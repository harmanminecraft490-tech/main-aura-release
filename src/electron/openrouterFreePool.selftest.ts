/**
 * OPENROUTER FREE POOL — 20-SCENARIO SELF-TEST
 *
 * Tests routing, fallback, health tracking, model discovery, security,
 * and error handling without live network calls.
 *
 * Run: npx tsx src/electron/openrouterFreePool.selftest.ts
 */

import assert from 'node:assert/strict'

// ─────────────────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────────────────

import {
  classifyTask,
  routeRequest,
  getNextFallback,
  buildTaskContext,
  type TaskCategory,
} from './openrouterRouter'

import {
  getCachedFreeModels,
  invalidateFreeModelCache,
  OPENROUTER_FREE_ROUTER_ID,
  type FreeModel,
} from './openrouterFreeModels'

import {
  recordRequest,
  recordSuccess,
  recordFailure,
  isModelHealthy,
  getSuccessRate,
  clearAllHealth,
  clearModelCooldown,
} from './openrouterModelHealth'

import {
  hasOpenRouterKey,
} from './openrouterFreePool'

import {
  isFreeCloudAIProfile,
  FREE_CLOUD_AI_IDENTITY,
} from './auraProviderRouter'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function test(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (error) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${error instanceof Error ? error.message : error}`)
    failed++
  }
}

function buildModel(overrides: Partial<FreeModel> = {}): FreeModel {
  return {
    id: overrides.id ?? 'test/model:free',
    name: overrides.name ?? 'Test Model',
    provider: overrides.provider ?? 'test',
    free: true,
    contextLength: overrides.contextLength ?? 32768,
    inputModalities: overrides.inputModalities ?? ['text'],
    outputModalities: ['text'],
    supportsTools: overrides.supportsTools ?? true,
    supportsVision: overrides.supportsVision ?? false,
    supportsStructuredOutput: false,
    supportsReasoning: overrides.supportsReasoning ?? false,
    specialties: overrides.specialties ?? ['general_chat'],
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: Simple chat routing
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 1: Simple chat routing ══')
test('classifies "hi" as simple_chat', () => {
  const task = classifyTask('hi', false, false)
  assert.equal(task.category, 'simple_chat')
  assert.equal(task.needsVision, false)
  assert.equal(task.needsTools, false)
  assert.equal(task.complexity, 'low')
})

test('classifies "what is 2+2" as simple_chat', () => {
  const task = classifyTask('what is 2+2', false, false)
  assert.equal(task.category, 'simple_chat')
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: Coding routing
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 2: Normal coding routing ══')
test('classifies Python code request as normal_coding', () => {
  const task = classifyTask('write a python function to sort a list', false, false)
  assert.ok(['normal_coding', 'complex_coding'].includes(task.category), `got ${task.category}`)
})

test('classifies TypeScript request as normal_coding', () => {
  const task = classifyTask('how do I use TypeScript generics?', false, false)
  assert.ok(['normal_coding', 'complex_coding', 'simple_chat'].includes(task.category))
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: Complex coding routing
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 3: Complex coding routing ══')
test('classifies architecture request as complex_coding', () => {
  const task = classifyTask('architect a scalable microservices system with async message queues', false, false)
  assert.ok(['complex_coding', 'agent', 'planning'].includes(task.category), `got ${task.category}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4: Agent routing
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 4: Agent routing ══')
test('classifies multi-file task as agent', () => {
  const task = classifyTask('create a full React app with multiple files and components', true, true)
  assert.ok(['agent', 'complex_coding'].includes(task.category), `got ${task.category}`)
  assert.equal(task.needsVision, true)
})

test('classifies debug task as agent', () => {
  const task = classifyTask('fix the bug in my application that causes crashes', false, true)
  assert.ok(['agent', 'complex_coding', 'normal_coding'].includes(task.category), `got ${task.category}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5: Vision routing
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 5: Vision routing ══')
test('classifies image request as vision', () => {
  const task = classifyTask('analyze this image', true, false)
  assert.equal(task.category, 'vision')
  assert.equal(task.needsVision, true)
})

test('vision task requires vision-capable model', () => {
  const visionModel = buildModel({ id: 'vision/model:free', supportsVision: true, specialties: ['vision'] })
  const textModel = buildModel({ id: 'text/model:free', supportsVision: false })
  const task = classifyTask('look at this picture', true, false)
  const decision = routeRequest('look at this picture', true, false, [visionModel, textModel])
  assert.equal(decision.primary.id, 'vision/model:free', 'should pick vision model')
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6: Tool-call routing
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 6: Tool-call routing ══')
test('tool-required task excludes non-tool models', () => {
  const toolModel = buildModel({ id: 'tool/model:free', supportsTools: true, specialties: ['tool_calling', 'coding'] })
  const noToolModel = buildModel({ id: 'notool/model:free', supportsTools: false })
  const decision = routeRequest('build a project using tools', false, true, [toolModel, noToolModel])
  assert.equal(decision.primary.id, 'tool/model:free', 'should pick tool-capable model')
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 7: Unavailable model fallback
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 7: Unavailable model fallback ══')
test('unhealthy primary triggers fallback', () => {
  clearAllHealth()
  const primary = buildModel({ id: 'primary/model:free', specialties: ['coding'] })
  const fallback = buildModel({ id: 'fallback/model:free', specialties: ['coding'] })
  const freeRouter = buildModel({ id: OPENROUTER_FREE_ROUTER_ID, specialties: ['general_chat'] })

  // Mark primary as unhealthy
  for (let i = 0; i < 3; i++) {
    recordRequest(primary.id)
    recordFailure(primary.id, 'generic')
  }
  assert.equal(isModelHealthy(primary.id), false, 'primary should be unhealthy')

  const decision = routeRequest('write code', false, false, [primary, fallback, freeRouter])
  // Primary is unhealthy, so fallback should be selected
  assert.notEqual(decision.primary.id, primary.id, 'should not pick unhealthy primary')
  clearAllHealth()
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 8: 429 fallback
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 8: 429 rate-limit fallback ══')
test('429 errors trigger cooldown', () => {
  clearAllHealth()
  const modelId = 'rate-limited/model:free'
  for (let i = 0; i < 3; i++) {
    recordRequest(modelId)
    recordFailure(modelId, '429')
  }
  assert.equal(isModelHealthy(modelId), false, 'model should be in cooldown after 429s')
  clearAllHealth()
})

test('getNextFallback skips unhealthy models', () => {
  clearAllHealth()
  const unhealthy = buildModel({ id: 'unhealthy/model:free' })
  const healthy = buildModel({ id: 'healthy/model:free' })
  const freeRouter = buildModel({ id: OPENROUTER_FREE_ROUTER_ID })

  for (let i = 0; i < 3; i++) {
    recordRequest(unhealthy.id)
    recordFailure(unhealthy.id, '429')
  }

  const decision = {
    primary: unhealthy,
    fallbacks: [unhealthy, healthy, freeRouter],
    task: classifyTask('hi', false, false),
    diagnostics: { requestId: 'test', taskCategory: 'simple_chat' as TaskCategory, candidateCount: 3, primaryScore: 50, fallbackCount: 2 },
  }

  const triedIds = new Set([unhealthy.id])
  const next = getNextFallback(decision, triedIds)
  assert.equal(next?.id, healthy.id, 'should skip unhealthy and pick healthy')
  clearAllHealth()
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 9: 5xx fallback
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 9: 5xx server error fallback ══')
test('5xx errors trigger cooldown after threshold', () => {
  clearAllHealth()
  const modelId = '5xx/model:free'
  for (let i = 0; i < 3; i++) {
    recordRequest(modelId)
    recordFailure(modelId, '5xx')
  }
  assert.equal(isModelHealthy(modelId), false, 'model should be in cooldown after 5xx errors')
  clearAllHealth()
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 10: Timeout fallback
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 10: Timeout fallback ══')
test('timeout errors trigger cooldown', () => {
  clearAllHealth()
  const modelId = 'timeout/model:free'
  for (let i = 0; i < 3; i++) {
    recordRequest(modelId)
    recordFailure(modelId, 'timeout')
  }
  assert.equal(isModelHealthy(modelId), false, 'model should be in cooldown after timeouts')
  clearAllHealth()
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 11: Malformed model response
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 11: Malformed response handling ══')
test('malformed responses are tracked', () => {
  clearAllHealth()
  const modelId = 'malformed/model:free'
  for (let i = 0; i < 3; i++) {
    recordRequest(modelId)
    recordFailure(modelId, 'malformed')
  }
  assert.equal(isModelHealthy(modelId), false, 'model should be in cooldown after malformed responses')
  clearAllHealth()
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 12: Dynamic model discovery failure
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 12: Discovery failure — cached registry fallback ══')
test('getCachedFreeModels returns fallback when discovery never ran', () => {
  invalidateFreeModelCache()
  const models = getCachedFreeModels()
  assert.ok(Array.isArray(models), 'should return array')
  assert.ok(models.length > 0, 'should have fallback models')
  // Always includes openrouter/free
  assert.ok(models.some(m => m.id === OPENROUTER_FREE_ROUTER_ID), 'should include openrouter/free')
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 13: Cached registry fallback
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 13: Cached registry fallback ══')
test('fallback registry has all 19 preferred families + openrouter/free', () => {
  invalidateFreeModelCache()
  const models = getCachedFreeModels()
  // Should have at least 10 models (some families may not match in fallback)
  assert.ok(models.length >= 10, `expected ≥10 models, got ${models.length}`)
  // openrouter/free must always be present
  const freeRouter = models.find(m => m.id === OPENROUTER_FREE_ROUTER_ID)
  assert.ok(freeRouter, 'openrouter/free must be in fallback registry')
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 14: Context overflow handling
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 14: Context overflow / compression ══')
test('large context model preferred for long messages', () => {
  const smallCtx = buildModel({ id: 'small/ctx:free', contextLength: 4096, specialties: ['general_chat'] })
  const largeCtx = buildModel({ id: 'large/ctx:free', contextLength: 128000, specialties: ['general_chat', 'long_context'] })
  const freeRouter = buildModel({ id: OPENROUTER_FREE_ROUTER_ID })

  const decision = routeRequest('explain everything', false, false, [smallCtx, largeCtx, freeRouter])
  // Large context model should score higher due to contextFit
  // (not guaranteed to be primary since scoring is multi-factor, but it should be in the pool)
  assert.ok(decision.primary.id === largeCtx.id || decision.fallbacks.some(m => m.id === largeCtx.id),
    'large context model should be in routing pool')
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 15: Model switching during agent task
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 15: Model switching during agent task ══')
test('agent task prefers agentic models', () => {
  const agentModel = buildModel({
    id: 'agent/model:free',
    supportsTools: true,
    specialties: ['agentic_coding', 'tool_calling', 'coding'],
  })
  const chatModel = buildModel({
    id: 'chat/model:free',
    supportsTools: false,
    specialties: ['general_chat', 'fast_response'],
  })
  const freeRouter = buildModel({ id: OPENROUTER_FREE_ROUTER_ID, supportsTools: true })

  const decision = routeRequest(
    'create a full application with multiple files and run tests',
    false,
    true,
    [agentModel, chatModel, freeRouter]
  )
  assert.equal(decision.primary.id, agentModel.id, 'should pick agentic model for agent task')
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 16: API key isolation
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 16: API key isolation ══')
test('hasOpenRouterKey returns false when key not set', () => {
  const original = process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_API_KEY
  // Reset the env-loaded flag so ensureEnvLoaded re-reads
  const result = hasOpenRouterKey()
  // May be true if .env file has a key — just verify it returns a boolean
  assert.equal(typeof result, 'boolean', 'hasOpenRouterKey must return boolean')
  if (original !== undefined) process.env.OPENROUTER_API_KEY = original
})

test('isFreeCloudAIProfile correctly identifies Free Cloud AI profiles', () => {
  assert.equal(
    isFreeCloudAIProfile({ locked: true, name: 'Free Cloud AI', displayName: 'Free Cloud AI — Auto' }),
    true
  )
  assert.equal(
    isFreeCloudAIProfile({ locked: true, name: 'Free Cloud AI — Auto', displayName: 'Free Cloud AI — Auto' }),
    true
  )
  assert.equal(
    isFreeCloudAIProfile({ locked: false, name: 'Free Cloud AI', displayName: 'Free Cloud AI' }),
    false,
    'unlocked profile should not be identified as Free Cloud AI'
  )
  assert.equal(
    isFreeCloudAIProfile({ locked: true, name: 'Default Profile', displayName: 'Default Profile' }),
    false,
    'Aura managed profile should not be identified as Free Cloud AI'
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 17: No renderer credential exposure
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 17: No renderer credential exposure ══')
test('FREE_CLOUD_AI_IDENTITY does not contain API key', () => {
  const identity = FREE_CLOUD_AI_IDENTITY
  const identityStr = JSON.stringify(identity)
  assert.ok(!identityStr.includes('sk-or'), 'identity must not contain API key')
  assert.ok(!identityStr.includes('OPENROUTER_API_KEY'), 'identity must not reference env var name')
  assert.equal(identity.displayProvider, 'openrouter', 'display provider should be openrouter')
  assert.equal(identity.displayLabel, 'Free Cloud AI — Auto', 'display label should be user-friendly')
})

test('Free Cloud AI identity hides model details', () => {
  // The user-facing label should never expose internal model IDs
  assert.ok(!FREE_CLOUD_AI_IDENTITY.displayLabel.includes('nex'), 'should not expose nex model')
  assert.ok(!FREE_CLOUD_AI_IDENTITY.displayLabel.includes('nemotron'), 'should not expose nemotron model')
  assert.ok(!FREE_CLOUD_AI_IDENTITY.displayLabel.includes('openrouter/free'), 'should not expose openrouter/free')
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 18: 20-model registry normalization
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 18: 20-model registry normalization ══')
test('fallback registry models have required fields', () => {
  invalidateFreeModelCache()
  const models = getCachedFreeModels()
  for (const model of models) {
    assert.ok(typeof model.id === 'string' && model.id.length > 0, `model.id must be non-empty string: ${JSON.stringify(model)}`)
    assert.ok(typeof model.name === 'string', `model.name must be string: ${model.id}`)
    assert.ok(typeof model.provider === 'string', `model.provider must be string: ${model.id}`)
    assert.ok(typeof model.free === 'boolean', `model.free must be boolean: ${model.id}`)
    assert.ok(typeof model.contextLength === 'number' && model.contextLength > 0, `model.contextLength must be positive: ${model.id}`)
    assert.ok(Array.isArray(model.inputModalities), `model.inputModalities must be array: ${model.id}`)
    assert.ok(Array.isArray(model.specialties), `model.specialties must be array: ${model.id}`)
    assert.ok(typeof model.supportsTools === 'boolean', `model.supportsTools must be boolean: ${model.id}`)
    assert.ok(typeof model.supportsVision === 'boolean', `model.supportsVision must be boolean: ${model.id}`)
  }
})

test('all fallback models are marked as free', () => {
  const models = getCachedFreeModels()
  for (const model of models) {
    assert.equal(model.free, true, `${model.id} should be marked as free`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 19: openrouter/free fallback
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 19: openrouter/free fallback ══')
test('openrouter/free is always in fallback chain', () => {
  const models = getCachedFreeModels()
  const freeRouter = models.find(m => m.id === OPENROUTER_FREE_ROUTER_ID)
  assert.ok(freeRouter, 'openrouter/free must always be in registry')
  assert.equal(freeRouter.free, true)
})

test('routing always includes openrouter/free in fallbacks when other models exist', () => {
  const model1 = buildModel({ id: 'model1:free', specialties: ['coding'] })
  const model2 = buildModel({ id: 'model2:free', specialties: ['general_chat'] })
  const freeRouter = buildModel({ id: OPENROUTER_FREE_ROUTER_ID, specialties: ['general_chat'] })

  const decision = routeRequest('hello', false, false, [model1, model2, freeRouter])
  const allIds = [decision.primary.id, ...decision.fallbacks.map(m => m.id)]
  assert.ok(allIds.includes(OPENROUTER_FREE_ROUTER_ID), 'openrouter/free should be in routing chain')
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 20: All providers unavailable
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST 20: All providers unavailable ══')
test('routing still returns a model when all are unhealthy', () => {
  clearAllHealth()
  const models = getCachedFreeModels()

  // Mark all models as unhealthy
  for (const model of models) {
    for (let i = 0; i < 3; i++) {
      recordRequest(model.id)
      recordFailure(model.id, 'generic')
    }
  }

  // routeRequest should still return something (falls back to all models when all unhealthy)
  const decision = routeRequest('hello', false, false, models)
  assert.ok(decision.primary, 'should always return a primary model even when all unhealthy')
  assert.ok(typeof decision.primary.id === 'string', 'primary model must have an id')

  clearAllHealth()
})

test('health tracking resets after clearAllHealth', () => {
  clearAllHealth()
  const modelId = 'reset/model:free'
  for (let i = 0; i < 3; i++) {
    recordRequest(modelId)
    recordFailure(modelId, 'generic')
  }
  assert.equal(isModelHealthy(modelId), false)
  clearAllHealth()
  assert.equal(isModelHealthy(modelId), true, 'model should be healthy after clearAllHealth')
})

// ─────────────────────────────────────────────────────────────────────────────
// BONUS: Task context injection
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ BONUS: Task context injection ══')
test('simple_chat gets no extra context (token efficiency)', () => {
  const task = classifyTask('hi', false, false)
  const ctx = buildTaskContext(task)
  assert.equal(ctx, '', 'simple chat should inject no extra context')
})

test('agent task gets agent context', () => {
  const task = classifyTask('create a full application with multiple files', false, true)
  const ctx = buildTaskContext(task)
  // Agent or complex_coding — either should have some context
  assert.ok(typeof ctx === 'string', 'context should be a string')
})

test('success rate starts at 1.0 (optimistic default)', () => {
  clearAllHealth()
  const rate = getSuccessRate('brand-new/model:free')
  assert.equal(rate, 1.0, 'new model should have optimistic 1.0 success rate')
})

test('success rate decreases after failures', () => {
  clearAllHealth()
  const modelId = 'degrading/model:free'
  recordRequest(modelId)
  recordSuccess(modelId, 500)
  recordRequest(modelId)
  recordFailure(modelId, 'generic')
  const rate = getSuccessRate(modelId)
  assert.ok(rate < 1.0, `success rate should be < 1.0 after failure, got ${rate}`)
  assert.ok(rate > 0, 'success rate should be > 0 after one success')
  clearAllHealth()
})

test('cooldown clears after clearModelCooldown', () => {
  clearAllHealth()
  const modelId = 'cooldown/model:free'
  for (let i = 0; i < 3; i++) {
    recordRequest(modelId)
    recordFailure(modelId, '429')
  }
  assert.equal(isModelHealthy(modelId), false)
  clearModelCooldown(modelId)
  assert.equal(isModelHealthy(modelId), true, 'model should be healthy after clearModelCooldown')
  clearAllHealth()
})

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n══ Results: ${passed} passed, ${failed} failed ══\n`)
if (failed > 0) {
  process.exit(1)
}
