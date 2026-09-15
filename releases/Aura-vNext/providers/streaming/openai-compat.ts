/**
 * OpenAI-compatible streaming adapter.
 *
 * Works with OpenAI, OpenRouter, Groq, Gemini's OpenAI endpoint, DeepSeek,
 * Moonshot, Ollama, LM Studio, vLLM, and any company gateway that speaks
 * `POST {base}/chat/completions`.
 *
 * Guarantees (enforced by the `finished` latch):
 *  - exactly one terminal callback (onDone | onError | onAbort)
 *  - no tokens delivered after a terminal callback
 */

import type { CompletionParams, ProviderConfig, StreamHandler, StreamOptions, ChatUsage, ChatMessage } from '../types'
import { buildHeaders } from '../discovery'
import { isAbortError, readSSE } from './sse'

interface OpenAIStreamChunk {
  model?: string
  choices?: Array<{
    delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null }
    message?: { content?: string | null }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  error?: { message?: string }
}

function endpoint(provider: ProviderConfig): string {
  const base = provider.baseURL.trim().replace(/\/+$/, '')
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`
}

/** Convert our wire messages (with optional image parts) to OpenAI format. */
function toOpenAIMessages(params: CompletionParams): unknown[] {
  const messages: unknown[] = []
  if (params.system) messages.push({ role: 'system', content: params.system })

  for (const message of params.messages) {
    if (message.parts && message.parts.some(part => part.kind === 'image')) {
      messages.push({
        role: message.role,
        content: message.parts.map(part =>
          part.kind === 'text'
            ? { type: 'text', text: part.text }
            : { type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${part.data}` } }
        ),
      })
    } else {
      messages.push({ role: message.role, content: message.content })
    }
  }
  return messages
}

export async function streamOpenAICompat(
  provider: ProviderConfig,
  params: CompletionParams,
  handler: StreamHandler,
  options: StreamOptions
): Promise<void> {
  const { signal } = options
  let finished = false
  const finish = (fn: () => void) => {
    if (finished) return
    finished = true
    fn()
  }

  let text = ''
  let thinking = ''
  let model: string | undefined
  let usage: ChatUsage | undefined

  try {
    const response = await fetch(endpoint(provider), {
      method: 'POST',
      headers: buildHeaders(provider),
      signal,
      body: JSON.stringify({
        model: params.model,
        messages: toOpenAIMessages(params),
        temperature: params.temperature,
        top_p: params.topP,
        max_tokens: params.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(extractApiError(body, response.status))
    }
    if (!response.body) throw new Error('The provider returned no response stream.')

    await readSSE(response.body, {
      signal,
      firstByteTimeoutMs: options.firstByteTimeoutMs ?? provider.timeoutMs,
      idleTimeoutMs: options.idleTimeoutMs ?? 60_000,
      onEvent: event => {
        if (finished || event.data === '[DONE]') return
        let chunk: OpenAIStreamChunk
        try {
          chunk = JSON.parse(event.data) as OpenAIStreamChunk
        } catch {
          return // tolerate keep-alive/malformed frames
        }
        if (chunk.error?.message) throw new Error(chunk.error.message)

        if (chunk.model) model = chunk.model
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens: chunk.usage.total_tokens ?? (chunk.usage.prompt_tokens ?? 0) + (chunk.usage.completion_tokens ?? 0),
          }
        }

        const delta = chunk.choices?.[0]?.delta
        const reasoningDelta = delta?.reasoning_content ?? delta?.reasoning
        if (reasoningDelta) {
          thinking += reasoningDelta
          handler.onThinking?.(reasoningDelta)
        }
        const contentDelta = delta?.content ?? chunk.choices?.[0]?.message?.content
        if (contentDelta) {
          text += contentDelta
          handler.onToken(contentDelta)
        }
      },
    })

    finish(() => handler.onDone(text || thinking, { model, usage }))
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      finish(() => handler.onAbort())
      return
    }
    finish(() => handler.onError(error instanceof Error ? error : new Error(String(error))))
  }
}

function extractApiError(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    const message = parsed.error?.message ?? parsed.message
    if (message) return message
  } catch {
    // fall through
  }
  if (status === 401 || status === 403) return 'Authentication failed. Check your API key.'
  if (status === 404) return 'Model or endpoint not found.'
  if (status === 429) return 'Rate limited by the provider. Try again shortly.'
  if (status >= 500) return `Provider server error (${status}).`
  return `Request failed (${status}).`
}

/** Non-streaming single completion, used for connection tests. */
export async function completeOnce(
  provider: ProviderConfig,
  model: string,
  prompt: string,
  signal: AbortSignal
): Promise<string> {
  const messages: ChatMessage[] = [{ role: 'user', content: prompt }]
  const response = await fetch(endpoint(provider), {
    method: 'POST',
    headers: buildHeaders(provider),
    signal,
    body: JSON.stringify({ model, messages, max_tokens: 8, stream: false }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(extractApiError(body, response.status))
  }
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return payload.choices?.[0]?.message?.content ?? ''
}
