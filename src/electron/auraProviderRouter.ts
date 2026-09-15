/**
 * AURA PROVIDER ROUTER
 *
 * Internal Cerebras (primary) → Groq (fallback) chain behind a single
 * user-facing identity: "Aura · Aura Model".
 *
 * Never expose provider names, model IDs, or failover details to the UI.
 * Load env once and cache; do not hit disk/DB on every message.
 */

import type { AIConfig, AIProvider, APIProfile, AIMode } from './aiConfig'

/** Public identity shown in Settings / chat — never the underlying vendor. */
export const AURA_MODEL_IDENTITY = {
  providerLabel: 'Aura',
  modelName: 'Aura Model',
  /** Display-only provider id sent to the renderer via sanitizeProfile. */
  displayProvider: 'aura' as const,
} as const

/** Public identity for the OpenRouter free model pool. */
export const FREE_CLOUD_AI_IDENTITY = {
  providerLabel: 'Free Cloud AI',
  modelName: 'Auto',
  displayProvider: 'openrouter' as const,
  displayLabel: 'Free Cloud AI — Auto',
} as const

export type AuraBackendId = 'cerebras' | 'groq' | 'openrouter-free'

export interface AuraBackendConfig {
  id: AuraBackendId
  provider: AIProvider
  apiKey: string
  baseURL: string
  model: string
}

interface HealthEntry {
  unhealthyUntil: number
  reason: string
}

/** Default cooldown after a transient primary failure before Cerebras is tried again. */
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000
const DEFAULT_TRANSIENT_COOLDOWN_MS = 15_000

const health = new Map<AuraBackendId, HealthEntry>()

let cachedBackends: { cerebras: AuraBackendConfig; groq: AuraBackendConfig; openrouter: AuraBackendConfig } | null = null
let cacheEnvFingerprint = ''

function envFingerprint(): string {
  return [
    process.env.CEREBRAS_API_KEY,
    process.env.CEREBRAS_BASE_URL,
    process.env.CEREBRAS_MODEL,
    process.env.AURA_CEREBRAS_API_KEY,
    process.env.AURA_CEREBRAS_BASE_URL,
    process.env.AURA_CEREBRAS_MODEL,
    process.env.GROQ_API_KEY,
    process.env.GROQ_BASE_URL,
    process.env.GROQ_MODEL,
    process.env.AURA_GROQ_API_KEY,
    process.env.AURA_GROQ_BASE_URL,
    process.env.AURA_GROQ_MODEL,
    process.env.OPENROUTER_API_KEY,
    process.env.AURA_OPENROUTER_API_KEY,
  ].join('|')
}

function readEnv(keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = process.env[key]
    if (value !== undefined && value.trim() !== '') return value.trim()
  }
  return fallback
}

/** Read the OpenRouter API key for the free pool (main process only). */
export function readOpenRouterFreeKey(): string {
  return readEnv(['OPENROUTER_API_KEY', 'AURA_OPENROUTER_API_KEY'])
}

/** Build (or refresh) the cached Aura backend descriptors from env. */
export function getAuraBackends(): { cerebras: AuraBackendConfig; groq: AuraBackendConfig; openrouter: AuraBackendConfig } {
  const fingerprint = envFingerprint()
  if (cachedBackends && cacheEnvFingerprint === fingerprint) return cachedBackends

  cachedBackends = {
    cerebras: {
      id: 'cerebras',
      provider: 'cerebras',
      apiKey: readEnv(['AURA_CEREBRAS_API_KEY', 'CEREBRAS_API_KEY']),
      baseURL: readEnv(['AURA_CEREBRAS_BASE_URL', 'CEREBRAS_BASE_URL'], 'https://api.cerebras.ai/v1'),
      model: readEnv(['AURA_CEREBRAS_MODEL', 'CEREBRAS_MODEL'], 'gpt-oss-120b'),
    },
    groq: {
      id: 'groq',
      provider: 'groq',
      apiKey: readEnv(['AURA_GROQ_API_KEY', 'GROQ_API_KEY']),
      baseURL: readEnv(['AURA_GROQ_BASE_URL', 'GROQ_BASE_URL'], 'https://api.groq.com/openai/v1'),
      model: readEnv(['AURA_GROQ_MODEL', 'GROQ_MODEL'], 'openai/gpt-oss-120b'),
    },
    openrouter: {
      id: 'openrouter-free',
      provider: 'openrouter',
      apiKey: readOpenRouterFreeKey(),
      baseURL: 'https://openrouter.ai/api/v1',
      model: 'openrouter/free',
    },
  }
  cacheEnvFingerprint = fingerprint
  return cachedBackends
}

/** Invalidate cached env-derived backends (e.g. after a hot reload of .env). */
export function invalidateAuraBackendCache(): void {
  cachedBackends = null
  cacheEnvFingerprint = ''
}

/**
 * True when the profile is the Free Cloud AI locked profile.
 * These profiles use the OpenRouter free pool and must never expose
 * individual model IDs or the API key to the renderer.
 */
export function isFreeCloudAIProfile(profile: Pick<APIProfile, 'locked' | 'name' | 'displayName'> | null | undefined): boolean {
  if (!profile?.locked) return false
  const name = (profile.name || profile.displayName || '').trim().toLowerCase()
  return name === 'free cloud ai' || name === 'free cloud ai — auto' || name === 'free cloud ai - auto'
}

