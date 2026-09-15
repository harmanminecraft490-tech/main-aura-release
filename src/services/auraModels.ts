/**
 * AURA AI MODELS - Complete Brand Abstraction Layer
 *
 * This module defines Aura's proprietary model system that completely abstracts
 * away underlying providers. Users interact with Aura models, not provider models.
 */

import type { AuraVirtualModel, AuraCapability, AIProvider, ModelSelection, AuraModelMatcher, APIProfile } from '@/types'

// ═══════════════════════════════════════════════════════════════════════════════
// AURA MODEL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

export const AURA_MODELS: AuraVirtualModel[] = [
  {
    id: 'aura-flash',
    name: 'Aura Flash',
    tagline: 'Lightning-fast responses with minimal latency',
    description: 'Optimized for speed and instant responses. Perfect for quick queries, real-time chat, and rapid iterations.',
    capabilities: ['speed', 'reliability'],
    chain: [
      { provider: 'groq', modelPattern: 'llama-3.3' },
      { provider: 'groq', modelPattern: 'llama-3.1' },
      { provider: 'gemini', modelPattern: 'flash' },
      { provider: 'openai', modelPattern: 'gpt-4o-mini' },
    ],
    autoFallback: true,
    builtIn: true,
    icon: '⚡',
    color: '#FFD700',
    category: 'speed',
    contextWindow: 8000,
    costTier: 'free',
  },
  
  {
    id: 'aura-swift',
    name: 'Aura Swift',
    tagline: 'Fast reasoning for daily conversations',
    description: 'Balanced speed and intelligence for everyday tasks. Great for general questions, planning, and casual coding.',
    capabilities: ['speed', 'reasoning', 'writing'],
    chain: [
      { provider: 'openai', modelPattern: 'gpt-4o' },
      { provider: 'gemini', modelPattern: 'pro' },
      { provider: 'anthropic', modelPattern: 'haiku' },
    ],
    autoFallback: true,
    builtIn: true,
    icon: '🚀',
    color: '#00D9FF',
    category: 'general',
    contextWindow: 32000,
    costTier: 'low',
  },

  {
    id: 'aura-core',
    name: 'Aura Core',
    tagline: 'Balanced intelligence for most tasks',
    description: 'The default choice. Excellent reasoning, coding, and writing capabilities with good speed.',
    capabilities: ['reasoning', 'coding', 'writing', 'reliability'],
    chain: [
      { provider: 'anthropic', modelPattern: 'sonnet' },
      { provider: 'openai', modelPattern: 'gpt-4' },
      { provider: 'gemini', modelPattern: 'pro' },
    ],
    autoFallback: true,
    builtIn: true,
    icon: '💎',
    color: '#8B5CF6',
    category: 'general',
    contextWindow: 200000,
    costTier: 'medium',
  },

  {
    id: 'aura-pro',
    name: 'Aura Pro',
    tagline: 'Deep reasoning and complex problem solving',
    description: 'Advanced reasoning for complex tasks. Ideal for challenging problems, detailed analysis, and sophisticated coding.',
    capabilities: ['reasoning', 'coding', 'research', 'tools'],
    chain: [
      { provider: 'anthropic', modelPattern: 'opus' },
      { provider: 'openai', modelPattern: 'o1' },
      { provider: 'anthropic', modelPattern: 'sonnet' },
    ],
    autoFallback: true,
    builtIn: true,
    icon: '🧠',
    color: '#EC4899',
    category: 'reasoning',
    contextWindow: 200000,
    costTier: 'high',
  },

  {
    id: 'aura-expert',
    name: 'Aura Expert',
    tagline: 'Maximum intelligence for research, coding & architecture',
    description: 'Top-tier reasoning model. Best for complex codebases, research papers, system architecture, and expert-level tasks.',
    capabilities: ['reasoning', 'coding', 'research', 'tools', 'context'],
    chain: [
      { provider: 'anthropic', modelPattern: 'opus' },
      { provider: 'openai', modelPattern: 'o1-pro' },
      { provider: 'openai', modelPattern: 'o1' },
      { provider: 'gemini', modelPattern: 'pro-exp' },
    ],
    autoFallback: true,
    builtIn: true,
    icon: '🎯',
    color: '#F59E0B',
    category: 'expert',
    contextWindow: 200000,
    costTier: 'premium',
  },

  {
    id: 'aura-studio',
    name: 'Aura Studio',
    tagline: 'Creative writing, images & ideas',
    description: 'Optimized for creative tasks. Perfect for storytelling, content creation, brainstorming, and artistic projects.',
    capabilities: ['writing', 'reasoning', 'vision'],
    chain: [
      { provider: 'anthropic', modelPattern: 'sonnet' },
      { provider: 'openai', modelPattern: 'gpt-4' },
      { provider: 'gemini', modelPattern: 'pro' },
    ],
    autoFallback: true,
    builtIn: true,
    icon: '🎨',
    color: '#10B981',
    category: 'creative',
    contextWindow: 200000,
    costTier: 'medium',
  },

  {
    id: 'aura-vision',
    name: 'Aura Vision',
    tagline: 'Images, documents & OCR',
    description: 'Specialized for visual understanding. Analyze images, read documents, extract text, and understand visual content.',
    capabilities: ['vision', 'reasoning', 'tools'],
    chain: [
      { provider: 'anthropic', modelPattern: 'sonnet' },
      { provider: 'gemini', modelPattern: 'pro' },
      { provider: 'openai', modelPattern: 'gpt-4' },
    ],
    autoFallback: true,
    builtIn: true,
    icon: '👁️',
    color: '#06B6D4',
    category: 'vision',
    contextWindow: 200000,
    costTier: 'medium',
  },

  {
    id: 'aura-infinity',
    name: 'Aura Infinity',
    tagline: 'Automatically routes to the best available provider',
    description: 'Intelligent routing system. Analyzes your request and automatically selects the optimal model for the task.',
    capabilities: ['reasoning', 'coding', 'writing', 'research', 'vision', 'tools'],
    chain: [], // Uses intelligent routing, no fixed chain
    autoFallback: true,
    builtIn: true,
    icon: '∞',
    color: '#A78BFA',
    category: 'smart',
    contextWindow: 200000,
    costTier: 'dynamic',
  },

  {
    id: 'aura-x',
    name: 'Aura X',
    tagline: 'Experimental - Mix multiple providers',
    description: 'Experimental features and cutting-edge models. May combine multiple providers for optimal results.',
    capabilities: ['reasoning', 'coding', 'research', 'tools', 'speed'],
    chain: [
      { provider: 'openai', modelPattern: 'o1' },
      { provider: 'anthropic', modelPattern: 'opus' },
      { provider: 'gemini', modelPattern: 'exp' },
    ],
    autoFallback: true,
    builtIn: true,
    icon: '🔬',
    color: '#EF4444',
    category: 'experimental',
    contextWindow: 200000,
    costTier: 'variable',
  },

  {
    id: 'aura-enterprise',
    name: 'Aura Enterprise',
    tagline: 'Maximum quality for mission-critical tasks',
    description: 'Enterprise-grade reliability and quality. Prioritizes accuracy, consistency, and comprehensive responses.',
    capabilities: ['reasoning', 'coding', 'research', 'writing', 'tools', 'reliability', 'context'],
    chain: [
      { provider: 'anthropic', modelPattern: 'opus' },
      { provider: 'openai', modelPattern: 'o1-pro' },
    ],
    autoFallback: true,
    builtIn: true,
    icon: '🏢',
    color: '#6366F1',
    category: 'enterprise',
    contextWindow: 200000,
    costTier: 'premium',
  },
]

