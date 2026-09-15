import { useEffect, useState } from 'react'
import {
  BookOpen,
  Boxes,
  Check,
  Cpu,
  Globe2,
  Layers,
  Loader2,
  LogIn,
  Mic,
  Palette,
  Plug,
  Route,
  Settings2,
  Shield,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  X,
  Zap,
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { useAuraStore } from '@/store'
import type { AccountStatus, AIConfig, ModelPreset } from '@/types'
import { AccountTab } from './settings/AccountTab'
import { APIDashboardTab } from './settings/APIDashboardTab'
import { AgentMarketplacePage } from './settings/AgentMarketplacePage'
import { AppearanceTab } from './settings/AppearanceTab'
import { AuraModelsTab } from './settings/AuraModelsTab'
import { CapabilitiesTab } from './settings/CapabilitiesTab'
import { DocsPage } from './settings/DocsPage'
import { GeneralPage } from './settings/GeneralPage'
import { McpPage } from './settings/McpPage'
import { ModelManagerTab } from './settings/ModelManagerTab'
import { ModesTab } from './settings/ModesTab'
import { PermissionsPage } from './settings/PermissionsPage'
import { SmartRoutingTab } from './settings/SmartRoutingTab'
import { VoiceSettingsTab } from './settings/VoiceSettingsTab'
import { WebSearchTab } from './settings/WebSearchTab'

type SettingsSection =
  | 'general'
  | 'permissions'
  | 'capabilities'
  | 'mcp'
  | 'api'
  | 'aura-models'
  | 'modes'
  | 'models'
  | 'routing'
  | 'web-search'
  | 'marketplace'
  | 'voice'
  | 'appearance'
  | 'docs'
  | 'account'

const NAV: Array<{ id: SettingsSection; label: string; icon: React.ElementType; group: 'main' | 'ai' | 'more' }> = [
  { id: 'general', label: 'General', icon: Settings2, group: 'main' },
  { id: 'permissions', label: 'Permissions', icon: Shield, group: 'main' },
  { id: 'capabilities', label: 'Capabilities', icon: Zap, group: 'main' },
  { id: 'mcp', label: 'MCP', icon: Plug, group: 'main' },
  { id: 'api', label: 'API', icon: Layers, group: 'ai' },
  { id: 'aura-models', label: 'Aura Models', icon: Sparkles, group: 'ai' },
  { id: 'modes', label: 'AI Modes', icon: SlidersHorizontal, group: 'ai' },
  { id: 'models', label: 'Models', icon: Cpu, group: 'ai' },
  { id: 'routing', label: 'Routing', icon: Route, group: 'ai' },
  { id: 'web-search', label: 'Web Search', icon: Globe2, group: 'ai' },
  { id: 'marketplace', label: 'Agents', icon: Boxes, group: 'more' },
  { id: 'voice', label: 'Voice', icon: Mic, group: 'more' },
  { id: 'appearance', label: 'Appearance', icon: Palette, group: 'more' },
  { id: 'docs', label: 'Docs', icon: BookOpen, group: 'more' },
  { id: 'account', label: 'Our Account', icon: UserRound, group: 'more' },
]

function AccountRailButton({
  status,
  onOpen,
  onLogout,
}: {
  status: AccountStatus | null
  onOpen: () => void
  onLogout: () => void
}) {
  const loggedIn = Boolean(status?.loggedIn)
  const tierHint =
    status?.tier === 'dev'
      ? 'Dev · unlimited'
      : status?.tier === 'premium'
        ? 'Premium'
        : status?.trialActive
          ? 'Basic · trial'
          : status?.loggedIn
            ? 'Basic'
            : null

  return (
    <div className="space-y-1 border-t border-white/[0.06] p-2">
      <button
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] transition',
          loggedIn ? 'text-emerald-300 hover:bg-white/[0.05]' : 'text-white/55 hover:bg-white/[0.05] hover:text-white'
        )}
        onClick={onOpen}
        title={loggedIn ? status?.email ?? 'Our Account' : 'Our Account — create account to unlock free trial'}
        type="button"
      >
        <UserRound size={15} />
        <span className="min-w-0 flex-1 truncate">Our Account</span>
        {loggedIn ? (
          <span className="truncate text-[10px] text-white/35 max-w-[88px]" title={status?.email ?? ''}>
            {tierHint ?? status?.email?.split('@')[0]}
          </span>
        ) : (
          <LogIn size={12} className="opacity-50" />
        )}
      </button>
      {loggedIn && (
        <button
          className="w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] text-white/35 transition hover:bg-white/[0.05] hover:text-red-300"
          onClick={onLogout}
          type="button"
        >
          Log out
        </button>
      )}
    </div>
  )
}

/** Dedicated Our Account page with login / logout and plan tier. */
function AccountSection({ onStatus }: { onStatus: (status: AccountStatus | null) => void }) {
  return (
    <div className="mx-auto max-w-2xl">
      <AccountTab onStatusChange={onStatus} />
    </div>
  )
}

