/**
 * Self-contained checks for Aura provider routing + error classification.
 * Run: npx tsx src/electron/auraProviderRouter.selftest.ts
 */

import assert from 'node:assert/strict'
import {
  clearProviderHealth,
  extractRetryAfterMs,
  getAuraBackends,
  invalidateAuraBackendCache,
  isAuraManagedProfile,
  isProviderHealthy,
  markProviderUnhealthy,
  resolveAuraBackendChain,
} from './auraProviderRouter'
import {
  isAuthError,
  isRateLimitError,
  isTransientProviderFailure,
  sanitizeProviderError,
} from './toolCallNormalizer'

function section(title: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n══ ${title} ══`)
}

function pass(name: string): void {
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}`)
}

section('Aura managed profile identity')
assert.equal(isAuraManagedProfile({ locked: true, isDefault: true, name: 'Default Profile', displayName: 'Default Profile' }), true)
assert.equal(isAuraManagedProfile({ locked: true, isDefault: false, name: 'Aura', displayName: 'Aura' }), true)
assert.equal(isAuraManagedProfile({ locked: false, isDefault: true, name: 'Default Profile', displayName: 'Default Profile' }), false)
assert.equal(isAuraManagedProfile({ locked: true, isDefault: false, name: 'Work', displayName: 'Work' }), false)
pass('locked Default Profile / Aura are managed; others are not')

section('Backend chain — Cerebras primary, Groq fallback')
process.env.CEREBRAS_API_KEY = 'csk-test-primary'
process.env.CEREBRAS_BASE_URL = 'https://api.cerebras.ai/v1'
process.env.CEREBRAS_MODEL = 'gpt-oss-120b'
process.env.GROQ_API_KEY = 'gsk-test-fallback'
process.env.GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
process.env.GROQ_MODEL = 'openai/gpt-oss-120b'
invalidateAuraBackendCache()
clearProviderHealth()

const backends = getAuraBackends()
assert.equal(backends.cerebras.provider, 'cerebras')
assert.equal(backends.groq.provider, 'groq')
assert.equal(backends.cerebras.apiKey, 'csk-test-primary')
assert.equal(backends.groq.apiKey, 'gsk-test-fallback')

const healthyChain = resolveAuraBackendChain()
assert.deepEqual(healthyChain.map(b => b.id), ['cerebras', 'groq'])
pass('healthy: Cerebras then Groq')

section('TEST 2 pattern — rate-limit health prefers Groq immediately')
markProviderUnhealthy('cerebras', '429 rate limit', 60_000)
assert.equal(isProviderHealthy('cerebras'), false)
const degraded = resolveAuraBackendChain()
assert.equal(degraded[0]?.id, 'groq')
pass('Cerebras unhealthy → Groq preferred first')

clearProviderHealth()
assert.equal(isProviderHealthy('cerebras'), true)
assert.equal(resolveAuraBackendChain()[0]?.id, 'cerebras')
pass('after cooldown clear → Cerebras primary again')

section('Error classification')
assert.equal(isRateLimitError({ status: 429, message: 'Too Many Requests' }), true)
assert.equal(isTransientProviderFailure({ status: 429, message: 'rate limit' }), true)
assert.equal(isTransientProviderFailure({ status: 503, message: 'Service Unavailable' }), true)
assert.equal(isTransientProviderFailure({ status: 502, message: 'Bad Gateway' }), true)
assert.equal(isTransientProviderFailure({ status: 504, message: 'Gateway Timeout' }), true)
assert.equal(isTransientProviderFailure(new Error('ETIMEDOUT')), true)
assert.equal(isTransientProviderFailure(new Error('fetch failed')), true)
assert.equal(isTransientProviderFailure(new Error('ECONNRESET')), true)
assert.equal(isAuthError({ status: 401, message: 'Invalid API Key' }), true)
assert.equal(isTransientProviderFailure({ status: 401, message: 'Invalid API Key' }), false)
pass('429/5xx/timeout/network failover; auth does not')

section('No provider leakage in user errors')
const rate = sanitizeProviderError({ status: 429, message: 'Cerebras 429 rate_limit on groq openai/gpt-oss-120b' })
assert.equal(rate.message.includes('Cerebras'), false)
assert.equal(rate.message.includes('Groq'), false)
assert.equal(rate.message.includes('groq'), false)
assert.equal(rate.message.includes('gpt-oss'), false)
assert.match(rate.message, /Aura/i)

const auth = sanitizeProviderError({ status: 401, message: 'Invalid Groq API key' })
assert.equal(auth.message.includes('Groq'), false)
assert.match(auth.message, /Aura/i)
pass('sanitized errors never name Cerebras/Groq/raw models')

section('Retry-After parsing')
const ms = extractRetryAfterMs({ headers: { 'retry-after': '30' } })
assert.equal(ms, 30_000)
pass('Retry-After seconds → ms')

section('Missing keys skipped')
delete process.env.CEREBRAS_API_KEY
invalidateAuraBackendCache()
clearProviderHealth()
const groqOnly = resolveAuraBackendChain()
assert.deepEqual(groqOnly.map(b => b.id), ['groq'])
pass('no Cerebras key → Groq only')

process.env.CEREBRAS_API_KEY = 'csk-test-primary'
delete process.env.GROQ_API_KEY
invalidateAuraBackendCache()
const cerebrasOnly = resolveAuraBackendChain()
assert.deepEqual(cerebrasOnly.map(b => b.id), ['cerebras'])
pass('no Groq key → Cerebras only')

// eslint-disable-next-line no-console
console.log('\nAll Aura provider router self-tests passed.\n')
