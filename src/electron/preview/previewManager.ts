/**
 * PREVIEW MANAGER — runs or reuses the active project's dev server so Design
 * mode can preview the ACTUAL application (never a mockup, screenshot, or
 * placeholder).
 *
 * Key guarantees:
 *  - One tracked server per workspace root. Starting twice for the same root is
 *    a no-op (returns the live state) — never a duplicate server.
 *  - If something is ALREADY listening on the project's port, it is REUSED
 *    instead of spawning a second server.
 *  - The server runs in the background and nothing here blocks the AI response.
 *  - Non-HMR projects get a debounced `reload` event on file changes; Vite/HMR
 *    projects update by themselves and only get the reload count bumped.
 *  - Every failure is surfaced as an honest `error` state with the real reason
 *    so the UI can show "Preview unavailable" instead of pretending.
 */

import * as childProcess from 'child_process'
import * as fs from 'fs'
import * as http from 'http'
import * as path from 'path'

export type PreviewStatus = 'idle' | 'starting' | 'ready' | 'error' | 'stopped'
export type PreviewProjectType = 'vite' | 'node' | 'static' | 'unknown'

export interface PreviewState {
  root: string
  status: PreviewStatus
  url: string | null
  projectType: PreviewProjectType
  command: string | null
  error?: string
  reloadCount: number
}

export interface PreviewEvent extends PreviewState {
  event: 'status' | 'reload'
}

const DEBOUNCE_MS = 350
const READY_TIMEOUT_MS = 30_000
const PORT_PROBE_TIMEOUT_MS = 1200
const IGNORED_WATCH_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.cache', 'vendor',
  'target', 'out', '.next', 'release', 'bin', 'obj', 'tmp', 'logs',
  '.claude', '.idea', '.vscode', '__pycache__', '.venv', 'venv', 'Pods', '.pytest_cache',
])

interface RunningServer {
  root: string
  child: childProcess.ChildProcess | null
  httpServer: http.Server | null
  state: PreviewState
  watcher: fs.FSWatcher | null
  debounceTimer: NodeJS.Timeout | null
  disposed: boolean
}

interface ProjectDetect {
  type: PreviewProjectType
  args: string[]
  defaultPort: number
}

function normalizeRoot(root: string): string {
  return path.resolve(root)
}

function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

/** Identify the project's dev stack so the right server is (re)used. */
function detectProject(root: string): ProjectDetect {
  const pkgPath = path.join(root, 'package.json')
  type PkgJson = { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  let pkg: PkgJson | null = null
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as PkgJson
  } catch {
    // no package.json — not a node project
  }

  const isVite =
    fs.existsSync(path.join(root, 'vite.config.ts')) ||
    fs.existsSync(path.join(root, 'vite.config.js')) ||
    fs.existsSync(path.join(root, 'vite.config.mjs')) ||
    Boolean(pkg?.devDependencies?.vite || pkg?.dependencies?.vite)

  if (isVite) return { type: 'vite', args: ['run', 'dev'], defaultPort: 5173 }

  const scripts = pkg?.scripts ?? {}
  for (const name of ['dev', 'start', 'preview', 'serve', 'web']) {
    if (typeof scripts[name] === 'string' && scripts[name].trim()) {
      return { type: 'node', args: ['run', name], defaultPort: 3000 }
    }
  }

  if (fs.existsSync(path.join(root, 'index.html'))) {
    return { type: 'static', args: [], defaultPort: 4173 }
  }

  return { type: 'unknown', args: [], defaultPort: 3000 }
}

/** Extract the dev-server origin (scheme://host:port) from its startup output. */
function parseDevOrigin(output: string): string | null {
  const match =
    /https?:\/\/localhost:\d+/i.exec(output) ??
    /https?:\/\/127\.0\.0\.1:\d+/.exec(output) ??
    /https?:\/\/\[::1\]:\d+/.exec(output)
  return match ? match[0] : null
}

/** True when a server already answers on the URL (used to reuse, not duplicate). */
function probeUrl(url: string, timeoutMs = PORT_PROBE_TIMEOUT_MS): Promise<string | null> {
  return new Promise(resolve => {
    const req = http.get(url, { timeout: timeoutMs }, res => {
      res.resume()
      resolve(url)
    })
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.on('error', () => resolve(null))
  })
}

