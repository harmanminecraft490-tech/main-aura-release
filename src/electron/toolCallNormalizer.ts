/**
 * TOOL-CALL NORMALIZER
 *
 * Provider-agnostic normalization of model tool-call output into Aura's
 * internal format { name, arguments }. Providers emit tool calls in different
 * shapes and with very different reliability:
 *
 *   - OpenAI-compatible (OpenAI, Groq, OpenRouter, Gemini-OpenAI, Moonshot,
 *     ZAI, NVIDIA, local servers): `message.tool_calls[].function.{name,arguments}`
 *   - Anthropic: `message.content[].tool_use.{name,input}`
 *   - Some providers stream `function.arguments` as fragmented text that can
 *     arrive TRUNCATED (cut mid-JSON by max_tokens) or wrapped in markdown.
 *     Groq's gpt-oss family is known to do this and then rejects its own
 *     output server-side with "Parsing failed … see 'failed_generation'".
 *
 * Aura's internal format is ALWAYS:
 *   { name: string, arguments: Record<string, unknown> }
 *
 * This module NEVER throws a "parsing failed" error at the user. When a tool
 * call cannot be normalized it returns null and leaves a parseError string so
 * the caller can fall back (Aura-controlled web search) or log it internally.
 *
 * All functions are PURE (no electron / no io) so they can be unit-tested.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Argument JSON repair
// ─────────────────────────────────────────────────────────────────────────────

function tryParse(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw)
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

/**
 * Salvage a possibly-truncated or wrapped tool-call `arguments` string.
 * Returns a parseable JSON string, or null when the text is beyond repair.
 */
export function repairToolArguments(raw: string | null | undefined): string | null {
  if (!raw) return null
  let s = raw.trim()
  if (!s) return null

  // Strip markdown code fences the model may have wrapped the JSON in.
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  s = s.trim()

  // The payload must be a JSON object; find its opening brace.
  const start = s.indexOf('{')
  if (start === -1) return null
  s = s.slice(start)

  // 1) Already-valid JSON → use as-is.
  if (tryParse(s)) return s

  // 2) Truncated JSON → walk the string, then close any dangling quote or brace.
  //    This repairs the common "cut mid-value by max_tokens" case, e.g.
  //    `{"query":"nxtraa.online","recency":"ye`  →  `{"query":"nxtraa.online","recency":"ye"}`
  let depth = 0
  let inString = false
  let escaped = false
  let rebuilt = ''
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    rebuilt += ch
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
  }
  if (inString) rebuilt += '"'                       // close a dangling string value
  while (depth > 0) { rebuilt += '}'; depth -= 1 }   // close unclosed objects
  if (tryParse(rebuilt)) return rebuilt

  // 3) Last resort: extract a balanced `{...}` block with a regex.
  const match = s.match(/\{[\s\S]*\}/)
  if (match) {
    const candidate = match[0]
    // Trim trailing garbage between the last `}` and any text after it.
    const lastClose = candidate.lastIndexOf('}')
    if (lastClose !== -1 && tryParse(candidate.slice(0, lastClose + 1))) {
      return candidate.slice(0, lastClose + 1)
    }
    if (tryParse(candidate)) return candidate
  }

  return null
}

/**
 * Normalize ONE provider tool call into Aura's internal format.
 * Returns null (with parseError) when the arguments cannot be recovered.
 */
export interface NormalizedToolCall {
  name: string
  arguments: Record<string, unknown>
  rawArguments: string
  parseError?: string
}

export function normalizeToolCall(call: {
  name?: string | null
  arguments?: string | null
}): NormalizedToolCall | null {
  const name = (call.name ?? '').trim()
  if (!name) return null

  const rawArguments = (call.arguments ?? '').trim()
  if (!rawArguments) {
    return { name, arguments: {}, rawArguments: '', parseError: 'empty tool arguments' }
  }

  const repaired = repairToolArguments(rawArguments)
  if (repaired) {
    return { name, arguments: tryParse(repaired) ?? {}, rawArguments, parseError: repaired !== rawArguments ? 'repaired' : undefined }
  }
  return { name, arguments: {}, rawArguments, parseError: `unparseable tool arguments: ${rawArguments.slice(0, 200)}` }
}

