/**
 * Unified streaming entry point + retry policy.
 *
 * `streamCompletion` dispatches to the right protocol adapter. Retries happen
 * only for transient failures *before any token was emitted* — once output
 * has started, a retry would duplicate content, so we surface the error.
 */

import type { CompletionParams, ProviderConfig, StreamHandler, StreamOptions } from './types'
import { streamAnthropic } from './streaming/anthropic'
import { streamOpenAICompat } from './streaming/openai-compat'

const MAX_RETRIES = 2
const RETRYABLE = /rate limit|429|500|502|503|504|overloaded|server error|ECONNRESET|ETIMEDOUT|network|fetch failed/i

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function streamCompletion(
  provider: ProviderConfig,
  params: CompletionParams,
  handler: StreamHandler,
  options: StreamOptions
): Promise<void> {
  const adapter = provider.protocol === 'anthropic' ? streamAnthropic : streamOpenAICompat

  for (let attempt = 0; ; attempt += 1) {
    let tokensEmitted = false
    let retryError: Error | null = null

    // Wrap the handler so we know whether output started, and so a retryable
    // pre-token error is captured instead of surfaced.
    const wrapped: StreamHandler = {
      onToken: delta => {
        tokensEmitted = true
        handler.onToken(delta)
      },
      onThinking: delta => {
        tokensEmitted = true
        handler.onThinking?.(delta)
      },
      onDone: (text, meta) => handler.onDone(text, meta),
      onAbort: () => handler.onAbort(),
      onError: error => {
        const canRetry =
          !tokensEmitted && attempt < MAX_RETRIES && RETRYABLE.test(error.message) && !options.signal.aborted
        if (canRetry) {
          retryError = error
        } else {
          handler.onError(error)
        }
      },
    }

    await adapter(provider, params, wrapped, options)
    if (!retryError) return

    // Exponential backoff with jitter: ~600ms, ~1.5s.
    const backoff = 600 * Math.pow(2, attempt) * (0.75 + Math.random() * 0.5)
    try {
      await delay(backoff, options.signal)
    } catch {
      handler.onAbort()
      return
    }
  }
}
