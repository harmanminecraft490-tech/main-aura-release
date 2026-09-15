import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { app } from 'electron'
import * as path from 'path'
import type {
  AIConfig,
  AIMode,
  APIProfile,
  ModelPreset,
  PipelineStage,
  PipelineStep,
  TestConnectionResult,
} from './aiConfig'
import { addDevLog } from './aiConfig'
import { assemblePrompt, logTokenInspector, type ContextBudget } from './contextBudget'
import { debugRequestPayload, type DebugSection } from './payloadDebug'
import { providerTokenBudget } from './tokenBudget'
import { getModelCapabilities, type ModelCapabilities } from './modelCapabilities'
import { serializeProviderMessages, VISION_NOT_SUPPORTED_MESSAGE, type ImageAttachment, type WireMessage } from './messageAdapter'
import { ToolProtocolSuppressor } from './toolProtocolFilter'
import { WORKSPACE_FILE_TOOL } from './workspace/workspaceTools'
import { WEB_SEARCH_TOOL, READ_PAGE_TOOL, WEB_RESEARCH_TOOL } from './capabilities/webSearch'
import {
  normalizeToolCall,
  isToolCallParseError,
  isWebToolValidationError,
  isContentSchemaError,
  isRateLimitError,
  isTransientProviderFailure,
  sanitizeProviderError,
  deriveSearchQuery,
} from './toolCallNormalizer'
import type { EffectiveAIMode } from './modeRouter'
import { resolveEffectiveMode } from './modeRouter'
import {
  AURA_MODEL_IDENTITY,
  FREE_CLOUD_AI_IDENTITY,
  auraLog,
  backendToStreamConfig,
  extractRetryAfterMs,
  isAuraManagedProfile,
  isFreeCloudAIProfile,
  markProviderUnhealthy,
  profileToAuraBaseConfig,
  resolveAuraBackendChain,
} from './auraProviderRouter'
import { ensureEnvLoaded } from './aiConfig'
import {
  streamFreePool,
  hasOpenRouterKey,
  type FreePoolMessage,
} from './openrouterFreePool'

interface RendererMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface StreamCallbacks {
  onToken: (token: string) => void
  onThinking?: (thinking: string) => void
  onDone: (text: string, model?: string, usage?: { input: number; output: number; total: number }) => void
  onError: (error: Error) => void
  onAbort?: () => void
  onPipeline?: (steps: PipelineStep[]) => void
  /** Emitted when the model requests a workspace tool call (result is the verified JSON). */
  onTool?: (name: string, args: Record<string, unknown>, result: string) => void
}

interface StreamUsage {
  input: number
  output: number
  total: number
}

/**
 * Convert WireMessage[] to the OpenAI SDK param type. This is a type-boundary
 * coercion only — the runtime shapes already match (system/user/assistant with
 * string content; multimodal content parts only ever appear on the LAST user
 * message, which the adapter guarantees). TypeScript cannot prove it from the
 * two separate `role`/`content` properties, hence the single assertion here.
 */
function toOpenAIChatMessages(messages: WireMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map(message => ({
    role: message.role,
    content: message.content,
  })) as unknown as OpenAI.Chat.ChatCompletionMessageParam[]
}

/**
 * Validate the wire message array before it reaches a provider. Catches
 * malformed structures (non-string content, a tool/assistant message holding an
 * image array, a null-content assistant message without tool_calls) INTERNALLY
 * so a strict provider never rejects with "400 messages[1].content must be a
 * string". Throws a clean, user-friendly error; the specific violation is logged
 * to the developer console for debugging.
 */
function assertValidOpenAIMessages(messages: OpenAI.Chat.ChatCompletionMessageParam[]): void {
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    const content = message.content

    if (content === null) {
      // Only an assistant message carrying tool_calls may have null content.
      if (message.role !== 'assistant' || !('tool_calls' in message)) {
        // eslint-disable-next-line no-console
        console.warn(`[schema] message ${index} has null content without tool_calls (role=${message.role})`)
        throw new Error("Aura couldn't send that message to the AI service. Please try again.")
      }
      continue
    }

    if (Array.isArray(content)) {
      // Multimodal parts are only valid on a user message (the vision turn).
      if (message.role !== 'user') {
        // eslint-disable-next-line no-console
        console.warn(`[schema] message ${index} has array content but role=${message.role}`)
        throw new Error("Aura couldn't send that message to the AI service. Please try again.")
      }
      for (const part of content) {
        if (typeof part !== 'object' || part === null) {
          // eslint-disable-next-line no-console
          console.warn(`[schema] message ${index} has a malformed content part`)
          throw new Error("Aura couldn't send that message to the AI service. Please try again.")
        }
      }
      continue
    }

    if (typeof content !== 'string') {
      // eslint-disable-next-line no-console
      console.warn(`[schema] message ${index} has unsupported content type (${typeof content})`)
      throw new Error("Aura couldn't send that message to the AI service. Please try again.")
    }
  }
}

/**
 * Rough input-token estimate for the wire message array. Drives the token-budget
 * governor (see tokenBudget.ts) so `input + max_tokens` stays inside the
 * provider's per-minute window instead of 429ing and burning the window on a
 * retry. Approximate is fine — the goal is a safe upper bound, not exactness.
 */
function estimateWireInput(messages: OpenAI.Chat.ChatCompletionMessageParam[]): number {
  let chars = 0
  for (const message of messages) {
    const content = message.content
    if (typeof content === 'string') {
      chars += content.length
    } else if (Array.isArray(content)) {
      for (const part of content) {
        const text = (part as { text?: string })?.text
        if (typeof text === 'string') chars += text.length
      }
    }
  }
  return Math.max(32, Math.ceil(chars / 4) + 64)
}

/**
 * Plan + reserve the provider token budget for one wire request and return the
 * max_tokens to actually send. Shrinks max_tokens (or waits, only when a single
 * request's input nearly fills the window) so the request fits the rolling
 * per-minute budget. Every caller that issues a provider request must route
 * through this so the window is never over-committed.
 */
async function reserveBudget(
  provider: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  requestedMax: number,
  abortSignal: AbortSignal,
  onAbort: () => void
): Promise<number | null> {
  const inputTokens = estimateWireInput(messages)
  const plan = providerTokenBudget.plan(provider, inputTokens, requestedMax)
  if (plan.waitMs > 0) {
    await new Promise(resolve => setTimeout(resolve, plan.waitMs))
    if (abortSignal.aborted) {
      onAbort()
      return null
    }
  }
  providerTokenBudget.consume(provider, inputTokens + plan.maxTokens)
  const windowCap = providerTokenBudget.available(provider) + providerTokenBudget.used(provider)
  // eslint-disable-next-line no-console
  console.log(`[tokens] ${provider} input≈${inputTokens} max=${plan.maxTokens} window=${providerTokenBudget.used(provider)}/${windowCap}`)
  return plan.maxTokens
}

interface StreamResult {
  text: string
  model?: string
  usage?: StreamUsage
  aborted?: boolean
}

interface ModeOverrides {
  temperature: number
  maxTokens: number
  systemAddendum?: string
  pipelineDepth: 'none' | 'light' | 'full'
}

