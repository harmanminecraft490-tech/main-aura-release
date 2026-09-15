import { useEffect, useState } from 'react'
import { Download, Heart, Pin, Plus, Trash2, Upload, Search, Tag } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useAuraStore } from '@/store'
import type { SavedModel, AIProvider, ModelPreset } from '@/types'
import { Card, TextField, SelectField, IconBtn, PROVIDER_META, PROVIDERS } from './shared'

export function ModelManagerTab({ presets }: { presets: ModelPreset[] }) {
  const { savedModels, setSavedModels } = useAuraStore()
  const [search, setSearch] = useState('')
  const [newModel, setNewModel] = useState({ provider: 'groq' as AIProvider, modelId: '', name: '', category: 'general' })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  useEffect(() => {
    window.aura?.models.list().then(setSavedModels).catch(() => {})
  }, [setSavedModels])

  const filtered = savedModels.filter(m =>
    !search || m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.modelId.toLowerCase().includes(search.toLowerCase())
  )

  async function addModel() {
    if (!newModel.modelId.trim()) return
    await window.aura!.models.add({
      provider: newModel.provider,
      modelId: newModel.modelId.trim(),
      name: newModel.name.trim() || newModel.modelId.trim(),
      pinned: false,
      favorite: false,
      category: newModel.category,
    })
    const list = await window.aura!.models.list()
    setSavedModels(list)
    setNewModel({ provider: 'groq', modelId: '', name: '', category: 'general' })
  }

  async function deleteModel(id: string) {
    await window.aura!.models.delete(id)
    setSavedModels(await window.aura!.models.list())
  }

  async function togglePin(id: string) {
    await window.aura!.models.togglePin(id)
    setSavedModels(await window.aura!.models.list())
  }

  async function toggleFavorite(id: string) {
    await window.aura!.models.toggleFavorite(id)
    setSavedModels(await window.aura!.models.list())
  }

  async function commitRename(id: string) {
    if (editName.trim()) {
      await window.aura!.models.update(id, { name: editName.trim() })
      setSavedModels(await window.aura!.models.list())
    }
    setEditingId(null)
  }

  async function exportModels() {
    const json = await window.aura!.models.exportAll()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'aura-models.json'; a.click()
    URL.revokeObjectURL(url)
  }

  async function importModels(file: File) {
    const text = await file.text()
    await window.aura!.models.importAll(text)
    setSavedModels(await window.aura!.models.list())
  }

  const sorted = [...filtered].sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.favorite) - Number(a.favorite))

  return (
    <div className="max-w-3xl space-y-5">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 pl-9 pr-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
            onChange={e => setSearch(e.target.value)}
            placeholder="Search models…"
            value={search}
          />
        </div>
        <button className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-xs text-white/60 hover:bg-white/7" onClick={exportModels}>
          <Download size={14} />
        </button>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-xs text-white/60 hover:bg-white/7">
          <Upload size={14} />
          <input accept=".json" className="hidden" type="file" onChange={async e => { const f = e.target.files?.[0]; if (f) await importModels(f) }} />
        </label>
      </div>

      {/* Saved models list */}
      <Card title={`Saved Models (${savedModels.length})`}>
        {sorted.length === 0 ? (
          <p className="py-2 text-sm text-white/30">No saved models yet. Add one below.</p>
        ) : (
          <div className="space-y-1.5">
            {sorted.map(model => (
              <div key={model.id} className="flex items-center gap-3 rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-2.5">
                <span className={cn('h-2 w-2 shrink-0 rounded-full bg-gradient-to-br', PROVIDER_META[model.provider].color)} />
                {editingId === model.id ? (
                  <input
                    autoFocus
                    className="flex-1 rounded-lg bg-white/8 px-2 py-1 text-sm text-white outline-none"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={() => commitRename(model.id)}
                    onKeyDown={e => { if (e.key === 'Enter') commitRename(model.id); if (e.key === 'Escape') setEditingId(null) }}
                  />
                ) : (
                  <div className="flex flex-1 flex-col">
                    <span className="cursor-pointer text-sm font-medium text-white hover:text-white/80" onDoubleClick={() => { setEditingId(model.id); setEditName(model.name) }}>
                      {model.name}
                    </span>
                    <span className="text-[11px] font-mono text-white/35">{model.modelId}</span>
                  </div>
                )}
                {model.category && (
                  <span className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-0.5 text-[10px] text-white/35">
                    <Tag size={9} /> {model.category}
                  </span>
                )}
                <span className="rounded-lg bg-white/5 px-2 py-0.5 text-[10px] text-white/35">{PROVIDER_META[model.provider].label}</span>
                <IconBtn icon={Heart} onClick={() => toggleFavorite(model.id)} title={model.favorite ? 'Unfavorite' : 'Favorite'} active={model.favorite} />
                <IconBtn icon={Pin} onClick={() => togglePin(model.id)} title={model.pinned ? 'Unpin' : 'Pin'} active={model.pinned} />
                <IconBtn icon={Trash2} onClick={() => deleteModel(model.id)} title="Delete" danger />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Add model form */}
      <Card title="Add Model">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Provider"
              value={newModel.provider}
              onChange={v => setNewModel(prev => ({ ...prev, provider: v as AIProvider }))}
              options={PROVIDERS.map(p => ({ value: p, label: PROVIDER_META[p].label }))}
            />
            <TextField label="Model ID" value={newModel.modelId} onChange={v => setNewModel(prev => ({ ...prev, modelId: v }))} placeholder="gpt-4o, deepseek-v4-pro, qwen3-coder…" />
            <TextField label="Display Name" value={newModel.name} onChange={v => setNewModel(prev => ({ ...prev, name: v }))} placeholder="Optional" />
            <TextField label="Category" value={newModel.category} onChange={v => setNewModel(prev => ({ ...prev, category: v }))} placeholder="general, coding, vision…" />
          </div>
          <button
            className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/15 disabled:opacity-40"
            disabled={!newModel.modelId.trim()}
            onClick={addModel}
          >
            <Plus size={15} /> Save Model
          </button>
        </div>
      </Card>

      {/* Presets quick-add */}
      <Card title="Provider Presets">
        <p className="mb-3 text-xs text-white/40">Click any preset to add it to your saved models</p>
        <div className="flex flex-wrap gap-2">
          {presets.map(preset => (
            <button
              key={`${preset.provider}/${preset.modelId}`}
              className="rounded-xl border border-white/8 px-3 py-1.5 text-xs text-white/55 transition hover:border-white/18 hover:text-white/85"
              onClick={async () => {
                await window.aura!.models.add({
                  provider: preset.provider,
                  modelId: preset.modelId,
                  name: preset.label,
                  pinned: false,
                  favorite: false,
                  category: 'preset',
                })
                setSavedModels(await window.aura!.models.list())
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </Card>
    </div>
  )
}
