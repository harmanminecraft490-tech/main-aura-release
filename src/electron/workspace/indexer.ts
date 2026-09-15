/**
 * WORKSPACE INDEXER — background, non-blocking, incremental.
 *
 * Walks the workspace in BATCHES, yielding to the event loop between batches
 * (setImmediate) so the renderer and main process never freeze. Ignores build
 * artifacts and caches. A debounced, batched fs.watch keeps the index current
 * incrementally — never a full rescan after a change.
 */

import * as fsp from 'fs/promises'
import * as fs from 'fs'
import * as path from 'path'

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.cache', 'vendor',
  'target', 'out', '.next', 'release', 'bin', 'obj', 'tmp', 'logs',
  '.claude', '.idea', '.vscode', '__pycache__', '.venv', 'venv', 'Pods', '.pytest_cache',
])

const IGNORED_EXTS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.ico', '.icns', '.mp3', '.mp4', '.mov', '.wav', '.ogg', '.woff', '.woff2',
  '.ttf', '.eot', '.zip', '.tar', '.gz', '.7z', '.rar', '.pdf', '.class',
  '.pyc', '.o', '.obj', '.map', '.min.js', '.lock',
])

const MAX_FILE_CHARS = 64 * 1024 // index at most 64 KB of content per file
const BATCH_SIZE = 128 // files indexed per event-loop yield
const DEBOUNCE_MS = 300

export interface IndexedFile {
  path: string
  rel: string
  name: string
  size: number
  mtime: number
  tokens: Set<string>
}

export interface IndexStatus {
  indexing: boolean
  indexed: number
  watched: boolean
}

export interface SearchHit {
  path: string
  rel: string
  name: string
  score: number
}

function tokenize(text: string): string[] {
  return Array.from(text.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter(token => token.length >= 2)
}

class WorkspaceIndexer {
  private index = new Map<string, IndexedFile>()
  private root: string | null = null
  private watcher: fs.FSWatcher | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private indexing = false
  private onProgress: ((status: IndexStatus) => void) | null = null

  setProgressListener(listener: ((status: IndexStatus) => void) | null) {
    this.onProgress = listener
  }

  async start(root: string): Promise<void> {
    this.dispose()
    this.root = root
    this.indexing = true
    this.emit()
    await this.walk(root, root)
    this.indexing = false
    this.emit()
    this.startWatcher(root)
  }

  private async walk(root: string, dir: string): Promise<void> {
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    let batch = 0
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        await this.walk(root, full)
      } else if (entry.isFile()) {
        if (this.indexable(full)) {
          await this.indexFile(full)
          batch += 1
          if (batch >= BATCH_SIZE) {
            batch = 0
            // Yield so the event loop (and renderer) stays responsive.
            await new Promise(resolve => setImmediate(resolve))
            if (this.root !== root) return // workspace switched mid-scan
            this.emit()
          }
        }
      }
    }
  }

  private indexable(abs: string): boolean {
    const ext = path.extname(abs).toLowerCase()
    return !IGNORED_EXTS.has(ext)
  }

  private async indexFile(abs: string): Promise<void> {
    try {
      const stat = await fsp.stat(abs)
      const name = path.basename(abs)
      const rel = path.relative(this.root ?? '', abs).split(path.sep).join('/')
      const tokens = new Set<string>(tokenize(name))
      if (stat.size > 0 && stat.size <= MAX_FILE_CHARS * 4) {
        try {
          const text = (await fsp.readFile(abs, 'utf8')).slice(0, MAX_FILE_CHARS)
          for (const token of tokenize(text)) tokens.add(token)
        } catch {
          // binary or unreadable — filename-only index entry
        }
      }
      this.index.set(abs, { path: abs, rel, name, size: stat.size, mtime: stat.mtimeMs, tokens })
    } catch {
      // file disappeared mid-scan — skip
    }
  }

  private startWatcher(root: string): void {
    try {
      this.watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (filename) this.scheduleUpdate(String(filename))
      })
    } catch {
      // recursive watching unsupported — index stays but won't auto-update
    }
  }

  private scheduleUpdate(rel: string): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      void this.update([rel])
    }, DEBOUNCE_MS)
  }

  /** Incremental update for a changed/added/removed path. No full rescan. */
  private async update(rels: string[]): Promise<void> {
    for (const rel of rels) {
      const abs = this.root ? path.join(this.root, rel) : rel
      try {
        const stat = await fsp.stat(abs)
        const existing = this.index.get(abs)
        if (existing && existing.mtime === stat.mtimeMs && existing.size === stat.size) continue
        if (this.indexable(abs)) await this.indexFile(abs)
        else this.index.delete(abs)
      } catch {
        this.index.delete(abs)
      }
    }
    this.emit()
  }

  search(query: string, limit = 50): SearchHit[] {
    const queryTokens = new Set(tokenize(query))
    if (queryTokens.size === 0) return []
    const hits: SearchHit[] = []
    for (const file of this.index.values()) {
      let contentScore = 0
      let nameScore = 0
      for (const token of queryTokens) {
        if (file.tokens.has(token)) contentScore += 1
      }
      for (const token of queryTokens) {
        if (file.name.toLowerCase().includes(token)) nameScore += 1
      }
      if (contentScore > 0 || nameScore > 0) {
        hits.push({
          path: file.path,
          rel: file.rel,
          name: file.name,
          score: nameScore * 4 + contentScore * 2,
        })
      }
    }
    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, limit)
  }

  status(): IndexStatus {
    return { indexing: this.indexing, indexed: this.index.size, watched: Boolean(this.watcher) }
  }

  private emit(): void {
    this.onProgress?.(this.status())
  }

  dispose(): void {
    if (this.watcher) {
      try { this.watcher.close() } catch { /* ignore */ }
      this.watcher = null
    }
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.index.clear()
    this.root = null
    this.indexing = false
  }
}

export const indexer = new WorkspaceIndexer()
