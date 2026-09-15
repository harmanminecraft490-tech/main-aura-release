/**
 * Dynamic model discovery. Fetches a provider's model list at runtime —
 * there are NO hardcoded model lists anywhere in Aura vNext.
 *
 * Supports:
 *  - OpenAI-compatible `GET {base}/models` (OpenAI, OpenRouter, Groq, Ollama,
 *    LM Studio, vLLM, any company gateway)
 *  - Anthropic `GET {base}/v1/models`
 *
 * Runs in the Electron main process (uses global fetch, Node 18+/Electron 33).
 */

import type { ConnectionTestResult, DiscoveredModel, ProviderConfig } from './types'
import {
  inferCapabilities,
  inferContextLength,
  inferMaxOutput,
  inferPricing,
  isChatModel,
  prettifyModelId,
  type RawModelEntry,
} from '../models/capabilities/infer'

const DISCOVERY_TIMEOUT_MS = 20_000

export class DiscoveryError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'DiscoveryError'
  }
}

function trimBase(baseURL: string): string {
  return baseURL.trim().replace(/\/+$/, '')
}

/** Build auth + custom headers. Custom headers win so gateways can override auth. */
export function buildHeaders(provider: ProviderConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (provider.apiKey) {
    if (provider.protocol === 'anthropic') {
      headers['x-api-key'] = provider.apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers.Authorization = `Bearer ${provider.apiKey}`
    }
  }
  if (provider.organization) headers['OpenAI-Organization'] = provider.organization

  return { ...headers, ...provider.headers }
}

function modelsEndpoint(provider: ProviderConfig): string {
  const base = trimBase(provider.baseURL)
  if (provider.protocol === 'anthropic') {
    // Accept bases given with or without /v1.
    return base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`
  }
  return `${base}/models`
}

async function fetchJSON(url: string, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { headers, signal: controller.signal })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new DiscoveryError(summarizeHttpError(response.status, body), response.status)
    }
    return await response.json()
  } catch (error) {
    if (error instanceof DiscoveryError) throw error
    if (controller.signal.aborted) {
      throw new DiscoveryError(`Model discovery timed out after ${Math.round(timeoutMs / 1000)}s.`)
    }
    throw new DiscoveryError(error instanceof Error ? error.message : 'Network error during discovery.')
  } finally {
    clearTimeout(timer)
  }
}

function summarizeHttpError(status: number, body: string): string {
  let detail = ''
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    detail = parsed.error?.message ?? parsed.message ?? ''
  } catch {
    detail = body.slice(0, 200)
  }
  if (status === 401 || status === 403) return `Authentication failed (${status}). Check the API key.`
  if (status === 404) return `Models endpoint not found (404). Check the base URL.`
  return detail ? `${status}: ${detail}` : `HTTP ${status}`
}

/** Extract the entries array from whatever shape the endpoint returned. */
function extractEntries(payload: unknown): RawModelEntry[] {
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>
  const list = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : Array.isArray(payload)
        ? (payload as unknown[])
        : []
  return list.filter((entry): entry is RawModelEntry => {
    if (!entry || typeof entry !== 'object') return false
    const id = (entry as Record<string, unknown>).id ?? (entry as Record<string, unknown>).name
    return typeof id === 'string' && id.length > 0
  }).map(entry => {
    const raw = entry as RawModelEntry & { name?: string }
    // Some servers (Gemini native, Ollama tags) use `name` as the id.
    return raw.id ? raw : { ...raw, id: raw.name as string }
  })
}

/**
 * Discover all chat models exposed by a provider.
 * `previous` carries over firstSeenAt so "new model" detection stays stable.
 */
export async function discoverModels(
  provider: ProviderConfig,
  previous: DiscoveredModel[] = []
): Promise<DiscoveredModel[]> {
  const payload = await fetchJSON(modelsEndpoint(provider), buildHeaders(provider), DISCOVERY_TIMEOUT_MS)
  const entries = extractEntries(payload)
  if (entries.length === 0) {
    throw new DiscoveryError('The provider returned no models. Check the base URL and API key.')
  }

  const previousById = new Map(previous.map(model => [model.id, model]))
  const now = Date.now()
  const seen = new Set<string>()
  const models: DiscoveredModel[] = []

  for (const raw of entries) {
    // Strip Gemini-style "models/" prefixes for the id we send back to the API.
    const id = raw.id.replace(/^models\//, '')
    if (!isChatModel(id) || seen.has(id)) continue
    seen.add(id)

    const prior = previousById.get(id)
    models.push({
      id,
      providerId: provider.id,
      displayName: raw.display_name ?? raw.name ?? prettifyModelId(id),
      contextLength: inferContextLength(raw),
      maxOutputTokens: inferMaxOutput(raw),
      capabilities: inferCapabilities(raw),
      pricing: inferPricing(raw),
      firstSeenAt: prior?.firstSeenAt ?? now,
      lastSeenAt: now,
      createdAt: raw.created,
    })
  }

  models.sort((a, b) => a.displayName.localeCompare(b.displayName))
  return models
}

/** Lightweight connection test: can we list models, and how fast? */
export async function testConnection(provider: ProviderConfig): Promise<ConnectionTestResult> {
  const start = Date.now()
  try {
    const models = await discoverModels(provider)
    return { ok: true, latencyMs: Date.now() - start, modelCount: models.length }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Connection failed.' }
  }
}
