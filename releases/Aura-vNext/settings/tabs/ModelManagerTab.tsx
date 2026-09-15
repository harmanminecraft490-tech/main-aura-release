import { useMemo, useState } from 'react'
import { Search, Star, Pin, EyeOff, Eye as EyeOn, ChevronDown } from 'lucide-react'
import { useStore } from '@services/store'
import type { RegistryModel } from '@/types'
import { TabHeader } from '../shared'
import { CapabilityBadges, formatContext } from './AuraModelsTab'
import { cn } from '@ui/cn'

type SortKey = 'name' | 'context' | 'provider' | 'newest'

export function ModelManagerTab() {
  const models = useStore(state => state.models)
  const providers = useStore(state => state.providers)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('name')
  const [showHidden, setShowHidden] = useState(false)
  const [providerFilter, setProviderFilter] = useState<string>('all')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    let pool = models
    if (!showHidden) pool = pool.filter(model => !model.userState.hidden)
    if (providerFilter !== 'all') pool = pool.filter(model => model.providerId === providerFilter)
    if (needle) {
      pool = pool.filter(model =>
        model.displayName.toLowerCase().includes(needle) ||
        model.id.toLowerCase().includes(needle) ||
        model.providerName.toLowerCase().includes(needle)
      )
    }
    const sorted = [...pool]
    switch (sort) {
      case 'name':
        sorted.sort((a, b) => a.displayName.localeCompare(b.displayName)); break
      case 'context':
        sorted.sort((a, b) => (b.contextLength ?? 0) - (a.contextLength ?? 0)); break
      case 'provider':
        sorted.sort((a, b) => a.providerName.localeCompare(b.providerName) || a.displayName.localeCompare(b.displayName)); break
      case 'newest':
        sorted.sort((a, b) => b.firstSeenAt - a.firstSeenAt); break
    }
    // Pinned models always float to the top.
    sorted.sort((a, b) => Number(Boolean(b.userState.pinned)) - Number(Boolean(a.userState.pinned)))
    return sorted
  }, [models, query, sort, showHidden, providerFilter])

  // Group by provider for display.
  const groups = useMemo(() => {
    const map = new Map<string, RegistryModel[]>()
    for (const model of filtered) {
      const list = map.get(model.providerName) ?? []
      list.push(model)
      map.set(model.providerName, list)
    }
    return [...map.entries()]
  }, [filtered])

  return (
    <div>
      <TabHeader
        title="Model Manager"
        description={`${models.length} models discovered across ${providers.length} provider${providers.length === 1 ? '' : 's'}. Everything here was fetched dynamically — nothing is hardcoded.`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input className="field !pl-9" placeholder="Search models…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <select className="field !w-40" value={providerFilter} onChange={e => setProviderFilter(e.target.value)}>
          <option value="all">All providers</option>
          {providers.map(provider => (
            <option key={provider.id} value={provider.id}>{provider.name}</option>
          ))}
        </select>
        <select className="field !w-36" value={sort} onChange={e => setSort(e.target.value as SortKey)}>
          <option value="name">Sort: Name</option>
          <option value="context">Sort: Context</option>
          <option value="provider">Sort: Provider</option>
          <option value="newest">Sort: Newest</option>
        </select>
        <button className={cn('btn-ghost !text-xs', showHidden && '!border-aura-400/40 !text-aura-200')} onClick={() => setShowHidden(v => !v)}>
          {showHidden ? <EyeOn className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          {showHidden ? 'Showing hidden' : 'Hidden excluded'}
        </button>
      </div>

      {groups.length === 0 && (
        <div className="card p-8 text-center text-white/45">
          {models.length === 0 ? 'No models yet — add a provider in the Providers tab.' : 'No models match your filters.'}
        </div>
      )}

      <div className="space-y-5">
        {groups.map(([providerName, groupModels]) => (
          <ModelGroup key={providerName} providerName={providerName} models={groupModels} />
        ))}
      </div>
    </div>
  )
}

function ModelGroup({ providerName, models }: { providerName: string; models: RegistryModel[] }) {
  const [open, setOpen] = useState(true)
  return (
    <section>
      <button className="mb-2 flex w-full items-center gap-2 text-left" onClick={() => setOpen(o => !o)}>
        <ChevronDown className={cn('h-4 w-4 text-white/40 transition', !open && '-rotate-90')} />
        <h3 className="text-sm font-semibold text-white/75">{providerName}</h3>
        <span className="badge !text-[10px]">{models.length}</span>
      </button>
      {open && (
        <div className="space-y-1.5">
          {models.map(model => <ModelRow key={model.key} model={model} />)}
        </div>
      )}
    </section>
  )
}

function ModelRow({ model }: { model: RegistryModel }) {
  const setState = (updates: Partial<RegistryModel['userState']>) =>
    void window.aura.models.setUserState(model.key, updates)

  return (
    <div className={cn(
      'group flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 transition hover:bg-white/[0.05]',
      model.userState.hidden && 'opacity-45'
    )}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-white/85">{model.displayName}</span>
          {model.userState.pinned && <Pin className="h-3 w-3 shrink-0 text-aura-300" />}
        </div>
        <p className="truncate font-mono text-[11px] text-white/35">{model.id}</p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {model.contextLength && <span className="badge !text-[10px]">{formatContext(model.contextLength)}</span>}
        {model.pricing?.input != null && (
          <span className="badge !text-[10px]" title="USD per 1M input / output tokens">
            ${model.pricing.input.toFixed(2)}{model.pricing.output != null ? ` / $${model.pricing.output.toFixed(2)}` : ''}
          </span>
        )}
        <CapabilityBadges model={model} />
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
        <button
          className="rounded-lg p-1.5 hover:bg-white/10"
          onClick={() => setState({ favorite: !model.userState.favorite })}
          title={model.userState.favorite ? 'Unfavorite' : 'Favorite'}
        >
          <Star className={cn('h-4 w-4', model.userState.favorite ? 'fill-amber-300 text-amber-300' : 'text-white/40')} />
        </button>
        <button
          className="rounded-lg p-1.5 hover:bg-white/10"
          onClick={() => setState({ pinned: !model.userState.pinned })}
          title={model.userState.pinned ? 'Unpin' : 'Pin to top'}
        >
          <Pin className={cn('h-4 w-4', model.userState.pinned ? 'text-aura-300' : 'text-white/40')} />
        </button>
        <button
          className="rounded-lg p-1.5 hover:bg-white/10"
          onClick={() => setState({ hidden: !model.userState.hidden })}
          title={model.userState.hidden ? 'Unhide' : 'Hide from pickers'}
        >
          {model.userState.hidden
            ? <EyeOn className="h-4 w-4 text-white/40" />
            : <EyeOff className="h-4 w-4 text-white/40" />}
        </button>
      </div>
    </div>
  )
}
