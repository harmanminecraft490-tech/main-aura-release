/**
 * OPENROUTER FREE MODEL DISCOVERY
 *
 * Dynamically discovers and normalizes free models from OpenRouter's /models
 * endpoint. Matches preferred model families, verifies capabilities, and
 * maintains a cached registry that refreshes periodically.
 *
 * Security: reads OPENROUTER_API_KEY from process.env only (main process).
 * Never exposes the key to the renderer.
 */

import * as https from 'https'

// ─────────────────────────────────────────────────────────────────────────────
// Normalized model structure
// ─────────────────────────────────────────────────────────────────────────────

export interface FreeModel {
  id: string
  name: string
  provider: string
  free: boolean
  contextLength: number
  inputModalities: string[]
  outputModalities: string[]
  supportsTools: boolean
  supportsVision: boolean
  supportsStructuredOutput: boolean
  supportsReasoning: boolean
  specialties: ModelSpecialty[]
  /** Populated at runtime by the health tracker */
  health?: ModelHealth
  latency?: number
  successRate?: number
}

export type ModelSpecialty =
  | 'general_chat'
  | 'coding'
  | 'debugging'
  | 'agentic_coding'
  | 'terminal'
  | 'tool_calling'
  | 'reasoning'
  | 'long_context'
  | 'vision'
  | 'structured_output'
  | 'fast_response'
  | 'frontend'
  | 'backend'
  | 'architecture'
  | 'research'
  | 'planning'