export function SettingsPanel() {
  const {
    aiConfig,
    setAIConfig,
    setViewMode,
    setProfiles,
    setSavedModels,
    setRouting,
    setVoiceSettings,
    setDevLogs,
    setDevStats,
    setPlugins,
    account,
    setAccount,
  } = useAuraStore()

  const [presets, setPresets] = useState<ModelPreset[]>([])
  const [section, setSection] = useState<SettingsSection>(() => {
    const pending = useAuraStore.getState().consumePendingSettingsSection()
    return (pending as SettingsSection | null) ?? 'general'
  })
  const [ready, setReady] = useState(false)
  const pendingSettingsSection = useAuraStore(state => state.pendingSettingsSection)

  useEffect(() => {
    if (!pendingSettingsSection) return
    const next = useAuraStore.getState().consumePendingSettingsSection()
    if (next) setSection(next as SettingsSection)
  }, [pendingSettingsSection])

  useEffect(() => {
    if (!window.aura) return
    Promise.all([
      window.aura.ai.getConfig(),
      window.aura.ai.getPresets(),
      window.aura.profiles.list(),
      window.aura.models.list(),
      window.aura.routing.get(),
      window.aura.voice.getSettings(),
      window.aura.devlogs.list(),
      window.aura.devlogs.stats(),
      window.aura.plugins.list(),
      window.aura.account.status().catch(() => null),
    ])
      .then(([config, presetList, profiles, models, routing, voice, devLogs, devStats, plugins, accountStatus]) => {
        setAIConfig(config as AIConfig)
        setPresets(presetList)
        setProfiles(profiles)
        setSavedModels(models)
        setRouting(routing)
        setVoiceSettings(voice)
        setDevLogs(devLogs)
        setDevStats(devStats)
        setPlugins(plugins)
        setAccount(accountStatus)
        setReady(true)
      })
      .catch(error => {
        console.error(error)
        setReady(true)
      })
  }, [setAIConfig, setProfiles, setSavedModels, setRouting, setVoiceSettings, setDevLogs, setDevStats, setPlugins, setAccount])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setViewMode('chat')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setViewMode])

  async function logout() {
    try {
      setAccount(await window.aura!.account.logout())
    } catch {
      /* ignore */
    }
  }

  if (!ready || !aiConfig) {
    return (
      <section className="flex h-full min-w-0 flex-1 items-center justify-center bg-[#0b0b0b]">
        <Loader2 className="animate-spin text-white/35" size={28} />
      </section>
    )
  }

  const active = NAV.find(item => item.id === section)

  return (
    <section className="flex h-full min-w-0 flex-1 overflow-hidden bg-[#0b0b0b]">
      {/* Icon + label rail (Cursor-style) */}
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0f0f0f]">
        <div className="flex items-center justify-between px-3 py-3">
          <div className="flex items-center gap-2 text-white/70">
            <Settings2 size={15} />
            <span className="text-[13px] font-medium">Settings</span>
          </div>
          <button
            className="rounded-md p-1.5 text-white/35 transition hover:bg-white/[0.06] hover:text-white/80"
            onClick={() => setViewMode('chat')}
            title="Close (Esc)"
            type="button"
          >
            <X size={15} />
          </button>
        </div>

        <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-3">
          {(['main', 'ai', 'more'] as const).map(group => (
            <div key={group} className="space-y-0.5">
              {NAV.filter(item => item.group === group).map(item => {
                const Icon = item.icon
                const isActive = section === item.id
                return (
                  <button
                    key={item.id}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition',
                      isActive
                        ? 'bg-white/[0.08] text-white'
                        : 'text-white/45 hover:bg-white/[0.04] hover:text-white/80'
                    )}
                    onClick={() => setSection(item.id)}
                    type="button"
                  >
                    <Icon size={15} className={isActive ? 'text-white' : 'text-white/40'} />
                    {item.label}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <AccountRailButton
          status={account}
          onOpen={() => setSection('account')}
          onLogout={() => void logout()}
        />
      </aside>

      {/* Content */}
      <div className="relative min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.06] bg-[#0b0b0b]/95 px-8 py-3 backdrop-blur">
          <div className="flex items-center gap-2 text-white/50">
            {active && <active.icon size={14} />}
            <span className="text-[12px] font-medium uppercase tracking-[0.12em]">{active?.label ?? 'Settings'}</span>
          </div>
          {account?.loggedIn && (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300">
              <Check size={11} /> Signed in
            </span>
          )}
        </div>

        <div className="px-8 py-6">
          {section === 'general' && <GeneralPage onNavigate={id => setSection(id as SettingsSection)} />}
          {section === 'permissions' && <PermissionsPage />}
          {section === 'capabilities' && <CapabilitiesTab onOpenIntegrations={() => setSection('mcp')} />}
          {section === 'mcp' && <McpPage />}
          {section === 'api' && <APIDashboardTab presets={presets} />}
          {section === 'aura-models' && <AuraModelsTab />}
          {section === 'modes' && <ModesTab />}
          {section === 'models' && <ModelManagerTab presets={presets} />}
          {section === 'routing' && <SmartRoutingTab />}
          {section === 'web-search' && <WebSearchTab />}
          {section === 'marketplace' && <AgentMarketplacePage />}
          {section === 'voice' && <VoiceSettingsTab />}
          {section === 'appearance' && <AppearanceTab />}
          {section === 'docs' && <DocsPage />}
          {section === 'account' && <AccountSection onStatus={setAccount} />}
        </div>
      </div>
    </section>
  )
}
