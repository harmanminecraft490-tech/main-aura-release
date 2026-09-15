import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, FolderOpen, Lock, RefreshCw, Shield } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { FilePermission, WorkspaceState } from '@/types'
import { Card, Toggle } from './shared'

const PERMISSION_META: Array<{
  id: FilePermission
  label: string
  description: string
  danger?: boolean
  defaultOn?: boolean
}> = [
  {
    id: 'read',
    label: 'Read files',
    description: 'List, open, and read files in the active workspace.',
    defaultOn: true,
  },
  {
    id: 'write',
    label: 'Write files',
    description: 'Create and edit files (write, append, mkdir, copy, move).',
    defaultOn: true,
  },
  {
    id: 'delete',
    label: 'Delete files',
    description: 'Allow workspace_file delete actions. Required before Aura can remove files.',
    danger: true,
  },
  {
    id: 'rename',
    label: 'Rename files',
    description: 'Allow rename operations inside the workspace.',
    danger: true,
  },
  {
    id: 'run',
    label: 'Run commands',
    description: 'Allow workspace_file run / terminal commands in the project folder.',
    danger: true,
  },
]

/**
 * Workspace Permissions — grant/revoke file-tool capabilities for the active project.
 * Maps directly to workspace.grant / workspace.revoke used by workspace_file.
 */
export function WorkspacePermissionsTab() {
  const [state, setState] = useState<WorkspaceState | null>(null)
  const [busy, setBusy] = useState<FilePermission | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!window.aura?.workspace) {
      setError('Workspace bridge unavailable.')
      return
    }
    try {
      const next = await window.aura.workspace.state()
      setState(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspace state')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 4000)
    return () => window.clearInterval(id)
  }, [refresh])

  async function toggle(permission: FilePermission, enabled: boolean) {
    if (!window.aura?.workspace || !state?.projectId) return
    setBusy(permission)
    try {
      const next = enabled
        ? await window.aura.workspace.grant([permission])
        : await window.aura.workspace.revoke(permission)
      setState(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update permission')
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const granted = new Set(state?.permissions ?? [])
  const hasProject = Boolean(state?.projectId)
  const hasRoot = Boolean(state?.root)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white">Workspace Permissions</h2>
        <p className="mt-1 text-sm text-white/40">
          Control what Aura&apos;s <code className="text-aura-300/80">workspace_file</code> tool can do
          in the active project. Delete, rename, and run are off by default.
        </p>
      </div>

      <Card title="Active workspace">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/8 text-aura-200">
              <FolderOpen size={18} />
            </div>
            <div className="min-w-0 flex-1">
              {!hasProject ? (
                <>
                  <p className="text-sm font-medium text-white/80">No project active</p>
                  <p className="text-xs text-white/35">
                    Open or create a project, then choose a workspace folder. Permissions are stored per project.
                  </p>
                </>
              ) : !hasRoot ? (
                <>
                  <p className="text-sm font-medium text-amber-300">Project has no workspace folder</p>
                  <p className="text-xs text-white/35">
                    Pick a folder for this project before file tools and permissions apply.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-white/80">Workspace connected</p>
                  <p className="truncate font-mono text-xs text-white/40" title={state?.root ?? ''}>
                    {state?.root}
                  </p>
                </>
              )}
            </div>
            <button
              className="rounded-xl border border-white/10 p-2 text-white/40 transition hover:bg-white/8 hover:text-white/70"
              onClick={() => void refresh()}
              title="Refresh"
              type="button"
            >
              <RefreshCw size={14} />
            </button>
          </div>

          {state?.bypass && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                Bypass AI mode is on — Aura has full computer access and these permission toggles are skipped.
                Switch to another AI Mode in Settings → AI Modes to restore normal workspace gates.
              </span>
            </div>
          )}
        </div>
      </Card>

      <Card
        title="File tool permissions"
        action={
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-white/30">
            <Shield size={11} /> workspace_file
          </span>
        }
      >
        <div className={cn('space-y-1', (!hasProject || !hasRoot) && 'pointer-events-none opacity-45')}>
          {PERMISSION_META.map(item => {
            const on = granted.has(item.id)
            return (
              <div
                key={item.id}
                className="flex items-center justify-between gap-4 rounded-xl px-2 py-3 transition hover:bg-white/[0.03]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white/75">{item.label}</span>
                    {item.danger && (
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                        Opt-in
                      </span>
                    )}
                    {item.defaultOn && (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400/80">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-white/35">{item.description}</p>
                </div>
                <Toggle
                  checked={on}
                  onChange={value => void toggle(item.id, value)}
                />
                {busy === item.id && <span className="sr-only">Updating…</span>}
              </div>
            )
          })}
        </div>

        {(!hasProject || !hasRoot) && (
          <p className="mt-3 flex items-center gap-2 text-xs text-white/35">
            <Lock size={12} /> Activate a project with a workspace folder to edit permissions.
          </p>
        )}
      </Card>

      {error && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
      )}
    </div>
  )
}
