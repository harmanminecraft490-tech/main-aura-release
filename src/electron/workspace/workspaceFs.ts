/**
 * WORKSPACE FILE API — the ONLY place real filesystem operations happen.
 *
 * Every operation is executed with fs.promises and then VERIFIED before it is
 * reported as a success (file exists, size matches, content read back matches).
 * A failure never reports success — it returns the real exception message.
 *
 * All paths are resolved inside the workspace root (path-traversal guarded).
 * Permission checks are enforced per operation via the `can` hook.
 *
 * Pure Node (testable in the harness).
 */

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'

export type WorkspaceOp =
  | 'read' | 'write' | 'append' | 'mkdir' | 'delete' | 'rename' | 'move'
  | 'copy' | 'list' | 'stat' | 'open'

export interface FsOpResult<T = unknown> {
  success: boolean
  operation: string
  /** Absolute path the operation acted on. */
  path: string
  /** Whether the path exists AFTER the operation. */
  exists: boolean
  bytesWritten?: number
  size?: number
  modifiedTime?: number
  checksum?: string
  data?: T
  error?: string
  durationMs?: number
}

export interface WorkspaceFsOptions {
  root: string
  can?: (op: WorkspaceOp, absPath: string) => { allowed: boolean; reason?: string }
  log?: (entry: Record<string, unknown>) => void
}

