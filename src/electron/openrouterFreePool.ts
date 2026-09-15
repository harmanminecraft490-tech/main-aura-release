/**
 * OPENROUTER FREE POOL — STREAMING EXECUTOR
 *
 * Executes streaming chat completions through the OpenRouter free model pool.
 * Handles:
 *   - Intelligent model selection via openrouterRouter
 *   - Automatic fallback on failure
 *   - Health tracking
 *   - Tool-call normalization
 *   - Context-efficient prompting
 *   - Rate limiting / 429 handling
 *   - Timeout and cancellation
 *
 * Security: OPENROUTER_API_KEY stays in this module (main process only).
 * Never sent to renderer, never logged.
 */

import * as https from 'https'
import type { FreeModel } from './openrouterFreeModels'
import { discoverFreeModels, getCachedFreeModels, OPENROUTER_FREE_ROUTER_ID } from './openrouterFreeModels'
import {
  recordRequest,
  recordSuccess,
  recordFailure,
  recordToolCallSuccess,
  isModelHealthy,
} from './openrouterModelHealth'
import {
  routeRequest,
  getNextFallback,
  buildTaskContext,
  type RoutingDecision,
} from './openrouterRouter'
import { normalizeToolCall } from './toolCallNormalizer'
import { ensureEnvLoaded } from './aiConfig'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const REQUEST_TIMEOUT_MS = 90_000
const MAX_RETRIES = 5
const MAX_OUTPUT_TOKENS = 32768
const MAX_CONTEXT_CHARS = 80_000 // ~20k tokens

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FreePoolMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface FreePoolCallbacks {
  onToken: (token: string) => void
  onThinking?: (thinking: string) => void
  onDone: (text: string, modelId?: string) => void
  onError: (error: Error) => void
  onAbort?: () => void
  onTool?: (name: string, args: Record<string, unknown>, result: string) => void
}

export interface FreePoolOptions {
  tools?: {
    enabled: boolean
    executor: (toolName: string, args: Record<string, unknown>) => Promise<string>
    schemas?: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>
  }
  images?: Array<{ path: string; mimeType: string; size?: number }>
  maxTokens?: number
  temperature?: number
  /** Override model selection (for testing) */
  forceModelId?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// API key access (main process only)
// ─────────────────────────────────────────────────────────────────────────────

function getOpenRouterKey(): string {
  ensureEnvLoaded()
  return process.env.OPENROUTER_API_KEY?.trim() ?? ''
}

export function hasOpenRouterKey(): boolean {
  return Boolean(getOpenRouterKey())
}

// ─────────────────────────────────────────────────────────────────────────────
// Context compression
// ─────────────────────────────────────────────────────────────────────────────

function compressMessages(messages: FreePoolMessage[]): FreePoolMessage[] {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0)
  if (totalChars <= MAX_CONTEXT_CHARS) return messages

  // Keep system message + last N messages that fit
  const system = messages.filter(m => m.role === 'system')
  const conversation = messages.filter(m => m.role !== 'system')

  let budget = MAX_CONTEXT_CHARS - system.reduce((s, m) => s + m.content.length, 0)
  const kept: FreePoolMessage[] = []

  // Always keep the last user message
  for (let i = conversation.length - 1; i >= 0; i--) {
    const msg = conversation[i]
    if (budget - msg.content.length < 0 && kept.length > 0) break
    kept.unshift(msg)
    budget -= msg.content.length
  }

  // eslint-disable-next-line no-console
  console.log(`[openrouter-pool] context compressed: ${conversation.length} → ${kept.length} messages`)

