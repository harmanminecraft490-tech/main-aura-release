/**
 * Core provider & model types shared by the Electron backend and the renderer.
 * This file must stay runtime-agnostic (no Node or DOM imports).
 */

/** Wire protocol a provider speaks. Everything else is configuration. */
export type ProviderProtocol = 'openai-compat' | 'anthropic'

export interface ProviderConfig {
  id: string
  /** User-facing name, e.g. "Aura Universal", "My OpenRouter". */
  name: string
  protocol: ProviderProtocol
  baseURL: string
  apiKey: string
  /** Extra headers merged into every request (may override auth). */
  headers?: Record<string, string>
  organization?: string
  /** Per-request timeout in ms (first byte). */
  timeoutMs: number
  enabled: boolean
  createdAt: number
  updatedAt: number
  /** Last successful /models discovery, if any. */
  lastDiscoveryAt?: number
  lastDiscoveryError?: string
}

export interface ModelCapabilities {
  vision: boolean
  reasoning: boolean
  tools: boolean
  streaming: boolean
}

export interface ModelPricing {
  /** USD per 1M input tokens. */
  input?: number
  /** USD per 1M output tokens. */
  output?: number
}

/** A model discovered dynamically from a provider's /models endpoint. */
export interface DiscoveredModel {
  /** Provider-scoped model id as accepted by the API, e.g. "gpt-5.6-terra". */
  id: string
  providerId: string
  displayName: string
  contextLength?: number
  maxOutputTokens?: number
  capabilities: ModelCapabilities
  pricing?: ModelPricing
  /** Epoch ms when this model first appeared in discovery for this provider. */
  firstSeenAt: number
  lastSeenAt: number
  /** Raw creation timestamp reported by the provider, when available. */
  createdAt?: number
}

/** Globally unique reference to a concrete backend model. */
export interface ModelRef {
  providerId: string
  modelId: string
}

export function modelKey(ref: ModelRef): string {
  return `${ref.providerId}/${ref.modelId}`
}

export function parseModelKey(key: string): ModelRef | null {
  const slash = key.indexOf('/')
  if (slash <= 0) return null
  return { providerId: key.slice(0, slash), modelId: key.slice(slash + 1) }
}

/** Per-model user state kept separately from discovery so refreshes never lose it. */
export interface ModelUserState {
  favorite?: boolean
  pinned?: boolean
  hidden?: boolean
  customDisplayName?: string
}

export interface ConnectionTestResult {
  ok: boolean
  latencyMs?: number
  modelCount?: number
  error?: string
}

// ─── Chat wire types ─────────────────────────────────────────────────────────

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatContentImage {
  kind: 'image'
  /** base64 data (no data: prefix). */
  data: string
  mimeType: string
}

export interface ChatContentText {
  kind: 'text'
  text: string
}

export type ChatContentPart = ChatContentText | ChatContentImage

export interface ChatMessage {
  role: ChatRole
  content: string
  /** Optional multimodal parts; when present, `content` is the text fallback. */
  parts?: ChatContentPart[]
}

export interface ChatUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface CompletionParams {
  model: string
  messages: ChatMessage[]
  system?: string
  temperature?: number
  topP?: number
  maxTokens?: number
}

/**
 * Streaming callbacks. Adapters guarantee:
 *  - callbacks stop the instant the signal aborts (no post-abort tokens)
 *  - exactly one terminal call: onDone | onError | onAbort
 */
export interface StreamHandler {
  onToken: (delta: string) => void
  onThinking?: (delta: string) => void
  onDone: (text: string, meta: { model?: string; usage?: ChatUsage }) => void
  onError: (error: Error) => void
  onAbort: () => void
}

export interface StreamOptions {
  signal: AbortSignal
  /** Abort with a timeout error if no byte arrives within this window. */
  firstByteTimeoutMs?: number
  /** Abort if the stream stalls mid-generation for this long. */
  idleTimeoutMs?: number
}
