import { useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'

type PermissionRequest = {
  streamId: string
  requestId: string
  toolName: string
  title: string
  detail: string
}

/**
 * Cursor/Claude-style tool permission prompt for mutating workspace actions.
 */
export function ToolPermissionPrompt() {
  const [request, setRequest] = useState<PermissionRequest | null>(null)

  useEffect(() => {
    const off = window.aura?.chat.on('tool-permission', payload => {
      const data = payload as unknown as Record<string, unknown>
      if (typeof data.requestId !== 'string') return
      setRequest({
        streamId: String(data.streamId ?? ''),
        requestId: data.requestId,
        toolName: String(data.toolName ?? 'tool'),
        title: String(data.title ?? data.toolName ?? 'Tool permission'),
        detail: String(data.detail ?? ''),
      })
    })
    return () => { off?.() }
  }, [])

  if (!request) return null

  async function respond(decision: 'allow' | 'allow-session' | 'deny') {
    const id = request!.requestId
    setRequest(null)
    await window.aura?.chat.respondToolPermission?.(id, decision)
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[80] flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-lg rounded-2xl border border-amber-400/25 bg-[#16140f]/96 p-4 shadow-2xl shadow-black/50 backdrop-blur-xl">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300">
            <ShieldAlert size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">Allow tool action?</p>
            <p className="mt-1 truncate text-[13px] text-white/75">{request.title}</p>
            {request.detail && (
              <p className="mt-1 line-clamp-3 font-mono text-[11px] text-white/40">{request.detail}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black transition hover:scale-[1.01]"
                onClick={() => void respond('allow')}
                type="button"
              >
                Allow once
              </button>
              <button
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10"
                onClick={() => void respond('allow-session')}
                type="button"
              >
                Allow for session
              </button>
              <button
                className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-500/15"
                onClick={() => void respond('deny')}
                type="button"
              >
                Deny
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
