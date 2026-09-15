/**
 * WORKSPACE MANAGER — the AI's view of the current project's files.
 *
 * The active project's workspace folder is the working directory. All file
 * operations go through the WorkspaceFs (real disk I/O with post-write
 * verification) and are gated by the permission system. Every operation is
 * logged to workspace-file-ops.log for developer mode.
 */

import { app, shell } from 'electron'
import * as childProcess from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { WorkspaceFs, type FsOpResult, type WorkspaceOp } from './workspaceFs'
import { indexer } from './indexer'
import { projectManager } from '../services/ProjectManager'

// ─────────────────────────────────────────────────────────────────────────────
// Permissions
// ─────────────────────────────────────────────────────────────────────────────

export type FilePermission = 'read' | 'write' | 'delete' | 'rename' | 'run'
export const ALL_PERMISSIONS: FilePermission[] = ['read', 'write', 'delete', 'rename', 'run']
const DEFAULT_GRANTS: FilePermission[] = ['read', 'write'] // usable out of the box; destructive ops need explicit grant

const PERMISSION_FILE = () => path.join(app.getPath('userData'), 'workspace-permissions.json')

function opToPermission(op: WorkspaceOp | 'run'): FilePermission {
  switch (op) {
    case 'read': case 'list': case 'stat': case 'open': return 'read'
    case 'write': case 'append': case 'mkdir': case 'copy': case 'move': return 'write'
    case 'delete': return 'delete'
    case 'rename': return 'rename'
    case 'run': return 'run'
    default: return 'read'
  }
}

class PermissionManager {
  private grants = new Map<string, Set<FilePermission>>()

  private load() {
    try {
      const raw = fs.readFileSync(PERMISSION_FILE(), 'utf8')
      const parsed = JSON.parse(raw) as Record<string, FilePermission[]>
      for (const [projectId, ops] of Object.entries(parsed)) {
        this.grants.set(projectId, new Set(ops))
      }
    } catch {
      // first run — no grants yet
    }
  }

  private save() {
    try {
      const data: Record<string, FilePermission[]> = {}
      for (const [projectId, ops] of this.grants) data[projectId] = [...ops]
      fs.mkdirSync(path.dirname(PERMISSION_FILE()), { recursive: true })
      fs.writeFileSync(PERMISSION_FILE(), JSON.stringify(data, null, 2), 'utf8')
    } catch {
      // ignore persistence errors
    }
  }

  constructor() { this.load() }

  grant(projectId: string, ops: FilePermission[]) {
    // Seed defaults so granting delete/rename/run never strips read/write.
    const set = this.grants.get(projectId) ?? new Set<FilePermission>(DEFAULT_GRANTS)
    for (const op of ops) set.add(op)
    this.grants.set(projectId, set)
    this.save()
  }

  revoke(projectId: string, op: FilePermission) {
    const set = this.grants.get(projectId) ?? new Set<FilePermission>(DEFAULT_GRANTS)
    set.delete(op)
    this.grants.set(projectId, set)
    this.save()
  }

  has(projectId: string, op: FilePermission): boolean {
    return this.list(projectId).includes(op)
  }