const MODE_OVERRIDES: Record<EffectiveAIMode, ModeOverrides> = {
  fast: {
    temperature: 0.25,
    maxTokens: 2048,
    pipelineDepth: 'none',
    systemAddendum:
      '\n\nFAST MODE: Answer quickly and directly. Prefer short, correct answers. Skip long preambles. If code is needed, keep it minimal.',
  },
  balanced: {
    temperature: 0.5,
    maxTokens: 4096,
    pipelineDepth: 'light',
    systemAddendum:
      '\n\nBALANCED MODE: Be clear and practical. Cover the important points without padding. Use tools when they improve accuracy.',
  },
  think: {
    temperature: 0.65,
    maxTokens: 8192,
    pipelineDepth: 'full',
    systemAddendum: [
      '',
      'THINK MODE — deeper reasoning:',
      '- Spend more effort understanding intent, constraints, and edge cases before answering.',
      '- Structure the answer: conclusion first, then reasoning, then details/code.',
      '- Prefer correctness over speed. Call out uncertainties explicitly.',
      '- When coding, consider failure modes and a minimal verification step.',
    ].join('\n'),
  },
  plan: {
    temperature: 0.55,
    maxTokens: 12288,
    pipelineDepth: 'full',
    systemAddendum: [
      '',
      'PLAN MODE: Prefer architecture-first thinking. For large tasks Aura runs plan-then-implement automatically.',
      'Be concrete: files, APIs, data flow, risks, and verification. Avoid vague bullet poetry.',
    ].join('\n'),
  },
  max: {
    temperature: 0.7,
    maxTokens: 16384,
    pipelineDepth: 'full',
    systemAddendum: [
      '',
      'MAX MODE — highest quality:',
      '- Maximize depth, clarity, and completeness.',
      '- Consider alternatives, trade-offs, edge cases, and best practices.',
      '- Produce production-grade code/explanations; do not rush.',
    ].join('\n'),
  },
  bypass: {
    temperature: 0.85,
    maxTokens: 16384,
    pipelineDepth: 'none',
    systemAddendum: [
      '',
      'BYPASS MODE: Execute directly with tools. Skip permission theater and filler.',
      'Still verify tool results before claiming success. Never invent filesystem outcomes.',
    ].join('\n'),
  },
}

/** Mode-specific developer addendum, exported so the Context Budget Manager
 *  can fold it into its "Developer Prompt" section before assembly. */
export function getModeOverrides(mode: AIMode | EffectiveAIMode): ModeOverrides {
  const effective = mode === 'auto' ? 'think' : (mode as EffectiveAIMode)
  return MODE_OVERRIDES[effective] ?? MODE_OVERRIDES.think
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Budget Manager overrides (per mode)
// ─────────────────────────────────────────────────────────────────────────────
//
// Every pre-curated section (system prompt, memory, attachments, rules) is left
// UNTOUCHED — those are hand-written and bounded upstream. The manager exists to
// bound the one section that grew without limit: the CONVERSATION HISTORY, which
// was re-sent in full on every request. Old turns beyond the mode budget are
// folded into a compact summary; recent turns stay verbatim; the current user
// message is never touched. The ceilings are generous, so typical conversations
// are unaffected and only runaway histories get compressed.
const UNTOUCHED = Number.MAX_SAFE_INTEGER
const MODE_CONTEXT_BUDGET: Record<EffectiveAIMode, Partial<ContextBudget>> = {
  fast:     { system: UNTOUCHED, recentMessages: 4000,  conversationSummary: 1200, total: 10000 },
  balanced: { system: UNTOUCHED, recentMessages: 6000,  conversationSummary: 1800, total: 16000 },
  think:    { system: UNTOUCHED, recentMessages: 10000, conversationSummary: 2800, total: 28000 },
  plan:     { system: UNTOUCHED, recentMessages: 10000, conversationSummary: 2800, total: 28000 },
  max:      { system: UNTOUCHED, recentMessages: 14000, conversationSummary: 3600, total: 36000 },
  bypass:   { system: UNTOUCHED, recentMessages: 12000, conversationSummary: 3000, total: 32000 },
}

export function getModeAddendum(mode: AIMode): string {
  return getModeOverrides(mode).systemAddendum ?? ''
}

/**
 * Per-provider ceiling on max OUTPUT tokens.
 *
 * Providers bill rate limits as `input + max_tokens` per request. Groq's free
 * tier is 8,000 TPM, so a max_tokens of 32768 makes EVERY request request
 * ≥32,768 tokens → 413 "Request too large" regardless of how small the input
 * is (confirmed: Groq reported Requested 33198 = ~430 input + 32768 max_tokens).
 * Clamping keeps requested tokens under the provider's per-request TPM budget.
 */
const PROVIDER_MAX_OUTPUT: Partial<Record<string, number>> = {
  groq: 2048,
  cerebras: 2048,
}

export function clampMaxTokens(provider: string, requested: number): number {
  const ceiling = PROVIDER_MAX_OUTPUT[provider]
  if (!ceiling) return requested
  return Math.max(256, Math.min(ceiling, requested))
}

export const PROVIDER_BASE_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  moonshot: 'https://api.moonshot.ai/v1',
  zai: 'https://api.z.ai/api/paas/v4/',
  groq: 'https://api.groq.com/openai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  aura: '',
  openrouter: 'https://openrouter.ai/api/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
  localai: 'http://localhost:8080/v1',
  vllm: 'http://localhost:8000/v1',
  custom: '',
}

