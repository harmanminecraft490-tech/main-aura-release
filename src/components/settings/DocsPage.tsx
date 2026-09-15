import { BookOpen, ExternalLink, Shield, Sparkles, Wrench } from 'lucide-react'
import { GhostButton, SettingsGroup, SettingsPageHeader, SettingsRow } from './shared'

const DOCS = [
  {
    id: 'permissions',
    title: 'Workspace permissions',
    description: 'How read, write, delete, rename, and run gates protect your project.',
    icon: Shield,
    url: 'https://github.com/aura-ai/aura-desktop#workspace-permissions',
  },
  {
    id: 'mcp',
    title: 'MCP connections',
    description: 'Connect Model Context Protocol servers under Settings → MCP.',
    icon: Wrench,
    url: 'https://modelcontextprotocol.io/docs',
  },
  {
    id: 'aura-model',
    title: 'Aura Model',
    description: 'One Aura identity with internal Cerebras → Groq failover.',
    icon: Sparkles,
    url: 'https://github.com/aura-ai/aura-desktop#aura-model',
  },
  {
    id: 'getting-started',
    title: 'Getting started',
    description: 'Projects, chat, agents, and first-run setup.',
    icon: BookOpen,
    url: 'https://github.com/aura-ai/aura-desktop#readme',
  },
]

async function openDoc(url: string) {
  try {
    if (window.aura?.openExternal) {
      await window.aura.openExternal(url)
      return
    }
  } catch {
    /* fall through */
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function DocsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <SettingsPageHeader
        title="Docs"
        description="Guides for Aura settings, tools, permissions, and integrations."
      />

      <SettingsGroup title="Documentation">
        {DOCS.map(doc => {
          const Icon = doc.icon
          return (
            <SettingsRow
              key={doc.id}
              label={doc.title}
              description={doc.description}
            >
              <span className="mr-1 text-white/30"><Icon size={14} /></span>
              <GhostButton onClick={() => void openDoc(doc.url)}>
                Open <ExternalLink size={11} />
              </GhostButton>
            </SettingsRow>
          )
        })}
      </SettingsGroup>

      <SettingsGroup title="In-app tips">
        <SettingsRow
          label="Delete files with Aura"
          description="Settings → Permissions → turn on Delete files, then ask Aura to remove the paths."
        >
          <span className="text-[11px] text-white/30">Permissions</span>
        </SettingsRow>
        <SettingsRow
          label="Vision on Default Profile"
          description="The locked Aura Model has vision enabled for image attachments."
        >
          <span className="text-[11px] text-white/30">API</span>
        </SettingsRow>
      </SettingsGroup>
    </div>
  )
}
