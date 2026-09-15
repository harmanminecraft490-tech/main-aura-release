/**
 * REQUEST PAYLOAD INSTRUMENTATION (no optimization — diagnosis only)
 *
 * Called immediately before every provider request is sent. Prints the
 * COMPLETE payload that will go to the provider:
 *   - every message: role, content length, estimated tokens
 *   - per-section totals (system, developer, conversation, memory, workspace,
 *     project, retrieved docs, tool definitions, hidden instructions)
 *   - FINAL REQUEST TOKENS
 * and writes the full payload to request-debug.json.
 *
 * This module is pure (fs only, no electron) so it can be unit-tested.
 */

import * as fs from 'fs'
import * as path from 'path'

/** Rough token estimate. ~4 ASCII chars/token, ~1 token per CJK char. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let units = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    units += code > 0x2e7f ? 1 : 0.25
  }
  return Math.max(1, Math.ceil(units))
}

export interface DebugMessage {
  role: string
  content: string | Array<unknown>
}

export interface DebugSection {
  name: string
  content: string
}

export interface DebugPayloadInput {
  provider: string
  model: string
  /** The complete system prompt string as sent to the provider. */
  system: string
  /** max_tokens (max output) sent in the request. */
  maxTokens?: number
  /** The full message array as sent to the provider (system included). */
  messages: DebugMessage[]
  /**
   * Decomposition of the system string into named sections. When provided,
   * each section's tokens are reported separately; any system text not covered
   * by a section is attributed to "System Prompt".
   */
  sections?: DebugSection[]
  /** Absolute path to write request-debug.json (no write if omitted). */
  savePath?: string
}

export interface DebugPayloadResult {
  totalTokens: number
  payloadBytes: number
  sectionTokens: Array<{ name: string; tokens: number; chars: number; percent: number }>
  messageRows: Array<{ index: number; role: string; contentLength: number; tokens: number }>
}

/** Coerce a message content to a string for accounting (multimodal parts safe). */
function contentAsString(content: string | Array<unknown>): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    // Multimodal content parts — keep the debug accounting honest without
    // leaking image data. Count the text parts, note the rest.
    const label = content
      .map(part => {
        if (typeof part === 'object' && part !== null) {
          const type = (part as { type?: unknown }).type
          return typeof type === 'string' ? type : 'part'
        }
        return 'part'
      })
      .join(',')
    return `[multimodal ${label}]`
  }
  return ''
}

