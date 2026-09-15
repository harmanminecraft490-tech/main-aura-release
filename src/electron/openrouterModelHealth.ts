/**
 * OPENROUTER MODEL HEALTH TRACKER
 *
 * Tracks per-model runtime health: success/failure rates, latency, cooldowns.
 * Used by the router to score and exclude temporarily unhealthy models.
 *
 * All state is in-memory (resets on restart). No disk I/O.
 */

import type { ModelHealth } from './openrouterFreeModels'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const INITIAL_COOLDOWN_MS = 30_000       // 30s after 3 consecutive failures
const MAX_COOLDOWN_MS = 10 * 60_000      // 10 minutes max backoff
const CONSECUTIVE_FAIL_THRESHOLD = 3
const LATENCY_ALPHA = 0.2                // EMA smoothing factor

// ─────────────────────────────────────────────────────────────────────────────
// Health store
// ─────────────────────────────────────────────────────────────────────────────

const healthStore = new Map<string, ModelHealth>()

function getOrCreate(modelId: string): ModelHealth {
  let entry = healthStore.get(modelId)
  if (!entry) {
    entry = {
      requestCount: 0,
      successCount: 0,
      failureCount: 0,
      timeoutCount: 0,
      http429Count: 0,
      http5xxCount: 0,
      avgLatencyMs: 0,
      toolCallSuccess: 0,
      malformedResponseCount: 0,
      lastSuccessAt: 0,
      cooldownUntil: 0,
      consecutiveFailures: 0,
    }
    healthStore.set(modelId, entry)
  }
  return entry
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function recordRequest(modelId: string): void {
  const h = getOrCreate(modelId)
  h.requestCount += 1
}

export function recordSuccess(modelId: string, latencyMs: number): void {
  const h = getOrCreate(modelId)
  h.successCount += 1
  h.consecutiveFailures = 0
  h.lastSuccessAt = Date.now()
  // Exponential moving average for latency
  h.avgLatencyMs = h.avgLatencyMs === 0
    ? latencyMs
    : h.avgLatencyMs * (1 - LATENCY_ALPHA) + latencyMs * LATENCY_ALPHA
}

export function recordFailure(
  modelId: string,
  kind: 'generic' | 'timeout' | '429' | '5xx' | 'malformed' | 'auth'
): void {
  const h = getOrCreate(modelId)
  h.failureCount += 1
  h.consecutiveFailures += 1

  switch (kind) {
    case 'timeout': h.timeoutCount += 1; break
    case '429': h.http429Count += 1; break
    case '5xx': h.http5xxCount += 1; break
    case 'malformed': h.malformedResponseCount += 1; break
    default: break
  }

  // Apply cooldown after threshold consecutive failures
  if (h.consecutiveFailures >= CONSECUTIVE_FAIL_THRESHOLD) {
    const backoffMultiplier = Math.min(
      Math.pow(2, h.consecutiveFailures - CONSECUTIVE_FAIL_THRESHOLD),
      MAX_COOLDOWN_MS / INITIAL_COOLDOWN_MS
    )
    const cooldownMs = Math.min(INITIAL_COOLDOWN_MS * backoffMultiplier, MAX_COOLDOWN_MS)
    h.cooldownUntil = Date.now() + cooldownMs
    // eslint-disable-next-line no-console
    console.warn(`[openrouter-health] ${modelId} cooldown ${Math.round(cooldownMs / 1000)}s (${h.consecutiveFailures} consecutive failures)`)
  }
}

export function recordToolCallSuccess(modelId: string): void {
  const h = getOrCreate(modelId)
  h.toolCallSuccess += 1
}

export function isModelHealthy(modelId: string, now = Date.now()): boolean {
  const h = healthStore.get(modelId)
  if (!h) return true // no data = assume healthy
  if (h.cooldownUntil > now) return false
  return true
}

export function getModelHealth(modelId: string): ModelHealth | undefined {
  return healthStore.get(modelId)
}

export function getSuccessRate(modelId: string): number {
  const h = healthStore.get(modelId)
  if (!h || h.requestCount === 0) return 1.0 // optimistic default
  return h.successCount / h.requestCount
}

export function getAvgLatency(modelId: string): number {
  return healthStore.get(modelId)?.avgLatencyMs ?? 0
}

export function clearModelCooldown(modelId: string): void {
  const h = healthStore.get(modelId)
  if (h) {
    h.cooldownUntil = 0
    h.consecutiveFailures = 0
  }
}

export function clearAllHealth(): void {
  healthStore.clear()
}

export function getAllHealth(): Record<string, ModelHealth> {
  const out: Record<string, ModelHealth> = {}
  for (const [id, health] of healthStore) {
    out[id] = { ...health }
  }
  return out
}