function checksum(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

export class WorkspaceFs {
  constructor(private readonly opts: WorkspaceFsOptions) {}

  private resolve(rel: string): string {
    if (rel === undefined || rel === null) throw new Error('Empty path')
    const raw = String(rel).trim()
    const root = path.resolve(this.opts.root)
    if (!raw) return root
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
      throw new Error(`Invalid path: unsupported scheme in "${raw.slice(0, 24)}…"`)
    }
    const abs = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(root, raw)
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new Error(`Path escapes the workspace root: ${raw}`)
    }
    return abs
  }

  private async run<T>(
    op: WorkspaceOp,
    relPath: string,
    fn: (abs: string) => Promise<T>,
    describe: (abs: string, data: T) => Partial<FsOpResult>
  ): Promise<FsOpResult> {
    const started = Date.now()
    let abs = ''
    try {
      abs = this.resolve(relPath)
      const permission = this.opts.can ? this.opts.can(op, abs) : { allowed: true }
      if (!permission.allowed) throw new Error(permission.reason ?? `Permission denied: ${op}`)
      const data = await fn(abs)
      const result = { ...describe(abs, data), success: true, path: abs, durationMs: Date.now() - started } as FsOpResult
      this.opts.log?.({
        operation: op, path: abs, started, finished: Date.now(), success: true,
        durationMs: result.durationMs, bytes: result.bytesWritten ?? result.size, error: undefined,
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const result: FsOpResult = {
        success: false, operation: op, path: abs || relPath, exists: false,
        error: message, durationMs: Date.now() - started,
      }
      this.opts.log?.({
        operation: op, path: abs || relPath, started, finished: Date.now(), success: false,
        durationMs: result.durationMs, error: message,
      })
      return result
    }
  }

  private async statOf(abs: string) {
    try {
      const st = await fsp.stat(abs)
      return { exists: true, size: st.size, modifiedTime: st.mtimeMs, isDirectory: st.isDirectory() }
    } catch {
      return { exists: false, size: 0, modifiedTime: 0, isDirectory: false }
    }
  }

  /** Write a file and verify: exists, size matches, content read back matches. */
  async write(relPath: string, content: string, opts?: { overwrite?: boolean }): Promise<FsOpResult> {
    return this.run('write', relPath, async abs => {
      if (opts?.overwrite === false && fs.existsSync(abs)) throw new Error('File already exists (overwrite not allowed)')
      await fsp.mkdir(path.dirname(abs), { recursive: true })
      await fsp.writeFile(abs, content, 'utf8')
      const bytes = Buffer.byteLength(content, 'utf8')
      const st = await fsp.stat(abs)
      const readBack = await fsp.readFile(abs, 'utf8')
      if (readBack !== content) throw new Error('Verification failed: written content does not match (read-back mismatch)')
      if (st.size !== bytes) throw new Error(`Verification failed: size mismatch (expected ${bytes}, got ${st.size})`)
      return { bytesWritten: bytes, size: st.size, modifiedTime: st.mtimeMs, checksum: checksum(content), exists: true }
    }, (abs, d) => ({
      operation: 'write', path: abs, exists: true, bytesWritten: d.bytesWritten,
      size: d.size, modifiedTime: d.modifiedTime, checksum: d.checksum,
      data: { bytesWritten: d.bytesWritten, modifiedTime: d.modifiedTime, checksum: d.checksum },
    }))
  }

  /** Read a file: returns content + size + mtime; fails if the file does not exist. */
  async read(relPath: string): Promise<FsOpResult> {
    return this.run('read', relPath, async abs => {
      if (!fs.existsSync(abs)) throw new Error('ENOENT: file does not exist')
      const content = await fsp.readFile(abs, 'utf8')
      const st = await fsp.stat(abs)
      return { content, size: st.size, modifiedTime: st.mtimeMs }
    }, (abs, d) => ({
      operation: 'read', path: abs, exists: true, size: d.size, modifiedTime: d.modifiedTime,
      data: { content: d.content, size: d.size, modifiedTime: d.modifiedTime },
    }))
  }

  /** Append to a file (creates it if missing), then verify size grew. */
  async append(relPath: string, content: string): Promise<FsOpResult> {
    return this.run('append', relPath, async abs => {
      const before = fs.existsSync(abs) ? (await fsp.stat(abs)).size : 0
      await fsp.mkdir(path.dirname(abs), { recursive: true })
      await fsp.appendFile(abs, content, 'utf8')
      const st = await fsp.stat(abs)
      const expected = before + Buffer.byteLength(content, 'utf8')
      if (st.size !== expected) throw new Error(`Verification failed: append size mismatch (expected ${expected}, got ${st.size})`)
      return { bytesWritten: Buffer.byteLength(content, 'utf8'), size: st.size, modifiedTime: st.mtimeMs, exists: true }
    }, (abs, d) => ({
      operation: 'append', path: abs, exists: true, bytesWritten: d.bytesWritten,
      size: d.size, modifiedTime: d.modifiedTime, data: { bytesWritten: d.bytesWritten, modifiedTime: d.modifiedTime },
    }))
  }

  /** Create a folder. */
  async mkdir(relPath: string): Promise<FsOpResult> {
    return this.run('mkdir', relPath, async abs => {
      await fsp.mkdir(abs, { recursive: true })
      const st = await fsp.stat(abs)
      return { exists: true, size: st.size, modifiedTime: st.mtimeMs, isDirectory: true }
    }, (abs, d) => ({
      operation: 'mkdir', path: abs, exists: d.exists, modifiedTime: d.modifiedTime,
      data: { isDirectory: true },
    }))
  }

  /** List a directory: files and folders (absolute + relative). */
  async list(relPath: string): Promise<FsOpResult> {
    return this.run('list', relPath, async abs => {
      const stat = await this.statOf(abs)
      if (!stat.exists) throw new Error('ENOENT: directory does not exist')
      if (!stat.isDirectory) throw new Error('ENOTDIR: path is not a directory')
      const entries = await fsp.readdir(abs, { withFileTypes: true })
      const files = []
      const folders = []
      for (const entry of entries) {
        const full = path.join(abs, entry.name)
        const rel = path.relative(this.opts.root, full).split(path.sep).join('/')
        if (entry.isDirectory()) folders.push(rel)
        else files.push(rel)
      }
      files.sort(); folders.sort()
      return { files, folders }
    }, (abs, d) => ({ operation: 'list', path: abs, exists: true, data: { files: d.files, folders: d.folders } }))
  }

  /** Stat a path. */
  async stat(relPath: string): Promise<FsOpResult> {
    return this.run('stat', relPath, async abs => {
      const s = await this.statOf(abs)
      if (!s.exists) throw new Error('ENOENT: path does not exist')
      return { exists: true, size: s.size, modifiedTime: s.modifiedTime, isDirectory: s.isDirectory }
    }, (abs, d) => ({
      operation: 'stat', path: abs, exists: d.exists, size: d.size, modifiedTime: d.modifiedTime,
      data: { size: d.size, modifiedTime: d.modifiedTime, isDirectory: d.isDirectory },
    }))
  }

  /** Delete a file or folder. Fails if the path does not exist. */
  async delete(relPath: string): Promise<FsOpResult> {
    return this.run('delete', relPath, async abs => {
      if (!fs.existsSync(abs)) throw new Error('ENOENT: path does not exist')
      const s = await this.statOf(abs)
      await fsp.rm(abs, { recursive: s.isDirectory, force: false })
      const after = await this.statOf(abs)
      if (after.exists) throw new Error('Verification failed: path still exists after delete')
      return { exists: false }
    }, abs => ({ operation: 'delete', path: abs, exists: false }))
  }

  /** Rename a file/folder. */
  async rename(relPath: string, newPath: string): Promise<FsOpResult> {
    return this.run('rename', relPath, async abs => {
      if (!fs.existsSync(abs)) throw new Error('ENOENT: source does not exist')
      const dest = this.resolve(newPath)
      await fsp.mkdir(path.dirname(dest), { recursive: true })
      await fsp.rename(abs, dest)
      const after = await this.statOf(dest)
      if (!after.exists) throw new Error('Verification failed: destination missing after rename')
      return { exists: true, size: after.size, modifiedTime: after.modifiedTime, dest }
    }, (abs, d) => ({
      operation: 'rename', path: abs, exists: true, size: d.size, modifiedTime: d.modifiedTime,
      data: { renamedTo: d.dest },
    }))
  }

  /** Move (rename) — same as rename but the caller may pass a destination relative to root. */
  async move(relPath: string, destPath: string): Promise<FsOpResult> {
    return this.rename(relPath, destPath)
  }

  /** Copy a file or folder recursively. */
  async copy(relPath: string, destPath: string): Promise<FsOpResult> {
    return this.run('copy', relPath, async abs => {
      if (!fs.existsSync(abs)) throw new Error('ENOENT: source does not exist')
      const dest = this.resolve(destPath)
      await fsp.mkdir(path.dirname(dest), { recursive: true })
      await fsp.cp(abs, dest, { recursive: true, force: true, errorOnExist: false })
      const after = await this.statOf(dest)
      if (!after.exists) throw new Error('Verification failed: copy destination missing')
      return { exists: true, size: after.size, modifiedTime: after.modifiedTime, dest }
    }, (abs, d) => ({
      operation: 'copy', path: abs, exists: true, size: d.size, modifiedTime: d.modifiedTime,
      data: { copiedTo: d.dest },
    }))
  }

  /** Open a folder in the OS file manager. */
  async open(relPath: string, shell: { openPath: (p: string) => Promise<string> }): Promise<FsOpResult> {
    return this.run('open', relPath, async abs => {
      const s = await this.statOf(abs)
      if (!s.exists) throw new Error('ENOENT: path does not exist')
      const error = await shell.openPath(abs)
      if (error) throw new Error(error)
      return { exists: true, size: s.size, modifiedTime: s.modifiedTime }
    }, (abs, d) => ({
      operation: 'open', path: abs, exists: d.exists, data: { opened: true },
    }))
  }
}