  return [...system, ...kept]
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP streaming (Node https)
// ─────────────────────────────────────────────────────────────────────────────

interface StreamChunk {
  id?: string
  model?: string
  choices?: Array<{
    delta?: {
      content?: string
      reasoning?: string
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string
  }>
  error?: { message?: string; code?: number }
}

async function streamOpenRouterRequest(
  modelId: string,
  messages: FreePoolMessage[],
  apiKey: string,
  abortSignal: AbortSignal,
  options: FreePoolOptions,
  callbacks: FreePoolCallbacks
): Promise<{ text: string; usedModelId: string; toolCalls: Map<number, { id: string; name: string; arguments: string }> }> {
  const compressed = compressMessages(messages)
  const maxTokens = Math.min(options.maxTokens ?? MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS)
  const temperature = options.temperature ?? 0.7

  const toolsSchema = options.tools?.enabled && options.tools.schemas && options.tools.schemas.length > 0
    ? options.tools.schemas
    : undefined

  const body = JSON.stringify({
    model: modelId,
    messages: compressed,
    max_tokens: maxTokens,
    temperature,
    stream: true,
    ...(toolsSchema ? { tools: toolsSchema } : {}),
  })

  return new Promise((resolve, reject) => {
    const url = new URL(`${OPENROUTER_BASE_URL}/chat/completions`)

    const reqOptions: https.RequestOptions = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://aura.ai',
        'X-Title': 'Aura',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: REQUEST_TIMEOUT_MS,
    }

    let text = ''
    let usedModelId = modelId
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()
    let buffer = ''
    let settled = false

    const settle = (err?: Error) => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else resolve({ text, usedModelId, toolCalls })
    }

    const req = https.request(reqOptions, res => {
      if (res.statusCode && res.statusCode >= 400) {
        let errBody = ''
        res.on('data', (chunk: Buffer) => { errBody += chunk.toString() })
        res.on('end', () => {
          let msg = `HTTP ${res.statusCode}`
          try {
            const parsed = JSON.parse(errBody) as { error?: { message?: string } }
            if (parsed.error?.message) msg = parsed.error.message
          } catch { /* use status */ }
          settle(Object.assign(new Error(msg), { status: res.statusCode }))
        })
        return
      }

      res.on('data', (chunk: Buffer) => {
        if (abortSignal.aborted) { req.destroy(); return }
        buffer += chunk.toString()

        let boundary = buffer.indexOf('\n\n')
        while (boundary !== -1) {
          const raw = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)

          const dataLine = raw
            .split(/\r?\n/)
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trim())
            .join('')

          if (dataLine && dataLine !== '[DONE]') {
            try {
              const chunk = JSON.parse(dataLine) as StreamChunk
              if (chunk.error?.message) {
                settle(Object.assign(new Error(chunk.error.message), { status: chunk.error.code }))
                return
              }
              if (chunk.model) usedModelId = chunk.model

              const delta = chunk.choices?.[0]?.delta
              if (delta?.content) {
                text += delta.content
                callbacks.onToken(delta.content)
              }
              if (delta?.reasoning) {
                callbacks.onThinking?.(delta.reasoning)
              }
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0
                  let call = toolCalls.get(idx)
                  if (!call) {
                    call = { id: '', name: '', arguments: '' }
                    toolCalls.set(idx, call)
                  }
                  if (tc.id) call.id = tc.id
                  if (tc.function?.name) call.name = tc.function.name
                  if (tc.function?.arguments) call.arguments += tc.function.arguments
                }
              }
            } catch { /* malformed SSE chunk — skip */ }
          }

          boundary = buffer.indexOf('\n\n')
        }
      })

      res.on('end', () => settle())
      res.on('error', err => settle(err))
    })

    req.on('timeout', () => {
      req.destroy()
      settle(Object.assign(new Error('Request timed out'), { status: 408 }))
    })

    req.on('error', err => settle(err))

    abortSignal.addEventListener('abort', () => {
      req.destroy()
      settle(Object.assign(new Error('Aborted'), { status: 0 }))
    }, { once: true })

    req.write(body)
    req.end()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Error classification
// ─────────────────────────────────────────────────────────────────────────────