// ═══════════════════════════════════════════════════════════════════════════════
// SPECIALIZED AURA MODELS (Can be created by users)
// ═══════════════════════════════════════════════════════════════════════════════

export const AURA_SPECIALIZED_TEMPLATES: Partial<AuraVirtualModel>[] = [
  {
    name: 'Aura Coding',
    tagline: 'Specialized for software development',
    capabilities: ['coding', 'reasoning', 'tools'],
    icon: '💻',
    category: 'specialized',
  },
  {
    name: 'Aura Medical',
    tagline: 'Healthcare and medical information',
    capabilities: ['research', 'reasoning', 'writing'],
    icon: '⚕️',
    category: 'specialized',
  },
  {
    name: 'Aura Research',
    tagline: 'Academic research and analysis',
    capabilities: ['research', 'reasoning', 'writing'],
    icon: '📚',
    category: 'specialized',
  },
  {
    name: 'Aura Teacher',
    tagline: 'Educational explanations',
    capabilities: ['writing', 'reasoning'],
    icon: '👨‍🏫',
    category: 'specialized',
  },
  {
    name: 'Aura Lawyer',
    tagline: 'Legal document analysis',
    capabilities: ['reasoning', 'research', 'writing'],
    icon: '⚖️',
    category: 'specialized',
  },
  {
    name: 'Aura Translator',
    tagline: 'Multilingual translation',
    capabilities: ['writing', 'speed'],
    icon: '🌍',
    category: 'specialized',
  },
  {
    name: 'Aura Marketing',
    tagline: 'Marketing and copywriting',
    capabilities: ['writing', 'reasoning'],
    icon: '📈',
    category: 'specialized',
  },
  {
    name: 'Aura Finance',
    tagline: 'Financial analysis',
    capabilities: ['reasoning', 'research', 'tools'],
    icon: '💰',
    category: 'specialized',
  },
]

