import { randomUUID } from 'crypto'
import { isMutatingWorkspaceAction } from './modeRouter'

export type ToolPermissionDecision = 'allow' | 'allow-session' | 'deny'

type Pending = {
  resolve: (decision: ToolPermissionDecision) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, Pending>()
/** Session allowlist: `${tool}:${action}` → true */
const sessionAllows = new Set<string>()

export function clearToolPermissionSession(): void {
  sessionAllows.clear()
}

export function resolveToolPermissionResponse(requestId: string, decision: ToolPermissionDecision): boolean {
  const entry = pending.get(requestId)
  if (!entry) return false
  clearTimeout(entry.timer)
  pending.delete(requestId)
  if (decision === 'allow-session') {
    // key is attached on the pending request via closure — handled by caller storing session key
  }
  entry.resolve(decision)
  return true
}

export function rememberSessionAllow(key: string): void {
  sessionAllows.add(key)
}

export function isSessionAllowed(key: string): boolean {
  return sessionAllows.has(key)
}

export function sessionKeyForTool(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'workspace_file') {
    return `workspace_file:${String(args.action ?? 'unknown')}`
  }
  return toolName
}

/** Whether this tool call should prompt the user (Cursor/Claude-style). */
export function shouldPromptForTool(
  toolName: string,
  args: Record<string, unknown>,
  opts: { bypass: boolean; effectiveMode: string }
): boolean {
  if (opts.bypass || opts.effectiveMode === 'bypass') return false
  if (toolName !== 'workspace_file') return false
  const action = String(args.action ?? '')
  if (!isMutatingWorkspaceAction(action)) return false
  const key = sessionKeyForTool(toolName, args)
  if (isSessionAllowed(key)) return false
  // Always prompt for destructive / run; also for write/mkdir so first edits are visible.
  return true
}

export function waitForToolPermission(params: {
  requestId?: string
  timeoutMs?: number
}): { requestId: string; promise: Promise<ToolPermissionDecision> } {
  const requestId = params.requestId ?? randomUUID()
  const timeoutMs = params.timeoutMs ?? 120_000
  const promise = new Promise<ToolPermissionDecision>(resolve => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      resolve('deny')
    }, timeoutMs)
    pending.set(requestId, { resolve, timer })
  })
  return { requestId, promise }
}

export function summarizeToolArgs(toolName: string, args: Record<string, unknown>): {
  title: string
  detail: string
} {
  if (toolName === 'workspace_file') {
    const action = String(args.action ?? 'action')
    const filePath = String(args.path ?? '')
    const newPath = typeof args.newPath === 'string' ? args.newPath : ''
    const title = `${action.toUpperCase()} ${filePath || 'workspace'}`.trim()
    const detail = newPath
      ? `${action} ${filePath} → ${newPath}`
      : action === 'run'
        ? `run: ${String(args.content ?? '').slice(0, 200)}`
        : `${action} ${filePath}`
    return { title, detail }
  }
  return { title: toolName, detail: JSON.stringify(args).slice(0, 240) }
}