function classifyError(error: unknown): 'timeout' | '429' | '5xx' | 'malformed' | 'auth' | 'generic' {
  const err = error as { status?: number; message?: string }
  const status = err.status ?? 0
  const msg = err.message ?? ''

  if (status === 408 || /timeout|timed out/i.test(msg)) return 'timeout'
  if (status === 429 || /rate.?limit|too many requests/i.test(msg)) return '429'
  if (status >= 500 && status < 600) return '5xx'
  if (status === 401 || status === 403 || /unauthorized|invalid.*key|authentication/i.test(msg)) return 'auth'
  if (/malformed|parse|invalid.*json/i.test(msg)) return 'malformed'
  return 'generic'
}

function isRetryable(errorKind: ReturnType<typeof classifyError>): boolean {
  return errorKind !== 'auth'
}

function shouldSwitchModel(errorKind: ReturnType<typeof classifyError>): boolean {
  return errorKind === '429' || errorKind === '5xx' || errorKind === 'timeout'
}

// ─────────────────────────────────────────────────────────────────────────────
// Main streaming entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stream a completion through the OpenRouter free model pool.
 * Automatically selects the best model, falls back on failure.
 */
export async function streamFreePool(
  messages: FreePoolMessage[],
  systemPrompt: string,
  abortSignal: AbortSignal,
  callbacks: FreePoolCallbacks,
  options: FreePoolOptions = {}
): Promise<void> {
  const apiKey = getOpenRouterKey()
  if (!apiKey) {
    callbacks.onError(new Error('OpenRouter API key not configured. Add OPENROUTER_API_KEY to your .env file.'))
    return
  }

  // Trigger background model discovery (non-blocking)
  discoverFreeModels(apiKey).catch(() => { /* already logged */ })

  const registry = getCachedFreeModels()
  const lastUser = [...messages].filter(m => m.role === 'user').pop()?.content ?? ''
  const hasImages = (options.images?.length ?? 0) > 0
  const toolsEnabled = options.tools?.enabled === true

  // Build full message list with system prompt
  const fullMessages: FreePoolMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages.filter(m => m.role !== 'system'),
  ]

  // Route the request
  let decision: RoutingDecision
  if (options.forceModelId) {
    const forced = registry.find(m => m.id === options.forceModelId) ?? {
      id: options.forceModelId,
      name: options.forceModelId,
      provider: 'openrouter',
      free: true,
      contextLength: 32768,
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsTools: true,
      supportsVision: false,
      supportsStructuredOutput: false,
      supportsReasoning: false,
      specialties: [] as import('./openrouterFreeModels').ModelSpecialty[],
    } satisfies FreeModel
    decision = {
      primary: forced,
      fallbacks: registry.filter(m => m.id !== options.forceModelId),
      task: { category: 'simple_chat', needsVision: false, needsTools: false, needsReasoning: false, complexity: 'low', estimatedTokens: 0 },
      diagnostics: { requestId: 'forced', taskCategory: 'simple_chat', candidateCount: 1, primaryScore: 100, fallbackCount: 0 },
    }
  } else {
    decision = routeRequest(lastUser, hasImages, toolsEnabled, registry)
  }

  const triedIds = new Set<string>()
  let currentModel = decision.primary
  let attempt = 0

  const MAX_TOOL_ROUNDS = 4

  while (attempt < MAX_RETRIES) {
    if (abortSignal.aborted) {
      callbacks.onAbort?.()
      return
    }

    if (!isModelHealthy(currentModel.id) && currentModel.id !== OPENROUTER_FREE_ROUTER_ID) {
      const next = getNextFallback(decision, triedIds)
      if (!next) break
      currentModel = next
    }

    triedIds.add(currentModel.id)
    recordRequest(currentModel.id)

    const startTime = Date.now()

    // Add task-specific context to system prompt (token-efficient)
    const taskContext = buildTaskContext(decision.task)
    const effectiveSystem = taskContext
      ? `${systemPrompt}\n\n${taskContext}`
      : systemPrompt

    const effectiveMessages: FreePoolMessage[] = [
      { role: 'system', content: effectiveSystem },
      ...fullMessages.filter(m => m.role !== 'system'),
    ]

    try {
      // Tool-calling loop
      let finalText = ''
      const openaiMessages = [...effectiveMessages]

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (abortSignal.aborted) {
          callbacks.onAbort?.()
          return
        }

        const { text, usedModelId, toolCalls } = await streamOpenRouterRequest(
          currentModel.id,
          openaiMessages,
          apiKey,
          abortSignal,
          options,
          callbacks
        )

        finalText += text

        if (toolCalls.size === 0) break

        // Execute tool calls
        const calls = [...toolCalls.values()]
        openaiMessages.push({
          role: 'assistant',
          content: JSON.stringify({ tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) }),
        })

        for (const call of calls) {
          const normalized = normalizeToolCall(call)
          const args = normalized?.arguments ?? {}
          let result: string
          try {
            result = options.tools
              ? await options.tools.executor(call.name, args)
              : JSON.stringify({ success: false, error: 'tools disabled' })
            recordToolCallSuccess(currentModel.id)
          } catch (err) {
            result = JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'tool failed' })
          }
          callbacks.onTool?.(call.name, args, result)
          openaiMessages.push({ role: 'user', content: `Tool result for ${call.name}: ${result}` })
        }

        // Update model id if provider returned a different one
        if (usedModelId && usedModelId !== currentModel.id) {
          // eslint-disable-next-line no-console
          console.log(`[openrouter-pool] model remapped: ${currentModel.id} → ${usedModelId}`)
        }
      }

      const latency = Date.now() - startTime
      recordSuccess(currentModel.id, latency)

      callbacks.onDone(finalText, currentModel.id)
      return

    } catch (error) {
      if (abortSignal.aborted) {
        callbacks.onAbort?.()
        return
      }

      const latency = Date.now() - startTime
      const kind = classifyError(error)
      recordFailure(currentModel.id, kind)

      // eslint-disable-next-line no-console
      console.warn(`[openrouter-pool] ${currentModel.id} failed (${kind}, ${latency}ms, attempt ${attempt + 1}):`, error instanceof Error ? error.message : error)

      // Auth errors are fatal — don't retry
      if (kind === 'auth') {
        callbacks.onError(new Error('OpenRouter authentication failed. Check your OPENROUTER_API_KEY.'))
        return
      }

      if (!isRetryable(kind)) {
        callbacks.onError(error instanceof Error ? error : new Error(String(error)))
        return
      }

      // Switch model on 429/5xx/timeout
      if (shouldSwitchModel(kind)) {
        const next = getNextFallback(decision, triedIds)
        if (next) {
          currentModel = next
          attempt++
          continue
        }
      }

      attempt++

      // Brief backoff before retry (only for same-model retries)
      if (attempt < MAX_RETRIES) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000)
        await new Promise(resolve => setTimeout(resolve, backoffMs))
      }
    }
  }

  // All attempts exhausted
  callbacks.onError(new Error('Free Cloud AI is temporarily unavailable. Please try again in a moment.'))
}

// ─────────────────────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize the free pool: load env, trigger background discovery.
 * Call once at app startup.
 */
export function initFreePool(): void {
  ensureEnvLoaded()
  const apiKey = getOpenRouterKey()
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.warn('[openrouter-pool] OPENROUTER_API_KEY not set — Free Cloud AI unavailable')
    return
  }
  // eslint-disable-next-line no-console
  console.log('[openrouter-pool] initialized, triggering background model discovery')
  discoverFreeModels(apiKey).catch(() => { /* logged inside */ })
}

/**
 * Test the OpenRouter connection with a minimal request.
 */
export async function testFreePoolConnection(): Promise<{ success: boolean; error?: string; modelCount?: number }> {
  const apiKey = getOpenRouterKey()
  if (!apiKey) {
    return { success: false, error: 'OPENROUTER_API_KEY not configured' }
  }

  try {
    const models = await discoverFreeModels(apiKey)
    return { success: true, modelCount: models.length }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}
