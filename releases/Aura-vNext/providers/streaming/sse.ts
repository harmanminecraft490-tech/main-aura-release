/**
 * Robust SSE reader shared by all provider adapters.
 *
 * Fixes the failure modes of the previous implementation:
 *  - hanging streams: first-byte + idle watchdogs abort dead connections
 *  - never-ending "Thinking...": exactly-one-terminal-event guarantee
 *  - duplicate chunks: events are parsed on strict SSE boundaries
 *  - post-abort execution: reader is cancelled the instant the signal fires
 */

export interface SSEEvent {
  data: string
}

export interface SSEReadOptions {
  signal: AbortSignal
  firstByteTimeoutMs: number
  idleTimeoutMs: number
  onEvent: (event: SSEEvent) => void
}

export class StreamTimeoutError extends Error {
  constructor(kind: 'first-byte' | 'idle', ms: number) {
    super(
      kind === 'first-byte'
        ? `The model did not start responding within ${Math.round(ms / 1000)}s.`
        : `The stream stalled for ${Math.round(ms / 1000)}s and was stopped.`
    )
    this.name = 'StreamTimeoutError'
  }
}

/**
 * Read an SSE body to completion. Resolves when the server finishes, rejects
 * on error/timeout, and rejects with the signal's reason on abort. The caller
 * is responsible for mapping events to tokens.
 */
export async function readSSE(body: ReadableStream<Uint8Array>, options: SSEReadOptions): Promise<void> {
  const { signal, firstByteTimeoutMs, idleTimeoutMs, onEvent } = options
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let receivedFirstByte = false

  let watchdog: ReturnType<typeof setTimeout> | undefined
  let timedOut: StreamTimeoutError | null = null

  const armWatchdog = () => {
    if (watchdog) clearTimeout(watchdog)
    const ms = receivedFirstByte ? idleTimeoutMs : firstByteTimeoutMs
    watchdog = setTimeout(() => {
      timedOut = new StreamTimeoutError(receivedFirstByte ? 'idle' : 'first-byte', ms)
      void reader.cancel().catch(() => {})
    }, ms)
  }

  const onAbort = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()

  armWatchdog()

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      if (timedOut) throw timedOut

      if (value && value.length > 0) {
        receivedFirstByte = true
        armWatchdog()
        buffer += decoder.decode(value, { stream: true })

        // SSE events are separated by a blank line; tolerate \r\n servers.
        let boundary = findBoundary(buffer)
        while (boundary) {
          const rawEvent = buffer.slice(0, boundary.index)
          buffer = buffer.slice(boundary.index + boundary.length)

          const data = rawEvent
            .split(/\r?\n/)
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart())
            .join('\n')

          if (data) onEvent({ data })
          boundary = findBoundary(buffer)
        }
      }

      if (done) break
    }
  } finally {
    if (watchdog) clearTimeout(watchdog)
    signal.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }

  if (timedOut) throw timedOut
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
}

function findBoundary(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (lf === -1 && crlf === -1) return null
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 }
  return { index: lf, length: 2 }
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === 'AbortError' ||
    (error instanceof Error && /abort/i.test(error.name))
  )
}