  list(projectId: string): FilePermission[] {
    const set = this.grants.get(projectId)
    if (!set) return [...DEFAULT_GRANTS]
    // Always keep explicitly stored grants; seed missing defaults only when the
    // project has never revoked read/write (they remain unless deleted from set).
    const merged = new Set<FilePermission>(set)
    for (const op of DEFAULT_GRANTS) {
      // If the stored set was created before seeding existed and only has
      // opt-in ops, restore defaults so the workspace stays usable.
      if (![...set].some(item => item === 'read' || item === 'write') && (op === 'read' || op === 'write')) {
        merged.add(op)
      }
    }
    return ALL_PERMISSIONS.filter(op => merged.has(op))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Developer log (also written to disk)
// ─────────────────────────────────────────────────────────────────────────────

class FileOpsLog {
  private entries: Array<Record<string, unknown>> = []
  private file = () => path.join(app.getPath('userData'), 'workspace-file-ops.log')

  push(entry: Record<string, unknown>) {
    this.entries.push({ timestamp: Date.now(), ...entry })
    if (this.entries.length > 500) this.entries.shift()
    try {
      fs.appendFileSync(this.file(), `${JSON.stringify({ timestamp: Date.now(), ...entry })}\n`, 'utf8')
    } catch {
      // log file unwritable — keep in-memory only
    }
  }

  list(): Array<Record<string, unknown>> {
    return [...this.entries].reverse()
  }

  clear() {
    this.entries = []
    try { fs.writeFileSync(this.file(), '', 'utf8') } catch { /* ignore */ }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace Manager
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkspaceState {
  projectId: string | null
  root: string | null
  currentFile: string | null
  currentFolder: string | null
  permissions: FilePermission[]
  bypass?: boolean
}

export interface WorkspaceAction {
  action: 'write' | 'read' | 'append' | 'mkdir' | 'list' | 'stat' | 'delete' | 'rename' | 'move' | 'copy' | 'open' | 'run'
  path: string
  content?: string
  newPath?: string
  overwrite?: boolean
}

class WorkspaceManager {
  private projectId: string | null = null
  private root: string | null = null
  private currentFile: string | null = null
  private currentFolder: string | null = null
  private fs: WorkspaceFs | null = null
  private bypass = false
  readonly permissions = new PermissionManager()
  readonly opsLog = new FileOpsLog()

  /** Rebuild the WorkspaceFs with the current root / permission policy. */
  private refreshFs() {
    if (this.bypass) {
      // Bypass mode: access the entire computer. Root = drive root, all ops allowed.
      const driveRoot = path.parse(process.cwd()).root || '/'
      this.root = driveRoot
      this.fs = new WorkspaceFs({
        root: driveRoot,
        can: () => ({ allowed: true }),
        log: entry => this.opsLog.push(entry),
      })
      indexer.dispose() // never index the whole computer
      return
    }
    if (this.projectId && this.root) {
      this.fs = new WorkspaceFs({
        root: this.root,
        can: (op, abs) => this.checkPermission(op),
        log: entry => this.opsLog.push(entry),
      })
      // Background indexing + watcher: never blocks the UI.
      void indexer.start(this.root)
    } else {
      this.fs = null
      indexer.dispose()
    }
  }

  /** Toggle full-computer access (bypass AI mode). */
  setBypass(enabled: boolean) {
    this.bypass = enabled
    this.refreshFs()
  }

  get isBypass(): boolean {
    return this.bypass
  }

  /** Activate a project: its workspace folder becomes the working directory. */
  activateProject(projectId: string): WorkspaceState {
    const project = projectManager.list().find(p => p.id === projectId)
    const root = project?.settings?.workspace?.trim()
    if (!root) {
      // No workspace chosen yet → keep fs inactive until the user picks a folder.
      this.projectId = projectId
      this.root = null
      this.currentFile = null
      this.currentFolder = ''
      this.refreshFs()
      return this.state()
    }
    this.bypass = false
    this.projectId = projectId
    this.root = root
    this.currentFile = null
    this.currentFolder = ''
    this.refreshFs()
    return this.state()
  }

  deactivate() {
    this.projectId = null
    this.root = null
    this.currentFile = null
    this.currentFolder = null
    this.bypass = false
    this.refreshFs()
  }

  get active(): boolean {
    return Boolean(this.fs)
  }

  state(): WorkspaceState {
    return {
      projectId: this.projectId,
      root: this.root,
      currentFile: this.currentFile,
      currentFolder: this.currentFolder,
      permissions: this.projectId ? this.permissions.list(this.projectId) : [],
      bypass: this.bypass,
    }
  }

  /** Background index status (files indexed / still indexing / watched). */
  indexStatus() {
    return indexer.status()
  }

  /** Incremental keyword search over the background index. */
  search(query: string, limit = 50) {
    return indexer.search(query, limit)
  }

  setCurrentFile(relPath: string) {
    this.currentFile = relPath || null
  }

  setCurrentFolder(relPath: string) {
    this.currentFolder = relPath || ''
  }

  /** Absolute path for a relative workspace path ('' → root). */
  abs(relPath: string): string | null {
    if (!this.root) return null
    return path.resolve(this.root, relPath || '')
  }

  grant(ops: FilePermission[]) {
    if (!this.projectId) return
    this.permissions.grant(this.projectId, ops)
  }

  revoke(op: FilePermission) {
    if (!this.projectId) return
    this.permissions.revoke(this.projectId, op)
  }

  private checkPermission(op: WorkspaceOp | 'run'): { allowed: boolean; reason?: string } {
    if (this.bypass) return { allowed: true } // bypass = full computer access
    if (!this.projectId || !this.fs) return { allowed: false, reason: 'No workspace active' }
    const permission = opToPermission(op)
    if (!this.permissions.has(this.projectId, permission)) {
      return { allowed: false, reason: `Workspace permission not granted: ${permission}. Grant it in Settings → Permissions.` }
    }
    return { allowed: true }
  }

  /**
   * Execute a file action through the WorkspaceFs. Returns the REAL result;
   * the AI can only ever report what this returns.
   */
  async execute(action: WorkspaceAction): Promise<FsOpResult> {
    if (!this.fs) {
      return {
        success: false, operation: action.action, path: action.path, exists: false,
        error: 'I cannot modify files directly because the workspace backend is unavailable.',
      }
    }
    switch (action.action) {
      case 'write': return this.fs.write(action.path, action.content ?? '', { overwrite: action.overwrite })
      case 'read': return this.fs.read(action.path)
      case 'append': return this.fs.append(action.path, action.content ?? '')
      case 'mkdir': return this.fs.mkdir(action.path)
      case 'list': return this.fs.list(action.path || '')
      case 'stat': return this.fs.stat(action.path)
      case 'delete': return this.fs.delete(action.path)
      case 'rename': return this.fs.rename(action.path, action.newPath ?? '')
      case 'move': return this.fs.move(action.path, action.newPath ?? '')
      case 'copy': return this.fs.copy(action.path, action.newPath ?? '')
      case 'open': return this.fs.open(action.path || '', { openPath: p => shell.openPath(p) })
      case 'run': return this.runCommand(action)
      default: {
        const unknown: WorkspaceAction['action'] = action.action
        return { success: false, operation: String(unknown), path: action.path, exists: false, error: `Unknown action: ${String(unknown)}` }
      }
    }
  }

  private runCommand(action: WorkspaceAction): FsOpResult {
    const started = Date.now()
    const command = (action.content ?? '').trim()
    if (!command) return { success: false, operation: 'run', path: action.path, exists: false, error: 'No command provided' }
    const permission = this.checkPermission('run')
    if (!permission.allowed) return { success: false, operation: 'run', path: action.path, exists: false, error: permission.reason ?? 'Run not permitted' }
    const cwd = this.root ?? process.cwd()
    try {
      const result = childProcess.spawnSync(command, { cwd, shell: true, encoding: 'utf8', timeout: 30_000 })
      const data = { stdout: (result.stdout ?? '').slice(0, 20_000), stderr: (result.stderr ?? '').slice(0, 10_000), exitCode: result.status }
      this.opsLog.push({
        operation: 'run', path: cwd, started, finished: Date.now(), success: result.status === 0,
        durationMs: Date.now() - started, error: result.status === 0 ? undefined : `exit ${result.status}`,
      })
      return {
        success: result.status === 0, operation: 'run', path: cwd, exists: true,
        durationMs: Date.now() - started, data,
        error: result.status === 0 ? undefined : `Command failed (exit ${result.status})`,
      }
    } catch (error) {
      return { success: false, operation: 'run', path: cwd, exists: false, error: error instanceof Error ? error.message : 'Run failed' }
    }
  }
}

export const workspaceManager = new WorkspaceManager()