export interface ModelHealth {
  requestCount: number
  successCount: number
  failureCount: number
  timeoutCount: number
  http429Count: number
  http5xxCount: number
  avgLatencyMs: number
  toolCallSuccess: number
  malformedResponseCount: number
  lastSuccessAt: number
  cooldownUntil: number
  consecutiveFailures: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Preferred model family definitions
// ─────────────────────────────────────────────────────────────────────────────

interface PreferredModelDef {
  /** Patterns to match against model id (case-insensitive) */
  idPatterns: RegExp[]
  /** Human-readable family name */
  family: string
  specialties: ModelSpecialty[]
  supportsTools?: boolean
  supportsVision?: boolean
  supportsReasoning?: boolean
}

const PREFERRED_MODEL_FAMILIES: PreferredModelDef[] = [
  {
    family: 'Nex-N2.5-Pro',
    idPatterns: [/nex.*n2\.5.*pro/i, /nex-n2\.5-pro/i, /nex.*pro.*2\.5/i],
    specialties: ['agentic_coding', 'coding', 'reasoning', 'tool_calling', 'vision', 'planning'],
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
  },
  {
    family: 'Nex-N2.5-Mini',
    idPatterns: [/nex.*n2\.5.*mini/i, /nex-n2\.5-mini/i, /nex.*mini.*2\.5/i],
    specialties: ['coding', 'fast_response', 'tool_calling', 'general_chat'],
    supportsTools: true,
    supportsVision: false,
    supportsReasoning: false,
  },
  {
    family: 'Laguna S 2.1',
    idPatterns: [/laguna.*s.*2\.1/i, /laguna-s-2\.1/i, /laguna.*2\.1.*s\b/i],
    specialties: ['agentic_coding', 'coding', 'debugging', 'backend', 'tool_calling'],
    supportsTools: true,
    supportsVision: false,
    supportsReasoning: true,
  },
  {
    family: 'Laguna XS 2.1',
    idPatterns: [/laguna.*xs.*2\.1/i, /laguna-xs-2\.1/i, /laguna.*2\.1.*xs\b/i],
    specialties: ['coding', 'fast_response', 'tool_calling'],
    supportsTools: true,
    supportsVision: false,
    supportsReasoning: false,
  },
  {
    family: 'North Mini Code',
    idPatterns: [/north.*mini.*code/i, /north-mini-code/i, /north.*code.*mini/i],
    specialties: ['coding', 'debugging', 'agentic_coding', 'frontend', 'backend', 'tool_calling'],
    supportsTools: true,
    supportsVision: false,
    supportsReasoning: false,
  },
  {
    family: 'Nemotron 3 Ultra',
    idPatterns: [/nemotron.*3.*ultra/i, /nemotron-3-ultra/i, /nvidia.*nemotron.*ultra/i],
    specialties: ['reasoning', 'planning', 'architecture', 'research', 'agentic_coding'],
    supportsTools: true,
    supportsVision: false,
    supportsReasoning: true,
  },
  {
    family: 'Nemotron 3.5 Lightning',
    idPatterns: [/nemotron.*3\.5.*lightning/i, /nemotron-3\.5-lightning/i, /nvidia.*nemotron.*lightning/i],
    specialties: ['fast_response', 'general_chat', 'coding'],
    supportsTools: true,
    supportsVision: false,
    supportsReasoning: false,
  },
  {
    family: 'Nemotron 3 Super',
    idPatterns: [/nemotron.*3.*super/i, /nemotron-3-super/i, /nvidia.*nemotron.*super/i],
    specialties: ['reasoning', 'planning', 'research', 'coding'],
    supportsTools: true,
    supportsVision: false,
    supportsReasoning: true,
  },
  {
    family: 'Inkling',
    idPatterns: [/\binkling\b(?!.*small)/i],
    specialties: ['reasoning', 'research', 'planning', 'vision', 'general_chat'],
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
  },
  {
    family: 'Inkling Small',
    idPatterns: [/inkling.*small/i, /inkling-small/i],
    specialties: ['fast_response', 'general_chat'],
    supportsTools: true,
    supportsVision: false,
    supportsReasoning: false,
  },
  {
    family: 'Ling 3.0 Flash VL',
    idPatterns: [/ling.*3\.0.*flash.*vl/i, /ling-3\.0-flash-vl/i, /ling.*vl.*3\.0/i],
    specialties: ['vision', 'fast_response', 'general_chat'],
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: false,
  },
  {
    family: 'Ling 3.0 Flash',
    idPatterns: [/ling.*3\.0.*flash(?!.*vl)/i, /ling-3\.0-flash(?!.*vl)/i],
    specialties: ['fast_response', 'general_chat', 'coding'],
    supportsTools: true,
    supportsVision: false,
    supportsReasoning: false,
  },
  {
    family: 'MiniMax M3',
    idPatterns: [/minimax.*m3/i, /minimax-m3/i, /minimax.*03/i],
    specialties: ['reasoning', 'planning', 'research', 'general_chat'],
    supportsTools: true,
    supportsVision: false,
    supportsReasoning: true,
  },
  {
    family: 'MiniMax M2.7',
    idPatterns: [/minimax.*m2\.7/i, /minimax-m2\.7/i, /minimax.*2\.7/i],
    specialties: ['fast_response', 'general_chat', 'coding'],
    supportsTools: true,
    supportsVision: false,
    supportsReasoning: false,
  },
  {
    family: 'Gemma 4 26B A4B',
    idPatterns: [/gemma.*4.*26b/i, /gemma-4-27b/i, /gemma.*26b.*a4b/i, /google.*gemma.*4/i],
    specialties: ['coding', 'reasoning', 'vision', 'general_chat'],
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: false,
  },
  {
    family: 'Dots 3 Note Preview',
    idPatterns: [/dots.*3.*note/i, /dots-3-note/i, /dots.*note.*3/i],
    specialties: ['general_chat', 'research', 'planning'],
    supportsTools: true,
    supportsVision: false,
    supportsReasoning: false,
  },
  {
    family: 'GPT-OSS 20B',
    idPatterns: [/gpt.*oss.*20b/i, /gpt-oss-20b/i, /openai.*gpt.*oss.*20/i],
    specialties: ['coding', 'general_chat', 'fast_response'],
    supportsTools: true,
    supportsVision: false,
    supportsReasoning: false,
  },
  {
    family: 'LFM2.5-2.6B',
    idPatterns: [/lfm.*2\.5.*2\.6b/i, /lfm2\.5-2\.6b/i, /lfm.*2\.6b/i],
    specialties: ['fast_response', 'general_chat'],
    supportsTools: false,
    supportsVision: false,
    supportsReasoning: false,
  },
]

// The final fallback — always included
export const OPENROUTER_FREE_ROUTER_ID = 'openrouter/free'

// ─────────────────────────────────────────────────────────────────────────────
// Raw OpenRouter API types
// ─────────────────────────────────────────────────────────────────────────────

interface OpenRouterModelRaw {
  id: string
  name?: string
  description?: string
  context_length?: number
  architecture?: {
    modality?: string
    input_modalities?: string[]
    output_modalities?: string[]
    tokenizer?: string
  }
  pricing?: {
    prompt?: string | number
    completion?: string | number
    image?: string | number
    request?: string | number
  }
  top_provider?: {
    context_length?: number
    max_completion_tokens?: number
    is_moderated?: boolean
  }
  supported_parameters?: string[]
  per_request_limits?: Record<string, unknown> | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery cache
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes
const DISCOVERY_TIMEOUT_MS = 10_000

let cachedRegistry: FreeModel[] | null = null
let cacheTimestamp = 0
let discoveryInFlight = false

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isFreeModel(raw: OpenRouterModelRaw): boolean {
  const pricing = raw.pricing
  if (!pricing) return false
  const prompt = Number(pricing.prompt ?? 1)
  const completion = Number(pricing.completion ?? 1)
  // Free models have prompt=0 and completion=0
  return prompt === 0 && completion === 0
}

function extractProvider(modelId: string): string {
  const slash = modelId.indexOf('/')
  return slash !== -1 ? modelId.slice(0, slash) : modelId
}

function detectVisionFromModality(raw: OpenRouterModelRaw): boolean {
  const modality = raw.architecture?.modality ?? ''
  const inputMods = raw.architecture?.input_modalities ?? []
  return (
    modality.includes('image') ||
    inputMods.includes('image') ||
    /vision|vl\b|multimodal/i.test(raw.id) ||
    /vision|vl\b|multimodal/i.test(raw.name ?? '')
  )
}

function detectToolsFromParams(raw: OpenRouterModelRaw): boolean {
  const params = raw.supported_parameters ?? []
  return params.includes('tools') || params.includes('tool_choice')
}

function detectStructuredOutput(raw: OpenRouterModelRaw): boolean {
  const params = raw.supported_parameters ?? []
  return params.includes('response_format') || params.includes('structured_outputs')
}

function detectReasoning(raw: OpenRouterModelRaw): boolean {
  const params = raw.supported_parameters ?? []
  return (
    params.includes('reasoning') ||
    /think|reason|r1\b|qwq|o1\b|o3\b/i.test(raw.id) ||
    /think|reason/i.test(raw.name ?? '')
  )
}

function matchPreferredFamily(raw: OpenRouterModelRaw): PreferredModelDef | null {
  for (const def of PREFERRED_MODEL_FAMILIES) {
    for (const pattern of def.idPatterns) {
      if (pattern.test(raw.id) || pattern.test(raw.name ?? '')) {
        return def
      }
    }
  }
  return null
}

function inferSpecialtiesFromId(raw: OpenRouterModelRaw): ModelSpecialty[] {
  const id = raw.id.toLowerCase()
  const name = (raw.name ?? '').toLowerCase()
  const combined = `${id} ${name}`
  const specialties: ModelSpecialty[] = ['general_chat']

  if (/code|coder|coding|dev|program/i.test(combined)) specialties.push('coding', 'debugging')
  if (/reason|think|r1\b|qwq|o1\b|o3\b/i.test(combined)) specialties.push('reasoning', 'planning')
  if (/vision|vl\b|multimodal|image/i.test(combined)) specialties.push('vision')
  if (/fast|flash|lightning|turbo|mini|small|lite/i.test(combined)) specialties.push('fast_response')
  if (/research|search/i.test(combined)) specialties.push('research')
  if (/agent|agentic/i.test(combined)) specialties.push('agentic_coding')

  return [...new Set(specialties)]
}

function normalizeModel(raw: OpenRouterModelRaw, family: PreferredModelDef | null): FreeModel {
  const hasVision = family?.supportsVision ?? detectVisionFromModality(raw)
  const hasTools = family?.supportsTools ?? detectToolsFromParams(raw)
  const hasReasoning = family?.supportsReasoning ?? detectReasoning(raw)
  const hasStructured = detectStructuredOutput(raw)

  const inputMods = raw.architecture?.input_modalities ?? ['text']
  const outputMods = raw.architecture?.output_modalities ?? ['text']

  const specialties = family?.specialties ?? inferSpecialtiesFromId(raw)

  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    provider: extractProvider(raw.id),
    free: true,
    contextLength: raw.context_length ?? raw.top_provider?.context_length ?? 8192,
    inputModalities: inputMods,
    outputModalities: outputMods,
    supportsTools: hasTools,
    supportsVision: hasVision,
    supportsStructuredOutput: hasStructured,
    supportsReasoning: hasReasoning,
    specialties,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP fetch (Node https — no external deps)
// ─────────────────────────────────────────────────────────────────────────────

function fetchOpenRouterModels(apiKey: string): Promise<OpenRouterModelRaw[]> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/models',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://aura.ai',
        'X-Title': 'Aura',
      },
      timeout: DISCOVERY_TIMEOUT_MS,
    }