export const PROVIDER_PRESETS: ModelPreset[] = [
  { provider: 'anthropic', label: 'Claude Opus 4', modelId: 'claude-opus-4-8', baseURL: 'https://api.anthropic.com' },
  { provider: 'anthropic', label: 'Claude Sonnet 5', modelId: 'claude-sonnet-5', baseURL: 'https://api.anthropic.com' },
  { provider: 'anthropic', label: 'Claude Haiku 4.5', modelId: 'claude-haiku-4-5', baseURL: 'https://api.anthropic.com' },
  { provider: 'openai', label: 'GPT-4o', modelId: 'gpt-4o', baseURL: 'https://api.openai.com/v1' },
  { provider: 'openai', label: 'GPT-4o Mini', modelId: 'gpt-4o-mini', baseURL: 'https://api.openai.com/v1' },
  { provider: 'openai', label: 'o3', modelId: 'o3', baseURL: 'https://api.openai.com/v1' },
  { provider: 'moonshot', label: 'Kimi K2.6', modelId: 'kimi-k2.6', baseURL: 'https://api.moonshot.ai/v1' },
  { provider: 'moonshot', label: 'Kimi K2.5', modelId: 'kimi-k2.5', baseURL: 'https://api.moonshot.ai/v1' },
  { provider: 'zai', label: 'GLM-5.2', modelId: 'glm-5.2', baseURL: 'https://api.z.ai/api/paas/v4/' },
  { provider: 'groq', label: 'Llama 4 Maverick', modelId: 'llama-4-maverick', baseURL: 'https://api.groq.com/openai/v1' },
  { provider: 'groq', label: 'Llama 4 Scout', modelId: 'llama-4-scout', baseURL: 'https://api.groq.com/openai/v1' },
  { provider: 'groq', label: 'Qwen3 Coder', modelId: 'qwen3-coder', baseURL: 'https://api.groq.com/openai/v1' },
  { provider: 'cerebras', label: 'GPT OSS 120B', modelId: 'gpt-oss-120b', baseURL: 'https://api.cerebras.ai/v1' },
  { provider: 'openrouter', label: 'Qwen3 Coder', modelId: 'qwen/qwen3-coder', baseURL: 'https://openrouter.ai/api/v1' },
  { provider: 'openrouter', label: 'DeepSeek V4', modelId: 'deepseek/deepseek-v4', baseURL: 'https://openrouter.ai/api/v1' },
  { provider: 'openrouter', label: 'GPT OSS 120B', modelId: 'openai/gpt-oss-120b', baseURL: 'https://openrouter.ai/api/v1' },
  { provider: 'openrouter', label: 'Claude Opus 4.5', modelId: 'anthropic/claude-opus-4-5', baseURL: 'https://openrouter.ai/api/v1' },
  { provider: 'openrouter', label: 'Llama 4', modelId: 'meta-llama/llama-4', baseURL: 'https://openrouter.ai/api/v1' },
  { provider: 'openrouter', label: 'Nemotron', modelId: 'nvidia/nemotron', baseURL: 'https://openrouter.ai/api/v1' },
  { provider: 'nvidia', label: 'DeepSeek V4 Pro', modelId: 'deepseek/deepseek-v4-pro', baseURL: 'https://integrate.api.nvidia.com/v1' },
  { provider: 'nvidia', label: 'Nemotron 3 Ultra 550B', modelId: 'nvidia/nemotron-3-ultra-550b-a55b', baseURL: 'https://integrate.api.nvidia.com/v1' },
  { provider: 'nvidia', label: 'Nemotron 3 Super 120B', modelId: 'nvidia/nemotron-3-super-120b-a12b', baseURL: 'https://integrate.api.nvidia.com/v1' },
  { provider: 'gemini', label: 'Gemini 2.5 Pro', modelId: 'gemini-2.5-pro', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
  { provider: 'gemini', label: 'Gemini 2.5 Flash', modelId: 'gemini-2.5-flash', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
  { provider: 'ollama', label: 'Qwen 2.5', modelId: 'qwen2.5', baseURL: 'http://localhost:11434/v1' },
  { provider: 'ollama', label: 'DeepSeek R1', modelId: 'deepseek-r1', baseURL: 'http://localhost:11434/v1' },
  { provider: 'ollama', label: 'Llama 3.2', modelId: 'llama3.2', baseURL: 'http://localhost:11434/v1' },
  { provider: 'ollama', label: 'Mistral', modelId: 'mistral', baseURL: 'http://localhost:11434/v1' },
  { provider: 'lmstudio', label: 'Loaded Model', modelId: 'local-model', baseURL: 'http://localhost:1234/v1' },
  { provider: 'lmstudio', label: 'Qwen 2.5 Coder', modelId: 'qwen2.5-coder', baseURL: 'http://localhost:1234/v1' },
  { provider: 'lmstudio', label: 'DeepSeek Coder V2', modelId: 'deepseek-coder-v2', baseURL: 'http://localhost:1234/v1' },
  { provider: 'localai', label: 'GPT-4 Local', modelId: 'gpt-4', baseURL: 'http://localhost:8080/v1' },
  { provider: 'localai', label: 'Llama 3 Local', modelId: 'llama3', baseURL: 'http://localhost:8080/v1' },
  { provider: 'localai', label: 'Mistral Local', modelId: 'mistral', baseURL: 'http://localhost:8080/v1' },
  { provider: 'vllm', label: 'Served Model', modelId: 'default-model', baseURL: 'http://localhost:8000/v1' },
  { provider: 'vllm', label: 'Llama 4 Server', modelId: 'meta-llama/Llama-4', baseURL: 'http://localhost:8000/v1' },
  { provider: 'vllm', label: 'Qwen3 Server', modelId: 'Qwen/Qwen3', baseURL: 'http://localhost:8000/v1' },
]

const COST_PER_1M: Record<string, { input: number; output: number }> = {
  anthropic: { input: 15, output: 75 },
  openai: { input: 5, output: 15 },
  moonshot: { input: 0.95, output: 4 },
  zai: { input: 1.4, output: 4.4 },
  groq: { input: 0, output: 0 },
  cerebras: { input: 0, output: 0 },
  aura: { input: 0, output: 0 },
  openrouter: { input: 2, output: 6 },
  nvidia: { input: 3, output: 6 },
  gemini: { input: 1.25, output: 5 },
  ollama: { input: 0, output: 0 },
  lmstudio: { input: 0, output: 0 },
  localai: { input: 0, output: 0 },
  vllm: { input: 0, output: 0 },
  custom: { input: 0, output: 0 },
}

function estimateCost(provider: string, promptTokens: number, completionTokens: number): number {
  const rates = COST_PER_1M[provider] ?? COST_PER_1M.custom
  return (promptTokens * rates.input + completionTokens * rates.output) / 1_000_000
}

const PIPELINE_STAGES: PipelineStage[] = [
  'intent',
  'context',
  'memory',
  'planning',
  'tools',
  'execution',
  'review',
  'response',
]

export const STAGE_LABELS: Record<PipelineStage, string> = {
  intent: 'Intent Analysis',
  context: 'Context Retrieval',
  memory: 'Memory Retrieval',
  planning: 'Planning',
  tools: 'Tool Selection',
  execution: 'Execution',
  review: 'Self-Review',
  response: 'Final Response',
}

function buildPipeline(mode: EffectiveAIMode, hasMemory: boolean): PipelineStep[] {
  const depth = MODE_OVERRIDES[mode].pipelineDepth

  if (depth === 'none') {
    return [
      { stage: 'execution', status: 'active', summary: 'Processing request', timestamp: Date.now() },
      { stage: 'response', status: 'pending', timestamp: Date.now() },
    ]
  }

  return PIPELINE_STAGES.map(stage => {
    if (stage === 'memory' && !hasMemory) {
      return { stage, status: 'skipped', summary: 'No relevant memories', timestamp: Date.now() }
    }

    if (depth === 'light' && (stage === 'tools' || stage === 'review')) {
      return { stage, status: 'skipped', timestamp: Date.now() }
    }

    return { stage, status: 'pending', timestamp: Date.now() }
  })
}

function advancePipeline(steps: PipelineStep[], activeStage: PipelineStage): PipelineStep[] {
  const activeIndex = PIPELINE_STAGES.indexOf(activeStage)
  return steps.map(step => {
    const currentIndex = PIPELINE_STAGES.indexOf(step.stage)
    if (step.stage === activeStage) return { ...step, status: 'active', timestamp: Date.now() }
    if (currentIndex < activeIndex && step.status !== 'skipped') {
      return { ...step, status: 'complete', timestamp: Date.now() }
    }
    return step
  })
}

function normalizeAnthropicBaseURL(baseURL: string): string | undefined {
  const trimmed = baseURL.trim().replace(/\/$/, '')
  if (!trimmed || trimmed === 'https://api.anthropic.com') return undefined
  return trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed
}

function shouldOmitTemperature(provider: string, model: string): boolean {
  const normalizedModel = model.toLowerCase()
  return provider === 'moonshot' && (normalizedModel.startsWith('kimi-k2.5') || normalizedModel.startsWith('kimi-k2.6'))
}

function hasAuthorizationHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some(key => key.toLowerCase() === 'authorization')
}

function resolveChatCompletionsURL(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/$/, '')
  if (!trimmed) throw new Error('Base URL is required for a custom/company API.')
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed
  return `${trimmed}/chat/completions`
}

function appendQueryParameters(url: string, params: Record<string, string>): string {
  const next = new URL(url)
  for (const [key, value] of Object.entries(params)) {
    if (!key.trim()) continue
    next.searchParams.set(key, value)
  }
  return next.toString()
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload.trim()) return payload
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (record.error && typeof record.error === 'object') {
      const errorRecord = record.error as Record<string, unknown>
      if (typeof errorRecord.message === 'string' && errorRecord.message.trim()) return errorRecord.message
    }
    if (typeof record.message === 'string' && record.message.trim()) return record.message
  }
  return fallback
}

async function createCustomChatCompletion(
  config: AIConfig | APIProfile,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  signal: AbortSignal,
  stream: boolean,
  temperature: number,
  maxTokens: number
): Promise<Response> {
  if (!config.baseURL?.trim()) throw new Error('Base URL is required for a custom/company API.')
  if (!config.model?.trim()) throw new Error('Model is required for a custom/company API.')

  const extraHeaders = (config as APIProfile).customHeaders ?? (config as AIConfig).customHeaders ?? {}
  const queryParams = (config as APIProfile).queryParameters ?? {}
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  }

  if (config.apiKey && !hasAuthorizationHeader(headers)) {
    headers.Authorization = `Bearer ${config.apiKey}`
  }

  const url = appendQueryParameters(resolveChatCompletionsURL(config.baseURL), queryParams)
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: shouldOmitTemperature(config.provider, config.model) ? undefined : temperature,
      max_tokens: maxTokens,
      top_p: config.topP,
      stream,
    }),
    signal,
  })

  if (!response.ok) {
    const text = await response.text()
    let payload: unknown = text
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
    throw new Error(extractErrorMessage(payload, `${response.status} ${response.statusText}`))
  }

  return response
}

