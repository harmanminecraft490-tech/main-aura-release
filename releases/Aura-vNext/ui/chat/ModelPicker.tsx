import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Check, Code2 } from 'lucide-react'
import { useStore } from '@services/store'
import { AURA_MODELS, type AuraModelId } from '@models/aura-models/definitions'
import { AuraModelIcon } from '../AuraModelIcon'
import { cn } from '../cn'

/**
 * Chat model picker. Shows ONLY Aura virtual models — never raw backend names.
 * When Developer Mode is on, each row also reveals the resolved backend model
 * it currently maps to (read from the mappings mirror).
 */
export function ModelPicker({ value, onChange }: { value: AuraModelId; onChange: (id: AuraModelId) => void }) {
  const [open, setOpen] = useState(false)
  const developerMode = useStore(state => state.appSettings.developerMode)
  const mappings = useStore(state => state.mappings)
  const ref = useRef<HTMLDivElement | null>(null)

  const resolvedByAura = useMemo(
    () => new Map(mappings.map(mapping => [mapping.id, mapping])),
    [mappings]
  )

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const selected = AURA_MODELS.find(model => model.id === value) ?? AURA_MODELS[0]

  return (
    <div className="relative no-drag" ref={ref}>
      <button
        className="btn-ghost !rounded-full !py-1.5 !pl-1.5 !pr-3"
        onClick={() => setOpen(o => !o)}
      >
        <AuraModelIcon id={selected.id} size="sm" />
        <span className="font-medium">{selected.name}</span>
        <ChevronDown className={cn('h-4 w-4 text-white/40 transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 origin-top-right animate-slide-up rounded-2xl border border-white/10 bg-surface-2/95 p-1.5 shadow-2xl backdrop-blur-2xl">
          <div className="max-h-[420px] overflow-y-auto">
            {AURA_MODELS.map(model => {
              const mapping = resolvedByAura.get(model.id)
              const active = model.id === value
              return (
                <button
                  key={model.id}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left transition',
                    active ? 'bg-aura-500/15' : 'hover:bg-white/[0.06]'
                  )}
                  onClick={() => { onChange(model.id); setOpen(false) }}
                >
                  <AuraModelIcon id={model.id} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-white">{model.name}</span>
                      {active && <Check className="h-3.5 w-3.5 text-aura-300" />}
                    </div>
                    <p className="truncate text-xs text-white/45">{model.tagline}</p>
                    {developerMode && (
                      <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-white/35">
                        <Code2 className="h-3 w-3" />
                        {mapping?.resolvedName
                          ? `${mapping.resolvedName} · ${mapping.resolvedProvider ?? '—'}`
                          : 'No backend model mapped'}
                      </p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
