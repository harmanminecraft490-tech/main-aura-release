/**
 * CAPABILITY MANAGER
 *
 * Central registry of every capability Aura can use. Queried before AI calls
 * so the AI only receives tools it can actually USE, and honestly reports
 * what is unavailable.
 *
 * Capabilities: filesystem, webSearch, browser, figma, git, terminal, vision, mcp, github
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { webSearchManager } from './webSearch'

export type CapabilityId =
  | 'filesystem'
  | 'workspace'
  | 'terminal'
  | 'git'
  | 'webSearch'
  | 'browser'
  | 'desktopControl'
  | 'figma'
  | 'mcp'
  | 'vision'
  | 'documents'
  | 'audio'
  | 'github'

export interface CapabilityStatus {
  id: CapabilityId
  name: string
  available: boolean
  connected: boolean
  authorized: boolean
  configured: boolean
  tools: string[]
  health: 'ok' | 'degraded' | 'unavailable'
  error?: string
  meta?: Record<string, unknown>
}

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'capabilities.json')

interface StoredCapabilityConfig {
  browser?: { enabled: boolean; backend: 'playwright' | 'puppeteer' | 'none' }
  figma?: { accessToken: string }
  github?: { token: string }
  mcp?: { servers: Array<{ name: string; url: string; enabled: boolean }> }
  /** Search key saved from the Settings UI. Env vars (SERPER_API_KEY, …) take precedence. */
  webSearch?: { provider: 'serper' | 'brave' | 'tavily'; apiKey: string }
}

class CapabilityManager {
  private config: StoredCapabilityConfig = {}
  private capabilities: Map<CapabilityId, CapabilityStatus> = new Map()
  private workspaceActive = false
  private runAuthorized = false

  constructor() {
    this.loadConfig()
    this.refresh()
  }

  private loadConfig() {
    try {
      const raw = fs.readFileSync(CONFIG_FILE(), 'utf8')
      this.config = JSON.parse(raw) as StoredCapabilityConfig
    } catch { this.config = {} }
  }