async function streamCustomOpenAICompat(
  config: AIConfig | APIProfile,
  messages: RendererMessage[],
  system: string,
  temperature: number,
  maxTokens: number,
  abortSignal: AbortSignal,
  callbacks: StreamCallbacks,
  debug?: DebugSection[],
  savePath?: string,
  images?: ImageAttachment[],
  capabilities?: ModelCapabilities
): Promise<void> {
  const caps = capabilities ?? getModelCapabilities(config.provider, config.model)
  const serialized = serializeProviderMessages({
    provider: config.provider,
    model: config.model,
    format: 'openai',
    capabilities: caps,
    messages,
    images,
  })

  const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    ...toOpenAIChatMessages(serialized.messages),
  ]

  debugRequestPayload({
    provider: config.provider,
    model: config.model,
    system,
    maxTokens,
    messages: openaiMessages.map(message => ({
      role: message.role,
      content: typeof message.content === 'string' ? message.content : '',
    })),
    sections: debug,
    savePath,
  })

  const response = await createCustomChatCompletion(config, openaiMessages, abortSignal, true, temperature, maxTokens)
  if (!response.body) throw new Error('Custom/company API did not return a response stream.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let lastModel: string | undefined
  const toolProtocol = new ToolProtocolSuppressor()

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })

    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)

      const data = chunk
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('')

      if (data && data !== '[DONE]') {
        const parsed = JSON.parse(data) as {
          model?: string
          choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>
        }
        lastModel = parsed.model ?? lastModel
        const delta = parsed.choices?.[0]?.delta?.content
          ?? parsed.choices?.[0]?.message?.content
          ?? ''
        if (delta) {
          const safe = toolProtocol.push(delta)
          if (safe) {
            text += safe
            callbacks.onToken(safe)
          }
        }
      }

      boundary = buffer.indexOf('\n\n')
    }

    if (done) break
    if (abortSignal.aborted) {
      callbacks.onAbort?.()
      return
    }
  }

  if (abortSignal.aborted) {
    callbacks.onAbort?.()
    return
  }

  callbacks.onDone(text, lastModel)
}

export function profileToConfig(profile: APIProfile, aiMode: AIMode): AIConfig {
  const effective = resolveEffectiveMode('', aiMode === 'auto' ? 'think' : aiMode)
  const overrides = getModeOverrides(effective)
  return {
    provider: profile.provider,
    apiKey: profile.apiKey,
    baseURL: profile.baseURL,
    model: profile.model,
    organizationId: profile.organizationId,
    customHeaders: profile.customHeaders,
    // Mode wins for behavior; profile still supplies provider/model identity.
    temperature: overrides.temperature,
    topP: profile.topP,
    maxTokens: overrides.maxTokens,
    streaming: profile.streaming,
    reasoningEffort: 'none',
    contextLength: profile.contextLength,
    aiMode,
    savedModels: [],
    activeProfileId: profile.id,
  }
}

export async function streamCompletion(
  config: AIConfig | APIProfile,
  messages: RendererMessage[],
  systemPrompt: string,
  abortSignal: AbortSignal,
  callbacks: StreamCallbacks,
  options?: {
    profile?: APIProfile
    hasMemory?: boolean
    taskType?: string
    /** Section decomposition of the system prompt, for the request-debug log. */
    debug?: DebugSection[]
    /**
     * Stable system-prompt prefix — identical across turns within a session.
     * On the Anthropic path it is sent as a cache_control block so repeat turns
     * are served from prompt cache at ~10% input cost with lower latency.
     * Volatile context (memory, attachments, conversation summary) is never
     * part of this prefix, otherwise it would invalidate the cache every turn.
     */
    stableSystem?: string
    /**
     * Tool calling: the model can request REAL operations (filesystem, web search, etc.).
     * executor receives (toolName, args) so main.ts can route to the correct handler.
     * extraTools is the full list of tool schemas to send to the model.
     */
    tools?: {
      enabled: boolean
      executor: (toolName: string, args: Record<string, unknown>) => Promise<string>
      extraTools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>
    }
    /** Image attachments to send as vision content on the last user message. */
    images?: ImageAttachment[]
  }
): Promise<void> {
  const selectedMode = (config as AIConfig).aiMode ?? 'auto'
  const lastUser = [...messages].reverse().find(message => message.role === 'user')?.content ?? ''
  const mode = resolveEffectiveMode(lastUser, selectedMode)
  const overrides = MODE_OVERRIDES[mode]
  // Mode controls depth/latency; do not let profile temp/tokens erase mode behavior.
  const temperature = overrides.temperature
  const maxTokens = clampMaxTokens(config.provider, overrides.maxTokens)
  const baseSystem = overrides.systemAddendum ? systemPrompt + overrides.systemAddendum : systemPrompt
  const hasMemory = options?.hasMemory ?? false

  // Resolve the model's capability set from the ACTUAL profile being used
  // (not the renderer's legacy config). Profile flags beat name heuristics.
  const capabilities = getModelCapabilities(config.provider, config.model, {
    visionSupport: options?.profile?.visionSupport,
    toolCalling: options?.profile?.toolCalling,
    streaming: options?.profile?.streaming,
  })

  // ── VISION GATE ────────────────────────────────────────────────────────────
  // A text-only model must NEVER receive image content — that is the exact
  // "400 messages[1].content must be a string" failure. When images are
  // attached but the model cannot see them, we skip the provider call and
  // surface a clean capability message instead of a malformed request.
  const images = options?.images ?? []
  if (images.length > 0 && !capabilities.vision) {
    const capabilityMessage = VISION_NOT_SUPPORTED_MESSAGE
    // eslint-disable-next-line no-console
    console.warn(`[vision] blocked: model ${config.model} (${config.provider}) has no vision support; ${images.length} image(s) not sent`)
    if (options?.profile) {
      addDevLog({
        type: 'response',
        profileId: options.profile.id,
        profileName: options.profile.displayName,
        provider: config.provider,
        model: config.model,
        latencyMs: 0,
        status: 'success',
        requestPreview: messages[messages.length - 1]?.content?.slice(0, 200) ?? '',
        responsePreview: capabilityMessage,
        mode,
        diagnostics: {
          kind: 'vision_capability_blocked',
          provider: config.provider,
          model: config.model,
          images: images.map(image => ({ mimeType: image.mimeType, size: image.size ?? 0 })),
          message: capabilityMessage,
        },
      })
    }
    callbacks.onDone(capabilityMessage)
    return
  }

  let apiMessages = messages.filter(message => message.role !== 'system')

  // ── Context Budget Manager ─────────────────────────────────────────────────
  // Bounds the conversation history — the one section that grew without limit
  // (every turn re-sent ALL previous turns verbatim). The system prompt itself
  // is pre-curated and left untouched; older turns beyond the mode budget are
  // folded into a compact "Conversation summary" inside the system block while
  // recent turns stay verbatim. The current user message is never moved, so the
  // request at hand is always preserved in full.
  let system = baseSystem
  if (apiMessages.length > 0) {
    const assembled = assemblePrompt({
      systemPrompt: baseSystem,
      messages: apiMessages,
      budget: MODE_CONTEXT_BUDGET[mode] ?? MODE_CONTEXT_BUDGET.think,
    })
    system = assembled.system
    // Anthropic requires the first message to be a user turn; the summary
    // already carries the gist of any boundary assistant turn.
    apiMessages = assembled.messages[0]?.role === 'assistant'
      ? assembled.messages.slice(1)
      : assembled.messages
    if (assembled.actions.droppedMessages > 0 || assembled.actions.steps.length > 0) {
      logTokenInspector(assembled, config.provider, config.model)
    }
  }

  let pipeline = buildPipeline(mode, hasMemory)
  callbacks.onPipeline?.(advancePipeline(pipeline, 'intent'))

  // For plan / think / max, show planning then move into execution for the live stream.
  if (mode === 'plan' || mode === 'think' || mode === 'max') {
    pipeline = advancePipeline(pipeline, 'planning')
    callbacks.onPipeline?.(pipeline)
  }
  pipeline = advancePipeline(pipeline, 'execution')
  callbacks.onPipeline?.(pipeline)

  const startTime = Date.now()
  const profile = options?.profile
  const provider = config.provider
  const latestRequest = apiMessages[apiMessages.length - 1]?.content?.slice(0, 200) ?? ''

  try {
    const debugSections = options?.debug
    const savePath = path.join(app.getPath('userData'), 'request-debug.json')

    if (provider === 'anthropic') {
      await streamAnthropic(config, apiMessages, system, temperature, maxTokens, abortSignal, callbacks, debugSections, savePath, options?.stableSystem, images, capabilities)
    } else if (profile && isAuraManagedProfile(profile)) {
      ensureEnvLoaded()
      await streamAuraManaged(
        profile,
        mode,
        apiMessages,
        system,
        temperature,
        maxTokens,
        abortSignal,
        callbacks,
        debugSections,
        savePath,
        options?.tools,
        images,
        capabilities
      )
    } else {
      await streamOpenAICompat(config, apiMessages, system, temperature, maxTokens, abortSignal, callbacks, debugSections, savePath, options?.tools, images, capabilities)
    }

    if (profile) {
      pipeline = advancePipeline(pipeline, 'response')
      callbacks.onPipeline?.(pipeline)
      addDevLog({
        type: 'response',
        profileId: profile.id,
        profileName: profile.displayName,
        provider: isAuraManagedProfile(profile) ? AURA_MODEL_IDENTITY.displayProvider : profile.provider,
        model: isAuraManagedProfile(profile) ? AURA_MODEL_IDENTITY.modelName : config.model,
        latencyMs: Date.now() - startTime,
        status: 'success',
        requestPreview: latestRequest,
        responsePreview: '',
        mode,
      })
    }
  } catch (error) {
    if (abortSignal.aborted) {
      callbacks.onAbort?.()
      if (profile) {
        addDevLog({
          type: 'error',
          profileId: profile.id,
          profileName: profile.displayName,
          provider: profile.provider,
          model: config.model,
          latencyMs: Date.now() - startTime,
          status: 'aborted',
          requestPreview: latestRequest,
          responsePreview: '',
          mode,
        })
      }
      return
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    // Never surface raw provider internals ("failed_generation", tool schemas,
    // service tiers) in a normal chat. Sanitize user-facing text; the raw
    // message is preserved in the dev log for Developer Mode.
    const sanitized = sanitizeProviderError(error)
    callbacks.onError(new Error(sanitized.message))

    if (profile) {
      addDevLog({
        type: 'error',
        profileId: profile.id,
        profileName: profile.displayName,
        provider: profile.provider,
        model: config.model,
        latencyMs: Date.now() - startTime,
        status: 'error',
        errorMessage,
        requestPreview: latestRequest,
        responsePreview: '',
        mode,
        diagnostics: isToolCallParseError(error)
          ? {
              kind: 'tool_call_parse_failure',
              provider: config.provider,
              model: config.model,
              toolCallFormat: 'openai-compatible tool_calls',
              parseFailure: errorMessage,
              retryPath: 'Aura-controlled web search fallback (web_search executed by Aura, results injected)',
            }
          : isRateLimitError(error)
            ? {
                kind: 'rate_limit',
                provider: config.provider,
                model: config.model,
                error: errorMessage,
                retryPath: 'single 6s backoff retry, then sanitized error',
              }
            : undefined,
      })
    }
  }
}

/**
 * Anthropic `system` parameter with prompt caching. The stable prefix (identity,
 * rules, capability list) is byte-identical across turns, so it is marked
 * cache_control: ephemeral — repeat turns are served from cache at ~10% input
 * cost and lower latency. Volatile context (memory, attachments, conversation
 * summary) stays in a plain second block so it never invalidates the cached
 * prefix. Caching engages above the provider's minimum cacheable length
 * (1024 tokens on Sonnet/Opus-class models); below that it's a harmless no-op.
 */
function buildAnthropicSystem(system: string, stableSystem?: string): Anthropic.TextBlockParam[] {
  if (!stableSystem) return [{ type: 'text', text: system }]
  const blocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: stableSystem, cache_control: { type: 'ephemeral' } },
  ]
  // Defensive: only treat `system`'s remainder as volatile when stableSystem is
  // a genuine prefix of it.
  const volatile = system.startsWith(stableSystem) ? system.slice(stableSystem.length) : system
  if (volatile) blocks.push({ type: 'text', text: volatile })
  return blocks
}

