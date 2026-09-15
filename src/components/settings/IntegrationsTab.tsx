import { useCallback, useEffect, useState } from 'react'
import { Check, Github, Loader2, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { CapabilityStatus } from '@/types'
import { Card, TextField, SelectField } from './shared'

type SearchProvider = 'serper' | 'brave' | 'tavily'

interface McpServerDraft {
  id: string
  name: string
  url: string
  enabled: boolean
}

/**
 * Integrations — Figma, GitHub, web search providers, and MCP server config.
 */
export function IntegrationsTab() {
  const [caps, setCaps] = useState<CapabilityStatus[]>([])
  const [figmaToken, setFigmaToken] = useState('')
  const [githubToken, setGithubToken] = useState('')
  const [searchProvider, setSearchProvider] = useState<SearchProvider>('serper')
  const [searchKey, setSearchKey] = useState('')
  const [mcpServers, setMcpServers] = useState<McpServerDraft[]>([])
  const [saving, setSaving] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!window.aura?.capabilities) return
    try {
      const list = await window.aura.capabilities.list()
      setCaps(list)
      const mcp = list.find(c => c.id === 'mcp')
      const servers = (mcp?.meta?.servers as Array<{ name: string; url: string; enabled: boolean }> | undefined) ?? []
      setMcpServers(servers.map((s, i) => ({
        id: `mcp-${i}-${s.name}`,
        name: s.name,
        url: s.url,
        enabled: s.enabled,
      })))
      const search = list.find(c => c.id === 'webSearch')
      const provider = search?.meta?.provider
      if (provider === 'serper' || provider === 'brave' || provider === 'tavily') {
        setSearchProvider(provider)
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function flashOk(label: string) {
    setFlash(label)
    window.setTimeout(() => setFlash(null), 2200)
  }

  async function saveFigma() {
    setSaving('figma')
    try {
      await window.aura!.capabilities.configureFigma(figmaToken.trim())
      setFigmaToken('')
      await load()
      flashOk('Figma saved')
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
      flashOk('GitHub saved')
    } finally {
      setSaving(null)
    }
  }

  async function saveSearch() {
    setSaving('search')
    try {
      await window.aura!.capabilities.configureSearch(searchProvider, searchKey.trim())
      setSearchKey('')
      await load()
      flashOk('Web search saved')
    } finally {
      setSaving(null)
    }
  }

  async function saveMcp() {
    setSaving('mcp')
    try {
      await window.aura!.capabilities.configureMcp(
        mcpServers.map(({ name, url, enabled }) => ({ name, url, enabled }))
      )
      await load()
      flashOk('MCP servers saved')
    } finally {
      setSaving(null)
    }
  }

  const figma = caps.find(c => c.id === 'figma')
  const github = caps.find(c => c.id === 'github')
  const search = caps.find(c => c.id === 'webSearch')

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Integrations</h2>
          <p className="mt-1 text-sm text-white/40">
            Connect tokens and services Aura can use. Environment variables always win over keys saved here.
          </p>
        </div>
        {flash && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <Check size={12} /> {flash}
          </span>
        )}
      </div>

      <Card title="Web Search">
        <div className="space-y-3">
          <p className="text-xs text-white/35">
            Status: {search?.connected ? `Connected (${String(search.meta?.provider ?? 'search')})` : (search?.error ?? 'Not configured')}
          </p>
          <SelectField
            label="Provider"
            value={searchProvider}
            onChange={v => setSearchProvider(v as SearchProvider)}
            options={[
              { value: 'serper', label: 'Serper (Google)' },
              { value: 'brave', label: 'Brave Search' },
              { value: 'tavily', label: 'Tavily' },
            ]}
          />
          <TextField
            label="API key"
            type="password"
            placeholder="Paste key…"
            value={searchKey}
            onChange={setSearchKey}
          />
          <button
            className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-surface-0 transition hover:scale-[1.02] disabled:opacity-40"
            disabled={saving === 'search' || !searchKey.trim()}
            onClick={() => void saveSearch()}
            type="button"
          >
            {saving === 'search' ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Save search key
          </button>
        </div>
      </Card>

      <Card title="Figma">
        <div className="space-y-3">
          <p className="text-xs text-white/35">
            {figma?.connected ? 'Connected' : (figma?.error ?? 'Not connected')}
          </p>
          <TextField
            label="Figma access token"
            type="password"
            placeholder="figd_…"
            value={figmaToken}
            onChange={setFigmaToken}
          />
          <button
            className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-white/70 transition hover:bg-white/7 disabled:opacity-40"
            disabled={saving === 'figma' || !figmaToken.trim()}
            onClick={() => void saveFigma()}
            type="button"
          >
            {saving === 'figma' ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Save Figma token
          </button>
        </div>
      </Card>

      <Card title="GitHub">
        <div className="space-y-3">
          <p className="text-xs text-white/35">
            {github?.connected ? 'Connected' : (github?.error ?? 'Not connected')}
          </p>
          <TextField
            label="GitHub personal access token"
            type="password"
            placeholder="ghp_…"
            value={githubToken}
            onChange={setGithubToken}
          />
          <button
            className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-white/70 transition hover:bg-white/7 disabled:opacity-40"
            disabled={saving === 'github' || !githubToken.trim()}
            onClick={() => void saveGitHub()}
            type="button"
          >
            {saving === 'github' ? <Loader2 size={15} className="animate-spin" /> : <Github size={15} />}
            Save GitHub token
          </button>
        </div>
      </Card>

      <Card
        title="MCP servers"
        action={
          <button
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-white/45 transition hover:bg-white/8 hover:text-white/70"
            onClick={() => setMcpServers(prev => [...prev, { id: `mcp-${Date.now()}`, name: '', url: '', enabled: true }])}
            type="button"
          >
            <Plus size={12} /> Add
          </button>
        }
      >
        <div className="space-y-3">
          {mcpServers.length === 0 && (
            <p className="text-xs text-white/35">No MCP servers configured yet.</p>
          )}
          {mcpServers.map((server, index) => (
            <div key={server.id} className="rounded-xl border border-white/8 bg-white/[0.02] p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-white/50">
                  <input
                    checked={server.enabled}
                    className="accent-aura-500"
                    onChange={e => setMcpServers(prev => prev.map((s, i) => i === index ? { ...s, enabled: e.target.checked } : s))}
                    type="checkbox"
                  />
                  Enabled
                </label>
                <button
                  className="rounded-lg p-1.5 text-white/30 transition hover:text-red-400"
                  onClick={() => setMcpServers(prev => prev.filter((_, i) => i !== index))}
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <TextField
                label="Name"
                value={server.name}
                onChange={name => setMcpServers(prev => prev.map((s, i) => i === index ? { ...s, name } : s))}
                placeholder="my-server"
              />
              <TextField
                label="URL"
                value={server.url}
                onChange={url => setMcpServers(prev => prev.map((s, i) => i === index ? { ...s, url } : s))}
                placeholder="http://localhost:3000/mcp"
              />
            </div>
          ))}
          <button
            className={cn(
              'flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-white/70 transition hover:bg-white/7 disabled:opacity-40'
            )}
            disabled={saving === 'mcp'}
            onClick={() => void saveMcp()}
            type="button"
          >
            {saving === 'mcp' ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Save MCP servers
          </button>
        </div>
      </Card>
    </div>
  )
}
