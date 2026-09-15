/**
 * MODEL CAPABILITY REGISTRY
 *
 * Single source of truth for what a provider/model can do:
 *   vision, tools (tool calling), webSearch, streaming.
 *
 * The request builder consults this before attaching image content, so Aura
 * never sends a multimodal payload to a text-only model (the cause of
 * "400 messages[1].content must be a string") and never claims to have
 * analyzed an image it could not see.
 *
 * Heuristics are intentionally conservative: when we cannot PROVE a model is
 * vision-capable, we treat it as text-only. An explicit profile override
 * (visionSupport / toolCalling / streaming flags) always wins over the name
 * heuristic.
 */

import type { AIProvider } from '../types'

export interface ModelCapabilities {
  vision: boolean
  tools: boolean
  webSearch: boolean
  streaming: boolean
}

export interface CapabilityOverrides {
  /** Explicit profile flag; wins over the model-name heuristic. */
  visionSupport?: boolean
  toolCalling?: boolean
  streaming?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Vision-capable model name patterns.
//
// Covers the providers Aura ships with. Not every OpenAI-compatible model is
// multimodal — a model id containing a vision marker is the only reliable
// signal short of a profile flag.
// ─────────────────────────────────────────────────────────────────────────────
const VISION_PATTERNS = [
  /vision/i,
  /gpt-4o/i,
  /gpt-5/i,
  /gemini/i,
  /claude-3/i,
  /claude-4/i,
  /claude-sonnet/i,
  /claude-opus/i,
  /glm-4v/i,
  /glm-5v/i,
  /qwen2?-?vl/i,
  /llava/i,
  /pixtral/i,
  /kimi.*v/i,
  /llama-3\.2/i,
  /llama-4/i,
  /4o-mini/i,
]

/**
 * Best-effort vision detection from the provider + model id.
 * Returns false when there is no reliable signal (conservative).
 */
export function modelSupportsVision(provider: AIProvider | string, model: string): boolean {
  // Every Claude model is multimodal.
  if (provider === 'anthropic') return true
  const normalized = model.toLowerCase()
  return VISION_PATTERNS.some(pattern => pattern.test(normalized))
}

/** True when a provider model exposes the OpenAI-compatible tool-call API. */
export function modelSupportsTools(provider: AIProvider | string, model: string): boolean {
  if (['ollama', 'lmstudio', 'localai', 'vllm'].includes(provider)) {
    // Local OpenAI-compatible servers: tool support depends on the served
    // model — unknown, so conservative. Only explicit profile flag enables.
    return false
  }
  // Hosted OpenAI-compatible + Anthropic all expose tool calling.
  return true
}

/**
 * Resolve the full capability set for a provider/model.
 *
 * `profile` overrides (visionSupport/toolCalling/streaming) win over the
 * heuristics — the user may know their custom model's real capabilities.
 */
export function getModelCapabilities(
  provider: AIProvider | string,
  model: string,
  profile?: CapabilityOverrides
): ModelCapabilities {
  const vision = profile?.visionSupport ?? modelSupportsVision(provider, model)
  const tools = profile?.toolCalling ?? modelSupportsTools(provider, model)
  const streaming = profile?.streaming ?? true
  return {
    vision,
    tools,
    // Web search rides the tool-calling path in Aura (model asks for it).
    webSearch: tools,
    streaming,
  }
}
