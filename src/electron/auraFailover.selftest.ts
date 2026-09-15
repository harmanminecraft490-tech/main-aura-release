/**
 * Failover simulation — verifies Cerebras→Groq attempt order without live APIs.
 * Run: npx tsx src/electron/auraFailover.selftest.ts
 */

import assert from 'node:assert/strict'
import {
  AURA_MODEL_IDENTITY,
  clearProviderHealth,
  invalidateAuraBackendCache,
  isAuraManagedProfile,
  markProviderUnhealthy,
  resolveAuraBackendChain,
} from './auraProviderRouter'
import { isTransientProviderFailure, sanitizeProviderError } from './toolCallNormalizer'

function simulateRequest(primaryFailsWith?: unknown): { attempted: string[]; publicModel: string; error?: string } {
  const attempted: string[] = []
  const chain = resolveAuraBackendChain()

  for (let i = 0; i < chain.length; i++) {
    const backend = chain[i]
    attempted.push(backend.id)
    const isLast = i === chain.length - 1

    // Simulate primary (first attempt) failure when requested.
    if (i === 0 && primaryFailsWith) {
      if (!isTransientProviderFailure(primaryFailsWith) || isLast) {
        const sanitized = sanitizeProviderError(primaryFailsWith)
        return { attempted, publicModel: AURA_MODEL_IDENTITY.modelName, error: sanitized.message }
      }
      markProviderUnhealthy(backend.id, String((primaryFailsWith as Error)?.message ?? primaryFailsWith))
      continue // immediate failover — no delay
    }

    return { attempted, publicModel: AURA_MODEL_IDENTITY.modelName }
  }

  const sanitized = sanitizeProviderError(primaryFailsWith ?? new Error('unavailable'))
  return { attempted, publicModel: AURA_MODEL_IDENTITY.modelName, error: sanitized.message }
}

process.env.CEREBRAS_API_KEY = 'csk-test'
process.env.GROQ_API_KEY = 'gsk-test'
invalidateAuraBackendCache()
clearProviderHealth()

console.log('\n══ Failover simulations ══')

// TEST 1: Cerebras works — Groq must NOT be called
{
  clearProviderHealth()
  const r = simulateRequest()
  assert.deepEqual(r.attempted, ['cerebras'])
  assert.equal(r.publicModel, 'Aura Model')
  assert.equal(r.error, undefined)
  console.log('  ✓ TEST 1: Cerebras success — Groq not called')
}

// TEST 2: Cerebras 429 → immediate Groq
{
  clearProviderHealth()
  const r = simulateRequest({ status: 429, message: 'rate limit' })
  assert.deepEqual(r.attempted, ['cerebras', 'groq'])
  assert.equal(r.publicModel, 'Aura Model')
  assert.equal(r.error, undefined)
  console.log('  ✓ TEST 2: Cerebras 429 → immediate Groq')
}

// TEST 3: Cerebras timeout → Groq
{
  clearProviderHealth()
  const r = simulateRequest(new Error('ETIMEDOUT'))
  assert.deepEqual(r.attempted, ['cerebras', 'groq'])
  console.log('  ✓ TEST 3: Cerebras timeout → Groq')
}

// TEST 4: Cerebras 503 → Groq
{
  clearProviderHealth()
  const r = simulateRequest({ status: 503, message: 'Service Unavailable' })
  assert.deepEqual(r.attempted, ['cerebras', 'groq'])
  console.log('  ✓ TEST 4: Cerebras 503 → Groq')
}

// TEST 5: Both fail → generic Aura error, no provider names
{
  clearProviderHealth()
  delete process.env.GROQ_API_KEY
  invalidateAuraBackendCache()
  process.env.CEREBRAS_API_KEY = 'csk-test'
  const r = simulateRequest({ status: 503, message: 'Service Unavailable' })
  assert.ok(r.error)
  assert.equal(r.error!.toLowerCase().includes('cerebras'), false)
  assert.equal(r.error!.toLowerCase().includes('groq'), false)
  assert.match(r.error!, /Aura/i)
  console.log('  ✓ TEST 5: both unavailable → generic Aura error')
  process.env.GROQ_API_KEY = 'gsk-test'
  invalidateAuraBackendCache()
}

// Auth must not failover
{
  clearProviderHealth()
  const r = simulateRequest({ status: 401, message: 'Invalid API Key for Cerebras' })
  assert.deepEqual(r.attempted, ['cerebras'])
  assert.ok(r.error)
  assert.equal(r.error!.toLowerCase().includes('cerebras'), false)
  console.log('  ✓ Auth error: no Groq failover, generic Aura message')
}

// TEST 10: UI identity
{
  assert.equal(AURA_MODEL_IDENTITY.providerLabel, 'Aura')
  assert.equal(AURA_MODEL_IDENTITY.modelName, 'Aura Model')
  assert.equal(
    isAuraManagedProfile({ locked: true, isDefault: true, name: 'Default Profile', displayName: 'Default Profile' }),
    true
  )
  console.log('  ✓ TEST 10: UI identity always Aura · Aura Model')
}

console.log('\nAll failover simulation tests passed.\n')
