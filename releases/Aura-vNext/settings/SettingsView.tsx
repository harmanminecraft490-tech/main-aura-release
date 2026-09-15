import { Settings2, Server, Sparkles, LayoutGrid, Palette, Code2, ArrowLeft } from 'lucide-react'
import { useStore } from '@services/store'
import { cn } from '@ui/cn'
import { GeneralTab } from './tabs/GeneralTab'
import { ProvidersTab } from './tabs/ProvidersTab'
import { AuraModelsTab } from './tabs/AuraModelsTab'
import { ModelManagerTab } from './tabs/ModelManagerTab'
import { AppearanceTab } from './tabs/AppearanceTab'
import { DeveloperTab } from './tabs/DeveloperTab'

const TABS = [
  { id: 'general', label: 'General', icon: Settings2, component: GeneralTab },
  { id: 'providers', label: 'Providers', icon: Server, component: ProvidersTab },
  { id: 'aura-models', label: 'Aura Models', icon: Sparkles, component: AuraModelsTab },
  { id: 'model-manager', label: 'Model Manager', icon: LayoutGrid, component: ModelManagerTab },
  { id: 'appearance', label: 'Appearance', icon: Palette, component: AppearanceTab },
  { id: 'developer', label: 'Developer', icon: Code2, component: DeveloperTab },
] as const

export function SettingsView() {
  const tab = useStore(state => state.settingsTab)
  const setSettingsTab = useStore(state => state.setSettingsTab)
  const setView = useStore(state => state.setView)
  const suggestions = useStore(state => state.suggestions)

  const active = TABS.find(candidate => candidate.id === tab) ?? TABS[0]
  const ActiveComponent = active.component

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-60 shrink-0 flex-col border-r border-white/[0.06] bg-surface-1/40 p-3">
        <button className="btn-subtle mb-3 justify-start" onClick={() => setView('chat')}>
          <ArrowLeft className="h-4 w-4" /> Back to chat
        </button>
        <h2 className="px-2.5 pb-2 text-lg font-semibold text-white">Settings</h2>
        <nav className="space-y-0.5">
          {TABS.map(candidate => (
            <button
              key={candidate.id}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition',
                candidate.id === active.id
                  ? 'bg-aura-500/15 text-white ring-1 ring-aura-400/25'
                  : 'text-white/60 hover:bg-white/[0.06] hover:text-white'
              )}
              onClick={() => setSettingsTab(candidate.id)}
            >
              <candidate.icon className="h-4 w-4" />
              {candidate.label}
              {candidate.id === 'aura-models' && suggestions.length > 0 && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-aura-500 px-1.5 text-[11px] font-semibold text-white">
                  {suggestions.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-6">
          <ActiveComponent />
        </div>
      </div>
    </div>
  )
}
