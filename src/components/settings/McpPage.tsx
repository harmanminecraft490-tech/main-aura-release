import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Plus, Trash2 } from 'lucide-react'
import type { CapabilityStatus } from '@/types'
import { GhostButton, SettingsGroup, SettingsPageHeader, SettingsRow, TextField, Toggle } from './shared'

interface McpServerDraft {
  id: string
  name: string
  url: string
  enabled: boolean
}

export function McpPage() {
  const [caps, setCaps] = useState<CapabilityStatus[]>([])
  const [servers, setServers] = useState<McpServerDraft[]>([])
  const [figmaToken, setFigmaToken] = useState('')
  const [githubToken, setGithubToken] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!window.aura?.capabilities) return
    const list = await window.aura.capabilities.list()
    setCaps(list)
    const mcp = list.find(c => c.id === 'mcp')
    const stored = (mcp?.meta?.servers as Array<{ name: string; url: string; enabled: boolean }> | undefined) ?? []
    setServers(stored.map((s, i) => ({
      id: `mcp-${i}-${s.name}`,
      name: s.name,
      url: s.url,
      enabled: s.enabled,
    })))
  }, [])

  useEffect(() => {
    void load().catch(() => undefined)
  }, [load])

  function flashOk(text: string) {
    setFlash(text)
    window.setTimeout(() => setFlash(null), 2000)
  }

  async function saveMcp() {
    setSaving('mcp')
    try {
      await window.aura!.capabilities.configureMcp(
        servers.map(({ name, url, enabled }) => ({ name, url, enabled }))
      )
      await load()
      flashOk('MCP saved')
    } finally {
      setSaving(null)
    }
  }

  async function saveFigma() {
    setSaving('figma')
    try {
      await window.aura!.capabilities.configureFigma(figmaToken.trim())
      setFigmaToken('')
      await load()
      flashOk('Figma connected')
    } finally {
      setSaving(null)
    }
  }

  async function saveGitHub() {
    setSaving('github')
    try {
      await window.aura!.capabilities.configureGitHub(githubToken.trim())
      setGithubToken('')
      await load()
      flashOk('GitHub connected')
    } finally {
      setSaving(null)
    }
  }

  const mcp = caps.find(c => c.id === 'mcp')
  const figma = caps.find(c => c.id === 'figma')
  const github = caps.find(c => c.id === 'github')

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <SettingsPageHeader
        title="MCP & Integrations"
        description="Connect Model Context Protocol servers and third-party tokens Aura can use."
      />

      {flash && (
        <p className="flex items-center gap-1.5 text-[12px] text-emerald-400">
          <Check size={12} /> {flash}
        </p>
      )}

      <SettingsGroup title="MCP connection">
        <SettingsRow
          label="MCP status"
          description={mcp?.connected ? 'At least one server is enabled.' : (mcp?.error ?? 'No servers configured.')}
        >
          <GhostButton
            onClick={() => setServers(prev => [...prev, { id: `mcp-${Date.now()}`, name: '', url: '', enabled: true }])}
          >
            <Plus size={12} /> Add server
          </GhostButton>
        </SettingsRow>

        {servers.map((server, index) => (
          <div key={server.id} className="space-y-2 border-t border-white/[0.06] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <Toggle
                checked={server.enabled}
                onChange={enabled => setServers(prev => prev.map((s, i) => i === index ? { ...s, enabled } : s))}
              />
              <button
                className="rounded-lg p-1.5 text-white/30 hover:text-red-400"
                onClick={() => setServers(prev => prev.filter((_, i) => i !== index))}
                type="button"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <TextField
              label="Name"
              placeholder="filesystem"
              value={server.name}
              onChange={name => setServers(prev => prev.map((s, i) => i === index ? { ...s, name } : s))}
            />
            <TextField
              label="URL"
              placeholder="http://127.0.0.1:3000/mcp"
              value={server.url}
              onChange={url => setServers(prev => prev.map((s, i) => i === index ? { ...s, url } : s))}
            />
          </div>
        ))}

        <div className="border-t border-white/[0.06] px-4 py-3">
          <GhostButton disabled={saving === 'mcp'} onClick={() => void saveMcp()} variant="primary">
            {saving === 'mcp' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Save MCP servers
          </GhostButton>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Figma">
        <SettingsRow label="Figma" description={figma?.connected ? 'Connected' : (figma?.error ?? 'Not connected')}>
          <span className="text-[11px] text-white/30">{figma?.connected ? 'On' : 'Off'}</span>
        </SettingsRow>
        <div className="space-y-2 px-4 py-3">
          <TextField label="Access token" type="password" placeholder="figd_…" value={figmaToken} onChange={setFigmaToken} />
          <GhostButton disabled={saving === 'figma' || !figmaToken.trim()} onClick={() => void saveFigma()}>
            Save Figma token
          </GhostButton>
        </div>
      </SettingsGroup>

      <SettingsGroup title="GitHub">
        <SettingsRow label="GitHub" description={github?.connected ? 'Connected' : (github?.error ?? 'Not connected')}>
          <span className="text-[11px] text-white/30">{github?.connected ? 'On' : 'Off'}</span>
        </SettingsRow>
        <div className="space-y-2 px-4 py-3">
          <TextField label="Personal access token" type="password" placeholder="ghp_…" value={githubToken} onChange={setGithubToken} />
          <GhostButton disabled={saving === 'github' || !githubToken.trim()} onClick={() => void saveGitHub()}>
            Save GitHub token
          </GhostButton>
        </div>
      </SettingsGroup>
    </div>
  )
}
