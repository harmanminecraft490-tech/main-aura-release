/**
 * TOOL-PROTOCOL STREAM FILTER
 *
 * Some tool-calling models (e.g. Cerebras/Groq gpt-oss family) "think aloud" by
 * emitting their tool-call arguments — and, after a tool runs, echoing the tool
 * result — as plain STREAMED TEXT (`delta.content`) in addition to the proper
 * structured `tool_calls` deltas. Aura forwards every content token to the
 * visible chat, so that JSON ends up on screen:
 *
 *   {"action":"list","path":"src/renderer"}{"success":true,"operation":"list",...}
 *
 * This is a PRESENTATION/STATE separation problem: tool calls and tool results
 * are INTERNAL model-context state. The visible assistant message must contain
 * only real model prose. The structured tool_calls channel (which drives actual
 * execution) is untouched — we only stop the redundant JSON ECHO from reaching
 * the user.
 *
 * This module is a pure, streaming state machine. It feeds content tokens and
 * returns only the text that is safe to show:
 *
 *   - a JSON object whose FIRST KEY is a tool-protocol marker
 *     (action / success / operation / query / tool_call / …) is swallowed;
 *   - every other character (prose, markdown, legit JSON) passes through.
 *
 * It is stateless across calls except for an internal buffer that holds a
 * partial JSON object until it is complete (JSON spans multiple stream chunks).
 * Deliberately conservative: only the exact first-key markers used by Aura's
 * tool protocol are treated as protocol, so normal answers (even JSON the user
 * asked for) are never affected.
 *
 * The filter is applied in the MAIN process at the provider boundary — the raw
 * JSON never enters chat state or the renderer, so there is nothing to hide
 * with CSS or delete after the fact.
 */

/** First keys that mark an object as tool protocol. Matches the shapes Aura's
 *  tools actually emit: workspace_file args/results, web_search args/results,
 *  read_webpage args, tool-call replay structures. */
const TOOL_PROTOCOL_KEYS = new Set([
  'action',
  'success',
  'operation',
  'tool_call',
  'tool_result',
  'tool_call_id',
  'call_id',
  'request',
  'query',
  'provider',
  'duration',
  'results',
  'result',
  'num',
  'arguments',
  'args',
  'stream_id',
  'streamId',
])

/** Extract the first key of a JSON object, or null if it isn't one. */
function firstKey(text: string): string | null {
  const match = /^\{\s*"([a-zA-Z_][a-zA-Z0-9_]*)":/.exec(text)
  return match ? match[1] : null
}

function isToolProtocolObject(objectText: string): boolean {
  const key = firstKey(objectText)
  if (!key) return false
  return TOOL_PROTOCOL_KEYS.has(key)
}

/**
 * Scan `text` from `start` (which must point at a `{`) for the index of the
 * closing `}` of the first balanced JSON object. Returns -1 when the object is
 * not yet complete (i.e. more chunks are needed). Strings and escapes are
 * respected so a `}` inside a string value does not close the object early.
 */
function findBalancedObjectEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

export class ToolProtocolSuppressor {
  /** Unconsumed input held between calls (a partial JSON object). */
  private pending = ''
  /** True while we are holding a JSON object waiting for it to complete. */
  private holdingBrace = false

  /**
   * Feed one streamed content token. Returns the substring that is safe to show;
   * the tool-protocol portion is consumed and never returned.
   */
  push(chunk: string): string {
    this.pending += chunk
    const safe: string[] = []
    let cursor = 0

    while (cursor < this.pending.length) {
      if (this.holdingBrace) {
        const holdStart = cursor
        const end = findBalancedObjectEnd(this.pending, holdStart)
        if (end === -1) {
          // Object not complete yet — keep it in the buffer for the next chunk.
          cursor = holdStart
          break
        }
        const objectText = this.pending.slice(holdStart, end + 1)
        cursor = end + 1
        this.holdingBrace = false
        // Tool-protocol objects are swallowed; everything else is real text.
        if (!isToolProtocolObject(objectText)) safe.push(objectText)
        continue
      }

      // Idle: look for the next '{'.
      const open = this.pending.indexOf('{', cursor)
      if (open === -1) {
        safe.push(this.pending.slice(cursor))
        cursor = this.pending.length
        break
      }
      safe.push(this.pending.slice(cursor, open))
      this.holdingBrace = true
      cursor = open
    }

    this.pending = this.pending.slice(cursor)
    return safe.join('')
  }

  /** Any unsuppressed text still buffered (e.g. at the end of a stream). */
  flush(): string {
    if (this.holdingBrace) {
      // An unterminated object: drop it (it was tool protocol or truncated).
      this.pending = ''
      this.holdingBrace = false
      return ''
    }
    const rest = this.pending
    this.pending = ''
    return rest
  }
}