export function isAuraManagedProfile(profile: Pick<APIProfile, 'locked' | 'isDefault' | 'name' | 'displayName'> | null | undefined): boolean {
  if (!profile?.locked) return false
  if (profile.isDefault) return true
  const name = (profile.name || profile.displayName || '').trim().toLowerCase()
  return name === 'default profile' || name === 'aura'
}

export function isProviderHealthy(id: AuraBackendId, now = Date.now()): boolean {
  const entry = health.get(id)
  if (!entry) return true
  if (now >= entry.unhealthyUntil) {
    health.delete(id)
    return true
  }
  return false
}

export function markProviderUnhealthy(id: AuraBackendId, reason: string, cooldownMs?: number, now = Date.now()): void {
  const ms = cooldownMs ?? ( /429|rate.?limit|quota/i.test(reason) ? DEFAULT_RATE_LIMIT_COOLDOWN_MS : DEFAULT_TRANSIENT_COOLDOWN_MS)
  health.set(id, { unhealthyUntil: now + Math.max(1_000, ms), reason })
  // eslint-disable-next-line no-console
  console.warn(`[AURA] primary temporarily unavailable (${id}) — cooldown ${Math.round(ms / 1000)}s`)
}

export function clearProviderHealth(id?: AuraBackendId): void {
  if (id) health.delete(id)
  else health.clear()
}

/** Extract Retry-After (seconds or HTTP-date) when present; otherwise undefined. */
export function extractRetryAfterMs(error: unknown): number | undefined {
  const err = error as {
    headers?: Headers | Record<string, string> | { get?: (name: string) => string | null }
    response?: { headers?: Headers | Record<string, string> }
    error?: { headers?: Record<string, string> }
  }
  const headers = err.headers ?? err.response?.headers ?? err.error?.headers
  if (!headers) return undefined

  let raw: string | null | undefined
  if (typeof (headers as Headers).get === 'function') {
    raw = (headers as Headers).get('retry-after')
  } else if (typeof headers === 'object') {
    const record = headers as Record<string, string>
    raw = record['retry-after'] ?? record['Retry-After']
  }
  if (!raw) return undefined

  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(300_000, seconds * 1000)

  const dateMs = Date.parse(raw)
  if (Number.isFinite(dateMs)) return Math.min(300_000, Math.max(0, dateMs - Date.now()))
  return undefined
}

/**
 * Ordered backends for one Aura request.
 * Healthy Cerebras first; then Groq and OpenRouter as fallbacks.
 * Each backend appears at most once. Missing API keys are skipped.
 */
export function resolveAuraBackendChain(now = Date.now()): AuraBackendConfig[] {
  const { cerebras, groq, openrouter } = getAuraBackends()
  const chain: AuraBackendConfig[] = []

  const push = (backend: AuraBackendConfig) => {
    if (!backend.apiKey) return
    if (chain.some(item => item.id === backend.id)) return
    chain.push(backend)
  }

  if (isProviderHealthy('cerebras', now)) {
    push(cerebras)
    push(groq)
    push(openrouter)
  } else {
    // Temporary prefer fallback; Cerebras returns to primary after cooldown.
    push(groq)
    push(cerebras)
    push(openrouter)
  }

  return chain
}

/** Merge a backend into a full AIConfig for streamCompletion / OpenAI-compat. */
export function backendToStreamConfig(
  backend: AuraBackendConfig,
  base: Pick<AIConfig, 'temperature' | 'topP' | 'maxTokens' | 'streaming' | 'contextLength' | 'aiMode' | 'reasoningEffort' | 'savedModels' | 'activeProfileId' | 'organizationId' | 'customHeaders'>
): AIConfig {
  return {
    provider: backend.provider,
    apiKey: backend.apiKey,
    baseURL: backend.baseURL,
    model: backend.model,
    organizationId: base.organizationId ?? '',
    customHeaders: base.customHeaders ?? {},
    temperature: base.temperature,
    topP: base.topP,
    maxTokens: base.maxTokens,
    streaming: base.streaming,
    reasoningEffort: base.reasoningEffort ?? 'none',
    contextLength: base.contextLength,
    aiMode: base.aiMode,
    savedModels: base.savedModels ?? [],
    activeProfileId: base.activeProfileId,
  }
}

export function profileToAuraBaseConfig(profile: APIProfile, aiMode: AIMode): Omit<AIConfig, 'provider' | 'apiKey' | 'baseURL' | 'model'> & { aiMode: AIMode } {
  return {
    organizationId: profile.organizationId ?? '',
    customHeaders: profile.customHeaders ?? {},
    temperature: profile.temperature,
    topP: profile.topP,
    maxTokens: profile.maxTokens,
    streaming: profile.streaming,
    reasoningEffort: 'none',
    contextLength: profile.contextLength,
    aiMode,
    savedModels: [],
    activeProfileId: profile.id,
  }
}

/** Safe internal log lines — never includes secrets. */
export function auraLog(event: string, detail?: string): void {
  // eslint-disable-next-line no-console
  console.log(`[AURA] ${event}${detail ? ` — ${detail}` : ''}`)
}