async function streamAnthropic(
  config: AIConfig | APIProfile,
  messages: RendererMessage[],
  system: string,
  temperature: number,
  maxTokens: number,
  abortSignal: AbortSignal,
  callbacks: StreamCallbacks,
  debug?: DebugSection[],
  savePath?: string,
  stableSystem?: string,
  images?: ImageAttachment[],
  capabilities?: ModelCapabilities
): Promise<void> {
  const extraHeaders = (config as APIProfile).customHeaders ?? (config as AIConfig).customHeaders ?? {}
  const queryParams = (config as APIProfile).queryParameters ?? {}

  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: normalizeAnthropicBaseURL(config.baseURL),
    timeout: (config as APIProfile).timeout ?? 10 * 60 * 1000,
    maxRetries: (config as APIProfile).retryCount ?? 2,
    defaultHeaders: extraHeaders,
  })

  let text = ''
  let thinking = ''
  const toolProtocol = new ToolProtocolSuppressor()

  const caps = capabilities ?? getModelCapabilities(config.provider, config.model)
  const serialized = serializeProviderMessages({
    provider: config.provider,
    model: config.model,
    format: 'anthropic',
    capabilities: caps,
    messages,
    images,
  })

  const anthropicMessages = serialized.messages.map(message => ({
    role: message.role as 'user' | 'assistant',
    content: message.content as string | Anthropic.ContentBlockParam[],
  }))

  // Instrumentation: print the complete payload + FINAL REQUEST TOKENS, and
  // write request-debug.json before the request goes out.
  debugRequestPayload({
    provider: config.provider,
    model: config.model,
    system,
    maxTokens,
    messages: anthropicMessages,
    sections: debug,
    savePath,
  })

  const stream = client.messages.stream(
    {
      model: config.model,
      max_tokens: maxTokens,
      temperature,
      system: buildAnthropicSystem(system, stableSystem),
      messages: anthropicMessages,
      ...queryParams,
    },
    { signal: abortSignal }
  )

  for await (const event of stream) {
    if (abortSignal.aborted) break
    if (event.type !== 'content_block_delta') continue

    if (event.delta.type === 'text_delta') {
      const safe = toolProtocol.push(event.delta.text)
      if (safe) {
        text += safe
        callbacks.onToken(safe)
      }
    }

    if (event.delta.type === 'thinking_delta') {
      thinking += event.delta.thinking
      callbacks.onThinking?.(event.delta.thinking)
    }
  }

  if (abortSignal.aborted) {
    callbacks.onAbort?.()
    return
  }

  const final = await stream.finalMessage()
  callbacks.onDone(text || thinking, final.model, {
    input: final.usage.input_tokens,
    output: final.usage.output_tokens,
    total: final.usage.input_tokens + final.usage.output_tokens,
  })
}

/**
 * Last user-visible text in the (OpenAI-shaped) message list, across both
 * string and multi-part (vision) content.
 */
function lastUserText(messages: Array<{ role: string; content?: unknown }>): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    const content = message.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter(part => typeof part === 'object' && part !== null && (part as { type?: string }).type === 'text' && typeof (part as { text?: unknown }).text === 'string')
        .map(part => (part as { text: string }).text)
        .join(' ')
    }
  }
  return ''
}

