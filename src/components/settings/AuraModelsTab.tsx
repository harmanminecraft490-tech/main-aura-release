import { ArrowDown, ArrowUp, Check, Plus, RotateCcw, Sparkles, Trash2, X, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '@/utils/cn'
import { useAuraStore } from '@/store'
import {
  describeMatcher,
  resetVirtualModels,
  resolveVirtualModel,
  loadVirtualModels,
} from '@/services/auraModels'
import type { AuraModelMatcher, AuraVirtualModel, AIProvider } from '@/types'
import { Card, IconBtn, PROVIDER_META, PROVIDERS } from './shared'

/**
 * Settings tab for Aura virtual models: pick the default, edit each model's
 * routing chain (priority-ordered matchers over existing profiles), and see
 * a live preview of which provider model each virtual model resolves to.
 */
export function AuraModelsTab() {
  const virtualModels = useAuraStore(state => state.virtualModels)
  const setVirtualModels = useAuraStore(state => state.setVirtualModels)
  const profiles = useAuraStore(state => state.profiles)
  const defaultSelection = useAuraStore(state => state.defaultModelSelection)
  const setDefaultModelSelection = useAuraStore(state => state.setDefaultModelSelection)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const enabledProfiles = useMemo(() => profiles.filter(p => p.enabled), [profiles])

  function updateModel(id: string, updates: Partial<AuraVirtualModel>) {
    setVirtualModels(virtualModels.map(m => (m.id === id ? { ...m, ...updates } : m)))
  }

  function moveMatcher(model: AuraVirtualModel, index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= model.chain.length) return
    const chain = [...model.chain]
    ;[chain[index], chain[target]] = [chain[target], chain[index]]
    updateModel(model.id, { chain })
  }

  function removeMatcher(model: AuraVirtualModel, index: number) {
    updateModel(model.id, { chain: model.chain.filter((_, i) => i !== index) })
  }

  function addMatcher(model: AuraVirtualModel, matcher: AuraModelMatcher) {
    updateModel(model.id, { chain: [...model.chain, matcher] })
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-white/40">
          Aura models are smart presets that route each conversation to the best available provider
          from your API profiles — with automatic fallback when a provider is unavailable. Routing is
          fully editable and never changes your provider configurations.
        </p>
        <button
          className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/55 transition hover:border-white/20 hover:text-white/85"
          onClick={() => {
            resetVirtualModels();
            setVirtualModels(loadVirtualModels());
          }}
          type="button"
        >
          <RotateCcw size={13} /> Reset to defaults
        </button>
      </div>

      {enabledProfiles.length === 0 && (
        <Card>
          <p className="text-center text-sm text-amber-300/70">
            Add at least one API profile in the API Dashboard tab — Aura models route on top of your profiles.
          </p>
        </Card>
      )}

      <div className="space-y-3">
        {virtualModels.map(model => {
          const resolved = resolveVirtualModel(model.id, virtualModels, profiles)
          const isDefault = defaultSelection.kind === 'aura' && defaultSelection.id === model.id
          const expanded = expandedId === model.id
          return (
            <div
              key={model.id}
              className={cn(
                'rounded-3xl border bg-white/[0.04] backdrop-blur-2xl transition',
                isDefault ? 'border-aura-400/40' : 'border-white/8'
              )}
            >
              <button
                className="flex w-full items-center gap-3 px-5 py-4 text-left"
                onClick={() => setExpandedId(expanded ? null : model.id)}
                type="button"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-aura-400/30 to-fuchsia-400/20 text-aura-200">
                  <Sparkles size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{model.name}</span>
                    {isDefault && (
                      <span className="rounded-full bg-aura-500/20 px-2 py-0.5 text-[10px] font-medium text-aura-200">Default</span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-white/40">{model.tagline}</span>
                </span>
                <span className="shrink-0 text-right">
                  {resolved && resolved.profile ? (
                    <>
                      <span className="flex items-center justify-end gap-1.5 text-xs text-white/60">
                        <span className={cn('h-1.5 w-1.5 rounded-full bg-gradient-to-br', (PROVIDER_META[resolved.profile.provider] ?? PROVIDER_META.aura).color)} />
                        {resolved.profile.displayName}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-white/30">
                        {resolved.profile.model}{resolved.via === 'fallback' ? ' · fallback' : ''}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-white/25">No provider available</span>
                  )}
                </span>
              </button>

              {expanded && (
                <div className="border-t border-white/6 px-5 py-4">
                  <div className="mb-4 flex items-center justify-between">
                    <button
                      className={cn(
                        'flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition',
                        isDefault
                          ? 'bg-aura-500/20 text-aura-200'
                          : 'border border-white/10 text-white/55 hover:border-white/20 hover:text-white/85'
                      )}
                      onClick={() => setDefaultModelSelection({ kind: 'aura', id: model.id })}
                      type="button"
                    >
                      {isDefault ? <Check size={13} /> : <Zap size={13} />}
                      {isDefault ? 'Default model' : 'Set as default'}
                    </button>
                    <label className="flex items-center gap-2 text-xs text-white/45">
                      <input
                        checked={model.autoFallback}
                        className="accent-aura-400"
                        onChange={e => updateModel(model.id, { autoFallback: e.target.checked })}
                        type="checkbox"
                      />
                      Auto-fallback when no rule matches
                    </label>
                  </div>

                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/30">
                    Routing priority
                  </p>
                  <div className="space-y-1.5">
                    {model.chain.map((matcher, index) => {
                      const live = resolved && !(resolved.via === 'fallback' || resolved.via === 'unknown') && parseInt(resolved.via, 10) === index
                      return (
                        <div
                          key={`${index}-${matcher.provider ?? ''}-${matcher.profileId ?? ''}-${matcher.modelPattern ?? ''}`}
                          className={cn(
                            'flex items-center gap-2 rounded-xl border px-3 py-2',
                            live ? 'border-emerald-400/30 bg-emerald-500/8' : 'border-white/6 bg-white/[0.02]'
                          )}
                        >
                          <span className="w-5 text-center font-mono text-[10px] text-white/30">{index + 1}</span>
                          <span className="flex-1 truncate text-xs text-white/65">{describeMatcher(matcher)}</span>
                          {live && <span className="text-[10px] font-medium text-emerald-300">active</span>}
                          <IconBtn icon={ArrowUp} onClick={() => moveMatcher(model, index, -1)} title="Move up" />
                          <IconBtn icon={ArrowDown} onClick={() => moveMatcher(model, index, 1)} title="Move down" />
                          <IconBtn icon={Trash2} onClick={() => removeMatcher(model, index)} title="Remove" danger />
                        </div>
                      )
                    })}
                    {model.chain.length === 0 && (
                      <p className="rounded-xl border border-dashed border-white/10 px-3 py-3 text-center text-xs text-white/30">
                        No rules — {model.autoFallback ? 'capability-based auto-selection is used' : 'this model cannot resolve'}
                      </p>
                    )}
                  </div>

                  <MatcherComposer profiles={enabledProfiles} onAdd={matcher => addMatcher(model, matcher)} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MatcherComposer({
  profiles,
  onAdd,
}: {
  profiles: ReturnType<typeof useAuraStore.getState>['profiles']
  onAdd: (matcher: AuraModelMatcher) => void
}) {
  const [mode, setMode] = useState<'closed' | 'profile' | 'pattern'>('closed')
  const [provider, setProvider] = useState<AIProvider>('anthropic')
  const [pattern, setPattern] = useState('')

  if (mode === 'closed') {
    return (
      <div className="mt-3 flex gap-2">
        <button
          className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-white/55 transition hover:border-white/20 hover:text-white/85"
          onClick={() => setMode('profile')}
          type="button"
        >
          <Plus size={12} /> Add profile rule
        </button>
        <button
          className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-white/55 transition hover:border-white/20 hover:text-white/85"
          onClick={() => setMode('pattern')}
          type="button"
        >
          <Plus size={12} /> Add provider rule
        </button>
      </div>
    )
  }

  return (
    <div className="mt-3 flex items-center gap-2">
      {mode === 'profile' ? (
        <select
          className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] py-2 px-3 text-xs text-white/70 outline-none focus:border-white/20"
          defaultValue=""
          onChange={e => {
            if (e.target.value) {
              onAdd({ profileId: e.target.value })
              setMode('closed')
            }
          }}
        >
          <option value="" className="bg-surface-1">Pick a profile…</option>
          {profiles.map(p => (
            <option key={p.id} value={p.id} className="bg-surface-1">
              {p.displayName} · {p.model}
            </option>
          ))}
        </select>
      ) : (
        <>
          <select
            className="rounded-xl border border-white/10 bg-white/[0.04] py-2 px-3 text-xs text-white/70 outline-none focus:border-white/20"
            onChange={e => setProvider(e.target.value as AIProvider)}
            value={provider}
          >
            {PROVIDERS.map(p => (
              <option key={p} value={p} className="bg-surface-1">{PROVIDER_META[p].label}</option>
            ))}
          </select>
          <input
            className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] py-2 px-3 text-xs text-white outline-none placeholder:text-white/25 focus:border-white/20"
            onChange={e => setPattern(e.target.value)}
            placeholder="Model pattern (optional) — e.g. sonnet, flash, gpt-5"
            value={pattern}
          />
          <button
            className="rounded-xl bg-white/10 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/15"
            onClick={() => {
              onAdd({ provider, ...(pattern.trim() ? { modelPattern: pattern.trim() } : {}) })
              setPattern('')
              setMode('closed')
            }}
            type="button"
          >
            Add
          </button>
        </>
      )}
      <IconBtn icon={X} onClick={() => setMode('closed')} title="Cancel" />
    </div>
  )
}