export function debugRequestPayload(input: DebugPayloadInput): DebugPayloadResult {
  const { provider, model, system, messages, sections, savePath } = input

  // Per-message accounting (the exact payload bytes as sent).
  const messageRows = messages.map((message, index) => {
    const content = contentAsString(message.content)
    return {
      index,
      role: message.role,
      contentLength: content.length,
      tokens: estimateTokens(content),
    }
  })

  // Section accounting.
  const systemTokens = estimateTokens(system)
  const conversationTokens = messages
    .filter(message => message.role !== 'system')
    .reduce((sum, message) => sum + estimateTokens(contentAsString(message.content)), 0)

  let sectionTokens: DebugPayloadResult['sectionTokens']
  if (sections && sections.length > 0) {
    const sectionSum = sections.reduce((sum, section) => sum + estimateTokens(section.content), 0)
    sectionTokens = sections.map(section => ({
      name: section.name,
      tokens: estimateTokens(section.content),
      chars: section.content.length,
      percent: 0,
    }))
    // The Conversation section is the non-system messages; if the caller did
    // not provide it, add it so the total is complete.
    if (!sections.some(section => /conversation/i.test(section.name))) {
      sectionTokens.push({
        name: 'Conversation',
        tokens: conversationTokens,
        chars: messages.filter(m => m.role !== 'system').reduce((sum, m) => sum + contentAsString(m.content).length, 0),
        percent: 0,
      })
    }
    // Unattributed system text (e.g. markers/headers) lands in System Prompt.
    const attributed = sectionTokens.reduce((sum, section) => sum + section.tokens, 0)
    const remainder = systemTokens - sectionSum
    if (remainder > 0 && remainder < systemTokens) {
      const sys = sectionTokens.find(section => /system prompt/i.test(section.name))
      if (sys) sys.tokens += remainder
      else sectionTokens.push({ name: 'System Prompt (overhead)', tokens: remainder, chars: 0, percent: 0 })
    }
    // Ensure the section total reconciles with FINAL REQUEST TOKENS.
    const total = sectionTokens.reduce((sum, section) => sum + section.tokens, 0)
    for (const section of sectionTokens) {
      section.percent = total === 0 ? 0 : Math.round((section.tokens / total) * 1000) / 10
    }
  } else {
    sectionTokens = [
      { name: 'System Prompt (full system string)', tokens: systemTokens, chars: system.length, percent: 0 },
      { name: 'Conversation', tokens: conversationTokens, chars: 0, percent: 0 },
    ]
    const total = systemTokens + conversationTokens
    for (const section of sectionTokens) {
      section.percent = total === 0 ? 0 : Math.round((section.tokens / total) * 1000) / 10
    }
  }

  const totalTokens = sectionTokens.reduce((sum, section) => sum + section.tokens, 0)
  const payloadBytes = JSON.stringify({ system, messages }).length

  // ── Console output ──────────────────────────────────────────────────────────
  const line = '─'.repeat(66)
  const out: string[] = [
    `\n${line}`,
    `AURA REQUEST DEBUG  ·  ${provider} / ${model}`,
    line,
    '  MESSAGES (exact payload as sent):',
    ...messageRows.map(row =>
      `    [${String(row.index).padStart(2)}] ${row.role.padEnd(9)} len ${String(row.contentLength).padStart(7)}  ~${String(row.tokens).padStart(5)} tok`
    ),
    line,
    '  SECTION TOTALS:',
    ...sectionTokens.map(section =>
      `    ${section.name.padEnd(24)} ${String(section.tokens).padStart(6)} tok  ${String(section.chars).padStart(7)} ch  ${String(section.percent).padStart(5)}%`
    ),
    line,
    `  FINAL REQUEST TOKENS: ${totalTokens}`,
    input.maxTokens !== undefined ? `  max_tokens (output cap): ${input.maxTokens}` : '',
    input.maxTokens !== undefined ? `  Requested by provider (input + max_tokens): ${totalTokens + input.maxTokens}` : '',
    `  Payload bytes: ${payloadBytes}`,
    savePath ? `  Saved: ${savePath}` : '',
    line,
  ].filter(Boolean)

  // eslint-disable-next-line no-console
  console.log(out.join('\n'))

  // ── Write request-debug.json (last request) + request-debug.log (all) ──────
  if (savePath) {
    try {
      const payload = {
        provider,
        model,
        totalTokens,
        payloadBytes,
        sectionTokens,
        messages: messageRows,
        payload: [
          { role: 'system', contentLength: system.length, estimatedTokens: systemTokens, content: system },
          ...messages.map(message => {
            const content = contentAsString(message.content)
            return {
              role: message.role,
              contentLength: content.length,
              estimatedTokens: estimateTokens(content),
              content,
            }
          }),
        ],
      }
      fs.mkdirSync(path.dirname(savePath), { recursive: true })
      fs.writeFileSync(savePath, JSON.stringify(payload, null, 2), 'utf8')
      const logPath = savePath.replace(/request-debug\.json$/i, 'request-debug.log')
      const summary = sectionTokens
        .filter(section => section.tokens > 0)
        .map(section => `${section.name}=${section.tokens}`)
        .join(' ')
      fs.appendFileSync(
        logPath,
        `${new Date().toISOString()}  provider=${provider} model=${model} TOTAL=${totalTokens} bytes=${payloadBytes} | ${summary}\n`,
        'utf8'
      )
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('AURA REQUEST DEBUG: could not write request-debug files:', error)
    }
  }

  return { totalTokens, payloadBytes, sectionTokens, messageRows }
}
