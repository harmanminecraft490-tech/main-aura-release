/**
 * Capability inference for dynamically discovered models.
 *
 * Providers rarely report capabilities in /models responses, so we infer them
 * from id/name heuristics plus any metadata the provider does return
 * (OpenRouter-style `architecture`, context_length, pricing...). Inference is
 * conservative: streaming defaults to true (verified on first use), everything
 * else defaults to false unless a signal says otherwise.
 *
 * NOTE: heuristics are pattern-based, never a hardcoded model list — an
 * unknown future model still gets sensible defaults.
 */

import type { ModelCapabilities, ModelPricing } from '../../providers/types'

/** Loose shape of a single entry from a /models response (OpenAI, OpenRouter, Anthropic...). */
export interface RawModelEntry {
  id: string
  name?: string
  display_name?: string
  created?: number
  context_length?: number
  context_window?: number
  max_context_length?: number
  max_tokens?: number
  max_output_tokens?: number
  top_provider?: { context_length?: number; max_completion_tokens?: number }
  architecture?: {
    modality?: string
    input_modalities?: string[]
    output_modalities?: string[]
  }
  capabilities?: {
    vision?: boolean
    reasoning?: boolean
    function_calling?: boolean
    tools?: boolean
    streaming?: boolean
  }
  pricing?: {
    prompt?: string | number
    completion?: string | number
    input?: string | number
    output?: string | number
  }
  supported_generation_methods?: string[]
}

const VISION_PATTERNS = [
  /vision/i, /-vl\b/i, /\bvl-/i, /multimodal/i,
  /\bgpt-4o\b/i, /\bgpt-4\.\d/i, /\bgpt-5/i, /\bo[34]\b/i,
  /claude-(3|opus|sonnet|haiku)/i, /gemini/i, /pixtral/i, /llava/i,
  /\bglm-.?v/i, /qwen.*vl/i, /grok-(vision|[2-9])/i, /llama-?[34]/i, /kimi/i,
]

const REASONING_PATTERNS = [
  /think/i, /reason/i, /\br1\b/i, /\bo[134](-|$)/i, /-o[134]\b/i,
  /opus/i, /deepseek-r/i, /qwq/i, /grok-[3-9]/i, /gemini-.*(pro|thinking)/i,
]

const TOOLS_PATTERNS = [
  /gpt/i, /claude/i, /gemini/i, /mistral/i, /qwen/i, /deepseek/i,
  /llama-?[34]/i, /kimi/i, /glm/i, /grok/i, /command/i, /nemotron/i,
]

/** Models that are clearly not chat models — excluded from the registry. */
const NON_CHAT_PATTERNS = [
  /embed/i, /whisper/i, /\btts\b/i, /audio/i, /dall-e/i, /image-gen/i,
  /moderation/i, /rerank/i, /babbage/i, /davinci-00/i, /^text-similarity/i,
]

export function isChatModel(id: string): boolean {
  return !NON_CHAT_PATTERNS.some(pattern => pattern.test(id))
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(value))
}

function toNumber(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function inferCapabilities(raw: RawModelEntry): ModelCapabilities {
  const haystack = `${raw.id} ${raw.name ?? ''} ${raw.display_name ?? ''}`

  // Provider-reported capabilities always win over heuristics.
  const reported = raw.capabilities
  const inputModalities = raw.architecture?.input_modalities ?? []
  const modality = raw.architecture?.modality ?? ''

  const vision =
    reported?.vision ??
    (inputModalities.includes('image') || modality.includes('image') || matchesAny(haystack, VISION_PATTERNS))

  const reasoning = reported?.reasoning ?? matchesAny(haystack, REASONING_PATTERNS)

  const tools =
    reported?.function_calling ?? reported?.tools ?? matchesAny(haystack, TOOLS_PATTERNS)

  const streaming =
    reported?.streaming ??
    (raw.supported_generation_methods
      ? raw.supported_generation_methods.some(method => /stream|generate/i.test(method))
      : true)

  return { vision, reasoning, tools, streaming }
}

export function inferContextLength(raw: RawModelEntry): number | undefined {
  return (
    raw.context_length ??
    raw.context_window ??
    raw.max_context_length ??
    raw.top_provider?.context_length ??
    inferContextFromName(raw.id)
  )
}

/** "…-128k", "…-1m" style suffixes carry the context size in the id itself. */
function inferContextFromName(id: string): number | undefined {
  const match = id.match(/[-_](\d+)(k|m)\b/i)
  if (!match) return undefined
  const value = Number.parseInt(match[1], 10)
  if (!Number.isFinite(value)) return undefined
  return match[2].toLowerCase() === 'm' ? value * 1_000_000 : value * 1_000
}

export function inferMaxOutput(raw: RawModelEntry): number | undefined {
  return raw.max_output_tokens ?? raw.top_provider?.max_completion_tokens ?? raw.max_tokens
}

export function inferPricing(raw: RawModelEntry): ModelPricing | undefined {
  const pricing = raw.pricing
  if (!pricing) return undefined
  // OpenRouter reports USD per token; normalize to USD per 1M tokens.
  const input = toNumber(pricing.input ?? pricing.prompt)
  const output = toNumber(pricing.output ?? pricing.completion)
  if (input === undefined && output === undefined) return undefined
  const scale = (value: number | undefined) =>
    value === undefined ? undefined : value < 0.01 ? value * 1_000_000 : value
  return { input: scale(input), output: scale(output) }
}

/** Human-friendly display name from a raw id: "gpt-5.6-terra" → "GPT 5.6 Terra". */
export function prettifyModelId(id: string): string {
  const base = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id
  return base
    .replace(/[-_]/g, ' ')
    .replace(/\b(gpt|glm|llm|ai|vl|qwq)\b/gi, segment => segment.toUpperCase())
    .replace(/\b[a-z]/g, char => char.toUpperCase())
}
