/**
 * IPC surface for Aura vNext. Owns the runtime state (providers, model cache,
 * mappings, settings, request log) and exposes it to the renderer via typed
 * channels. All state mutations persist immediately.
 */

import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import type { ModelUserState, ProviderConfig } from '../providers/types'
import { parseModelKey } from '../providers/types'
import { discoverModels, testConnection } from '../providers/discovery'
import { buildRegistry, type RegistrySnapshot } from '../models/registry/registry'
import type { AuraMappings, AuraModelId } from '../models/aura-models/definitions'
import { AURA_MODELS, isAuraModelId } from '../models/aura-models/definitions'
import { resolveAllMappings } from '../models/aura-models/mapping'
import { computeSuggestions } from '../models/aura-models/suggestions'
import { ChatOrchestrator, type ChatStartInput, type RequestLogEntry } from './chat-orchestrator'
import {
  loadMappings, loadModelCache, loadModelUserState, loadProviders, loadSettings, loadSuggestionState,
  saveMappings, saveModelCache, saveModelUserState, saveProviders, saveSettings, saveSuggestionState,
  type AppSettings, type ModelCache,
} from './persistence'

const MAX_LOG_ENTRIES = 200

export class AuraBackend {
  private providers: ProviderConfig[] = loadProviders()
  private modelCache: ModelCache = loadModelCache()
  private modelUserState: Record<string, ModelUserState> = loadModelUserState()
  private mappings: AuraMappings = loadMappings()
  private suggestionState = loadSuggestionState()
  private settings: AppSettings = loadSettings()
  private requestLog: RequestLogEntry[] = []
  private snapshot: RegistrySnapshot
  private readonly orchestrator: ChatOrchestrator

  constructor(private readonly getWindow: () => BrowserWindow | null) {
    this.snapshot = this.rebuildSnapshot()
    this.orchestrator = new ChatOrchestrator({
      getSnapshot: () => this.snapshot,
      getProviders: () => this.providers,
      getMappings: () => this.mappings,
      getDefaultAuraModel: () => this.settings.defaultAuraModel,
      emit: (channel, payload) => this.send(channel, payload),
      log: entry => {
        this.requestLog.unshift(entry)
        if (this.requestLog.length > MAX_LOG_ENTRIES) this.requestLog.length = MAX_LOG_ENTRIES
      },
    })
  }

  dispose(): void {
    this.orchestrator.abortAll()
  }

  private send(channel: string, payload: unknown): void {
    const window = this.getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }

  private rebuildSnapshot(): RegistrySnapshot {
    this.snapshot = buildRegistry(this.providers, this.modelCache, this.modelUserState)
    return this.snapshot
  }

  /** Push fresh derived state (registry, mappings, suggestions) to the renderer. */
  private broadcastState(): void {
    this.rebuildSnapshot()
    this.send('state:models', this.serializeModels())
    this.send('state:mappings', this.serializeMappings())
    this.send('state:suggestions', computeSuggestions(this.snapshot, this.mappings, this.suggestionState))
  }

  private serializeModels() {
    return this.snapshot.models
  }

  private serializeMappings() {
    const resolved = resolveAllMappings(this.snapshot, this.mappings)
    return AURA_MODELS.map(definition => {
      const mapping = resolved[definition.id]
      return {
        ...definition,
        resolvedKey: mapping.model?.key ?? null,
        resolvedName: mapping.model?.displayName ?? null,
        resolvedProvider: mapping.model?.providerName ?? null,
        source: mapping.source,
        isOverride: mapping.source === 'override',
      }
    })
  }

  private async refreshProvider(provider: ProviderConfig): Promise<{ ok: boolean; count?: number; error?: string }> {
    try {
      const models = await discoverModels(provider, this.modelCache[provider.id] ?? [])
      this.modelCache[provider.id] = models
      provider.lastDiscoveryAt = Date.now()
      provider.lastDiscoveryError = undefined
      saveModelCache(this.modelCache)
      saveProviders(this.providers)
      this.broadcastState()
      return { ok: true, count: models.length }
    } catch (error) {
      provider.lastDiscoveryError = error instanceof Error ? error.message : 'Discovery failed'
      saveProviders(this.providers)
      this.send('state:providers', this.providers)
      return { ok: false, error: provider.lastDiscoveryError }
    }
  }

