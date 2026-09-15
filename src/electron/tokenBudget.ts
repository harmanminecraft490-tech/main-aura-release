/**
 * PROVIDER TOKEN BUDGET — rolling per-provider TPM governor.
 *
 * Providers (notably Groq free tier: 8,000 TPM) reject a request as 429 when
 * `input + max_tokens` exceeds the per-minute window. Aura used to discover this
 * only AFTER sending — and the single retry then burned even more of the window.
 *
 * This module self-paces instead. It tracks a rolling 60s window per provider
 * and, before each request, shrinks `max_tokens` (or waits only when unavoidable)
 * so the request always fits the remaining budget. 429s become the exception
 * rather than the rule, and nothing is slowed down: sending a smaller payload is
 * faster than sending a big one and then retrying.
 *
 * Pure module (no electron) so it can be unit-tested.
 */

export interface BudgetPlan {
  maxTokens: number
  waitMs: number
}

interface UsageEntry {
  ts: number
  tokens: number
}

const WINDOW_MS = 60_000
/** Never shrink an answer below this many output tokens. */
const FLOOR_TOKENS = 512
/** Conservative default for providers without an entry in the table. */
const DEFAULT_TPM = 200_000

class ProviderTokenBudget {
  private tpm: Record<string, number>
  private usage = new Map<string, UsageEntry[]>()

  constructor(tpm: Record<string, number> = {}) {
    this.tpm = tpm
  }

  private cap(provider: string): number {
    return this.tpm[provider] ?? DEFAULT_TPM
  }

  private prune(provider: string, now: number): UsageEntry[] {
    const cutoff = now - WINDOW_MS
    const entries = (this.usage.get(provider) ?? []).filter(entry => entry.ts >= cutoff)
    this.usage.set(provider, entries)
    return entries
  }

  /** Tokens consumed by this provider in the current rolling window. */
  used(provider: string, now = Date.now()): number {
    return this.prune(provider, now).reduce((sum, entry) => sum + entry.tokens, 0)
  }

  /** Tokens still available in the current rolling window. */
  available(provider: string, now = Date.now()): number {
    return Math.max(0, this.cap(provider) - this.used(provider, now))
  }

  /** Record `tokens` consumed by this provider. Call BEFORE sending a request
   *  so a busy window never lets a second request over-commit. */
  consume(provider: string, tokens: number, now = Date.now()): void {
    if (tokens <= 0) return
    this.prune(provider, now)
    const entries = this.usage.get(provider) ?? []
    entries.push({ ts: now, tokens })
    this.usage.set(provider, entries)
  }

  /**
   * Plan one request so `input + max_tokens` fits the remaining window.
   *  - Fits → return the requested maxTokens, no wait.
   *  - Doesn't fit → shrink maxTokens (floored at FLOOR_TOKENS), no wait.
   *  - Even the floor doesn't fit → wait until enough of the window frees up
   *    (capped; only when a single request's input is enormous).
   */
  plan(provider: string, inputTokens: number, requestedMax: number, now = Date.now()): BudgetPlan {
    const available = this.available(provider, now)
    const headroom = available - inputTokens
    if (headroom >= requestedMax) return { maxTokens: requestedMax, waitMs: 0 }

    const fitMax = Math.max(FLOOR_TOKENS, headroom)
    if (fitMax >= FLOOR_TOKENS) return { maxTokens: Math.min(requestedMax, fitMax), waitMs: 0 }

    // Input alone nearly fills the window — find when enough budget frees.
    const need = inputTokens + FLOOR_TOKENS
    const cap = this.cap(provider)
    const entries = [...this.prune(provider, now)].sort((a, b) => a.ts - b.ts)
    let released = 0
    for (const entry of entries) {
      released += entry.tokens
      if (this.used(provider, now) - released + need <= cap) {
        return { maxTokens: FLOOR_TOKENS, waitMs: Math.min(WINDOW_MS, Math.max(0, entry.ts + WINDOW_MS - now)) }
      }
    }
    return { maxTokens: FLOOR_TOKENS, waitMs: Math.min(WINDOW_MS, 15_000) }
  }
}

/** Per-provider TPM ceilings. Unknown providers get a generous default. */
export const providerTokenBudget = new ProviderTokenBudget({
  groq: 8_000,
  cerebras: 60_000,
  moonshot: 10_000,
  zai: 10_000,
  openrouter: 20_000,
  nvidia: 100_000,
})
