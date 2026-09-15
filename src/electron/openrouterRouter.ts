/**
 * OPENROUTER FREE MODEL ROUTER
 *
 * Intelligent routing across the 20-model free pool.
 * Classifies requests, scores models, selects the best healthy candidate,
 * and provides a fallback chain.
 *
 * Security: never exposes model IDs or provider details to the renderer.
 * The user sees only "Free Cloud AI — Auto".
 */

import type { FreeModel, ModelSpecialty } from './openrouterFreeModels'
import { OPENROUTER_FREE_ROUTER_ID, getCachedFreeModels } from './openrouterFreeModels'
import {
  isModelHealthy,
  getSuccessRate,
  getAvgLatency,
} from './openrouterModelHealth'

// ─────────────────────────────────────────────────────────────────────────────
// Task classification
// ─────────────────────────────────────────────────────────────────────────────

export type TaskCategory =
  | 'simple_chat'
  | 'normal_coding'
  | 'complex_coding'
  | 'agent'
  | 'reasoning'
  | 'vision'
  | 'fast'
  | 'research'
  | 'planning'

export interface TaskProfile {
  category: TaskCategory
  needsVision: boolean
  needsTools: boolean
  needsReasoning: boolean
  complexity: 'low' | 'medium' | 'high'
  estimatedTokens: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Request classifier
// ─────────────────────────────────────────────────────────────────────────────

const SIMPLE_PATTERNS = [
  /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|great|cool|nice|good|bye|goodbye)[\s!.?]*$/i,
  /^what is \d+[\s+\-*/]\d+/i,
  /^(what('s| is) (the )?(time|date|day|weather))/i,
]

const VISION_PATTERNS = [
  /\b(image|picture|photo|screenshot|diagram|chart|graph|figure|visual|look at|see|show me|analyze this)\b/i,
]

const AGENT_PATTERNS = [
  /\b(create|build|implement|develop|write|generate|make|set up|configure|deploy|refactor|migrate|convert|transform)\b.*\b(project|app|application|system|service|api|component|module|file|folder|directory|codebase)\b/i,
  /\b(fix|debug|resolve|solve|investigate|diagnose)\b.*\b(bug|error|issue|problem|crash|failure|exception)\b/i,
  /\b(run|execute|test|verify|check|validate)\b.*\b(command|script|test|suite|build|pipeline)\b/i,
  /multiple files|several files|entire codebase|whole project/i,
]

const COMPLEX_CODING_PATTERNS = [
  /\b(architect|design|implement|refactor|optimize|migrate)\b.*\b(system|service|api|database|infrastructure|pipeline)\b/i,
  /\b(algorithm|data structure|performance|scalability|concurrency|async|parallel)\b/i,
  /\b(typescript|rust|go|c\+\+|java|kotlin|swift)\b.*\b(complex|advanced|production|enterprise)\b/i,
]

const NORMAL_CODING_PATTERNS = [
  /\b(code|function|class|method|variable|loop|array|object|string|number|boolean)\b/i,
  /\b(javascript|typescript|python|java|c#|php|ruby|go|rust|swift|kotlin)\b/i,
  /\b(html|css|react|vue|angular|node|express|django|flask|spring)\b/i,
  /```|`[^`]+`/,
  /\.(js|ts|py|java|cs|php|rb|go|rs|swift|kt|html|css|json|yaml|yml|toml|sh|bash)\b/i,
]

const REASONING_PATTERNS = [
  /\b(analyze|analyse|evaluate|assess|compare|contrast|pros and cons|trade-off|tradeoff)\b/i,
  /\b(why|how does|explain|reason|logic|think through|step by step|carefully)\b/i,
  /\b(philosophy|ethics|strategy|decision|complex problem|nuanced)\b/i,
]

const RESEARCH_PATTERNS = [
  /\b(research|investigate|find out|look up|search|explore|survey|review|summarize)\b/i,
  /\b(latest|current|recent|news|update|release|version|announcement)\b/i,
]

const PLANNING_PATTERNS = [
  /\b(plan|roadmap|architecture|design|outline|structure|organize|strategy|approach)\b/i,
  /\b(step by step|phases|milestones|timeline|breakdown|decompose)\b/i,
]

export function classifyTask(
  userMessage: string,
  hasImages: boolean,
  toolsEnabled: boolean
): TaskProfile {
  const msg = userMessage.trim()
  const lower = msg.toLowerCase()

  // Vision always wins if images present
  if (hasImages || VISION_PATTERNS.some(p => p.test(msg))) {
    return {
      category: 'vision',
      needsVision: true,
      needsTools: toolsEnabled,
      needsReasoning: false,
      complexity: 'medium',
      estimatedTokens: estimateTokens(msg),
    }
  }

  // Simple chat — very short or trivial
  if (msg.length < 60 && SIMPLE_PATTERNS.some(p => p.test(msg))) {
    return {
      category: 'simple_chat',
      needsVision: false,
      needsTools: false,
      needsReasoning: false,
      complexity: 'low',
      estimatedTokens: estimateTokens(msg),
    }
  }

  // Agent tasks
  if (AGENT_PATTERNS.some(p => p.test(msg)) || (toolsEnabled && msg.length > 200)) {
    return {
      category: 'agent',
      needsVision: false,
      needsTools: true,
      needsReasoning: true,
      complexity: 'high',
      estimatedTokens: estimateTokens(msg),
    }
  }

  // Complex coding
  if (COMPLEX_CODING_PATTERNS.some(p => p.test(msg))) {
    return {
      category: 'complex_coding',
      needsVision: false,
      needsTools: toolsEnabled,
      needsReasoning: true,
      complexity: 'high',
      estimatedTokens: estimateTokens(msg),
    }
  }

  // Normal coding
  if (NORMAL_CODING_PATTERNS.some(p => p.test(msg))) {
    return {
      category: 'normal_coding',
      needsVision: false,
      needsTools: toolsEnabled,
      needsReasoning: false,
      complexity: 'medium',
      estimatedTokens: estimateTokens(msg),
    }
  }

  // Reasoning / planning
  if (REASONING_PATTERNS.some(p => p.test(lower))) {
    return {
      category: 'reasoning',
      needsVision: false,
      needsTools: false,
      needsReasoning: true,
      complexity: 'high',
      estimatedTokens: estimateTokens(msg),
    }
  }

  if (PLANNING_PATTERNS.some(p => p.test(lower))) {
    return {
      category: 'planning',
      needsVision: false,
      needsTools: toolsEnabled,
      needsReasoning: true,
      complexity: 'high',
      estimatedTokens: estimateTokens(msg),
    }
  }

  if (RESEARCH_PATTERNS.some(p => p.test(lower))) {
    return {
      category: 'research',
      needsVision: false,
      needsTools: false,
      needsReasoning: false,
      complexity: 'medium',
      estimatedTokens: estimateTokens(msg),
    }
  }

  // Fast / short messages
  if (msg.length < 120) {
    return {
      category: 'fast',
      needsVision: false,
      needsTools: false,
      needsReasoning: false,
      complexity: 'low',
      estimatedTokens: estimateTokens(msg),
    }
  }

  // Default: general chat
  return {
    category: 'simple_chat',
    needsVision: false,
    needsTools: toolsEnabled,
    needsReasoning: false,
    complexity: 'medium',
    estimatedTokens: estimateTokens(msg),
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// ─────────────────────────────────────────────────────────────────────────────
// Preferred model ordering per task category
// ─────────────────────────────────────────────────────────────────────────────

// Maps task category → preferred model family names (in priority order)
const CATEGORY_PREFERENCES: Record<TaskCategory, string[]> = {
  simple_chat: [
    'Nemotron 3.5 Lightning',
    'LFM2.5-2.6B',
    'Inkling Small',
    'MiniMax M2.7',
    'Ling 3.0 Flash',
  ],
  fast: [
    'Nemotron 3.5 Lightning',
    'LFM2.5-2.6B',
    'Inkling Small',
    'MiniMax M2.7',
    'Ling 3.0 Flash',
  ],
  normal_coding: [
    'North Mini Code',
    'Laguna XS 2.1',
    'Nex-N2.5-Mini',
    'Nemotron 3.5 Lightning',
    'GPT-OSS 20B',
  ],
  complex_coding: [
    'Nex-N2.5-Pro',
    'Laguna S 2.1',
    'North Mini Code',
    'Nemotron 3 Ultra',
    'Nex-N2.5-Mini',
  ],
  agent: [
    'Nex-N2.5-Pro',
    'Laguna S 2.1',
    'Nemotron 3 Ultra',
    'North Mini Code',
    'Nex-N2.5-Mini',
  ],
  reasoning: [
    'Nemotron 3 Ultra',
    'Nemotron 3 Super',
    'MiniMax M3',
    'Inkling',
    'Nex-N2.5-Pro',
  ],
  planning: [
    'Nemotron 3 Ultra',
    'Nemotron 3 Super',
    'MiniMax M3',
    'Nex-N2.5-Pro',
    'Laguna S 2.1',
  ],
  vision: [
    'Nex-N2.5-Pro',
    'Ling 3.0 Flash VL',
    'Inkling',
    'Gemma 4 26B A4B',
  ],
  research: [
    'Nemotron 3 Ultra',
    'MiniMax M3',
    'Inkling',
    'Nex-N2.5-Pro',
    'Nemotron 3 Super',
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Model scoring
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelScore {
  model: FreeModel
  score: number
  reasons: string[]
}

/**
 * Score a model for a given task profile.
 * Higher = better. Returns 0 for hard-disqualified models.
 */
export function scoreModel(model: FreeModel, task: TaskProfile, preferredFamilies: string[]): number {
  let score = 0
  const reasons: string[] = []

  // Hard disqualify: vision required but model doesn't support it
  if (task.needsVision && !model.supportsVision) return 0

  // Hard disqualify: tools required but model doesn't support them
  if (task.needsTools && !model.supportsTools) return 0

  // Capability match (40 points)
  const capabilityScore = computeCapabilityMatch(model, task)
  score += capabilityScore * 40
  reasons.push(`capability=${capabilityScore.toFixed(2)}`)

  // Tool support match (20 points)
  if (task.needsTools && model.supportsTools) {
    score += 20
    reasons.push('tools=yes')
  } else if (!task.needsTools) {
    score += 10 // neutral
  }

  // Reliability (15 points)
  const successRate = getSuccessRate(model.id)
  score += successRate * 15
  reasons.push(`reliability=${successRate.toFixed(2)}`)

  // Latency (10 points) — lower is better
  const avgLatency = getAvgLatency(model.id)
  const latencyScore = avgLatency === 0 ? 1.0 : Math.max(0, 1 - avgLatency / 10000)
  score += latencyScore * 10
  reasons.push(`latency=${avgLatency}ms`)

  // Context fit (10 points)
  const contextScore = model.contextLength >= 32768 ? 1.0 : model.contextLength / 32768
  score += contextScore * 10

  // Recent success bonus (5 points)
  const health = model.health
  if (health && health.lastSuccessAt > 0) {
    const recency = Math.max(0, 1 - (Date.now() - health.lastSuccessAt) / (60 * 60 * 1000))
    score += recency * 5
  }

  // Preferred family bonus (up to 25 points)
  const familyIndex = preferredFamilies.findIndex(f => model.name.includes(f) || model.id.includes(f.toLowerCase().replace(/\s+/g, '-')))
  if (familyIndex !== -1) {
    const familyBonus = Math.max(0, 25 - familyIndex * 3)
    score += familyBonus
    reasons.push(`preferred_rank=${familyIndex}`)
  }

  // Reasoning bonus for reasoning tasks
  if (task.needsReasoning && model.supportsReasoning) {
    score += 10
    reasons.push('reasoning=yes')
  }

  return score
}

function computeCapabilityMatch(model: FreeModel, task: TaskProfile): number {
  const requiredSpecialties = taskToSpecialties(task.category)
  if (requiredSpecialties.length === 0) return 0.5

  const matched = requiredSpecialties.filter(s => model.specialties.includes(s)).length
  return matched / requiredSpecialties.length
}

function taskToSpecialties(category: TaskCategory): ModelSpecialty[] {
  const map: Record<TaskCategory, ModelSpecialty[]> = {
    simple_chat: ['general_chat', 'fast_response'],
    fast: ['fast_response', 'general_chat'],
    normal_coding: ['coding', 'tool_calling'],
    complex_coding: ['coding', 'debugging', 'agentic_coding', 'tool_calling'],
    agent: ['agentic_coding', 'tool_calling', 'coding', 'debugging'],
    reasoning: ['reasoning', 'planning'],
    planning: ['planning', 'architecture', 'reasoning'],
    vision: ['vision'],
    research: ['research', 'reasoning'],
  }
  return map[category] ?? ['general_chat']
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

export interface RoutingDecision {
  /** Primary model to use */
  primary: FreeModel
  /** Ordered fallback chain (excluding primary) */
  fallbacks: FreeModel[]
  /** Task classification */
  task: TaskProfile
  /** Diagnostic info (for dev logs only) */
  diagnostics: {
    requestId: string
    taskCategory: TaskCategory
    candidateCount: number
    primaryScore: number
    fallbackCount: number
  }
}

let requestCounter = 0

/**
 * Select the best model for a request and build a fallback chain.
 * Never throws — always returns at least the openrouter/free fallback.
 */
export function routeRequest(
  userMessage: string,
  hasImages: boolean,
  toolsEnabled: boolean,
  models?: FreeModel[]
): RoutingDecision {
  const requestId = `or-${Date.now().toString(36)}-${(++requestCounter).toString(36)}`
  const task = classifyTask(userMessage, hasImages, toolsEnabled)
  const registry = models ?? getCachedFreeModels()

  const preferredFamilies = CATEGORY_PREFERENCES[task.category] ?? []

  // Filter to healthy models
  const healthy = registry.filter(m => isModelHealthy(m.id))
  const candidates = healthy.length > 0 ? healthy : registry // fallback to all if all unhealthy

  // Score all candidates
  const scored = candidates
    .map(model => ({ model, score: scoreModel(model, task, preferredFamilies) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)

  // Always ensure openrouter/free is in the fallback chain
  const freeRouter = registry.find(m => m.id === OPENROUTER_FREE_ROUTER_ID)

  if (scored.length === 0) {
    // All models disqualified — use openrouter/free
    const fallback = freeRouter ?? registry[registry.length - 1]
    return {
      primary: fallback,
      fallbacks: [],
      task,
      diagnostics: { requestId, taskCategory: task.category, candidateCount: 0, primaryScore: 0, fallbackCount: 0 },
    }
  }

  const primary = scored[0].model
  const fallbackList = scored.slice(1).map(s => s.model)

  // Ensure openrouter/free is at the end of fallbacks if not already present
  if (freeRouter && !fallbackList.some(m => m.id === OPENROUTER_FREE_ROUTER_ID) && primary.id !== OPENROUTER_FREE_ROUTER_ID) {
    fallbackList.push(freeRouter)
  }

  // eslint-disable-next-line no-console
  console.log(`[openrouter-router] req=${requestId} task=${task.category} primary=${primary.id} score=${scored[0].score.toFixed(1)} fallbacks=${fallbackList.length}`)

  return {
    primary,
    fallbacks: fallbackList,
    task,
    diagnostics: {
      requestId,
      taskCategory: task.category,
      candidateCount: scored.length,
      primaryScore: scored[0].score,
      fallbackCount: fallbackList.length,
    },
  }
}

/**
 * Get the next fallback model from a decision, excluding already-tried IDs.
 */
export function getNextFallback(
  decision: RoutingDecision,
  triedIds: Set<string>
): FreeModel | null {
  for (const model of decision.fallbacks) {
    if (!triedIds.has(model.id) && isModelHealthy(model.id)) {
      return model
    }
  }
  // Last resort: openrouter/free even if tried (it's the final safety net)
  const freeRouter = decision.fallbacks.find(m => m.id === OPENROUTER_FREE_ROUTER_ID)
  if (freeRouter && !triedIds.has(freeRouter.id)) return freeRouter
  return null
}

/**
 * Build a context-efficient system prompt for the given task category.
 * Only injects what the current request needs — never the full agent prompt
 * for a simple "hi".
 */
export function buildTaskContext(task: TaskProfile): string {
  switch (task.category) {
    case 'simple_chat':
    case 'fast':
      return '' // No extra context needed for simple chat

    case 'normal_coding':
      return [
        'You are a skilled software engineer.',
        'Write clean, correct, well-commented code.',
        'Prefer idiomatic patterns for the language.',
        'If asked to fix a bug, explain the root cause briefly.',
      ].join('\n')

    case 'complex_coding':
      return [
        'You are a senior software engineer with deep expertise.',
        'For complex tasks: understand requirements fully before coding.',
        'Consider edge cases, error handling, and performance.',
        'Write production-quality code with appropriate abstractions.',
        'Explain architectural decisions when relevant.',
      ].join('\n')

    case 'agent':
      return [
        'You are an autonomous coding agent.',
        'For each task: understand the objective, inspect the workspace, execute tools, verify results.',
        'Use tools to perform REAL operations — never claim success without tool confirmation.',
        'If a tool fails, report the exact error and try an alternative approach.',
        'Complete the task fully before responding.',
      ].join('\n')

    case 'reasoning':
      return [
        'Think carefully and systematically.',
        'Show your reasoning step by step.',
        'Consider multiple perspectives and edge cases.',
        'Be precise and acknowledge uncertainty when present.',
      ].join('\n')

    case 'planning':
      return [
        'Create a concrete, actionable plan.',
        'Break down complex tasks into clear phases.',
        'Identify dependencies, risks, and success criteria.',
        'Be specific about files, APIs, and implementation details.',
      ].join('\n')

    case 'vision':
      return [
        'Analyze the provided image(s) carefully.',
        'Describe what you observe accurately.',
        'Answer questions based on what is actually visible.',
      ].join('\n')

    case 'research':
      return [
        'Provide accurate, well-sourced information.',
        'Distinguish between established facts and your knowledge cutoff.',
        'Organize information clearly.',
      ].join('\n')

    default:
      return ''
  }
}