// ─────────────────────────────────────────────────────────────────────────────
// Search-query derivation (Aura-controlled fallback routing)
// ─────────────────────────────────────────────────────────────────────────────

const DOMAIN_RE = /\b([a-z0-9-]+\.(?:online|com|org|net|in|io|dev|ai|co|app|site|xyz|info|shop|store|tech))\b/i

/**
 * Derive a search query from the last user message WITHOUT a model tool call.
 * Used by the Aura-controlled web-search fallback: when the model cannot emit a
 * parseable tool call, Aura runs the search itself and injects the results.
 * Prefers a bare domain the user named (e.g. "nxtraa.online"), otherwise strips
 * leading search-intent phrasing and returns the meaningful remainder.
 */
export function deriveSearchQuery(userText: string): string {
  const text = (userText ?? '').trim()
  if (!text) return ''

  const domain = text.match(DOMAIN_RE)
  if (domain) return domain[1].toLowerCase()

  const stripped = text
    .replace(/^(please\s+)?(search|look|find|google|browse|check)\s+(the\s+web\s+)?(for\s+|about\s+|up\s+|into\s+)?/i, '')
    .replace(/\s+(and|then)\s+(give|tell|summari[sz]e|brief).*$/i, '')
    .trim()

  const cleaned = stripped || text
  return cleaned.slice(0, 160)
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider error classification
// ─────────────────────────────────────────────────────────────────────────────

const PARSE_FAILURE_PATTERNS = [
  /failed_generation/i,
  /could not be parsed/i,
  /failed to parse tool call/i,
  /invalid tool call/i,
  /tool call arguments/i,
  /parsing failed/i,
  /invalid_response_error/i,
  /json_schema/i,
]

// The model called a tool that was NOT registered in the request. Providers
// (OpenRouter, some OpenAI-compatible gateways) reject the whole response with
// messages like:
//   "Tool call validation failed: attempted to call tool 'web_search' which was
//    not in request.tools"
const TOOL_VALIDATION_PATTERNS = [
  /not in request\.tools/i,
  /tool call validation failed/i,
  /was not in request/i,
  /unregistered tool/i,
  /requested tool.*not (available|registered)/i,
  /unknown tool/i,
]

const RATE_LIMIT_PATTERNS = [/rate.?limit/i, /429/i, /too many requests/i, /tokens per (minute|day)/i, /quota/i]

const AUTH_PATTERNS = [/401/i, /403/i, /invalid api key/i, /unauthorized/i, /incorrect api key/i, /authentication/i]

const TRANSIENT_PATTERNS = [
  /429/i,
  /rate.?limit/i,
  /quota/i,
  /too many requests/i,
  /timeout/i,
  /timed out/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /socket hang up/i,
  /network/i,
  /fetch failed/i,
  /503/i,
  /502/i,
  /504/i,
  /500/i,
  /service unavailable/i,
  /bad gateway/i,
  /gateway timeout/i,
  /overloaded/i,
  /temporarily unavailable/i,
]

/** Strip vendor / raw model identifiers from any user-facing string. */
const PROVIDER_LEAK_PATTERNS: Array<[RegExp, string]> = [
  [/cerebras/gi, 'Aura'],
  [/groq/gi, 'Aura'],
  [/openai\/gpt-oss-120b/gi, 'Aura Model'],
  [/gpt-oss-120b/gi, 'Aura Model'],
  [/openrouter/gi, 'Aura'],
]

/** Tools that Aura's web-search fallback can execute on the model's behalf. */
const WEB_TOOL_NAMES = ['web_search', 'read_webpage', 'web_research']

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try { return JSON.stringify(error) } catch { return String(error) }
}

/** True when the provider rejected its own model output as unparseable. */
export function isToolCallParseError(error: unknown): boolean {
  return PARSE_FAILURE_PATTERNS.some(pattern => pattern.test(messageOf(error)))
}

/**
 * True when the provider rejected a tool call because the tool was NOT in
 * `request.tools`. Returns true only for web-tool validation failures (or
 * validation failures with no visible tool name) — a workspace-file validation
 * failure must NOT trigger the web-search fallback.
 */
