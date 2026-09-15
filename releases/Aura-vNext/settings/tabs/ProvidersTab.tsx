import { useState } from 'react'
import {
  Plus, RefreshCw, Trash2, Pencil, CheckCircle2, XCircle, Loader2, Zap, Globe,
} from 'lucide-react'
import { useStore } from '@services/store'
import type { ProviderConfig } from '@/types'
import { TabHeader } from '../shared'
import { cn } from '@ui/cn'

type Draft = {
  name: string
  protocol: 'openai-compat' | 'anthropic'
  baseURL: string
  apiKey: string
  organization: string
  headersText: string
  timeoutMs: number
}

const EMPTY_DRAFT: Draft = {
  name: '',
  protocol: 'openai-compat',
  baseURL: '',
  apiKey: '',
  organization: '',
  headersText: '',
  timeoutMs: 30_000,
}

function parseHeaders(text: string): Record<string, string> | undefined {
  const headers: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return Object.keys(headers).length ? headers : undefined
}

function draftToInput(draft: Draft): Partial<ProviderConfig> {
  return {
    name: draft.name.trim(),
    protocol: draft.protocol,
    baseURL: draft.baseURL.trim(),
    apiKey: draft.apiKey.trim(),
    organization: draft.organization.trim() || undefined,
    headers: parseHeaders(draft.headersText),
    timeoutMs: draft.timeoutMs,
  }
}

export function ProvidersTab() {
  const providers = useStore(state => state.providers)
  const models = useStore(state => state.models)
  const [editing, setEditing] = useState<ProviderConfig | null>(null)
  const [showForm, setShowForm] = useState(false)

  const modelCount = (providerId: string) => models.filter(model => model.providerId === providerId).length

  return (
    <div>
      <TabHeader
        title="Providers"
        description="One API key unlocks every model behind it — Aura discovers models automatically. Add any OpenAI-compatible or Anthropic endpoint."
      />

      {!showForm && (
        <button className="btn-primary mb-5" onClick={() => { setEditing(null); setShowForm(true) }}>
          <Plus className="h-4 w-4" /> Add provider
        </button>
      )}

      {showForm && (
        <ProviderForm
          key={editing?.id ?? 'new'}
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null) }}
        />
      )}

      <div className="space-y-3">
        {providers.length === 0 && !showForm && (
          <div className="card flex flex-col items-center gap-2 p-8 text-center">
            <Globe className="h-8 w-8 text-white/25" />
            <p className="text-white/60">No providers yet.</p>
            <p className="text-sm text-white/35">
              Add your gateway or provider — for example base URL <code className="rounded bg-white/10 px-1">https://your-api.com/v1</code> — and every model it serves appears automatically.
            </p>
          </div>
        )}

        {providers.map(provider => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            modelCount={modelCount(provider.id)}
            onEdit={() => { setEditing(provider); setShowForm(true) }}
          />
        ))}
      </div>
    </div>
  )
}

function ProviderCard({ provider, modelCount, onEdit }: {
  provider: ProviderConfig
  modelCount: number
  onEdit: () => void
}) {
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async () => {
    setRefreshing(true)
    try {
      await window.aura.providers.refreshModels(provider.id)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white">{provider.name}</h3>
            <span className="badge">{provider.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'}</span>
            {!provider.enabled && <span className="badge !text-amber-300">Disabled</span>}
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-white/40">{provider.baseURL}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/50">
            {provider.lastDiscoveryError ? (
              <span className="flex items-center gap-1 text-red-300">
                <XCircle className="h-3.5 w-3.5" /> {provider.lastDiscoveryError}
              </span>
            ) : provider.lastDiscoveryAt ? (
              <span className="flex items-center gap-1 text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" /> {modelCount} models discovered
              </span>
            ) : (
              <span className="text-white/35">Not discovered yet</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button className="btn-subtle !px-2" onClick={() => void refresh()} title="Refresh models" disabled={refreshing}>
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          </button>
          <button className="btn-subtle !px-2" onClick={onEdit} title="Edit">
            <Pencil className="h-4 w-4" />
          </button>
          <button
            className="btn-subtle !px-2 hover:!text-red-300"
            onClick={() => void window.aura.providers.delete(provider.id)}
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

function ProviderForm({ initial, onClose }: { initial: ProviderConfig | null; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft>(
    initial
      ? {
          name: initial.name,
          protocol: initial.protocol,
          baseURL: initial.baseURL,
          apiKey: initial.apiKey,
          organization: initial.organization ?? '',
          headersText: Object.entries(initial.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n'),
          timeoutMs: initial.timeoutMs,
        }
      : EMPTY_DRAFT
  )
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const set = (updates: Partial<Draft>) => {
    setDraft(prev => ({ ...prev, ...updates }))
    setTestResult(null)
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.aura.providers.test(draftToInput(draft))
      setTestResult(
        result.ok
          ? { ok: true, text: `Connected — ${result.modelCount} models in ${result.latencyMs}ms` }
          : { ok: false, text: result.error ?? 'Connection failed.' }
      )
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      if (initial) {
        await window.aura.providers.update(initial.id, draftToInput(draft))
      } else {
        const result = await window.aura.providers.add(draftToInput(draft))
        if (!result.discovery.ok) {
          setError(`Provider saved, but discovery failed: ${result.discovery.error}`)
          setSaving(false)
          return
        }
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save provider.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card mb-5 space-y-3 p-4">
      <h3 className="font-semibold text-white">{initial ? `Edit ${initial.name}` : 'New provider'}</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-white/50">Name</span>
          <input className="field" placeholder="Aura Universal" value={draft.name} onChange={e => set({ name: e.target.value })} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-white/50">Protocol</span>
          <select className="field" value={draft.protocol} onChange={e => set({ protocol: e.target.value as Draft['protocol'] })}>
            <option value="openai-compat">OpenAI-compatible</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-white/50">Base URL</span>
        <input className="field font-mono" placeholder="https://your-api.com/v1" value={draft.baseURL} onChange={e => set({ baseURL: e.target.value })} />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-white/50">API key</span>
        <input className="field font-mono" type="password" placeholder="sk-…" value={draft.apiKey} onChange={e => set({ apiKey: e.target.value })} />
      </label>

      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-white/40 hover:text-white/70">Advanced (headers, organization, timeout)</summary>
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-white/50">Custom headers (one per line, "Name: value")</span>
            <textarea className="field min-h-[64px] resize-y font-mono text-xs" placeholder="X-Team: research" value={draft.headersText} onChange={e => set({ headersText: e.target.value })} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-white/50">Organization (optional)</span>
              <input className="field" value={draft.organization} onChange={e => set({ organization: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-white/50">Timeout (ms)</span>
              <input className="field" type="number" min={1000} step={1000} value={draft.timeoutMs} onChange={e => set({ timeoutMs: Number(e.target.value) || 30_000 })} />
            </label>
          </div>
        </div>
      </details>

      {testResult && (
        <p className={cn('flex items-center gap-1.5 text-sm', testResult.ok ? 'text-emerald-300' : 'text-red-300')}>
          {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {testResult.text}
        </p>
      )}
      {error && <p className="text-sm text-amber-300">{error}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button className="btn-subtle" onClick={onClose}>Cancel</button>
        <button className="btn-ghost" onClick={() => void test()} disabled={testing || !draft.baseURL.trim()}>
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Test connection
        </button>
        <button className="btn-primary" onClick={() => void save()} disabled={saving || !draft.baseURL.trim()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {initial ? 'Save changes' : 'Add & discover models'}
        </button>
      </div>
    </div>
  )
}
