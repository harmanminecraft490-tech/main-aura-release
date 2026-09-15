import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { CapabilityStatus } from '@/types'
import { Card } from './shared'

function healthColor(health: CapabilityStatus['health']): string {
  if (health === 'ok') return 'from-emerald-400 to-teal-500'
  if (health === 'degraded') return 'from-amber-400 to-orange-500'
  return 'from-white/25 to-white/10'
}

function statusLabel(cap: CapabilityStatus): string {
  if (cap.connected && cap.health === 'ok') return 'Connected'
  if (cap.health === 'degraded') return 'Degraded'
  if (cap.configured && !cap.connected) return 'Configured'
  return 'Unavailable'
}

/**
 * Capabilities — live status of every Aura capability the model can use.
 */
export function CapabilitiesTab({ onOpenIntegrations }: { onOpenIntegrations?: () => void }) {
  const [caps, setCaps] = useState<CapabilityStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!window.aura?.capabilities) {
      setCaps([])
      setLoading(false)
      return
    }
    try {
      const list = await window.aura.capabilities.list()
      setCaps(list)
    } catch {
      setCaps([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function refresh() {
    setRefreshing(true)
    try {
      const list = await window.aura!.capabilities.refresh()
      setCaps(list)
    } catch {
      await load()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Capabilities</h2>
          <p className="mt-1 text-sm text-white/40">
            What Aura can use right now. Unavailable items are never advertised as working to the model.
          </p>
        </div>
        <button
          className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-white/55 transition hover:bg-white/8 hover:text-white/80 disabled:opacity-40"
          disabled={refreshing}
          onClick={() => void refresh()}
          type="button"
        >
          {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
      </div>

      <Card title="Status">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-white/40">
            <Loader2 size={16} className="animate-spin" /> Loading capabilities…
          </div>
        ) : (
          <div className="space-y-2">
            {caps.map(cap => (
              <div
                key={cap.id}
                className="flex items-start gap-3 rounded-xl border border-white/6 bg-white/[0.02] px-3 py-3"
              >
                <span className={cn('mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-br', healthColor(cap.health))} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-white/80">{cap.name}</span>
                    <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold text-white/45">
                      {statusLabel(cap)}
                    </span>
                  </div>
                  {cap.error && <p className="mt-1 text-xs text-white/35">{cap.error}</p>}
                  {cap.tools.length > 0 && (
                    <p className="mt-1 font-mono text-[10px] text-white/25">{cap.tools.join(' · ')}</p>
                  )}
                </div>
                {(cap.id === 'figma' || cap.id === 'github' || cap.id === 'mcp' || cap.id === 'webSearch') && onOpenIntegrations && (
                  <button
                    className="shrink-0 rounded-lg px-2 py-1 text-[11px] text-aura-300/80 transition hover:bg-white/8"
                    onClick={onOpenIntegrations}
                    type="button"
                  >
                    Configure
                  </button>
                )}
                {cap.id === 'workspace' && !cap.connected && (
                  <span className="shrink-0 text-[11px] text-white/30">Open a project</span>
                )}
                {cap.connected && cap.health === 'ok' && (
                  <Check size={14} className="mt-0.5 shrink-0 text-emerald-400" />
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <p className="text-xs text-white/30">
        File delete/rename/run are controlled in <span className="text-white/50">Settings → Permissions</span>.
        API tokens live under <span className="text-white/50">Settings → Integrations</span>.
      </p>
    </div>
  )
}