export function isWebToolValidationError(error: unknown): boolean {
  const message = messageOf(error)
  if (!TOOL_VALIDATION_PATTERNS.some(pattern => pattern.test(message))) return false
  const named = /tool\s+['"]?([a-z_]+)['"]?\s+(?:which\s+)?was\s+not/i.exec(message)?.[1]?.toLowerCase()
  return !named || WEB_TOOL_NAMES.includes(named)
}

/**
 * True when the provider rejected the payload because a message `content` was
 * not a plain string — the exact "400 messages[1].content must be a string"
 * failure Aura hit with image requests against a text-only (or strict
 * OpenAI-compatible) backend. Detected so the caller can drop images and retry
 * text-only instead of surfacing the raw schema error.
 */
export function isContentSchemaError(error: unknown): boolean {
  const message = messageOf(error)
  return (
    /messages?\[\d+\]\.content/i.test(message) ||
    /content must be a string/i.test(message) ||
    /content.*must be (a|of type) string/i.test(message) ||
    /expected.*string.*got.*(object|array)/i.test(message) ||
    /invalid.*content.*type/i.test(message) ||
    /content.*not.*valid/i.test(message)
  )
}

/** True for 429 / tokens-per-minute / tokens-per-day provider responses. */
export function isRateLimitError(error: unknown): boolean {
  const status = statusOf(error)
  if (status === 429) return true
  return RATE_LIMIT_PATTERNS.some(pattern => pattern.test(messageOf(error)))
}

/** True for 401 / invalid-key responses. */
export function isAuthError(error: unknown): boolean {
  const status = statusOf(error)
  if (status === 401 || status === 403) return true
  return AUTH_PATTERNS.some(pattern => pattern.test(messageOf(error)))
}

/**
 * Transient / capacity failures that should fail over from Cerebras → Groq.
 * Auth and permanent config errors must NOT trigger failover retries.
 */
export function isTransientProviderFailure(error: unknown): boolean {
  if (isAuthError(error)) return false
  const status = statusOf(error)
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true
  return TRANSIENT_PATTERNS.some(pattern => pattern.test(messageOf(error)))
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const err = error as { status?: number; statusCode?: number; response?: { status?: number } }
  return err.status ?? err.statusCode ?? err.response?.status
}

function scrubProviderLeaks(text: string): string {
  let out = text
  for (const [pattern, replacement] of PROVIDER_LEAK_PATTERNS) {
    out = out.replace(pattern, replacement)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// User-facing error sanitization
// ─────────────────────────────────────────────────────────────────────────────
//
// Raw provider errors are packed with internals a normal user should never see:
// "Parsing failed. … See 'failed_generation'", "service tier `on_demand`",
// tool schemas, HTTP internals. Aura's own fallback paths handle most of these
// transparently; this maps whatever still escapes to a clean, honest message.
// Detailed diagnostics are recorded separately (dev logs, console), never here.

export interface SanitizedError {
  message: string
  detail?: string // raw text, shown only in Developer Mode
}

export function sanitizeProviderError(raw: unknown): SanitizedError {
  const message = messageOf(raw)
  const detail = message

  // The model tried to call a web tool that wasn't registered for this request.
  // Surface a clean, honest message instead of the provider's "not in
  // request.tools" validation error (raw internal detail stays in dev logs).
  if (isWebToolValidationError(raw)) {
    return {
      message: "I couldn't complete the web search because the search tool wasn't available for this request.",
      detail,
    }
  }
  if (isToolCallParseError(raw)) {
    return {
      message: "I couldn't complete that with the AI service. I'm trying a different approach.",
      detail,
    }
  }
  if (isRateLimitError(raw) || isTransientProviderFailure(raw)) {
    return {
      message: 'Aura is temporarily unavailable. Please try again in a moment.',
      detail,
    }
  }
  if (isAuthError(raw)) {
    return {
      message: "Aura couldn't authenticate with the AI service.",
      detail,
    }
  }

  return { message: scrubProviderLeaks(message), detail }
}
