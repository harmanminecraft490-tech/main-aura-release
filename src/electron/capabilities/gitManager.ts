/**
 * GIT MANAGER
 *
 * Real Git integration using simple-git. Only active when:
 * 1. A workspace is open
 * 2. The workspace root is a Git repository (has a .git folder)
 *
 * All operations return REAL git state. Never fabricates status.
 */

import simpleGit, { type SimpleGit, type StatusResult, type LogResult } from 'simple-git'
import * as fs from 'fs'
import * as path from 'path'

export interface GitStatus {
  isGitRepo: boolean
  branch: string | null
  ahead: number
  behind: number
  staged: string[]
  modified: string[]
  untracked: string[]
  conflicted: string[]
  isClean: boolean
  error?: string
}

export interface GitCommit {
  hash: string
  date: string
  message: string
  author: string
}

class GitManager {
  private git: SimpleGit | null = null
  private root: string | null = null
  private _isRepo = false

  async activateWorkspace(root: string): Promise<void> {
    this.root = root
    this._isRepo = false
    this.git = null

    const gitDir = path.join(root, '.git')
    try {
      if (fs.existsSync(gitDir)) {
        this.git = simpleGit(root)
        this._isRepo = true
      }
    } catch {
      this._isRepo = false
    }
  }

  deactivate() {
    this.git = null
    this.root = null
    this._isRepo = false
  }

  get isRepo(): boolean {
    return this._isRepo
  }

  async status(): Promise<GitStatus> {
    if (!this.git || !this._isRepo) {
      return { isGitRepo: false, branch: null, ahead: 0, behind: 0, staged: [], modified: [], untracked: [], conflicted: [], isClean: true }
    }
    try {
      const status: StatusResult = await this.git.status()
      return {
        isGitRepo: true,
        branch: status.current,
        ahead: status.ahead,
        behind: status.behind,
        staged: [...status.staged],
        modified: [...status.modified],
        untracked: [...status.not_added],
        conflicted: [...status.conflicted],
        isClean: status.isClean(),
      }
    } catch (err) {
      return {
        isGitRepo: true,
        branch: null,
        ahead: 0,
        behind: 0,
        staged: [],
        modified: [],
        untracked: [],
        conflicted: [],
        isClean: true,
        error: err instanceof Error ? err.message : 'Git status failed',
      }
    }
  }

  async log(limit = 20): Promise<GitCommit[]> {
    if (!this.git || !this._isRepo) return []
    try {
      const log: LogResult = await this.git.log({ maxCount: limit })
      return log.all.map(c => ({
        hash: c.hash.slice(0, 8),
        date: c.date,
        message: c.message,
        author: c.author_name,
      }))
    } catch {
      return []
    }
  }

  async diff(file?: string): Promise<string> {
    if (!this.git || !this._isRepo) return ''
    try {
      return file ? await this.git.diff([file]) : await this.git.diff()
    } catch {
      return ''
    }
  }

  async stage(files: string[]): Promise<boolean> {
    if (!this.git || !this._isRepo) return false
    try {
      await this.git.add(files)
      return true
    } catch {
      return false
    }
  }

  async commit(message: string): Promise<boolean> {
    if (!this.git || !this._isRepo) return false
    try {
      await this.git.commit(message)
      return true
    } catch {
      return false
    }
  }

  async branches(): Promise<string[]> {
    if (!this.git || !this._isRepo) return []
    try {
      const summary = await this.git.branch()
      return summary.all
    } catch {
      return []
    }
  }

  async checkout(branch: string): Promise<boolean> {
    if (!this.git || !this._isRepo) return false
    try {
      await this.git.checkout(branch)
      return true
    } catch {
      return false
    }
  }
}

export const gitManager = new GitManager()
