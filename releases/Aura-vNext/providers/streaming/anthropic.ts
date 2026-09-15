/**
 * Anthropic Messages API streaming adapter (raw SSE, no SDK dependency —
 * keeps the backend bundle small and behavior identical to the other
 * adapters: same watchdogs, same exactly-one-terminal-event guarantee).
 */

import type { CompletionParams, ProviderConfig, StreamHandler, StreamOptions, ChatUsage } from '../types'
import { buildHeaders } from '../discovery'
import { isAbortError, readSSE } from './sse'

interface AnthropicStreamEvent {
  type: string
  message?: { model?: string; usage?: { input_tokens?: number; output_tokens?: number } }
  delta?: { type?: string; text?: string; thinking?: string; stop_reason?: string }
  usage?: { input_tokens?: number; output_tokens?: number }
  error?: { message?: string }
}

function endpoint(provider: ProviderConfig): string {
  const base = provider.baseURL.trim().replace(/\/+$/, '')
  return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`
}

function toAnthropicMessages(params: CompletionParams): unknown[] {
  return params.messages
    .filter(message => message.role !== 'system')
    .map(message => {
      if (message.parts && message.parts.some(part => part.kind === 'image')) {
        return {
          role: message.role,
          content: message.parts.map(part =>
            part.kind === 'text'
              ? { type: 'text', text: part.text }
              : { type: 'image', source: { type: 'base64', media_type: part.mimeType, data: part.data } }
          ),
        }
      }
      return { role: message.role, content: message.content }
    })
}

export async function streamAnthropic(
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
  let inputTokens = 0
  let outputTokens = 0

  try {
    const response = await fetch(endpoint(provider), {
      method: 'POST',
      headers: buildHeaders(provider),
      signal,
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.maxTokens ?? 8192,
        temperature: params.temperature,
        top_p: params.topP,
        system: params.system,
        messages: toAnthropicMessages(params),
        stream: true,
      }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(extractAnthropicError(body, response.status))
    }
    if (!response.body) throw new Error('The provider returned no response stream.')

    await readSSE(response.body, {
      signal,
      firstByteTimeoutMs: options.firstByteTimeoutMs ?? provider.timeoutMs,
      idleTimeoutMs: options.idleTimeoutMs ?? 60_000,
      onEvent: event => {
        if (finished) return
        let parsed: AnthropicStreamEvent
        try {
          parsed = JSON.parse(event.data) as AnthropicStreamEvent
        } catch {
          return
        }

        switch (parsed.type) {
          case 'error':
            throw new Error(parsed.error?.message ?? 'Anthropic stream error')
          case 'message_start':
            model = parsed.message?.model ?? model
            inputTokens = parsed.message?.usage?.input_tokens ?? inputTokens
            break
          case 'content_block_delta':
            if (parsed.delta?.type === 'text_delta' && parsed.delta.text) {
              text += parsed.delta.text
              handler.onToken(parsed.delta.text)
            } else if (parsed.delta?.type === 'thinking_delta' && parsed.delta.thinking) {
              thinking += parsed.delta.thinking
              handler.onThinking?.(parsed.delta.thinking)
            }
            break
          case 'message_delta':
            outputTokens = parsed.usage?.output_tokens ?? outputTokens
            break
        }
      },
    })

    const usage: ChatUsage | undefined =
      inputTokens || outputTokens
        ? { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
        : undefined
    finish(() => handler.onDone(text || thinking, { model, usage }))
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      finish(() => handler.onAbort())
      return
    }
    finish(() => handler.onError(error instanceof Error ? error : new Error(String(error))))
  }
}

function extractAnthropicError(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    if (parsed.error?.message) return parsed.error.message
  } catch {
    // fall through
  }
  if (status === 401 || status === 403) return 'Authentication failed. Check your API key.'
  if (status === 404) return 'Model not found.'
  if (status === 429) return 'Rate limited by Anthropic. Try again shortly.'
  return `Request failed (${status}).`
}
