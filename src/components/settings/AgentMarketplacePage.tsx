import { useEffect, useMemo, useState } from 'react'
import { Bot, Check, Store } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { AgentType } from '@/types'
import { GhostButton, SettingsGroup, SettingsPageHeader, SettingsRow, Toggle } from './shared'

interface MarketplaceAgent {
  id: string
  name: string
  type: AgentType
  description: string
  builtIn: boolean
}

const CATALOG: MarketplaceAgent[] = [
  { id: 'agent-coding', name: 'Coding Agent', type: 'coding', description: 'Implements features, fixes bugs, and refactors with workspace tools.', builtIn: true },
  { id: 'agent-research', name: 'Research Agent', type: 'research', description: 'Searches the web and synthesizes sources into clear briefs.', builtIn: true },
  { id: 'agent-writing', name: 'Writing Agent', type: 'writing', description: 'Drafts docs, emails, and long-form content in your voice.', builtIn: true },
  { id: 'agent-designer', name: 'Design Agent', type: 'designer', description: 'Helps with UI structure, copy, and visual direction.', builtIn: true },
  { id: 'agent-devops', name: 'DevOps Agent', type: 'devops', description: 'Assists with configs, CI, deploys, and environment setup.', builtIn: true },
  { id: 'agent-architect', name: 'Architect Agent', type: 'architect', description: 'Plans system design, trade-offs, and migration paths.', builtIn: true },
]

const STORAGE_KEY = 'aura:marketplace-agents'

function loadEnabled(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return Object.fromEntries(CATALOG.map(a => [a.id, true]))
    }
    return JSON.parse(raw) as Record<string, boolean>
  } catch {
    return Object.fromEntries(CATALOG.map(a => [a.id, true]))
  }
}

export function AgentMarketplacePage() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => loadEnabled())
  const activeCount = useMemo(() => Object.values(enabled).filter(Boolean).length, [enabled])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(enabled))
  }, [enabled])

  function toggle(id: string, value: boolean) {
    setEnabled(prev => ({ ...prev, [id]: value }))
  }

  function enableAll() {
    setEnabled(Object.fromEntries(CATALOG.map(a => [a.id, true])))
  }

  function disableAll() {
    setEnabled(Object.fromEntries(CATALOG.map(a => [a.id, false])))
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <SettingsPageHeader
        title="Agent Marketplace"
        description="Enable specialized Aura agents for coding, research, writing, and more."
      />

      <SettingsGroup title="Marketplace">
        <SettingsRow
          label="Installed agents"
          description={`${activeCount} of ${CATALOG.length} enabled. Agents appear in the Agent workspace.`}
        >
          <div className="flex gap-2">
            <GhostButton onClick={enableAll}>Enable all</GhostButton>
            <GhostButton onClick={disableAll}>Disable all</GhostButton>
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Available agents">
        {CATALOG.map(agent => {
          const on = enabled[agent.id] !== false
          return (
            <SettingsRow
              key={agent.id}
              label={agent.name}
              description={agent.description}
            >
              <span className={cn(
                'mr-2 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                on ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/8 text-white/35'
              )}>
                {on ? <Check size={10} /> : <Store size={10} />}
                {agent.type}
              </span>
              <Toggle checked={on} onChange={value => toggle(agent.id, value)} />
            </SettingsRow>
          )
        })}
      </SettingsGroup>

      <p className="flex items-center gap-2 text-[12px] text-white/35">
        <Bot size={13} /> Built-in agents ship with Aura. Custom agent packs can be added later via plugins.
      </p>
    </div>
  )
}
