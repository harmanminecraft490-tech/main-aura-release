import { useEffect, useState } from 'react'
import { RefreshCw, Trash2, CheckCircle2, XCircle, CircleSlash } from 'lucide-react'
import { useStore } from '@services/store'
import type { RequestLogEntry } from '@/types'
import { TabHeader, SettingRow, Toggle } from '../shared'
import { cn } from '@ui/cn'

export function DeveloperTab() {
  const settings = useStore(state => state.appSettings)
  const [log, setLog] = useState<RequestLogEntry[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      setLog(await window.aura.dev.requestLog())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  return (
    <div>
      <TabHeader
        title="Developer"
        description="Diagnostics and raw backend details. With Developer Mode off, the app shows only Aura branding."
      />

      <div className="space-y-3">
        <SettingRow
          label="Developer Mode"
          hint="Reveals backend model names, providers, latency, and token usage across the app."
        >
          <Toggle
            checked={settings.developerMode}
            onChange={next => void window.aura.settings.set({ developerMode: next })}
          />
        </SettingRow>
      </div>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/75">Request log</h3>
          <div className="flex gap-1">
            <button className="btn-subtle !px-2 !text-xs" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Refresh
            </button>
            <button
              className="btn-subtle !px-2 !text-xs hover:!text-red-300"
              onClick={async () => { await window.aura.dev.clearLog(); setLog([]) }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </button>
          </div>
        </div>

        {log.length === 0 ? (
          <div className="card p-6 text-center text-sm text-white/40">No requests yet this session.</div>
        ) : (
          <div className="card divide-y divide-white/[0.05] overflow-hidden !p-0">
            {log.map((entry, index) => (
              <div key={`${entry.id}-${index}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                {entry.status === 'success' ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : entry.status === 'aborted' ? (
                  <CircleSlash className="h-4 w-4 shrink-0 text-white/40" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-white/75">{entry.modelKey}</p>
                  <p className="truncate text-[11px] text-white/40">
                    {entry.auraModelId} · {entry.providerName}
                    {entry.error ? ` · ${entry.error}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right text-[11px] text-white/45">
                  <p>{(entry.latencyMs / 1000).toFixed(1)}s{entry.firstTokenMs != null ? ` · TTFT ${(entry.firstTokenMs / 1000).toFixed(1)}s` : ''}</p>
                  {entry.usage && <p>{entry.usage.totalTokens} tokens</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