  private saveConfig() {
    try {
      fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true })
      fs.writeFileSync(CONFIG_FILE(), JSON.stringify(this.config, null, 2), 'utf8')
    } catch { /* ignore */ }
  }

  /** Re-evaluate all capability states (call after env changes or workspace changes). */
  refresh() {
    // Always re-read env for search keys, then fall back to a key saved from
    // the Settings UI when no env var is set (env wins).
    webSearchManager.reloadEnv()
    const storedSearch = this.config.webSearch
    if (storedSearch?.apiKey && !webSearchManager.isConnected) {
      webSearchManager.configure(storedSearch.provider, storedSearch.apiKey)
    }

    // Filesystem / Workspace
    this.set('filesystem', {
      name: 'Filesystem',
      available: true,
      connected: true,
      authorized: true,
      configured: true,
      tools: ['workspace_file'],
      health: 'ok',
    })

    this.set('workspace', {
      name: 'Workspace',
      available: true,
      connected: this.workspaceActive,
      authorized: true,
      configured: true,
      tools: ['workspace_file'],
      health: this.workspaceActive ? 'ok' : 'degraded',
      error: this.workspaceActive ? undefined : 'No workspace open. Open a project to use file tools.',
    })

    this.set('terminal', {
      name: 'Terminal',
      available: true,
      connected: this.workspaceActive,
      authorized: this.runAuthorized,
      configured: true,
      tools: ['workspace_file:run'],
      health: this.runAuthorized ? 'ok' : 'degraded',
      error: this.runAuthorized
        ? undefined
        : 'Terminal run permission is off. Enable “Run” in Settings → Permissions.',
    })

    // Web Search — powered by SERPER_API_KEY / BRAVE_SEARCH_API_KEY / TAVILY_API_KEY
    const searchConnected = webSearchManager.isConnected
    this.set('webSearch', {
      name: 'Web Search',
      available: true,
      connected: searchConnected,
      authorized: searchConnected,
      configured: searchConnected,
      tools: searchConnected ? ['web_search', 'read_webpage', 'web_research'] : [],
      health: searchConnected ? 'ok' : 'unavailable',
      error: searchConnected ? undefined : webSearchManager.statusMessage,
      meta: { provider: webSearchManager.provider },
    })

    // Browser — requires Playwright
    const browserEnabled = Boolean(this.config.browser?.enabled && this.config.browser?.backend !== 'none')
    this.set('browser', {
      name: 'Browser',
      available: false, // playwright not installed
      connected: false,
      authorized: false,
      configured: browserEnabled,
      tools: [],
      health: 'unavailable',
      error: 'Browser automation requires Playwright. Enable it in Settings → Capabilities when available.',
    })

    // Desktop Control
    this.set('desktopControl', {
      name: 'Desktop Control',
      available: false,
      connected: false,
      authorized: false,
      configured: false,
      tools: [],
      health: 'unavailable',
      error: 'Desktop control is not available in this version.',
    })

    // Figma
    const figmaToken = this.config.figma?.accessToken
    const figmaOk = Boolean(figmaToken)
    this.set('figma', {
      name: 'Figma',
      available: true,
      connected: figmaOk,
      authorized: figmaOk,
      configured: figmaOk,
      tools: figmaOk ? ['figma_read', 'figma_inspect'] : [],
      health: figmaOk ? 'ok' : 'unavailable',
      error: figmaOk ? undefined : "Figma isn't connected. Add your Figma access token in Settings → Integrations.",
    })

    // GitHub
    const githubToken = this.config.github?.token
    const githubOk = Boolean(githubToken)
    this.set('github', {
      name: 'GitHub',
      available: true,
      connected: githubOk,
      authorized: githubOk,
      configured: githubOk,
      tools: githubOk ? ['github_read', 'github_pr', 'github_issue'] : [],
      health: githubOk ? 'ok' : 'unavailable',
      error: githubOk ? undefined : 'GitHub not connected. Add your GitHub token in Settings → Integrations.',
    })

    // Git (local)
    this.set('git', {
      name: 'Git',
      available: true,
      connected: this.workspaceActive,
      authorized: true,
      configured: true,
      tools: ['git_status', 'git_diff', 'git_log'],
      health: 'ok',
    })

    // Vision
    this.set('vision', {
      name: 'Vision',
      available: true,
      connected: true,
      authorized: true,
      configured: true,
      tools: [],
      health: 'ok',
    })

    // MCP
    const mcpServers = this.config.mcp?.servers ?? []
    const mcpOk = mcpServers.some(s => s.enabled)
    this.set('mcp', {
      name: 'MCP',
      available: true,
      connected: mcpOk,
      authorized: mcpOk,
      configured: mcpServers.length > 0,
      tools: [],
      health: mcpOk ? 'ok' : 'unavailable',
      error: mcpOk ? undefined : 'No MCP servers configured. Add them in Settings → Integrations.',
      meta: { servers: mcpServers },
    })
  }

  private set(id: CapabilityId, status: Omit<CapabilityStatus, 'id'>) {
    this.capabilities.set(id, { id, ...status })
  }

  setWorkspaceState(active: boolean, runAuthorized?: boolean) {
    this.workspaceActive = active
    if (typeof runAuthorized === 'boolean') this.runAuthorized = runAuthorized
    this.refresh()
  }

  setRunAuthorized(authorized: boolean) {
    this.runAuthorized = authorized
    this.refresh()
  }

  get(id: CapabilityId): CapabilityStatus | undefined {
    return this.capabilities.get(id)
  }

  all(): CapabilityStatus[] {
    return [...this.capabilities.values()]
  }

  isConnected(id: CapabilityId): boolean {
    return this.capabilities.get(id)?.connected ?? false
  }

  /**
   * System prompt addendum — honest description of what IS and IS NOT available
   * for the CURRENT request. Keeps the AI from claiming capabilities it doesn't
   * have, and — critically — from calling a tool that is NOT registered in this
   * request's `request.tools`.
   *
   * `activeToolNames` is the exact set of tool function names being sent to the
   * provider for this request. Any capability whose tools are not in that set is
   * NOT advertised as connected: a model that sees "Web Search [tools:
   * web_search]" in its system prompt will happily emit a `web_search` call even
   * on a request where the tool was never registered, and the provider rejects
   * it ("attempted to call tool 'web_search' which was not in request.tools"),
   * which previously produced a dead end with no answer.
   */
  buildCapabilityPrompt(activeToolNames?: Set<string>): string {
    const connected: string[] = []
    const unavailable: string[] = []
    const filterTools = activeToolNames !== undefined

    for (const cap of this.capabilities.values()) {
      if (cap.id === 'vision') continue // always available, not worth listing

      if (cap.tools.length === 0) {
        // Nothing to register — advertise availability as-is.
        if (cap.connected) connected.push(`  ✓ ${cap.name}`)
        else if (cap.error && cap.id !== 'desktopControl') unavailable.push(`  ✗ ${cap.name}: ${cap.error}`)
        continue
      }

      const advertised = filterTools
        ? cap.tools.filter(tool => activeToolNames!.has(tool))
        : cap.tools

      if (advertised.length === 0) {
        // None of this capability's tools are registered for this request, so
        // the model cannot call them — keep it out of the "connected" list.
        if (cap.error && cap.id !== 'desktopControl') unavailable.push(`  ✗ ${cap.name}: ${cap.error}`)
        continue
      }

      if (cap.connected) {
        connected.push(`  ✓ ${cap.name} [tools: ${advertised.join(', ')}]`)
      } else if (cap.error && cap.id !== 'desktopControl') {
        unavailable.push(`  ✗ ${cap.name}: ${cap.error}`)
      }
    }

    const lines: string[] = ['## Connected Capabilities']
    if (connected.length > 0) lines.push(...connected)
    else lines.push('  (none — no workspace open, no search configured)')

    if (unavailable.length > 0) {
      lines.push('\n## Not Available This Session')
      lines.push(...unavailable)
    }

    lines.push(
      '\nRULE: Never claim to use a tool or capability listed as unavailable.',
      'RULE: Never fabricate search results, file contents, or tool outputs.',
      'RULE: If a capability is not connected, tell the user honestly and explain how to enable it.'
    )

    return lines.join('\n')
  }

  /** Configure web search key programmatically (from Settings). Persisted so it survives restart. */
  configureWebSearch(provider: 'serper' | 'brave' | 'tavily', key: string) {
    const trimmed = key.trim()
    if (trimmed) {
      this.config.webSearch = { provider, apiKey: trimmed }
    } else {
      delete this.config.webSearch
    }
    this.saveConfig()
    this.refresh()
  }

  updateFigma(token: string) {
    this.config.figma = { accessToken: token }
    this.saveConfig()
    this.refresh()
  }

  updateGitHub(token: string) {
    this.config.github = { token }
    this.saveConfig()
    this.refresh()
  }

  updateMcpServers(servers: Array<{ name: string; url: string; enabled: boolean }>) {
    this.config.mcp = {
      servers: servers
        .map(server => ({
          name: server.name.trim(),
          url: server.url.trim(),
          enabled: Boolean(server.enabled),
        }))
        .filter(server => server.name && server.url),
    }
    this.saveConfig()
    this.refresh()
  }
}

export const capabilityManager = new CapabilityManager()