// ═══════════════════════════════════════════════════════════════════════════════
// CAPABILITY SCORING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Score a provider+model combination for specific capabilities.
 * Used when routing Aura models to determine the best backend.
 */
export function scoreModelCapabilities(
  provider: AIProvider,
  model: string,
  capabilities: AuraCapability[]
): number {
  let score = 0
  const modelLower = model.toLowerCase()

  // Speed capability
  if (capabilities.includes('speed')) {
    if (provider === 'groq') score += 50
    if (modelLower.includes('flash') || modelLower.includes('mini')) score += 30
    if (modelLower.includes('turbo')) score += 20
  }

  // Coding capability
  if (capabilities.includes('coding')) {
    if (modelLower.includes('opus')) score += 50
    if (modelLower.includes('sonnet')) score += 45
    if (modelLower.includes('o1')) score += 48
    if (modelLower.includes('gpt-4')) score += 40
    if (modelLower.includes('deepseek')) score += 35
  }

  // Reasoning capability
  if (capabilities.includes('reasoning')) {
    if (modelLower.includes('o1')) score += 50
    if (modelLower.includes('opus')) score += 48
    if (modelLower.includes('sonnet')) score += 40
    if (modelLower.includes('pro')) score += 35
  }

  // Research capability
  if (capabilities.includes('research')) {
    if (modelLower.includes('opus')) score += 45
    if (modelLower.includes('o1')) score += 43
    if (modelLower.includes('gemini') && modelLower.includes('pro')) score += 40
  }

  // Writing capability
  if (capabilities.includes('writing')) {
    if (provider === 'anthropic') score += 45
    if (modelLower.includes('gpt-4')) score += 40
    if (modelLower.includes('gemini')) score += 35
  }

  // Vision capability
  if (capabilities.includes('vision')) {
    if (modelLower.includes('vision') || modelLower.includes('gpt-4')) score += 45
    if (provider === 'gemini') score += 43
    if (provider === 'anthropic' && modelLower.includes('sonnet')) score += 40
  }

  // Context capability
  if (capabilities.includes('context')) {
    if (modelLower.includes('opus') || modelLower.includes('sonnet')) score += 45
    if (modelLower.includes('gemini')) score += 40
    if (modelLower.includes('gpt-4')) score += 35
  }

  // Reliability capability
  if (capabilities.includes('reliability')) {
    if (provider === 'anthropic') score += 45
    if (provider === 'openai') score += 43
    if (provider === 'gemini') score += 40
  }

  // Tools capability
  if (capabilities.includes('tools')) {
    if (provider === 'anthropic') score += 45
    if (provider === 'openai' && modelLower.includes('gpt-4')) score += 43
    if (provider === 'gemini') score += 35
  }

  return score
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTELLIGENT TASK DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

export interface TaskAnalysis {
  type: 'coding' | 'writing' | 'research' | 'vision' | 'math' | 'translation' | 'roleplay' | 'general'
  complexity: 'simple' | 'moderate' | 'complex'
  suggestedCapabilities: AuraCapability[]
  confidence: number
}

/**
 * Analyze a user prompt to determine the best Aura model
 */
export function analyzePrompt(prompt: string): TaskAnalysis {
  const lower = prompt.toLowerCase()
  
  // Coding detection
  if (
    lower.includes('code') ||
    lower.includes('function') ||
    lower.includes('bug') ||
    lower.includes('debug') ||
    lower.includes('implement') ||
    lower.includes('algorithm') ||
    lower.includes('api') ||
    /\b(js|ts|py|java|cpp|rust|go|html|css)\b/.test(lower)
  ) {
    const complexity = lower.includes('complex') || lower.includes('architect') ? 'complex' : 
                      lower.includes('simple') || lower.includes('quick') ? 'simple' : 'moderate'
    return {
      type: 'coding',
      complexity,
      suggestedCapabilities: ['coding', 'reasoning', 'tools'],
      confidence: 0.85,
    }
  }

  // Vision detection
  if (
    lower.includes('image') ||
    lower.includes('picture') ||
    lower.includes('photo') ||
    lower.includes('visual') ||
    lower.includes('diagram') ||
    lower.includes('screenshot') ||
    lower.includes('ocr')
  ) {
    return {
      type: 'vision',
      complexity: 'moderate',
      suggestedCapabilities: ['vision', 'reasoning'],
      confidence: 0.9,
    }
  }

  // Research detection
  if (
    lower.includes('research') ||
    lower.includes('analyze') ||
    lower.includes('study') ||
    lower.includes('compare') ||
    lower.includes('explain in detail') ||
    lower.includes('comprehensive')
  ) {
    return {
      type: 'research',
      complexity: 'complex',
      suggestedCapabilities: ['research', 'reasoning', 'context'],
      confidence: 0.8,
    }
  }

  // Math detection
  if (
    lower.includes('calculate') ||
    lower.includes('math') ||
    lower.includes('equation') ||
    lower.includes('solve') ||
    /\d+\s*[+\-*/]\s*\d+/.test(lower)
  ) {
    return {
      type: 'math',
      complexity: 'moderate',
      suggestedCapabilities: ['reasoning', 'tools'],
      confidence: 0.85,
    }
  }

  // Translation detection
  if (
    lower.includes('translate') ||
    lower.includes('translation') ||
    lower.includes('in spanish') ||
    lower.includes('in french') ||
    /translate.*to\s+\w+/.test(lower)
  ) {
    return {
      type: 'translation',
      complexity: 'simple',
      suggestedCapabilities: ['writing', 'speed'],
      confidence: 0.9,
    }
  }

  // Creative writing detection
  if (
    lower.includes('write') ||
    lower.includes('story') ||
    lower.includes('poem') ||
    lower.includes('creative') ||
    lower.includes('blog post') ||
    lower.includes('article')
  ) {
    return {
      type: 'writing',
      complexity: 'moderate',
      suggestedCapabilities: ['writing', 'reasoning'],
      confidence: 0.75,
    }
  }

  // Default to general
  return {
    type: 'general',
    complexity: 'simple',
    suggestedCapabilities: ['reasoning', 'writing'],
    confidence: 0.5,
  }
}

/**
 * Suggest the best Aura model based on prompt analysis
 */
export function suggestAuraModel(prompt: string): string {
  const analysis = analyzePrompt(prompt)
  
  switch (analysis.type) {
    case 'coding':
      return analysis.complexity === 'complex' ? 'aura-expert' : 'aura-core'
    case 'vision':
      return 'aura-vision'
    case 'research':
      return 'aura-expert'
    case 'math':
      return 'aura-pro'
    case 'translation':
      return 'aura-swift'
    case 'writing':
      return 'aura-studio'
    default:
      return 'aura-core'
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOCAL STORAGE
// ═══════════════════════════════════════════════════════════════════════════════

const STORAGE_KEY_MODELS = 'aura:virtual-models'
const STORAGE_KEY_SELECTION = 'aura:default-model-selection'

export function loadVirtualModels(): AuraVirtualModel[] {
  try {
    const stored = localStorage?.getItem(STORAGE_KEY_MODELS)
    if (!stored) return AURA_MODELS
    const parsed = JSON.parse(stored)
    // Merge built-in models with user-created ones
    const builtInIds = AURA_MODELS.map(m => m.id)
    const userModels = parsed.filter((m: AuraVirtualModel) => !builtInIds.includes(m.id))
    return [...AURA_MODELS, ...userModels]
  } catch {
    return AURA_MODELS
  }
}

export function saveVirtualModels(models: AuraVirtualModel[]): void {
  try {
    // Only save user-created models, built-in models are always loaded from AURA_MODELS
    const userModels = models.filter(m => !m.builtIn)
    localStorage?.setItem(STORAGE_KEY_MODELS, JSON.stringify(userModels))
  } catch (err) {
    console.error('Failed to save virtual models:', err)
  }
}

export function loadDefaultSelection(): ModelSelection {
  try {
    const stored = localStorage?.getItem(STORAGE_KEY_SELECTION)
    if (!stored) return { kind: 'aura', id: 'aura-core' }
    return JSON.parse(stored)
  } catch {
    return { kind: 'aura', id: 'aura-core' }
  }
}

export function saveDefaultSelection(selection: ModelSelection): void {
  try {
    localStorage?.setItem(STORAGE_KEY_SELECTION, JSON.stringify(selection))
  } catch (err) {
    console.error('Failed to save default selection:', err)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT MODEL TO JSON
// ═══════════════════════════════════════════════════════════════════════════════

export function exportAuraModel(model: AuraVirtualModel): string {
  return JSON.stringify(model, null, 2)
}

export function importAuraModel(json: string): AuraVirtualModel {
  const model = JSON.parse(json)
  // Ensure it has required fields
  if (!model.id || !model.name || !model.tagline) {
    throw new Error('Invalid Aura model JSON')
  }
  return {
    ...model,
    builtIn: false, // User-imported models are never built-in
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPATIBILITY FUNCTIONS (for existing code)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve a ModelSelection to a display name
 * Used by existing components
 */
export function resolveSelection(
  selection: ModelSelection,
  virtualModels: AuraVirtualModel[],
  profiles: APIProfile[]
): string {
  if (selection.kind === 'aura') {
    const model = virtualModels.find(m => m.id === selection.id)
    return model?.name || 'Unknown Model'
  } else {
    const profile = profiles.find(p => p.id === selection.id)
    return profile?.displayName || 'Unknown Provider'
  }
}

/**
 * Resolve a virtual model to a concrete provider profile based on its chain and available profiles.
 * Returns the matched profile and the index in the chain that matched (as a string), or null if no match.
 * If the virtual machine has autoFallback enabled and no matcher matches, returns { profile: null, via: 'fallback' }.
 * Note: The fallback profile selection is not implemented; returns null for profile in fallback case.
 */
export function resolveVirtualModel(
  id: string,
  virtualModels: AuraVirtualModel[],
  profiles: APIProfile[]
): { profile: APIProfile | null; via: string } | null {
  const vm = virtualModels.find(m => m.id === id);
  if (!vm) return null;

  // If the virtual model has no chain, it uses intelligent routing (infinity model)
  if (vm.chain.length === 0) {
    // For infinity model, we cannot determine a specific profile without runtime info.
    // Return the first enabled profile as a placeholder, or null if none.
    const firstProfile = profiles.find(p => p.enabled);
    return firstProfile ? { profile: firstProfile, via: 'unknown' } : null;
  }

  // Otherwise, go through the chain in order and find the first matcher that matches a profile.
  for (const matcher of vm.chain) {
    let profile: APIProfile | null = null;
    if (matcher.profileId) {
      profile = profiles.find(p => p.id === matcher.profileId) || null;
      if (profile) {
        // When matched by profileId, the via is the provider of the matched profile
        return { profile, via: profile.provider };
      }
    } else if (matcher.provider) {
      let candidates = profiles.filter(p => p.provider === matcher.provider);
      if (matcher.modelPattern) {
        // Simple match: check if the model pattern is included in the model string (case-insensitive)
        const patternLower = matcher.modelPattern.toLowerCase();
        candidates = candidates.filter(p =>
          p.model.toLowerCase().includes(patternLower)
        );
      }
      if (candidates.length > 0) {
        // Take the first match
        profile = candidates[0];
      }
    }
    if (profile) {
      // When matched by provider, the via is the matcher's provider
      return { profile, via: matcher.provider || 'unknown' };
    }
  }

  // If no matcher matched, return null
  return null;
}

/**
 * Describe a matcher for display
 */
export function describeMatcher(matcher: AuraModelMatcher): string {
  if (matcher.profileId) {
    return `Profile: ${matcher.profileId}`
  }
  if (matcher.provider) {
    const pattern = matcher.modelPattern ? ` (${matcher.modelPattern})` : ''
    return `${matcher.provider}${pattern}`
  }
  return 'Any provider'
}

/**
 * Reset virtual models to defaults
 */
export function resetVirtualModels(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_MODELS)
  } catch (err) {
    console.error('Failed to reset virtual models:', err)
  }
}