/**
 * AURA-CONTROLLED WEB-SEARCH FALLBACK.
 *
 * When a provider rejects its own model output as unparseable (Groq gpt-oss
 * family: "Parsing failed … failed_generation" / "Failed to parse tool call
 * arguments as JSON"), Aura does NOT retry the same fragile tool syntax. It
 * performs the search itself through the real executor and injects the results
 * into the conversation so the model can still answer. Returns false only when
 * the search itself fails (then the caller surfaces a sanitized error).
 */
async function runWebSearchFallback(
  executor: (toolName: string, args: Record<string, unknown>) => Promise<string>,
  query: string,
  openaiMessages: Array<{ role: string; content?: unknown }>,
  provider: string,
  model: string
): Promise<boolean> {
  // eslint-disable-next-line no-console
  console.warn(`[tool-fallback] provider=${provider} model=${model} — model output unparseable; Aura performs the search directly (query="${query}")`)
  try {
    const result = await executor('web_search', { query: query || 'web search' })
    openaiMessages.push({
      role: 'user',
      content:
        'Aura performed a REAL web search for you because the previous model output could not be parsed. ' +
        'Do NOT call web_search again. Use these REAL results to answer the user\'s question:\n\n' +
        `${result}\n\n` +
        'Give a concise, honest answer with sources. Only call read_webpage if you need more detail on a specific URL.',
    })
    return true
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[tool-fallback] web_search executor failed:', error)
    return false
  }
}

/**
 * Register the web tool schemas into the active `request.tools` so later tool
 * rounds can call them legitimately. Used after the Aura-controlled fallback:
 * the fallback may run precisely because web tools were NOT registered for this
 * request, and re-registering them lets the model follow up (e.g. read_webpage)
 * without hitting the same "not in request.tools" wall again.
 */
function ensureWebToolsRegistered(toolsSchema: OpenAI.Chat.ChatCompletionTool[] | undefined): void {
  if (!toolsSchema) return
  for (const tool of [WEB_SEARCH_TOOL, READ_PAGE_TOOL, WEB_RESEARCH_TOOL]) {
    const name = tool.function.name
    const already = toolsSchema.some(existing =>
      (existing as { function?: { name?: string } }).function?.name === name
    )
    if (!already) toolsSchema.push(tool as OpenAI.Chat.ChatCompletionTool)
  }
}

/**
 * Aura Model identity: Cerebras primary → Groq fallback.
 * Failover only when the primary fails BEFORE meaningful streamed output.
 * Same request context (system, history, tools) is reused — no UI reset.
 */
async function streamAuraManaged(
  profile: APIProfile,
  aiMode: AIMode,
  messages: RendererMessage[],
  system: string,
  temperature: number,
  maxTokens: number,
  abortSignal: AbortSignal,
  callbacks: StreamCallbacks,
  debug?: DebugSection[],
  savePath?: string,
  tools?: {
    enabled: boolean
    executor: (toolName: string, args: Record<string, unknown>) => Promise<string>
    extraTools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>
  },
  images?: ImageAttachment[],
  capabilities?: ModelCapabilities
): Promise<void> {
  const base = profileToAuraBaseConfig(profile, aiMode)
  const chain = resolveAuraBackendChain()
  if (chain.length === 0) {
    throw new Error('Aura is not configured. Add OPENROUTER_API_KEY, CEREBRAS_API_KEY, or GROQ_API_KEY.')
  }

  let lastError: unknown

  for (let index = 0; index < chain.length; index += 1) {
    const backend = chain[index]
    const isLast = index === chain.length - 1
    const streamConfig = backendToStreamConfig(backend, base)
    const wireMaxTokens = clampMaxTokens(backend.provider, maxTokens)
    let tokensSent = false

    auraLog(index === 0 ? 'primary provider request' : 'failover completed', backend.id)

    const wrapped: StreamCallbacks = {
      ...callbacks,
      onToken: token => {
        tokensSent = true
        callbacks.onToken(token)
      },
      onThinking: thinking => {
        tokensSent = true
        callbacks.onThinking?.(thinking)
      },
      onDone: (text, _model, usage) => {
        callbacks.onDone(text, AURA_MODEL_IDENTITY.modelName, usage)
      },
      // Errors are handled by the loop — do not surface mid-failover.
      onError: error => {
        lastError = error
      },
    }

    try {
      await streamOpenAICompat(
        streamConfig,
        messages,
        system,
        temperature,
        wireMaxTokens,
        abortSignal,
        wrapped,
        debug,
        savePath,
        tools,
        images,
        capabilities,
        {
          skipRateLimitRetry: true,
          publicModelName: AURA_MODEL_IDENTITY.modelName,
        }
      )
      if (abortSignal.aborted) return
      return
    } catch (error) {
      if (abortSignal.aborted) {
        callbacks.onAbort?.()
        return
      }
      lastError = error

      // Already streamed meaningful output — do not restart through fallback.
      if (tokensSent) throw error

      const transient = isTransientProviderFailure(error)
      if (!transient || isLast) throw error

      const cooldown = extractRetryAfterMs(error)
      markProviderUnhealthy(backend.id, error instanceof Error ? error.message : String(error), cooldown)
      auraLog('primary temporarily unavailable', backend.id)
      lastError = undefined
      // Immediately try the next backend — no sleep / setTimeout.
    }
  }

  if (lastError) throw lastError
  throw new Error('Aura is temporarily unavailable. Please try again in a moment.')
}