  register(): void {
    // ─── Providers ───────────────────────────────────────────────────────────
    ipcMain.handle('providers:list', () => this.providers)

    ipcMain.handle('providers:add', async (_event, input: Partial<ProviderConfig>) => {
      const provider: ProviderConfig = {
        id: randomUUID(),
        name: input.name?.trim() || 'New Provider',
        protocol: input.protocol === 'anthropic' ? 'anthropic' : 'openai-compat',
        baseURL: (input.baseURL ?? '').trim(),
        apiKey: input.apiKey ?? '',
        headers: input.headers,
        organization: input.organization,
        timeoutMs: input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : 30_000,
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      if (!provider.baseURL) throw new Error('Base URL is required.')
      this.providers.push(provider)
      saveProviders(this.providers)
      // Auto-discover models immediately after adding.
      const discovery = await this.refreshProvider(provider)
      this.send('state:providers', this.providers)
      return { provider, discovery }
    })

    ipcMain.handle('providers:update', async (_event, id: string, updates: Partial<ProviderConfig>) => {
      const provider = this.providers.find(candidate => candidate.id === id)
      if (!provider) throw new Error('Provider not found.')
      const credentialsChanged =
        (updates.baseURL !== undefined && updates.baseURL !== provider.baseURL) ||
        (updates.apiKey !== undefined && updates.apiKey !== provider.apiKey)
      Object.assign(provider, {
        ...updates,
        id: provider.id,
        createdAt: provider.createdAt,
        updatedAt: Date.now(),
      })
      saveProviders(this.providers)
      if (credentialsChanged) await this.refreshProvider(provider)
      this.broadcastState()
      this.send('state:providers', this.providers)
      return provider
    })

    ipcMain.handle('providers:delete', (_event, id: string) => {
      this.providers = this.providers.filter(provider => provider.id !== id)
      delete this.modelCache[id]
      saveProviders(this.providers)
      saveModelCache(this.modelCache)
      this.broadcastState()
      this.send('state:providers', this.providers)
    })

    ipcMain.handle('providers:test', (_event, input: Partial<ProviderConfig>) =>
      testConnection({
        id: 'test',
        name: 'test',
        protocol: input.protocol === 'anthropic' ? 'anthropic' : 'openai-compat',
        baseURL: (input.baseURL ?? '').trim(),
        apiKey: input.apiKey ?? '',
        headers: input.headers,
        organization: input.organization,
        timeoutMs: input.timeoutMs ?? 20_000,
        enabled: true,
        createdAt: 0,
        updatedAt: 0,
      })
    )

    ipcMain.handle('providers:refresh-models', async (_event, id: string) => {
      const provider = this.providers.find(candidate => candidate.id === id)
      if (!provider) throw new Error('Provider not found.')
      return this.refreshProvider(provider)
    })

    // ─── Models ──────────────────────────────────────────────────────────────
    ipcMain.handle('models:list', () => this.serializeModels())

    ipcMain.handle('models:set-user-state', (_event, key: string, updates: ModelUserState) => {
      this.modelUserState[key] = { ...this.modelUserState[key], ...updates }
      saveModelUserState(this.modelUserState)
      this.broadcastState()
    })

    // ─── Aura mappings ───────────────────────────────────────────────────────
    ipcMain.handle('aura:list', () => this.serializeMappings())

    ipcMain.handle('aura:set-mapping', (_event, auraId: string, modelKey: string | null) => {
      if (!isAuraModelId(auraId)) throw new Error(`Unknown Aura model: ${auraId}`)
      if (modelKey === null) {
        delete this.mappings[auraId as AuraModelId]
      } else {
        const ref = parseModelKey(modelKey)
        if (!ref) throw new Error('Invalid model key.')
        this.mappings[auraId as AuraModelId] = { auraId: auraId as AuraModelId, target: ref, setAt: Date.now() }
      }
      saveMappings(this.mappings)
      this.broadcastState()
      return this.serializeMappings()
    })

    ipcMain.handle('aura:restore-defaults', () => {
      this.mappings = {}
      saveMappings(this.mappings)
      this.broadcastState()
      return this.serializeMappings()
    })

    // ─── Suggestions ─────────────────────────────────────────────────────────
    ipcMain.handle('suggestions:list', () =>
      computeSuggestions(this.snapshot, this.mappings, this.suggestionState)
    )

    ipcMain.handle('suggestions:accept', (_event, suggestionId: string) => {
      const [auraId, ...rest] = suggestionId.split(':')
      const modelKey = rest.join(':')
      if (!isAuraModelId(auraId)) throw new Error('Invalid suggestion.')
      const ref = parseModelKey(modelKey)
      if (!ref) throw new Error('Invalid suggestion target.')
      this.mappings[auraId as AuraModelId] = { auraId: auraId as AuraModelId, target: ref, setAt: Date.now() }
      saveMappings(this.mappings)
      this.broadcastState()
    })

    ipcMain.handle('suggestions:dismiss', (_event, suggestionId: string) => {
      if (!this.suggestionState.dismissed.includes(suggestionId)) {
        this.suggestionState.dismissed.push(suggestionId)
        saveSuggestionState(this.suggestionState)
      }
      this.broadcastState()
    })

    // ─── Settings ────────────────────────────────────────────────────────────
    ipcMain.handle('settings:get', () => this.settings)

    ipcMain.handle('settings:set', (_event, updates: Partial<AppSettings>) => {
      this.settings = { ...this.settings, ...updates }
      saveSettings(this.settings)
      this.send('state:settings', this.settings)
      return this.settings
    })

    // ─── Chat ────────────────────────────────────────────────────────────────
    ipcMain.handle('chat:start', (_event, input: ChatStartInput) => {
      // Fire and forget; events flow back over chat:* channels.
      void this.orchestrator.start(input)
      return { streamId: input.streamId }
    })

    ipcMain.handle('chat:abort', (_event, streamId: string) => {
      this.orchestrator.abort(streamId)
    })

    // ─── Developer ───────────────────────────────────────────────────────────
    ipcMain.handle('dev:request-log', () => this.requestLog)
    ipcMain.handle('dev:clear-log', () => {
      this.requestLog = []
    })
  }

  /** Discovery refresh for all enabled providers (startup + manual). */
  async refreshAll(): Promise<void> {
    await Promise.allSettled(
      this.providers.filter(provider => provider.enabled).map(provider => this.refreshProvider(provider))
    )
  }
}
