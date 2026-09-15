import { useMemo, useState } from 'react'
import { ArrowRight, Check, RotateCcw, Search, Star, X, Sparkles, Eye, Brain, Wrench, Radio } from 'lucide-react'
import { useStore } from '@services/store'
import type { AuraMappingView, RegistryModel } from '@/types'
import { AuraModelIcon } from '@ui/AuraModelIcon'
import { TabHeader } from '../shared'
import { cn } from '@ui/cn'

export function AuraModelsTab() {
  const mappings = useStore(state => state.mappings)
  const suggestions = useStore(state => state.suggestions)
  const [pickerFor, setPickerFor] = useState<string | null>(null)

  return (
    <div>
      <TabHeader
        title="Aura Models"
        description="Your models. Each Aura model is an alias for a real backend model — remap them any time; new chats use the change immediately."
      />

      {suggestions.length > 0 && (
        <div className="mb-5 space-y-2">
          {suggestions.map(suggestion => (
            <div key={suggestion.id} className="flex items-center gap-3 rounded-2xl border border-aura-400/30 bg-aura-500/10 px-4 py-3">
              <Sparkles className="h-4 w-4 shrink-0 text-aura-300" />
              <p className="min-w-0 flex-1 text-sm text-white/80">{suggestion.reason}</p>
              <button
                className="btn-primary !px-3 !py-1.5 !text-xs"
                onClick={() => void window.aura.suggestions.accept(suggestion.id)}
              >
                <Check className="h-3.5 w-3.5" /> Switch
              </button>
              <button
                className="btn-subtle !px-2 !py-1.5"
                onClick={() => void window.aura.suggestions.dismiss(suggestion.id)}
                title="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 flex justify-end">
        <button className="btn-ghost !text-xs" onClick={() => void window.aura.aura.restoreDefaults()}>
          <RotateCcw className="h-3.5 w-3.5" /> Restore defaults
        </button>
      </div>

      <div className="space-y-3">
        {mappings.map(mapping => (
          <MappingCard
            key={mapping.id}
            mapping={mapping}
            pickerOpen={pickerFor === mapping.id}
            onOpenPicker={() => setPickerFor(pickerFor === mapping.id ? null : mapping.id)}
            onClosePicker={() => setPickerFor(null)}
          />
        ))}
      </div>
    </div>
  )
}

function MappingCard({ mapping, pickerOpen, onOpenPicker, onClosePicker }: {
  mapping: AuraMappingView
  pickerOpen: boolean
  onOpenPicker: () => void
  onClosePicker: () => void
}) {
  const isAuto = mapping.id === 'aura-auto'

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3.5">
        <AuraModelIcon id={mapping.id} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-white">{mapping.name}</h3>
            {mapping.isOverride && <span className="badge !border-aura-400/30 !text-aura-200">Custom</span>}
            {mapping.source === 'capability' && <span className="badge">Auto-picked</span>}
          </div>
          <p className="mt-0.5 text-sm text-white/45">{mapping.description}</p>

          {isAuto ? (
            <p className="mt-2.5 flex items-center gap-1.5 text-sm text-white/55">
              <Sparkles className="h-4 w-4 text-aura-300" />
              Routes each message to the best Aura model automatically.
            </p>
          ) : (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-white/40">Mapped to</span>
              <ArrowRight className="h-3.5 w-3.5 text-white/30" />
              {mapping.resolvedName ? (
                <>
                  <span className="font-medium text-white/85">{mapping.resolvedName}</span>
                  <span className="badge">{mapping.resolvedProvider}</span>
                </>
              ) : (
                <span className="text-amber-300">No model available — add a provider</span>
              )}
            </div>
          )}
        </div>

        {!isAuto && (
          <button className="btn-ghost shrink-0 !text-xs" onClick={onOpenPicker}>
            Change mapping
          </button>
        )}
      </div>

      {pickerOpen && !isAuto && (
        <ModelPickerPanel
          currentKey={mapping.resolvedKey}
          onPick={async key => {
            await window.aura.aura.setMapping(mapping.id, key)
            onClosePicker()
          }}
          onReset={async () => {
            await window.aura.aura.setMapping(mapping.id, null)
            onClosePicker()
          }}
          isOverride={mapping.isOverride}
        />
      )}
    </div>
  )
}

function ModelPickerPanel({ currentKey, onPick, onReset, isOverride }: {
  currentKey: string | null
  onPick: (key: string) => void | Promise<void>
  onReset: () => void | Promise<void>
  isOverride: boolean
}) {
  const models = useStore(state => state.models)
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const pool = models.filter(model => !model.userState.hidden)
    const filtered = needle
      ? pool.filter(model =>
          model.displayName.toLowerCase().includes(needle) ||
          model.id.toLowerCase().includes(needle) ||
          model.providerName.toLowerCase().includes(needle)
        )
      : pool
    // Favorites first, then the current mapping, then alphabetical.
    return [...filtered].sort((a, b) => {
      const rank = (m: RegistryModel) => (m.key === currentKey ? 0 : m.userState.favorite ? 1 : 2)
      return rank(a) - rank(b) || a.displayName.localeCompare(b.displayName)
    }).slice(0, 60)
  }, [models, query, currentKey])

  return (
    <div className="mt-3 rounded-2xl border border-white/[0.08] bg-surface-2/60 p-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            className="field !pl-9"
            placeholder="Search models…"
            value={query}
            autoFocus
            onChange={event => setQuery(event.target.value)}
          />
        </div>
        {isOverride && (
          <button className="btn-subtle !text-xs" onClick={() => void onReset()}>
            <RotateCcw className="h-3.5 w-3.5" /> Use default
          </button>
        )}
      </div>

      <div className="mt-2 max-h-72 space-y-0.5 overflow-y-auto">
        {visible.length === 0 && (
          <p className="px-2 py-3 text-center text-sm text-white/35">
            {models.length === 0 ? 'No models discovered yet — add a provider first.' : 'No models match.'}
          </p>
        )}
        {visible.map(model => (
          <button
            key={model.key}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition',
              model.key === currentKey ? 'bg-aura-500/15 ring-1 ring-aura-400/25' : 'hover:bg-white/[0.06]'
            )}
            onClick={() => void onPick(model.key)}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {model.userState.favorite && <Star className="h-3 w-3 fill-amber-300 text-amber-300" />}
                <span className="truncate text-sm font-medium text-white/85">{model.displayName}</span>
                {model.key === currentKey && <Check className="h-3.5 w-3.5 shrink-0 text-aura-300" />}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span className="badge !text-[10px]">{model.providerName}</span>
                {model.contextLength && <span className="badge !text-[10px]">{formatContext(model.contextLength)}</span>}
                <CapabilityBadges model={model} />
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

export function CapabilityBadges({ model }: { model: RegistryModel }) {
  return (
    <>
      {model.capabilities.vision && <span className="badge !text-[10px]" title="Vision"><Eye className="h-3 w-3" /></span>}
      {model.capabilities.reasoning && <span className="badge !text-[10px]" title="Reasoning"><Brain className="h-3 w-3" /></span>}
      {model.capabilities.tools && <span className="badge !text-[10px]" title="Function calling"><Wrench className="h-3 w-3" /></span>}
      {model.capabilities.streaming && <span className="badge !text-[10px]" title="Streaming"><Radio className="h-3 w-3" /></span>}
    </>
  )
}

export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M ctx`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K ctx`
  return `${tokens} ctx`
}
