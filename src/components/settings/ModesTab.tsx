import { Check } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useAuraStore } from '@/store'
import type { AIMode } from '@/types'
import { MODE_META } from './shared'

export function ModesTab() {
  const { aiConfig, setAIMode, aiMode } = useAuraStore()
  const activeMode = aiConfig?.aiMode ?? aiMode
  const modes = Object.keys(MODE_META) as AIMode[]

  async function changeMode(mode: AIMode) {
    setAIMode(mode)
    await window.aura?.ai.setConfig({ aiMode: mode })
  }

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-white/40">
        Modes tune temperature, token budget, and reasoning depth. Auto picks the best mode per message (big tasks plan then implement). Plan always plans before coding. Mutating tools ask permission unless Bypass.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {modes.map(mode => {
          const meta = MODE_META[mode]
          const active = activeMode === mode
          return (
            <button
              key={mode}
              className={cn(
                'flex flex-col gap-3 rounded-3xl border p-5 text-left transition',
                active ? 'border-white/20 bg-white/[0.08]' : 'border-white/6 bg-white/[0.03] hover:border-white/12 hover:bg-white/6'
              )}
              onClick={() => changeMode(mode)}
            >
              <div className="flex items-center justify-between">
                <span className="text-2xl">{meta.emoji}</span>
                {active && (
                  <span className="flex items-center gap-1 rounded-full bg-white/12 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/80">
                    <Check size={10} /> Active
                  </span>
                )}
              </div>
              <div>
                <p className="font-semibold text-white">{meta.label}</p>
                <p className="mt-0.5 text-xs text-white/45">{meta.desc}</p>
              </div>
              <span className="rounded-lg bg-white/5 px-2.5 py-1 text-[11px] font-mono text-white/40">{meta.params}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
