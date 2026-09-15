import { useEffect, useState } from 'react'
import { MessageSquare, Code2, ListChecks, Eye, Mic, Database, ArrowRight } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useAuraStore } from '@/store'
import type { SmartRouting, TaskType, APIProfile } from '@/types'
import { Card, PROVIDER_META } from './shared'

const TASK_META: Record<TaskType, { label: string; icon: React.ElementType; desc: string }> = {
  chat: { label: 'Chat', icon: MessageSquare, desc: 'General conversation and Q&A' },
  coding: { label: 'Coding', icon: Code2, desc: 'Code generation, debugging, reviews' },
  planning: { label: 'Planning', icon: ListChecks, desc: 'Architecture and task planning' },
  vision: { label: 'Vision', icon: Eye, desc: 'Image analysis and visual tasks' },
  voice: { label: 'Voice', icon: Mic, desc: 'Voice interaction and TTS' },
  embeddings: { label: 'Embeddings', icon: Database, desc: 'Vector embeddings for search' },
}

const TASKS = Object.keys(TASK_META) as TaskType[]

export function SmartRoutingTab() {
  const { routing, setRouting, profiles } = useAuraStore()
  const [localRouting, setLocalRouting] = useState<SmartRouting>(routing)

  useEffect(() => {
    window.aura?.routing.get().then(setLocalRouting).catch(() => {})
  }, [])

  const enabledProfiles = profiles.filter(p => p.enabled)

  async function updateRouting(task: TaskType, profileId: string | null) {
    const updated = { ...localRouting, [task]: profileId || null }
    setLocalRouting(updated)
    setRouting(updated)
    await window.aura?.routing.set({ [task]: profileId || null })
  }

  return (
    <div className="max-w-3xl space-y-5">
      <p className="text-sm text-white/40">
        Assign specific API profiles to different task types. Aura automatically routes requests to the best model for each task.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {TASKS.map(task => {
          const meta = TASK_META[task]
          const Icon = meta.icon
          const assignedId = localRouting[task]
          const assignedProfile = enabledProfiles.find(p => p.id === assignedId)
          return (
            <Card key={task}>
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/8 text-aura-200">
                  <Icon size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">{meta.label}</p>
                  <p className="mt-0.5 text-xs text-white/40">{meta.desc}</p>
                </div>
              </div>
              <div className="mt-3">
                {assignedProfile ? (
                  <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                    <span className={cn('h-2 w-2 rounded-full bg-gradient-to-br', (PROVIDER_META[assignedProfile.provider] ?? PROVIDER_META.aura).color)} />
                    <span className="flex-1 truncate text-sm text-white/70">{assignedProfile.displayName}</span>
                    <span className="text-[10px] text-white/35">{(PROVIDER_META[assignedProfile.provider] ?? PROVIDER_META.aura).label}</span>
                    <button
                      className="text-xs text-white/30 hover:text-red-400"
                      onClick={() => updateRouting(task, null)}
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <div className="text-xs text-white/30">Using active/default profile</div>
                )}
                <select
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 px-3 text-xs text-white/60 outline-none focus:border-white/20"
                  onChange={e => updateRouting(task, e.target.value)}
                  value={assignedId ?? ''}
                >
                  <option value="" className="bg-surface-1">Auto (use active profile)</option>
                  {enabledProfiles.map(p => (
                    <option key={p.id} value={p.id} className="bg-surface-1">
                      {p.displayName} · {p.model}
                    </option>
                  ))}
                </select>
              </div>
            </Card>
          )
        })}
      </div>

      {enabledProfiles.length === 0 && (
        <Card>
          <p className="text-center text-sm text-white/40">Create API profiles first to enable smart routing.</p>
        </Card>
      )}
    </div>
  )
}
