import {
  Check, ChevronDown, Copy, Download, Edit3, Eye, EyeOff, Globe, Key, Loader2, Lock,
  Plus, RefreshCw, Search, Star, Trash2, Upload, X, Copy as Duplicate, Layers
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/utils/cn'
import { useAuraStore } from '@/store'
import type { APIProfile, AIProvider, ModelPreset, TestConnectionResult } from '@/types'
import {
  Card, Accordion, Toggle, SliderField, NumberField, TextField, SelectField, IconBtn,
  PROVIDER_META, PROVIDERS,
} from './shared'

export function APIDashboardTab({ presets }: { presets: ModelPreset[] }) {
  const { profiles, setProfiles, activeProfileId, setActiveProfileId } = useAuraStore()
  const [search, setSearch] = useState('')
  const [showCreator, setShowCreator] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const loadProfiles = useCallback(async () => {
    const list = await window.aura!.profiles.list()
    setProfiles(list)
  }, [setProfiles])

  useEffect(() => { loadProfiles() }, [loadProfiles])

  const filtered = profiles.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.provider.toLowerCase().includes(search.toLowerCase()) ||
    p.model.toLowerCase().includes(search.toLowerCase())
  )

  async function handleCreate(profile: Partial<APIProfile>) {
    await window.aura!.profiles.create(profile)
    await loadProfiles()
    setShowCreator(false)
  }

  async function handleUpdate(id: string, updates: Partial<APIProfile>) {
    await window.aura!.profiles.update(id, updates)
    await loadProfiles()
  }

  async function handleDelete(id: string) {
    await window.aura!.profiles.delete(id)
    await loadProfiles()
  }

  async function handleDuplicate(id: string) {
    await window.aura!.profiles.duplicate(id)
    await loadProfiles()
  }

  async function handleSetDefault(id: string) {
    await window.aura!.profiles.setDefault(id)
    await loadProfiles()
  }

  async function handleToggleEnabled(id: string, enabled: boolean) {
    await window.aura!.profiles.enable(id, enabled)
    await loadProfiles()
  }

  async function handleSetActive(id: string) {
    await window.aura!.profiles.setActive(id)
    setActiveProfileId(id)
  }

  async function handleExport() {
    const json = await window.aura!.profiles.exportAll()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'aura-profiles.json'; a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImport(file: File) {
    const text = await file.text()
    await window.aura!.profiles.importAll(text)
    await loadProfiles()
  }

  async function handleBackup() {
    const json = await window.aura!.profiles.backup()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'aura-backup.json'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 pl-9 pr-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
            onChange={e => setSearch(e.target.value)}
            placeholder="Search profiles…"
            value={search}
          />
        </div>
        <button
          className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/15"
          onClick={() => { setShowCreator(true); setEditingId(null) }}
        >
          <Plus size={15} /> New Profile
        </button>
        <button
          className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-xs font-medium text-white/60 transition hover:bg-white/7"
          onClick={handleExport}
          title="Export all profiles"
        >
          <Download size={14} />
        </button>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-xs font-medium text-white/60 transition hover:bg-white/7">
          <Upload size={14} />
          <input accept=".json" className="hidden" type="file" onChange={async e => { const f = e.target.files?.[0]; if (f) await handleImport(f) }} />
        </label>
        <button
          className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-xs font-medium text-white/60 transition hover:bg-white/7"
          onClick={handleBackup}
          title="Backup all settings (encrypted)"
        >
          <Layers size={14} /> Backup
        </button>
      </div>

      {/* Profile count */}
      <div className="text-xs text-white/35">
        {profiles.length} profile{profiles.length !== 1 ? 's' : ''} · {profiles.filter(p => p.enabled).length} enabled
      </div>

      {/* Creator / Editor */}
      {showCreator && (
        <ProfileCreatorWizard
          presets={presets}
          editingProfile={editingId ? (profiles.find(p => p.id === editingId) ?? null) : null}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onCancel={() => { setShowCreator(false); setEditingId(null) }}
        />
      )}

      {/* Profiles list */}
      <div className="space-y-2">
        {filtered.length === 0 && !showCreator && (
          <Card>
            <div className="py-6 text-center">
              <p className="text-sm text-white/40">No profiles yet. Create your first API profile to get started.</p>
              <button
                className="mt-4 flex items-center gap-2 mx-auto rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/15"
                onClick={() => setShowCreator(true)}
              >
                <Plus size={15} /> Create Profile
              </button>
            </div>
          </Card>
        )}
        {filtered.map(profile => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            isActive={profile.id === activeProfileId}
            presets={presets}
            onEdit={() => { setEditingId(profile.id); setShowCreator(true) }}
            onDelete={() => handleDelete(profile.id)}
            onDuplicate={() => handleDuplicate(profile.id)}
            onSetDefault={() => handleSetDefault(profile.id)}
            onToggleEnabled={(en) => handleToggleEnabled(profile.id, en)}
            onSetActive={() => handleSetActive(profile.id)}
            onUpdate={(updates) => handleUpdate(profile.id, updates)}
          />
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Profile Card — individual profile display with inline actions
// ═══════════════════════════════════════════════════════════════════════════

function ProfileCard({
  profile, isActive, presets, onEdit, onDelete, onDuplicate, onSetDefault, onToggleEnabled, onSetActive, onUpdate
}: {
  profile: APIProfile
  isActive: boolean
  presets: ModelPreset[]
  onEdit: () => void
  onDelete: () => void
  onDuplicate: () => void
  onSetDefault: () => void
  onToggleEnabled: (enabled: boolean) => void
  onSetActive: () => void
  onUpdate: (updates: Partial<APIProfile>) => void
}) {
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null)
  const [expanded, setExpanded] = useState(false)
  const meta = PROVIDER_META[profile.provider] ?? PROVIDER_META.aura
  const isLocked = Boolean(profile.locked)
  const isAuraIdentity = isLocked && (profile.provider === 'aura' || profile.model === 'Aura Model')
  const providerLabel = isAuraIdentity ? 'Aura' : meta.label
  const modelLabel = isAuraIdentity ? 'Aura Model' : (profile.model || 'no model')

  async function testConn() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.aura!.profiles.testConnection(profile)
      setTestResult(result)
    } catch {
      setTestResult({ success: false, error: 'IPC error' })
    } finally {
      setTesting(false)
    }
  }

  function copyKey() {
    navigator.clipboard.writeText(profile.apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const maskedKey = profile.apiKey
    ? profile.apiKey.slice(0, 4) + '•'.repeat(Math.max(4, profile.apiKey.length - 8)) + profile.apiKey.slice(-4)
    : 'Not set'

  return (
    <div className={cn(
      'rounded-2xl border p-4 transition',
      isActive
        ? 'border-aura-400/40 bg-aura-500/8'
        : profile.enabled
          ? 'border-white/8 bg-white/[0.03] hover:border-white/14'
          : 'border-white/5 bg-white/[0.01] opacity-60'
    )}>
      <div className="flex items-center gap-3">
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-br', meta.color)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-white">{profile.displayName}</span>
            {profile.isDefault && (
              <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                <Star size={9} /> Default
              </span>
            )}
            {isActive && (
              <span className="flex items-center gap-1 rounded-full bg-aura-500/15 px-2 py-0.5 text-[10px] font-semibold text-aura-300">
                Active
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-white/40">
            <span>{providerLabel}</span>
            <span>·</span>
            <span className={isAuraIdentity ? undefined : 'font-mono'}>{modelLabel}</span>
          </div>
        </div>
        {/* Inline actions */}
        <div className="flex items-center gap-1">
          {!isActive && profile.enabled && (
            <button
              className="rounded-lg px-2.5 py-1 text-[11px] text-white/50 transition hover:bg-white/8 hover:text-white"
              onClick={onSetActive}
              title="Set as active"
            >
              Use
            </button>
          )}
          {isLocked && (
            <span
              className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400"
              title="Managed by Aura — base URL and API key are protected"
            >
              <Lock size={9} /> Locked
            </span>
          )}
          {!isLocked && <IconBtn icon={Edit3} onClick={onEdit} title="Edit" />}
          {!isLocked && <IconBtn icon={Duplicate} onClick={onDuplicate} title="Duplicate" />}
          <IconBtn icon={RefreshCw} onClick={testConn} title="Test connection" />
          <IconBtn icon={ChevronDown} onClick={() => setExpanded(e => !e)} title="Details" />
          <Toggle checked={profile.enabled} onChange={onToggleEnabled} />
          {!isLocked && <IconBtn icon={Trash2} onClick={onDelete} title="Delete" danger />}
        </div>
      </div>

      {/* Test result */}
      {testResult && (
        <div className={cn(
          'mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs',
          testResult.success ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
        )}>
          {testResult.success ? (
            <>
              <Check size={12} /> {testResult.latencyMs}ms · {isAuraIdentity ? 'Aura Model' : (testResult.model ?? 'connected')}
              {testResult.supportsStreaming && <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5">Stream</span>}
              {testResult.supportsToolCalling && <span className="ml-1 rounded bg-white/10 px-1.5 py-0.5">Tools</span>}
              {testResult.supportsVision && <span className="ml-1 rounded bg-white/10 px-1.5 py-0.5">Vision</span>}
              {testResult.availableModels && testResult.availableModels.length > 0 && (
                <span className="ml-1 rounded bg-white/10 px-1.5 py-0.5">{testResult.availableModels.length} models</span>
              )}
            </>
          ) : (
            <><X size={12} /> {testResult.error}</>
          )}
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 space-y-3 border-t border-white/8 pt-3">
          {isLocked ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-xl bg-emerald-500/8 px-3 py-2.5 text-xs text-emerald-300/80">
                <Lock size={12} /> Managed by Aura — base URL and API key are protected. Identity: Aura · Aura Model.
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded bg-white/8 px-2 py-0.5 text-[10px] text-white/50">Streaming</span>
                <span className="rounded bg-white/8 px-2 py-0.5 text-[10px] text-white/50">Tool Calling</span>
                <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">Vision</span>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-white/30">API Key</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg bg-black/20 px-2 py-1 text-xs text-white/60">
                    {showKey ? profile.apiKey || 'Not set' : maskedKey}
                  </code>
                  <button className="rounded-lg p-1.5 text-white/30 hover:text-white/70" onClick={() => setShowKey(v => !v)}>
                    {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                  <button className="rounded-lg p-1.5 text-white/30 hover:text-white/70" onClick={copyKey}>
                    {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                  </button>
                </div>
              </div>
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-white/30">Base URL</p>
                <code className="block truncate rounded-lg bg-black/20 px-2 py-1 text-xs text-white/60">{profile.baseURL}</code>
              </div>
            </div>
          )}
          <div className="grid gap-3 text-xs sm:grid-cols-4">
            <div><span className="text-white/30">Temp:</span> <span className="text-white/60">{profile.temperature}</span></div>
            <div><span className="text-white/30">Max tokens:</span> <span className="text-white/60">{profile.maxTokens}</span></div>
            <div><span className="text-white/30">Context:</span> <span className="text-white/60">{profile.contextLength}</span></div>
            <div><span className="text-white/30">Timeout:</span> <span className="text-white/60">{(profile.timeout / 1000).toFixed(0)}s</span></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {profile.streaming && <span className="rounded bg-white/8 px-2 py-0.5 text-[10px] text-white/50">Streaming</span>}
            {profile.toolCalling && <span className="rounded bg-white/8 px-2 py-0.5 text-[10px] text-white/50">Tool Calling</span>}
            {profile.visionSupport && <span className="rounded bg-white/8 px-2 py-0.5 text-[10px] text-white/50">Vision</span>}
            {profile.retryCount > 0 && <span className="rounded bg-white/8 px-2 py-0.5 text-[10px] text-white/50">Retry: {profile.retryCount}</span>}
          </div>
          {!profile.isDefault && (
            <button
              className="flex items-center gap-1.5 text-xs text-amber-400/80 transition hover:text-amber-300"
              onClick={onSetDefault}
            >
              <Star size={12} /> Set as default
            </button>
          )}
        </div>
      )}

      {testing && (
        <div className="mt-3 flex items-center gap-2 text-xs text-white/40">
          <Loader2 size={12} className="animate-spin" /> Testing connection…
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Profile Creator Wizard
// ═══════════════════════════════════════════════════════════════════════════

function ProfileCreatorWizard({
  presets, editingProfile, onCreate, onUpdate, onCancel
}: {
  presets: ModelPreset[]
  editingProfile: APIProfile | null
  onCreate: (profile: Partial<APIProfile>) => Promise<void>
  onUpdate: (id: string, updates: Partial<APIProfile>) => Promise<void>
  onCancel: () => void
}) {
  const isEditing = Boolean(editingProfile)
  const isLockedEdit = Boolean(editingProfile?.locked)
  const initialHeaders = Object.entries(editingProfile?.customHeaders ?? {}).map(([key, value], index) => ({
    id: `header-${index}-${key}`,
    key,
    value,
  }))
  const initialQueryParams = Object.entries(editingProfile?.queryParameters ?? {}).map(([key, value], index) => ({
    id: `query-${index}-${key}`,
    key,
    value,
  }))
  const [form, setForm] = useState<Partial<APIProfile>>(editingProfile ?? {
    name: '',
    displayName: '',
    provider: 'custom' as AIProvider,
    apiKey: '',
    baseURL: '',
    model: '',
    temperature: 0.7,
    topP: 1.0,
    maxTokens: 8192,
    contextLength: 32768,
    streaming: true,
    timeout: 600000,
    retryCount: 2,
    toolCalling: false,
    visionSupport: false,
    enabled: true,
    isDefault: false,
    category: 'general',
  })
  const [headerRows, setHeaderRows] = useState(initialHeaders)
  const [queryRows, setQueryRows] = useState(initialQueryParams)

  const update = (updates: Partial<APIProfile>) => setForm(prev => ({ ...prev, ...updates }))
  const providerPresets = presets.filter(p => p.provider === form.provider)

  function rowsToRecord(rows: Array<{ key: string; value: string }>): Record<string, string> {
    return rows.reduce<Record<string, string>>((acc, row) => {
      const key = row.key.trim()
      if (!key) return acc
      acc[key] = row.value
      return acc
    }, {})
  }

  function updateHeaderRow(id: string, field: 'key' | 'value', value: string) {
    setHeaderRows(rows => rows.map(row => (row.id === id ? { ...row, [field]: value } : row)))
  }

  function updateQueryRow(id: string, field: 'key' | 'value', value: string) {
    setQueryRows(rows => rows.map(row => (row.id === id ? { ...row, [field]: value } : row)))
  }

  function handleProviderChange(provider: AIProvider) {
    const meta = PROVIDER_META[provider]
    update({ provider, baseURL: meta.defaultBaseURL })
  }

  async function save() {
    const customHeaders = rowsToRecord(headerRows)
    const queryParameters = rowsToRecord(queryRows)
    const payload = {
      ...form,
      customHeaders,
      queryParameters,
    }

    if (isEditing && editingProfile) {
      await onUpdate(editingProfile.id, payload)
    } else {
      await onCreate(payload)
    }
  }

  return (
    <Card title={isEditing ? 'Edit Profile' : 'Create New API Profile'}>
      <div className="space-y-4">
        {/* Provider selection */}
        <div>
          <label className="mb-2 block text-xs font-medium text-white/50">Provider</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PROVIDERS.map(p => {
              const meta = PROVIDER_META[p]
              const active = form.provider === p
              return (
                <button
                  key={p}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-2xl border p-2.5 text-xs font-medium transition',
                    active ? 'border-white/25 bg-white/12 text-white' : 'border-white/6 bg-white/[0.03] text-white/50 hover:border-white/14 hover:text-white/80'
                  )}
                  onClick={() => handleProviderChange(p)}
                >
                  <span className={cn('h-2 w-2 rounded-full bg-gradient-to-br', meta.color)} />
                  {meta.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Basic fields */}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Profile Name" value={form.name ?? ''} onChange={v => update({ name: v, displayName: v })} placeholder="My API Profile" />
          <TextField label="Display Name" value={form.displayName ?? ''} onChange={v => update({ displayName: v })} placeholder="Optional display name" />
        </div>

        {isLockedEdit ? (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-500/8 px-3 py-2.5 text-xs text-emerald-300/80">
            <Lock size={12} /> Managed Aura profile — base URL and API key are locked and cannot be edited.
          </div>
        ) : (
          <>
            {/* API Key */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-white/50">API Key</label>
              <div className="relative">
                <Key size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 pl-9 pr-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
                  onChange={e => update({ apiKey: e.target.value })}
                  placeholder={form.provider === 'ollama' ? 'Not required for Ollama' : 'sk-…'}
                  type="password"
                  value={form.apiKey ?? ''}
                />
              </div>
              <p className="mt-1 text-[10px] text-emerald-400/60">Encrypted locally with AES-256-GCM</p>
            </div>

            {/* Base URL */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-white/50">Base URL</label>
              <div className="relative">
                <Globe size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 pl-9 pr-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
                  onChange={e => update({ baseURL: e.target.value })}
                  placeholder="https://…"
                  value={form.baseURL ?? ''}
                />
              </div>
              {form.provider === 'custom' && (
                <p className="mt-1 text-[10px] text-white/35">
                  Use this for your company API or gateway. Best results come from an OpenAI-compatible `chat/completions` endpoint.
                </p>
              )}
            </div>
          </>
        )}

        {/* Model */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-white/50">Model</label>
          <div className="flex items-center gap-2">
            <input
              className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] py-2.5 px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
              onChange={e => update({ model: e.target.value })}
              placeholder="Enter any model name…"
              value={form.model ?? ''}
            />
            {providerPresets.length > 0 && (
              <select
                className="rounded-xl border border-white/10 bg-white/[0.04] py-2.5 px-3 text-xs text-white/60 outline-none"
                onChange={e => { const preset = providerPresets.find(p => p.modelId === e.target.value); if (preset) update({ model: preset.modelId }) }}
                value=""
              >
                <option value="" className="bg-surface-1">Presets…</option>
                {providerPresets.map(p => <option key={p.modelId} value={p.modelId} className="bg-surface-1">{p.label}</option>)}
              </select>
            )}
          </div>
          <p className="mt-1 text-[10px] text-white/30">Custom model names are accepted — no validation</p>
        </div>

        {/* Optional IDs */}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Organization ID (optional)" value={form.organizationId ?? ''} onChange={v => update({ organizationId: v })} placeholder="org-…" />
          <TextField label="Project ID (optional)" value={form.projectId ?? ''} onChange={v => update({ projectId: v })} placeholder="proj-…" />
        </div>

        {/* Custom Headers */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-white/50">Custom Headers (optional)</label>
          <div className="space-y-2">
            {headerRows.map(row => (
              <div key={row.id} className="flex gap-2">
                <input
                  className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] py-2 px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
                  placeholder="Header name"
                  value={row.key}
                  onChange={e => updateHeaderRow(row.id, 'key', e.target.value)}
                />
                <input
                  className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] py-2 px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
                  placeholder="Header value"
                  value={row.value}
                  onChange={e => updateHeaderRow(row.id, 'value', e.target.value)}
                />
                <button
                  className="rounded-xl px-3 text-red-400/80 hover:bg-red-500/10"
                  onClick={() => {
                    setHeaderRows(rows => rows.filter(item => item.id !== row.id))
                  }}
                  type="button"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <button
              className="flex items-center gap-2 rounded-xl border border-dashed border-white/20 px-3 py-2 text-xs text-white/40 transition hover:border-white/40 hover:text-white/60"
              onClick={() => {
                setHeaderRows(rows => [...rows, { id: `header-${Date.now()}`, key: '', value: '' }])
              }}
              type="button"
            >
              <Plus size={12} /> Add Header
            </button>
          </div>
        </div>

        {/* Query Parameters */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-white/50">Query Parameters (optional)</label>
          <div className="space-y-2">
            {queryRows.map(row => (
              <div key={row.id} className="flex gap-2">
                <input
                  className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] py-2 px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
                  placeholder="Parameter name"
                  value={row.key}
                  onChange={e => updateQueryRow(row.id, 'key', e.target.value)}
                />
                <input
                  className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] py-2 px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
                  placeholder="Parameter value"
                  value={row.value}
                  onChange={e => updateQueryRow(row.id, 'value', e.target.value)}
                />
                <button
                  className="rounded-xl px-3 text-red-400/80 hover:bg-red-500/10"
                  onClick={() => {
                    setQueryRows(rows => rows.filter(item => item.id !== row.id))
                  }}
                  type="button"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <button
              className="flex items-center gap-2 rounded-xl border border-dashed border-white/20 px-3 py-2 text-xs text-white/40 transition hover:border-white/40 hover:text-white/60"
              onClick={() => {
                setQueryRows(rows => [...rows, { id: `query-${Date.now()}`, key: '', value: '' }])
              }}
              type="button"
            >
              <Plus size={12} /> Add Parameter
            </button>
          </div>
        </div>

        {/* Category */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-white/50">Category (optional)</label>
          <input
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
            onChange={e => update({ category: e.target.value })}
            placeholder="general, work, personal, …"
            value={form.category ?? ''}
          />
        </div>

        {/* Advanced parameters */}
        <Accordion title="Advanced Parameters" defaultOpen={false}>
          <div className="grid gap-5 sm:grid-cols-2">
            <SliderField label="Temperature" min={0} max={2} step={0.05} value={form.temperature ?? 0.7} onChange={v => update({ temperature: v })} display={(form.temperature ?? 0.7).toFixed(2)} />
            <SliderField label="Top P" min={0} max={1} step={0.01} value={form.topP ?? 1.0} onChange={v => update({ topP: v })} display={(form.topP ?? 1.0).toFixed(2)} />
            <NumberField label="Max Tokens" value={form.maxTokens ?? 8192} onChange={v => update({ maxTokens: v })} min={256} max={200000} />
            <NumberField label="Context Length" value={form.contextLength ?? 32768} onChange={v => update({ contextLength: v })} min={1024} max={1000000} />
            <NumberField label="Timeout (ms)" value={form.timeout ?? 600000} onChange={v => update({ timeout: v })} min={5000} max={3600000} />
            <NumberField label="Retry Count" value={form.retryCount ?? 2} onChange={v => update({ retryCount: v })} min={0} max={10} />
          </div>
        </Accordion>

        {/* Feature toggles */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
            <span className="text-sm text-white/60">Streaming</span>
            <Toggle checked={form.streaming ?? true} onChange={v => update({ streaming: v })} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
            <span className="text-sm text-white/60">Tool Calling</span>
            <Toggle checked={form.toolCalling ?? false} onChange={v => update({ toolCalling: v })} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
            <span className="text-sm text-white/60">Vision Support</span>
            <Toggle checked={form.visionSupport ?? false} onChange={v => update({ visionSupport: v })} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
            <span className="text-sm text-white/60">Set as Default</span>
            <Toggle checked={form.isDefault ?? false} onChange={v => update({ isDefault: v })} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-surface-0 transition hover:scale-[1.02] disabled:opacity-40"
            disabled={!form.name?.trim()}
            onClick={save}
          >
            {isEditing ? <><Edit3 size={15} /> Update Profile</> : <><Plus size={15} /> Create Profile</>}
          </button>
          <button
            className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-white/60 transition hover:bg-white/7"
            onClick={onCancel}
          >
            <X size={15} /> Cancel
          </button>
        </div>
      </div>
    </Card>
  )
}
