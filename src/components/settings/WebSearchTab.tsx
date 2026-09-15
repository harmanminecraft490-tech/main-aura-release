import { useEffect, useState } from 'react'
import { Check, Globe, Loader2, Search } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { WebSearchStatus } from '@/types'
import { Card, TextField, SelectField } from './shared'

type SearchProvider = 'serper' | 'brave' | 'tavily'

const PROVIDER_LABELS: Record<SearchProvider, string> = {
  serper: 'Serper (Google)',
  brave: 'Brave Search',
  tavily: 'Tavily',
}

const ENV_HINTS: Record<SearchProvider, string> = {
  serper: 'SERPER_API_KEY',
  brave: 'BRAVE_SEARCH_API_KEY',
  tavily: 'TAVILY_API_KEY',
}

/**
 * Web Search settings — connect Serper / Brave / Tavily and verify it.
 * Env keys always win over keys saved here.
 */
export function WebSearchTab() {
  const [status, setStatus] = useState<WebSearchStatus | null>(null)
  const [provider, setProvider] = useState<SearchProvider>('serper')
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function load() {
    try {
      const s = await window.aura!.web.searchStatus()
      setStatus(s)
      const p = s.provider
      if (p === 'serper' || p === 'brave' || p === 'tavily') setProvider(p)
    } catch {
      setStatus({ connected: false, provider: null, message: 'Web search bridge unavailable.' })
    }
  }

  useEffect(() => { void load() }, [])

  async function saveKey() {
    setSaving(true)
    setSaved(false)
    try {
      await window.aura!.capabilities.configureSearch(provider, key)
      await load()
      setKey('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await window.aura!.web.search('Aura AI desktop app', { num: 3 })
      setTestResult(res.success
        ? { ok: true, text: `Connected — ${res.results.length} results in ${res.duration}ms` }
        : { ok: false, text: `Failed: ${res.error ?? 'unknown error'}` })
    } catch (error) {
      setTestResult({ ok: false, text: `Failed: ${error instanceof Error ? error.message : 'unknown error'}` })
    } finally {
      setTesting(false)
    }
  }

  const connected = Boolean(status?.connected)

  return (
    <div className="max-w-4xl space-y-5">
      <Card title="Web Search">
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-br', connected ? 'from-emerald-400 to-teal-500' : 'from-white/20 to-white/5')} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-white/80">
                {connected ? `Connected — ${status?.provider ?? 'search'} enabled` : 'Not configured'}
              </p>
              <p className="text-xs text-white/35">{status?.message ?? 'Loading…'}</p>
            </div>
          </div>

          <SelectField
            label="Provider"
            value={provider}
            onChange={v => setProvider(v as SearchProvider)}
            options={[
              { value: 'serper', label: PROVIDER_LABELS.serper },
              { value: 'brave', label: PROVIDER_LABELS.brave },
              { value: 'tavily', label: PROVIDER_LABELS.tavily },
            ]}
          />

          <div>
            <TextField
              label={`${PROVIDER_LABELS[provider]} API key`}
              placeholder="Paste API key…"
              type="password"
              value={key}
              onChange={setKey}
            />
            <p className="mt-1.5 text-[11px] text-white/30">
              Aura also reads <code className="text-aura-300/70">{ENV_HINTS[provider]}</code> from your{' '}
              <code className="text-aura-300/70">.env</code> / <code className="text-aura-300/70">.env.local</code> —
              that always takes priority over a key saved here.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-surface-0 transition hover:scale-[1.02] disabled:opacity-40"
              disabled={saving || !key.trim()}
              onClick={() => void saveKey()}
              type="button"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              Save & Connect
            </button>
            <button
              className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-white/60 transition hover:bg-white/7 disabled:opacity-40"
              disabled={testing || !connected}
              onClick={() => void test()}
              type="button"
            >
              {testing ? <Loader2 size={15} className="animate-spin" /> : <Globe size={15} />}
              Test Search
            </button>
            {saved && (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <Check size={12} /> Saved
              </span>
            )}
          </div>

          {testResult && (
            <div className={cn(
              'rounded-xl px-3 py-2.5 text-xs',
              testResult.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
            )}>
              {testResult.text}
            </div>
          )}

          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-xs leading-relaxed text-white/40">
            <p className="flex items-center gap-1.5 font-medium text-white/55">
              <Search size={12} /> How Aura uses web search
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>Search activates when your message looks time-sensitive or asks for current info.</li>
              <li>Results come from the real internet — the AI never fabricates them.</li>
              <li>You can also manage search keys under Settings → Integrations.</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  )
}