function shouldIgnoreWatchPath(rel: string): boolean {
  return rel.split(path.sep).some(segment => IGNORED_WATCH_DIRS.has(segment) || segment.startsWith('.'))
}

// ── Minimal static file server (no external dependency) ─────────────────────
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.map': 'application/json',
}

function staticContentType(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

function createStaticServer(root: string): http.Server {
  return http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0])
    let filePath = path.join(root, rel === '/' ? 'index.html' : rel)
    try {
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        const index = path.join(root, 'index.html')
        if (fs.existsSync(index) && fs.statSync(index).isFile()) filePath = index
        else { res.writeHead(404); res.end('Not found'); return }
      }
      const data = fs.readFileSync(filePath)
      res.writeHead(200, { 'Content-Type': staticContentType(filePath) })
      res.end(data)
    } catch {
      res.writeHead(404); res.end('Not found')
    }
  })
}

class PreviewManager {
  private servers = new Map<string, RunningServer>()
  private listeners = new Set<(event: PreviewEvent) => void>()

  onEvent(listener: (event: PreviewEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit(server: RunningServer, event: PreviewEvent['event']): void {
    const payload: PreviewEvent = { ...server.state, event }
    for (const listener of this.listeners) {
      try { listener(payload) } catch { /* a listener error must never break preview */ }
    }
  }

  status(root: string): PreviewState {
    const key = normalizeRoot(root)
    const server = this.servers.get(key)
    if (!server) return { root: key, status: 'idle', url: null, projectType: 'unknown', command: null, reloadCount: 0 }
    return { ...server.state }
  }

  list(): PreviewState[] {
    return [...this.servers.values()].map(server => ({ ...server.state }))
  }

  /**
   * Start (or reuse) the dev server for a workspace root.
   * Idempotent: a live server for the same root is returned as-is.
   */
  async start(rawRoot: string, opts?: { force?: boolean }): Promise<PreviewState> {
    const root = normalizeRoot(rawRoot)
    if (!fs.existsSync(root)) {
      return { root, status: 'error', url: null, projectType: 'unknown', command: null, error: 'Project folder does not exist.', reloadCount: 0 }
    }

    const existing = this.servers.get(root)
    if (existing && !existing.disposed && !opts?.force && existing.child && existing.child.exitCode === null) {
      return { ...existing.state }
    }
    // Stale entry (dead process / errored) → clean it before a fresh start.
    this.stop(root)

    const detect = detectProject(root)
    const state: PreviewState = {
      root,
      status: 'starting',
      url: null,
      projectType: detect.type,
      command: detect.type === 'static' ? 'built-in static server' : `${npmCommand()} ${detect.args.join(' ')}`,
      reloadCount: 0,
    }
    const server: RunningServer = {
      root, child: null, httpServer: null, state, watcher: null, debounceTimer: null, disposed: false,
    }
    this.servers.set(root, server)
    this.emit(server, 'status')

    if (detect.type === 'unknown') {
      return this.failTo(server, 'No dev server detected. Design preview needs a package.json dev script or an index.html in the project folder.')
    }

    // REUSE an already-running server on the default port — never a duplicate.
    if (detect.type !== 'static') {
      const reuseUrl = await probeUrl(`http://localhost:${detect.defaultPort}`)
      if (reuseUrl) {
        server.state.url = reuseUrl
        server.state.status = 'ready'
        this.emit(server, 'status')
        this.watchFiles(root, server)
        return { ...server.state }
      }
    }

    // Static site → serve in-process (no child process to leak).
    if (detect.type === 'static') {
      try {
        const httpServer = createStaticServer(root)
        await new Promise<void>((resolve, reject) => {
          httpServer.once('error', reject)
          httpServer.listen(0, '127.0.0.1', () => resolve())
        })
        const address = httpServer.address()
        const port = typeof address === 'object' && address !== null ? address.port : 4173
        server.httpServer = httpServer
        server.state.url = `http://localhost:${port}`
        server.state.status = 'ready'
        this.emit(server, 'status')
        this.watchFiles(root, server)
        return { ...server.state }
      } catch (error) {
        return this.failTo(server, error instanceof Error ? error.message : 'Failed to start the static preview server.')
      }
    }

    // Spawn the project's dev server in the background.
    let child: childProcess.ChildProcess
    try {
      child = childProcess.spawn(npmCommand(), detect.args, {
        cwd: root,
        shell: process.platform === 'win32',
        env: { ...process.env, BROWSER: 'none' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      return this.failTo(server, `Failed to start the dev server: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
    server.child = child

    let output = ''
    const onData = (chunk: string): void => {
      if (server.disposed) return
      output += chunk
      // Parse the real origin (vite auto-increments ports, so the actual URL
      // always wins over any default guess).
      if (!server.state.url) {
        const origin = parseDevOrigin(output)
        if (origin) {
          server.state.url = origin
          server.state.status = 'ready'
          this.emit(server, 'status')
          this.watchFiles(root, server)
        }
      }
    }
    child.stdout?.on('data', chunk => onData(String(chunk)))
    child.stderr?.on('data', chunk => onData(String(chunk)))

    child.on('error', error => {
      if (server.disposed) return
      this.failTo(server, `Failed to start the dev server: ${error.message}`)
    })

    child.on('exit', code => {
      if (server.disposed) return
      server.child = null
      if (server.state.status === 'ready') {
        server.state.status = 'stopped'
        this.emit(server, 'status')
      } else if (server.state.status === 'starting') {
        this.failTo(server, `The dev server exited before becoming ready (code ${code ?? 'unknown'}). See the terminal for details.`)
      }
    })

    this.waitForReady(server, detect)
    return { ...server.state }
  }

  /** Poll the parsed URL (or default port) until the page actually answers. */
  private waitForReady(server: RunningServer, detect: ProjectDetect): void {
    const deadline = Date.now() + READY_TIMEOUT_MS
    const poll = async (): Promise<void> => {
      if (server.disposed || server.state.status !== 'starting') return
      const url = server.state.url ?? (await probeUrl(`http://localhost:${detect.defaultPort}`))
      if (url) {
        server.state.url = url
        server.state.status = 'ready'
        this.emit(server, 'status')
        this.watchFiles(server.root, server)
        return
      }
      if (Date.now() >= deadline) {
        this.failTo(server, 'Timed out waiting for the dev server to start.')
        return
      }
      setTimeout(() => void poll(), 600)
    }
    void poll()
  }

  private watchFiles(root: string, server: RunningServer): void {
    if (server.watcher) {
      try { server.watcher.close() } catch { /* ignore */ }
      server.watcher = null
    }
    try {
      server.watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (server.disposed || !filename) return
        if (shouldIgnoreWatchPath(String(filename))) return
        if (server.debounceTimer) clearTimeout(server.debounceTimer)
        server.debounceTimer = setTimeout(() => {
          server.state.reloadCount += 1
          this.emit(server, 'reload')
        }, DEBOUNCE_MS)
      })
    } catch {
      // recursive watch unsupported — HMR still covers Vite projects.
    }
  }

  stop(root: string): PreviewState {
    const server = this.servers.get(normalizeRoot(root))
    if (!server) return this.status(root)
    this.disposeServer(server)
    return { ...server.state }
  }

  stopAll(): void {
    for (const server of [...this.servers.values()]) this.disposeServer(server)
  }

  private disposeServer(server: RunningServer): void {
    server.disposed = true
    if (server.debounceTimer) clearTimeout(server.debounceTimer)
    if (server.watcher) { try { server.watcher.close() } catch { /* ignore */ } }
    if (server.httpServer) { try { server.httpServer.close() } catch { /* ignore */ } }
    if (server.child && server.child.exitCode === null) {
      try {
        if (process.platform === 'win32' && server.child.pid) {
          childProcess.spawn('taskkill', ['/pid', String(server.child.pid), '/T', '/F'])
        } else {
          server.child.kill('SIGTERM')
        }
      } catch { /* process already gone */ }
    }
    server.child = null
    server.state.status = 'stopped'
    this.emit(server, 'status')
    this.servers.delete(server.root)
  }

  private failTo(server: RunningServer, error: string): PreviewState {
    server.state.status = 'error'
    server.state.error = error
    if (server.debounceTimer) clearTimeout(server.debounceTimer)
    if (server.watcher) { try { server.watcher.close() } catch { /* ignore */ } }
    if (server.httpServer) { try { server.httpServer.close() } catch { /* ignore */ } }
    if (server.child && server.child.exitCode === null) {
      try { server.child.kill() } catch { /* ignore */ }
    }
    server.child = null
    this.emit(server, 'status')
    return { ...server.state }
  }
}

export const previewManager = new PreviewManager()