async function streamOpenAICompat(
  config: AIConfig | APIProfile,
  messages: RendererMessage[],
  system: string,
  temperature: number,
  maxTokens: number,
  abortSignal: AbortSignal,
  callbacks: StreamCallbacks,
  debug?: DebugSection[],
  savePath?: string,
  tools?: {
    enabled: boolean
    executor: (toolName: string, args: Record<string, unknown>) => Promise<string>
    extraTools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>
  },
  images?: ImageAttachment[],
  capabilities?: ModelCapabilities,
  streamOpts?: {
    /** When true, skip same-provider 3s rate-limit retry so Aura can fail over immediately. */
    skipRateLimitRetry?: boolean
    /** Override the model id reported to onDone (Aura Model identity). */
    publicModelName?: string
  }
): Promise<void> {
  if (config.provider === 'custom') {
    await streamCustomOpenAICompat(config, messages, system, temperature, maxTokens, abortSignal, callbacks, debug, savePath, images, capabilities)
    return
  }

  const defaultHeaders: Record<string, string> = {}

  if (config.provider === 'openrouter') {
    defaultHeaders['HTTP-Referer'] = 'https://aura.ai'
    defaultHeaders['X-Title'] = 'Aura'
  }

  const extraHeaders = (config as APIProfile).customHeaders ?? (config as AIConfig).customHeaders ?? {}
  const queryParams = (config as APIProfile).queryParameters ?? {}

  const client = new OpenAI({
    apiKey: config.apiKey || (['ollama', 'lmstudio', 'localai', 'vllm'].includes(config.provider) ? 'ollama' : 'missing-api-key'),
    baseURL: config.baseURL,
    organization: (config as AIConfig).organizationId || (config as APIProfile).organizationId || undefined,
    defaultHeaders: { ...defaultHeaders, ...extraHeaders },
    timeout: (config as APIProfile).timeout ?? 60 * 1000,
    // Fail fast on rate limits — the SDK's exponential backoff is what turns a
    // quick 429 into a multi-minute hang.
    maxRetries: 0,
  })

  // VISION: the message adapter converts the LAST user message into provider
  // multimodal format (image_url parts) ONLY when the model supports vision.
  // Text-only requests stay `content: "..."` — never array-wrapped.
  const caps = capabilities ?? getModelCapabilities(config.provider, config.model, {
    visionSupport: (config as APIProfile).visionSupport,
    toolCalling: (config as APIProfile).toolCalling,
    streaming: (config as APIProfile).streaming,
  })
  const serialized = serializeProviderMessages({
    provider: config.provider,
    model: config.model,
    format: 'openai',
    capabilities: caps,
    messages,
    images,
  })
  if (serialized.embeddedImages > 0 || serialized.droppedImages.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[vision] model=${config.model} vision=${caps.vision} embedded=${serialized.embeddedImages}/${images?.length ?? 0} dropped=${serialized.droppedImages.map(d => `${d.name}:${d.reason}`).join(', ') || 'none'}`)
  }

  const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    ...toOpenAIChatMessages(serialized.messages),
  ]

  const toolsEnabled = tools?.enabled === true
  // Use extraTools if provided (multi-tool: workspace + web search etc.),
  // otherwise fall back to the single workspace tool.
  const toolsSchema: OpenAI.Chat.ChatCompletionTool[] | undefined = toolsEnabled
    ? ((tools?.extraTools && tools.extraTools.length > 0 ? tools.extraTools : [WORKSPACE_FILE_TOOL]) as OpenAI.Chat.ChatCompletionTool[])
    : undefined

  let finalText = ''
  let lastModel: string | undefined
  let fallbackUsed = false
  let rateLimitedOnce = false
  let finalAnswerRetried = false
  // Set once when a provider rejects a multimodal payload and Aura retries
  // text-only (see the schema-error branch below).
  let visionDropped = false
  const webSearchAvailable = Boolean(
    tools?.extraTools?.some(tool => tool.function?.name === 'web_search')
  )

  // Tool-calling loop: the model may request REAL operations (filesystem, web
  // search). Each round executes them and feeds the results back. Providers
  // that cannot reliably emit tool calls (Groq gpt-oss family) are handled by
  // Aura-controlled fallbacks instead of surfacing "parsing failed".
  const MAX_TOOL_ROUNDS = 3
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const roundStart = Date.now()
    // Self-pacing: keep `input + max_tokens` inside the provider's per-minute
    // token budget so a big request doesn't 429 and then burn the window on a
    // retry (see tokenBudget.ts). max_tokens is shrunk only when the window is
    // tight, so full-length answers are preserved whenever there is headroom.
    const wireMaxTokens = await reserveBudget(config.provider, openaiMessages, maxTokens, abortSignal, () => {
      callbacks.onAbort?.()
    })
    if (wireMaxTokens === null) return // aborted while waiting for budget
    // Reject malformed message structures internally — never send a payload a
    // strict provider would bounce with "content must be a string".
    assertValidOpenAIMessages(openaiMessages)
    const completionParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      model: config.model,
      messages: openaiMessages,
      temperature: shouldOmitTemperature(config.provider, config.model) ? undefined : temperature,
      max_tokens: wireMaxTokens,
      top_p: config.topP,
      stream: true,
      ...(toolsSchema ? { tools: toolsSchema } : {}),
      ...queryParams,
    }

    debugRequestPayload({
      provider: config.provider,
      model: config.model,
      system,
      maxTokens,
      messages: openaiMessages.map(message => ({
        role: message.role,
        content: typeof message.content === 'string' ? message.content : '',
      })),
      sections: debug,
      savePath,
    })

    let stream: any = null
    try {
      stream = await client.chat.completions.create(completionParams, { signal: abortSignal })
    } catch (error) {
      if (abortSignal.aborted) {
        callbacks.onAbort?.()
        return
      }
      // The provider rejected a MULTIMODAL payload — the exact "400
      // messages[1].content must be a string" failure Aura hit with image
      // requests against a text-only (or strict OpenAI-compatible) backend.
      // Drop the images and retry text-only so the user gets a graceful
      // capability message instead of a raw schema error (and normal text chat
      // is never affected).
      if (isContentSchemaError(error) && serialized.embeddedImages > 0 && !visionDropped) {
        visionDropped = true
        // eslint-disable-next-line no-console
        console.warn(`[vision] ${config.provider}/${config.model} rejected multimodal content — retrying text-only`)
        const textOnly = serializeProviderMessages({
          provider: config.provider,
          model: config.model,
          format: 'openai',
          capabilities: caps,
          messages,
          images: [],
        })
        openaiMessages.length = 0
        openaiMessages.push(
          { role: 'system', content: system },
          ...toOpenAIChatMessages(textOnly.messages),
          { role: 'user', content: VISION_NOT_SUPPORTED_MESSAGE }
        )
        continue
      }
      // The provider either rejected its own model output as unparseable, or
      // rejected the tool call because the tool wasn't in request.tools. In
      // both cases Aura performs the web search ITSELF and injects the REAL
      // results so the user still gets an answer instead of a dead end.
      const toolFallbackNeeded =
        (isToolCallParseError(error) && webSearchAvailable) ||
        isWebToolValidationError(error)
      if (toolFallbackNeeded && tools && !fallbackUsed) {
        fallbackUsed = true
        const query = deriveSearchQuery(lastUserText(openaiMessages))
        if (await runWebSearchFallback(tools.executor, query, openaiMessages, config.provider, config.model)) {
          ensureWebToolsRegistered(toolsSchema)
          continue
        }
      }
      // 429 / tokens-per-minute / tokens-per-day → one short retry, then a
      // clean sanitized error. Skipped for Aura managed failover so Cerebras
      // 429 immediately starts Groq with zero artificial delay.
      if (isRateLimitError(error) && !rateLimitedOnce && !streamOpts?.skipRateLimitRetry) {
        rateLimitedOnce = true
        // eslint-disable-next-line no-console
        console.warn(`[rate-limit] ${config.provider}/${config.model} — waiting 3s before a single retry`)
        await new Promise(resolve => setTimeout(resolve, 3000))
        if (abortSignal.aborted) {
          callbacks.onAbort?.()
          return
        }
        round -= 1 // re-run this round with the same payload
        continue
      }
      throw error
    }

    let text = ''
    // Tool-protocol JSON (tool-call args / tool-result echoes that some models
    // stream as text) is diverted from the visible assistant stream. Structured
    // tool_calls still drive execution; only the redundant JSON echo is removed.
    const toolProtocol = new ToolProtocolSuppressor()
    const toolCalls = new Map<number, { index: number; id: string; name: string; arguments: string }>()
    try {
      for await (const chunk of stream) {
        if (abortSignal.aborted) break
        const delta = chunk.choices[0]?.delta
        if (delta?.content) {
          const safe = toolProtocol.push(delta.content)
          if (safe) {
            text += safe
            callbacks.onToken(safe)
          }
        }
        if (delta?.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index ?? 0
            let call = toolCalls.get(index)
            if (!call) {
              call = { index, id: '', name: '', arguments: '' }
              toolCalls.set(index, call)
            }
            if (toolCall.id) call.id = toolCall.id
            if (toolCall.function?.name) call.name = toolCall.function.name
            if (toolCall.function?.arguments) call.arguments += toolCall.function.arguments
          }
        }
        if (chunk.model) lastModel = chunk.model
      }
    } catch (error) {
      if (abortSignal.aborted) {
        callbacks.onAbort?.()
        return
      }
      // Same fallback as above for errors that surface mid-stream.
      const toolFallbackNeeded =
        (isToolCallParseError(error) && webSearchAvailable) ||
        isWebToolValidationError(error)
      if (toolFallbackNeeded && tools && !fallbackUsed) {
        fallbackUsed = true
        const query = deriveSearchQuery(lastUserText(openaiMessages))
        if (await runWebSearchFallback(tools.executor, query, openaiMessages, config.provider, config.model)) {
          ensureWebToolsRegistered(toolsSchema)
          continue
        }
      }
      throw error
    }

    if (abortSignal.aborted) {
      callbacks.onAbort?.()
      return
    }

    finalText += text

    // eslint-disable-next-line no-console
    console.log(`[perf] tool round ${round + 1}: ${Date.now() - roundStart}ms, toolCalls=${toolCalls.size}, text=${text.length}`)

    // The model finished WITHOUT calling a tool. If it also produced no text
    // (reasoning-only output — common on Groq gpt-oss), nudge it once to answer.
    if (toolCalls.size === 0) {
      if (!text.trim() && !finalAnswerRetried && !abortSignal.aborted) {
        finalAnswerRetried = true
        // eslint-disable-next-line no-console
        console.warn('[empty-reply] model produced no text and no tool call — requesting a direct answer')
        openaiMessages.push({ role: 'user', content: 'Give your final answer now — be direct and concise. Do not call any tools.' })
        continue
      }
      break
    }

    // Execute the requested operations and feed the results back. The RAW
    // arguments string is echoed verbatim in the assistant message (OpenAI-compat
    // requires byte-identical replay); normalized arguments drive execution.
    const calls = [...toolCalls.values()]
    openaiMessages.push({
      role: 'assistant',
      content: null,
      tool_calls: calls.map(call => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    })

    for (const call of calls) {
      const normalized = normalizeToolCall(call)
      const args: Record<string, unknown> = normalized?.arguments ?? { _parseError: call.arguments }
      let result: string
      try {
        result = tools ? await tools.executor(call.name, args) : '{"success":false,"error":"tools disabled"}'
      } catch (error) {
        result = JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'tool execution failed' })
      }
      callbacks.onTool?.(call.name, args, result)
      openaiMessages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
  }

  // Tool rounds exhausted but the model still produced no text (reasoning-only
  // across every round). Force one plain, tool-free answer so the user always
  // gets a reply instead of silence.
  if (finalText.trim() === '' && !finalAnswerRetried && !abortSignal.aborted) {
    finalAnswerRetried = true
    // eslint-disable-next-line no-console
    console.warn('[empty-reply] tool rounds exhausted with no text — requesting a direct answer')
    openaiMessages.push({ role: 'user', content: 'Give your final answer now — be direct and concise. Do not call any tools.' })
    try {
      const finalMaxTokens = await reserveBudget(config.provider, openaiMessages, maxTokens, abortSignal, () => {
        callbacks.onAbort?.()
      })
      if (finalMaxTokens === null) return // aborted while waiting for budget
      assertValidOpenAIMessages(openaiMessages)
      const stream = await client.chat.completions.create({
        model: config.model,
        messages: openaiMessages,
        temperature: shouldOmitTemperature(config.provider, config.model) ? undefined : temperature,
        max_tokens: finalMaxTokens,
        top_p: config.topP,
        stream: true,
        ...queryParams,
      }, { signal: abortSignal })
      for await (const chunk of stream) {
        if (abortSignal.aborted) break
        const delta = chunk.choices?.[0]?.delta
        if (delta?.content) {
          finalText += delta.content
          callbacks.onToken(delta.content)
        }
        if (chunk.model) lastModel = chunk.model
      }
    } catch (error) {
      if (!abortSignal.aborted) {
        // eslint-disable-next-line no-console
        console.warn('[empty-reply] final answer round failed:', error instanceof Error ? error.message : error)
      }
    }
  }

  callbacks.onDone(finalText, streamOpts?.publicModelName ?? lastModel)
}

export async function testConnection(config: AIConfig | APIProfile): Promise<TestConnectionResult> {
  const start = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  const provider = config.provider
  const apiKey = config.apiKey
  const baseURL = config.baseURL
  const model = config.model

  let availableModels: string[] | undefined
  let supportsStreaming = false
  let supportsToolCalling = false
  let supportsVision = false

  try {
    if (provider === 'custom') {
      if (!baseURL?.trim()) {
        clearTimeout(timeout)
        return { success: false, error: 'Base URL is required for a custom/company API.' }
      }
      if (!model?.trim()) {
        clearTimeout(timeout)
        return { success: false, error: 'Model is required for a custom/company API.' }
      }

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'user', content: 'Say "ok"' },
      ]

      const response = await createCustomChatCompletion(config, messages, controller.signal, false, 0.2, 16)
      const payload = await response.json() as {
        model?: string
        choices?: Array<{ message?: { content?: string } }>
      }

      try {
        const streamResponse = await createCustomChatCompletion(
          config,
          [{ role: 'user', content: 'Reply with ok' }],
          controller.signal,
          true,
          0.2,
          16
        )

        if (streamResponse.body) {
          const reader = streamResponse.body.getReader()
          const firstChunk = await reader.read()
          supportsStreaming = Boolean(firstChunk.value && firstChunk.value.length > 0)
          await reader.cancel()
        }
      } catch {
        supportsStreaming = false
      }

      supportsToolCalling = true
      supportsVision = getModelCapabilities(provider, model).vision

      clearTimeout(timeout)
      return {
        success: true,
        latencyMs: Date.now() - start,
        model: payload.model || model,
        supportsStreaming,
        supportsToolCalling,
        supportsVision,
      }
    }

    if (provider === 'anthropic') {
      const client = new Anthropic({
        apiKey,
        baseURL: normalizeAnthropicBaseURL(baseURL),
        timeout: 15000,
        maxRetries: 0,
      })

      const response = await client.messages.create(
        {
          model,
          max_tokens: 5,
          messages: [{ role: 'user', content: 'Say "ok"' }],
        },
        { signal: controller.signal }
      )

      try {
        const stream = await client.messages.create(
          {
            model,
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Hi' }],
            stream: true,
          },
          { signal: controller.signal }
        )

        for await (const event of stream) {
          if (event.type === 'content_block_delta') {
            supportsStreaming = true
            break
          }
        }
      } catch {
        supportsStreaming = false
      }

      supportsToolCalling = true
      supportsVision = getModelCapabilities(provider, model).vision

      clearTimeout(timeout)
      return {
        success: true,
        latencyMs: Date.now() - start,
        model: response.model,
        supportsStreaming,
        supportsToolCalling,
        supportsVision,
      }
    }

    const client = new OpenAI({
      apiKey: apiKey || 'ollama',
      baseURL,
      organization: (config as AIConfig).organizationId || undefined,
      defaultHeaders: (config as AIConfig).customHeaders,
      timeout: 15000,
      maxRetries: 0,
    })

    if (['ollama', 'lmstudio', 'localai', 'vllm'].includes(provider)) {
      try {
        const modelsList = await client.models.list()
        availableModels = modelsList.data.map(item => item.id)
      } catch {
        availableModels = undefined
      }
    }

    const testModel =
      availableModels && availableModels.length > 0 && (!model || model === 'local-model' || model === 'default-model')
        ? availableModels[0]
        : model

    const response = await client.chat.completions.create(
      { model: testModel, messages: [{ role: 'user', content: 'Say "ok"' }], max_tokens: 5 },
      { signal: controller.signal }
    )

    try {
      const stream = await client.chat.completions.create(
        { model: testModel, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10, stream: true },
        { signal: controller.signal }
      )
      for await (const chunk of stream) {
        if (chunk.choices[0]?.delta?.content) {
          supportsStreaming = true
          break
        }
      }
    } catch {
      supportsStreaming = false
    }

    const capabilityFlags = getModelCapabilities(provider, testModel)
    supportsToolCalling = capabilityFlags.tools
    supportsVision = capabilityFlags.vision

    clearTimeout(timeout)
    return {
      success: true,
      latencyMs: Date.now() - start,
      model: response.model || testModel,
      supportsStreaming,
      supportsToolCalling,
      supportsVision,
      availableModels,
    }
  } catch (error) {
    clearTimeout(timeout)
    const message = error instanceof Error ? error.message : 'Unknown error'

    if (message.includes('401') || message.includes('403') || message.toLowerCase().includes('authentication')) {
      return { success: false, error: 'Authentication failed. Check your API key.' }
    }
    if (message.includes('404') || message.toLowerCase().includes('not found')) {
      return { success: false, error: 'Model or endpoint not found. Check model name and base URL.' }
    }
    if (message.includes('ECONNREFUSED') || message.toLowerCase().includes('fetch')) {
      return { success: false, error: 'Connection refused. Check if the server is running.' }
    }
    if (message.toLowerCase().includes('timeout') || message.toLowerCase().includes('aborted')) {
      return { success: false, error: 'Connection timeout. The server took too long to respond.' }
    }

    return { success: false, error: message }
  }
}

export { estimateCost }
