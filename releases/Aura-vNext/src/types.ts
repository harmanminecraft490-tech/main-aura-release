/**
 * Renderer-facing view types + the typed window.aura bridge contract.
 * These mirror the serialized shapes the backend sends over IPC.
 */

import type {
  AuraModelDefinition,
  AuraModelId,
} from '../models/aura-models/definitions'
import type { MappingSuggestion } from '../models/aura-models/suggestions'
import type { RegistryModel } from '../models/registry/registry'
import type { ChatUsage, ConnectionTestResult, ProviderConfig } from '../providers/types'
import type { AppSettings } from '../backend/persistence'
import type { RequestLogEntry } from '../backend/chat-orchestrator'

export type { AuraModelId, AuraModelDefinition, MappingSuggestion, RegistryModel, ProviderConfig, ChatUsage, AppSettings, RequestLogEntry }

/** Aura mapping row as serialized by the backend for the settings UI. */
export interface AuraMappingView extends AuraModelDefinition {
  resolvedKey: string | null
  resolvedName: string | null
  resolvedProvider: string | null
  source: 'override' | 'default' | 'capability' | 'none'
  isOverride: boolean
}

// ─── Chat event payloads ───────────────────────────────────────────────────

export interface ChatRoutedPayload {
  streamId: string
  auraModelId: AuraModelId
  reason: string
  modelKey: string
  modelName: string
  providerName: string
}
export interface ChatDeltaPayload { streamId: string; delta: string }
export interface ChatDonePayload {
  streamId: string
  text: string
  auraModelId: AuraModelId
  modelKey: string
  model?: string
  usage?: ChatUsage
  latencyMs: number
}
export interface ChatErrorPayload { streamId: string; message: string }
export interface ChatAbortedPayload { streamId: string }

export interface ProviderAddResult {
  provider: ProviderConfig
  discovery: { ok: boolean; count?: number; error?: string }
}

export interface AuraBridge {
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
  }
  providers: {
    list: () => Promise<ProviderConfig[]>
    add: (input: Partial<ProviderConfig>) => Promise<ProviderAddResult>
    update: (id: string, updates: Partial<ProviderConfig>) => Promise<ProviderConfig>
    delete: (id: string) => Promise<void>
    test: (input: Partial<ProviderConfig>) => Promise<ConnectionTestResult>
    refreshModels: (id: string) => Promise<{ ok: boolean; count?: number; error?: string }>
  }
  models: {
    list: () => Promise<RegistryModel[]>
    setUserState: (key: string, updates: Partial<RegistryModel['userState']>) => Promise<void>
  }
  aura: {
    list: () => Promise<AuraMappingView[]>
    setMapping: (auraId: string, modelKey: string | null) => Promise<AuraMappingView[]>
    restoreDefaults: () => Promise<AuraMappingView[]>
  }
  suggestions: {
    list: () => Promise<MappingSuggestion[]>
    accept: (id: string) => Promise<void>
    dismiss: (id: string) => Promise<void>
  }
  settings: {
    get: () => Promise<AppSettings>
    set: (updates: Partial<AppSettings>) => Promise<AppSettings>
  }
  chat: {
    start: (input: { streamId: string; messages: unknown[]; auraModelId?: string; temperature?: number; context?: string }) => Promise<{ streamId: string }>
    abort: (streamId: string) => Promise<void>
    on: {
      (event: 'routed', cb: (p: ChatRoutedPayload) => void): () => void
      (event: 'delta', cb: (p: ChatDeltaPayload) => void): () => void
      (event: 'thinking', cb: (p: ChatDeltaPayload) => void): () => void
      (event: 'done', cb: (p: ChatDonePayload) => void): () => void
      (event: 'error', cb: (p: ChatErrorPayload) => void): () => void
      (event: 'aborted', cb: (p: ChatAbortedPayload) => void): () => void
    }
  }
  state: {
    on: {
      (event: 'providers', cb: (p: ProviderConfig[]) => void): () => void
      (event: 'models', cb: (p: RegistryModel[]) => void): () => void
      (event: 'mappings', cb: (p: AuraMappingView[]) => void): () => void
      (event: 'suggestions', cb: (p: MappingSuggestion[]) => void): () => void
      (event: 'settings', cb: (p: AppSettings) => void): () => void
    }
  }
  dev: {
    requestLog: () => Promise<RequestLogEntry[]>
    clearLog: () => Promise<void>
  }
}

declare global {
  interface Window {
    aura: AuraBridge
  }
}
