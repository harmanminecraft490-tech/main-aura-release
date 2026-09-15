import { Check, ChevronDown, Search, Sparkles, Zap } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { cn } from '@/utils/cn'
import { useAuraStore } from '@/store'
import { resolveSelection } from '@/services/auraModels'
import type { ModelSelection, APIProfile, AuraVirtualModel } from '@/types'
import { PROVIDER_META } from './settings/shared'

type PickerItem = {
  selection: ModelSelection
  label: string
  sublabel: string
  section: 'aura' | 'provider'
  accent?: string
}

/**
 * Chat-header model selector. Lists Aura virtual models first (default
 * experience) and raw provider profiles below for advanced users. Selecting
 * an item only updates renderer state — resolution to a concrete profile
 * happens at send time in ChatView.
 */
export function ModelPicker({
  value,
  onChange,
}: {
  value: ModelSelection
  onChange: (selection: ModelSelection) => void
}) {
  const virtualModels = useAuraStore(state => state.virtualModels)
  const profiles = useAuraStore(state => state.profiles)
  const preferences = useAuraStore(state => state.preferences)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const enabledProfiles = useMemo(() => profiles.filter(p => p.enabled), [profiles])
  const showProviderModels = preferences.developerMode

  const items = useMemo<PickerItem[]>(() => {
    // Aura models show only their tagline — the underlying provider resolution
    // is admin detail, visible in Settings → Aura Models, never in chat.
    const auraItems: PickerItem[] = virtualModels.map(model => ({
      selection: { kind: 'aura', id: model.id },
      label: model.name,
      sublabel: model.tagline,
      section: 'aura',
    }))
    // Only include provider items if Developer Mode is enabled
    const providerItems: PickerItem[] = showProviderModels ? enabledProfiles.map(profile => {
      const isAuraIdentity = Boolean(profile.locked) && (profile.provider === 'aura' || profile.model === 'Aura Model')
      const meta = PROVIDER_META[profile.provider] ?? PROVIDER_META.aura
      return {
        selection: { kind: 'provider', id: profile.id },
        label: profile.displayName,
        sublabel: isAuraIdentity ? 'Aura · Aura Model' : `${meta.label} · ${profile.model}`,
        section: 'provider',
        accent: isAuraIdentity ? PROVIDER_META.aura.color : meta.color,
      }
    }) : []
    return [...auraItems, ...providerItems]
  }, [virtualModels, profiles, enabledProfiles, showProviderModels])

  const filtered = useMemo(() => {
    if (!query.trim()) return items
    const needle = query.toLowerCase()
    return items.filter(item =>
      item.label.toLowerCase().includes(needle) || item.sublabel.toLowerCase().includes(needle)
    )
  }, [items, query])

  const current = useMemo(() => {
    const selection = value
    let profile: APIProfile | undefined
    let virtualModel: AuraVirtualModel | undefined

    if (selection.kind === 'aura') {
      virtualModel = virtualModels.find(m => m.id === selection.id)
    } else {
      profile = profiles.find(p => p.id === selection.id)
    }
    // Never surface the raw provider model id in chat — Aura branding only.
    if (virtualModel) return { label: virtualModel.name, hint: profile ? '' : 'no provider configured' }
    if (profile) return { label: profile.displayName, hint: '' }
    return { label: 'Select model', hint: '' }
  }, [value, virtualModels, profiles])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setHighlight(0)
    inputRef.current?.focus()
    const onClickAway = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [open])

  useEffect(() => {
    setHighlight(h => Math.min(h, Math.max(filtered.length - 1, 0)))
  }, [filtered.length])

  const pick = useCallback((item: PickerItem) => {
    onChange(item.selection)
    setOpen(false)
  }, [onChange])

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!open) {
      // Let the trigger button behave natively (Enter/Space opens via click);
      // ArrowDown is a convenience opener.
      if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) }
      return
    }
    if (event.key === 'Escape') { setOpen(false); return }
    if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight(h => Math.min(h + 1, filtered.length - 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    if (event.key === 'Enter' && filtered[highlight]) { event.preventDefault(); pick(filtered[highlight]) }
  }, [open, filtered, setOpen, setHighlight, pick])

  const auraSection = filtered.filter(item => item.section === 'aura')
  const providerSection = filtered.filter(item => item.section === 'provider')

  function renderItem(item: PickerItem) {
    const index = filtered.indexOf(item)
    const isSelected = item.selection.kind === value.kind && item.selection.id === value.id
    return (
      <button
        key={`${item.selection.kind}:${item.selection.id}`}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition',
          index === highlight ? 'bg-white/10' : 'hover:bg-white/6'
        )}
        onClick={() => pick(item)}
        onMouseEnter={() => setHighlight(index)}
        type="button"
      >
        {item.section === 'aura' ? (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-aura-400/30 to-fuchsia-400/20 text-aura-200">
            <Sparkles size={12} />
          </span>
        ) : (
          <span className={cn('ml-2 mr-2 h-2 w-2 shrink-0 rounded-full bg-gradient-to-br', item.accent)} />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-white/85">{item.label}</span>
          <span className="block truncate text-[11px] text-white/35">{item.sublabel}</span>
        </span>
        {isSelected && <Check size={14} className="shrink-0 text-aura-300" />}
      </button>
    )
  }

  return (
    <div className="relative" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-3.5 py-2 text-sm text-white/80 transition hover:border-white/20 hover:bg-white/8"
        onClick={() => setOpen(v => !v)}
        title="Choose model"
        type="button"
      >
        <Zap size={14} className="text-aura-300" />
        <span className="max-w-[180px] truncate font-medium">{current.label}</span>
        {current.hint && <span className="hidden max-w-[140px] truncate text-xs text-white/35 sm:block">{current.hint}</span>}
        <ChevronDown size={14} className={cn('text-white/40 transition-transform', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="absolute right-0 z-50 mt-2 w-[340px] overflow-hidden rounded-2xl border border-white/12 bg-surface-1/95 shadow-2xl shadow-black/60 backdrop-blur-2xl"
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
          >
            <div className="border-b border-white/8 p-2">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  ref={inputRef}
                  className="w-full rounded-xl bg-white/[0.05] py-2 pl-8 pr-3 text-sm text-white outline-none placeholder:text-white/25"
                  onChange={e => { setQuery(e.target.value); setHighlight(0) }}
                  placeholder="Search models…"
                  value={query}
                />
              </div>
            </div>

            <div className="max-h-[380px] overflow-y-auto p-2">
              {auraSection.length > 0 && (
                <>
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-white/30">Aura Models</p>
                  {auraSection.map(renderItem)}
                </>
              )}
              {providerSection.length > 0 && (
                <>
                  <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-white/30">Provider Models</p>
                  {providerSection.map(renderItem)}
                </>
              )}
              {filtered.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-white/30">No models match “{query}”</p>
              )}
              {enabledProfiles.length === 0 && (
                <p className="px-3 pb-3 pt-1 text-[11px] leading-5 text-amber-300/70">
                  No API profiles configured yet — Aura models will activate once you add one in Settings → API Dashboard.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