    const req = https.request(options, res => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { data?: OpenRouterModelRaw[] }
          resolve(Array.isArray(parsed.data) ? parsed.data : [])
        } catch {
          reject(new Error(`OpenRouter /models parse error: ${body.slice(0, 200)}`))
        }
      })
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error('OpenRouter /models request timed out'))
    })
    req.on('error', reject)
    req.end()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic discovery — also finds one additional strong free coding model
// ─────────────────────────────────────────────────────────────────────────────

const STRONG_CODING_PATTERNS = [
  /qwen.*coder/i,
  /deepseek.*coder/i,
  /codestral/i,
  /starcoder/i,
  /wizard.*coder/i,
  /phind.*code/i,
  /code.*llama/i,
  /granite.*code/i,
]

function findAdditionalCodingModel(
  allFree: OpenRouterModelRaw[],
  alreadyIncluded: Set<string>
): FreeModel | null {
  for (const raw of allFree) {
    if (alreadyIncluded.has(raw.id)) continue
    for (const pattern of STRONG_CODING_PATTERNS) {
      if (pattern.test(raw.id) || pattern.test(raw.name ?? '')) {
        return normalizeModel(raw, null)
      }
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the free model registry from OpenRouter /models.
 * Returns cached data if fresh; falls back to cache on failure.
 * Never blocks a user request — callers should use the last-known-good registry.
 */
export async function discoverFreeModels(apiKey: string): Promise<FreeModel[]> {
  const now = Date.now()

  // Return fresh cache
  if (cachedRegistry && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedRegistry
  }

  // Prevent concurrent discovery
  if (discoveryInFlight) {
    return cachedRegistry ?? buildFallbackRegistry()
  }

  discoveryInFlight = true
  try {
    const allModels = await fetchOpenRouterModels(apiKey)
    const freeModels = allModels.filter(isFreeModel)

    const registry: FreeModel[] = []
    const includedIds = new Set<string>()

    // Match preferred families first
    for (const def of PREFERRED_MODEL_FAMILIES) {
      for (const raw of freeModels) {
        if (includedIds.has(raw.id)) continue
        let matched = false
        for (const pattern of def.idPatterns) {
          if (pattern.test(raw.id) || pattern.test(raw.name ?? '')) {
            matched = true
            break
          }
        }
        if (matched) {
          registry.push(normalizeModel(raw, def))
          includedIds.add(raw.id)
          break // one model per family
        }
      }
    }

    // Add one additional strong free coding model
    const extra = findAdditionalCodingModel(freeModels, includedIds)
    if (extra) {
      registry.push(extra)
      includedIds.add(extra.id)
    }

    // Always add the openrouter/free router as final fallback
    registry.push(buildOpenRouterFreeEntry())

    // eslint-disable-next-line no-console
    console.log(`[openrouter-discovery] found ${registry.length} free models (${freeModels.length} total free on OpenRouter)`)

    cachedRegistry = registry
    cacheTimestamp = now
    return registry
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[openrouter-discovery] failed, using cached/fallback registry:', error instanceof Error ? error.message : error)
    return cachedRegistry ?? buildFallbackRegistry()
  } finally {
    discoveryInFlight = false
  }
}

/**
 * Synchronous access to the last-known-good registry.
 * Returns fallback if discovery has never succeeded.
 */
export function getCachedFreeModels(): FreeModel[] {
  return cachedRegistry ?? buildFallbackRegistry()
}

/**
 * Invalidate the cache (e.g. after a key change).
 */
export function invalidateFreeModelCache(): void {
  cachedRegistry = null
  cacheTimestamp = 0
}

/**
 * Trigger a background refresh without blocking the caller.
 */
export function refreshFreeModelsInBackground(apiKey: string): void {
  if (!apiKey) return
  // Invalidate so next call fetches fresh
  cacheTimestamp = 0
  discoverFreeModels(apiKey).catch(() => { /* already logged inside */ })
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback registry (hardcoded model IDs for when discovery fails)
// ─────────────────────────────────────────────────────────────────────────────

function buildOpenRouterFreeEntry(): FreeModel {
  return {
    id: OPENROUTER_FREE_ROUTER_ID,
    name: 'OpenRouter Free',
    provider: 'openrouter',
    free: true,
    contextLength: 32768,
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsTools: true,
    supportsVision: false,
    supportsStructuredOutput: false,
    supportsReasoning: false,
    specialties: ['general_chat', 'coding', 'fast_response'],
  }
}

/**
 * Hardcoded fallback registry used when the /models endpoint is unreachable.
 * IDs are best-effort guesses; the real IDs come from discovery.
 */
function buildFallbackRegistry(): FreeModel[] {
  const fallbacks: Array<{ id: string; def: PreferredModelDef }> = [
    { id: 'nex/nex-n2.5-pro:free', def: PREFERRED_MODEL_FAMILIES[0] },
    { id: 'nex/nex-n2.5-mini:free', def: PREFERRED_MODEL_FAMILIES[1] },
    { id: 'laguna/laguna-s-2.1:free', def: PREFERRED_MODEL_FAMILIES[2] },
    { id: 'laguna/laguna-xs-2.1:free', def: PREFERRED_MODEL_FAMILIES[3] },
    { id: 'north/north-mini-code:free', def: PREFERRED_MODEL_FAMILIES[4] },
    { id: 'nvidia/nemotron-3-ultra:free', def: PREFERRED_MODEL_FAMILIES[5] },
    { id: 'nvidia/nemotron-3.5-lightning:free', def: PREFERRED_MODEL_FAMILIES[6] },
    { id: 'nvidia/nemotron-3-super:free', def: PREFERRED_MODEL_FAMILIES[7] },
    { id: 'inkling/inkling:free', def: PREFERRED_MODEL_FAMILIES[8] },
    { id: 'inkling/inkling-small:free', def: PREFERRED_MODEL_FAMILIES[9] },
    { id: 'ling/ling-3.0-flash-vl:free', def: PREFERRED_MODEL_FAMILIES[10] },
    { id: 'ling/ling-3.0-flash:free', def: PREFERRED_MODEL_FAMILIES[11] },
    { id: 'minimax/minimax-m3:free', def: PREFERRED_MODEL_FAMILIES[12] },
    { id: 'minimax/minimax-m2.7:free', def: PREFERRED_MODEL_FAMILIES[13] },
    { id: 'google/gemma-4-27b-it:free', def: PREFERRED_MODEL_FAMILIES[14] },
    { id: 'dots/dots-3-note-preview:free', def: PREFERRED_MODEL_FAMILIES[15] },
    { id: 'openai/gpt-oss-20b:free', def: PREFERRED_MODEL_FAMILIES[16] },
    { id: 'liquid/lfm2.5-2.6b:free', def: PREFERRED_MODEL_FAMILIES[17] },
  ]

  return [
    ...fallbacks.map(({ id, def }) => normalizeModel(
      { id, name: def.family, context_length: 32768 },
      def
    )),
    buildOpenRouterFreeEntry(),
  ]
}
