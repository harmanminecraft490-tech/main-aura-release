import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, FolderOpen, RefreshCw } from 'lucide-react'
import type { FilePermission, WorkspaceState } from '@/types'
import { GhostButton, SettingsGroup, SettingsPageHeader, SettingsRow, Toggle } from './shared'

const PERMISSION_ROWS: Array<{
  id: FilePermission
  label: string
  description: string
  danger?: boolean
}> = [
  { id: 'read', label: 'Read files', description: 'List, open, and read files in the active workspace.' },
  { id: 'write', label: 'Write files', description: 'Create and edit files (write, append, mkdir, copy, move).' },
  { id: 'delete', label: 'Delete files', description: 'Allow workspace_file delete. Required before Aura can remove files.', danger: true },
  { id: 'rename', label: 'Rename files', description: 'Allow rename / move path changes inside the workspace.', danger: true },
  { id: 'run', label: 'Run commands', description: 'Allow workspace_file run / terminal commands in the project folder.', danger: true },
]

export function PermissionsPage() {
  const [state, setState] = useState<WorkspaceState | null>(null)
  const [busy, setBusy] = useState<FilePermission | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!window.aura?.workspace) {
      setError('Workspace bridge unavailable.')
      return
    }
    try {
      setState(await window.aura.workspace.state())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspace')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function toggle(permission: FilePermission, enabled: boolean) {
    if (!window.aura?.workspace || !state?.projectId) return
    setBusy(permission)
    try {
      const next = enabled
        ? await window.aura.workspace.grant([permission])
        : await window.aura.workspace.revoke(permission)
      setState(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const granted = new Set(state?.permissions ?? [])
  const ready = Boolean(state?.projectId && state.root)

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <SettingsPageHeader
        title="Permissions"
        description="Control what Aura’s workspace_file tool can do in the active project. Delete, rename, and run are off by default."
      />

      <SettingsGroup title="Active workspace">
        <SettingsRow
          label={state?.root ? 'Workspace connected' : state?.projectId ? 'No folder selected' : 'No project active'}
          description={state?.root ?? 'Open a project and choose a workspace folder to edit permissions.'}
        >
          <GhostButton onClick={() => void refresh()} title="Refresh">
            <RefreshCw size={12} /> Refresh
          </GhostButton>
        </SettingsRow>
        {state?.bypass && (
          <div className="flex items-start gap-2 border-t border-white/[0.06] px-4 py-3 text-[12px] text-amber-200">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            Bypass AI mode is on — permission toggles are skipped until you leave Bypass in AI Modes.
          </div>
        )}
        {state?.root && (
          <div className="flex items-center gap-2 border-t border-white/[0.06] px-4 py-2.5 font-mono text-[11px] text-white/35">
            <FolderOpen size={12} />
            <span className="truncate">{state.root}</span>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title="File tool permissions">
        {PERMISSION_ROWS.map(row => (
          <SettingsRow
            key={row.id}
            label={row.label}
            description={row.description}
            danger={row.danger}
          >
            <Toggle
              checked={granted.has(row.id)}
              onChange={value => {
                if (!ready || busy) return
                void toggle(row.id, value)
              }}
            />
          </SettingsRow>
        ))}
      </SettingsGroup>

      {!ready && (
        <p className="text-[12px] text-white/35">
          Activate a project with a workspace folder to change permissions.
        </p>
      )}
      {error && <p className="text-[12px] text-red-300">{error}</p>}
    </div>
  )
}
