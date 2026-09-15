/**
 * AURA MODEL ROUTER
 *
 * Intelligent routing system that:
 * - Maps Aura models to actual provider profiles
 * - Automatically selects best available provider
 * - Handles failover when providers fail
 * - Never exposes provider names to users (unless Developer Mode)
 * - Scores providers based on capabilities
 */

import type {
  AuraVirtualModel,
  APIProfile,
  ModelSelection,
  AuraCapability,
  AIProvider,
  DevLogEntry
} from '../types'
import { scoreModelCapabilities } from '../services/auraModels'

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTING RESULT
// ═══════════════════════════════════════════════════════════════════════════════

export interface RoutingResult {
  profile: APIProfile
  auraModel: AuraVirtualModel
  reasoning?: string
  fallbackUsed: boolean
  alternativeProfiles: APIProfile[]
}

export interface RoutingError {
  auraModel: string
  error: string
  attemptedProviders: string[]
  suggestedAction: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTER CLASS
// ═══════════════════════════════════════════════════════════════════════════════

export class AuraModelRouter {
  private profiles: APIProfile[] = []
  private virtualModels: AuraVirtualModel[] = []
  private devMode: boolean = false
  private devLogs: DevLogEntry[] = []

  constructor(profiles: APIProfile[], virtualModels: AuraVirtualModel[], devMode: boolean = false) {
    this.profiles = profiles.filter(p => p.enabled)
    this.virtualModels = virtualModels
    this.devMode = devMode
  }

  /**
   * Main routing function - resolve a ModelSelection to an actual API profile
   */
  async route(selection: ModelSelection, prompt?: string): Promise<RoutingResult> {
    const startTime = Date.now()

    try {
      // If user selected a specific provider profile, use it directly
      if (selection.kind === 'provider') {
        const profile = this.profiles.find(p => p.id === selection.id)
        if (!profile) {
          throw new Error(`Provider profile ${selection.id} not found or disabled`)
        }
        
        this.log({
          id: this.generateId(),
          timestamp: Date.now(),
          type: 'routing',
          auraModel: 'direct',
          provider: profile.provider,
          model: profile.model,
          latency: Date.now() - startTime,
        })

        return {
          profile,
          auraModel: { 
            id: 'direct', 
            name: profile.displayName,
            tagline: 'Direct provider access',
            capabilities: [],
            chain: [],
            autoFallback: false,
            builtIn: false,
          },
          reasoning: 'Direct provider selection',
          fallbackUsed: false,
          alternativeProfiles: [],
        }
      }

      // User selected an Aura virtual model - need to route it
      const auraModel = this.virtualModels.find(m => m.id === selection.id)
      if (!auraModel) {
        throw new Error(`Aura model ${selection.id} not found`)
      }

      // Special handling for Aura Infinity - intelligent routing
      if (auraModel.id === 'aura-infinity') {
        return this.routeInfinity(auraModel, prompt)
      }

      // Try each matcher in the chain
      let selectedProfile: APIProfile | null = null
      let reasoning = ''

      for (const matcher of auraModel.chain) {
        const matchResult = this.matchProfile(matcher)
        if (matchResult) {
          selectedProfile = matchResult
          reasoning = `Matched ${matcher.profileId ? 'profile' : 'provider'} in chain`
          break
        }
      }

      // If chain didn't match and autoFallback is enabled, score all profiles
      if (!selectedProfile && auraModel.autoFallback) {
        selectedProfile = this.scoreProfiles(auraModel.capabilities)
        reasoning = 'Auto-fallback to best scored profile'
      }

      if (!selectedProfile) {
        throw new Error(`No suitable provider found for ${auraModel.name}`)
      }

      // Find alternatives for failover
      const alternatives = this.findAlternatives(auraModel, selectedProfile.id)

      this.log({
        id: this.generateId(),
        timestamp: Date.now(),
        type: 'routing',
        auraModel: auraModel.id,
        provider: selectedProfile.provider,
        model: selectedProfile.model,
        latency: Date.now() - startTime,
      })

      return {
        profile: selectedProfile,
        auraModel,
        reasoning: this.devMode ? reasoning : undefined,
        fallbackUsed: false,
        alternativeProfiles: alternatives,
      }

    } catch (error) {
      this.log({
        id: this.generateId(),
        timestamp: Date.now(),
        type: 'error',
        auraModel: selection.id,
        error: error instanceof Error ? error.message : 'Unknown routing error',
      })
      throw error
    }
  }

  /**
   * Intelligent routing for Aura Infinity - analyzes prompt and routes accordingly
   */
  private async routeInfinity(auraModel: AuraVirtualModel, prompt?: string): Promise<RoutingResult> {
    if (!prompt) {
      // No prompt to analyze, use best general-purpose model
      const profile = this.scoreProfiles(['reasoning', 'writing', 'coding'])
      if (!profile) {
        throw new Error('No suitable provider available for Aura Infinity')
      }
      return {
        profile,
        auraModel,
        reasoning: this.devMode ? 'Default routing (no prompt to analyze)' : undefined,
        fallbackUsed: false,
        alternativeProfiles: this.findAlternatives(auraModel, profile.id),
      }
    }

    // Analyze prompt to determine task type
    const analysis = this.analyzePrompt(prompt)
    
    // Route based on analysis
    const profile = this.scoreProfiles(analysis.suggestedCapabilities)
    if (!profile) {
      throw new Error('No suitable provider available for Aura Infinity')
    }

    return {
      profile,
      auraModel,
      reasoning: this.devMode 
        ? `Analyzed as ${analysis.type} task (${analysis.confidence * 100}% confidence)` 
        : undefined,
      fallbackUsed: false,
      alternativeProfiles: this.findAlternatives(auraModel, profile.id),
    }
  }

  /**
   * Attempt failover to next best provider
   */
  async failover(previousResult: RoutingResult): Promise<RoutingResult> {
    if (previousResult.alternativeProfiles.length === 0) {
      throw new Error('No alternative providers available for failover')
    }

    const nextProfile = previousResult.alternativeProfiles[0]
    const remainingAlternatives = previousResult.alternativeProfiles.slice(1)

    this.log({
      id: this.generateId(),
      timestamp: Date.now(),
      type: 'routing',
      auraModel: previousResult.auraModel.id,
      provider: nextProfile.provider,
      model: nextProfile.model,
    })

    return {
      profile: nextProfile,
      auraModel: previousResult.auraModel,
      reasoning: this.devMode ? 'Failover to alternative provider' : undefined,
      fallbackUsed: true,
      alternativeProfiles: remainingAlternatives,
    }
  }

  /**
   * Match a profile based on matcher criteria
   */
  private matchProfile(matcher: { profileId?: string; provider?: AIProvider; modelPattern?: string }): APIProfile | null {
    if (matcher.profileId) {
      return this.profiles.find(p => p.id === matcher.profileId) || null
    }

    if (matcher.provider) {
      const candidates = this.profiles.filter(p => p.provider === matcher.provider)
      
      if (matcher.modelPattern) {
        const pattern = matcher.modelPattern.toLowerCase()
        const matched = candidates.find(p => p.model.toLowerCase().includes(pattern))
        if (matched) return matched
      }

      // Return first matching provider if no model pattern or pattern didn't match
      return candidates[0] || null
    }

    return null
  }

  /**
   * Score all profiles based on required capabilities and return the best
   */
  private scoreProfiles(capabilities: AuraCapability[]): APIProfile | null {
    if (this.profiles.length === 0) return null

    const scored = this.profiles.map(profile => ({
      profile,
      score: scoreModelCapabilities(profile.provider, profile.model, capabilities),
    }))

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score)

    return scored[0]?.profile || null
  }

  /**
   * Find alternative profiles that could handle this Aura model
   */
  private findAlternatives(auraModel: AuraVirtualModel, excludeId: string): APIProfile[] {
    const alternatives: APIProfile[] = []

    // Try remaining matchers in chain
    for (const matcher of auraModel.chain) {
      const profile = this.matchProfile(matcher)
      if (profile && profile.id !== excludeId && !alternatives.find(a => a.id === profile.id)) {
        alternatives.push(profile)
      }
    }

    // Add scored alternatives if autoFallback enabled
    if (auraModel.autoFallback) {
      const scored = this.profiles
        .filter(p => p.id !== excludeId && !alternatives.find(a => a.id === p.id))
        .map(profile => ({
          profile,
          score: scoreModelCapabilities(profile.provider, profile.model, auraModel.capabilities),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3) // Top 3 alternatives
        .map(s => s.profile)

      alternatives.push(...scored)
    }

    return alternatives
  }

  /**
   * Analyze prompt to determine task type and required capabilities
   */
  private analyzePrompt(prompt: string): {
    type: string
    complexity: string
    suggestedCapabilities: AuraCapability[]
    confidence: number
  } {
    const lower = prompt.toLowerCase()
    
    // Coding detection
    if (
      lower.includes('code') ||
      lower.includes('function') ||
      lower.includes('bug') ||
      lower.includes('implement') ||
      /\b(js|ts|py|java|cpp|rust|go|html|css)\b/.test(lower)
    ) {
      return {
        type: 'coding',
        complexity: lower.includes('complex') ? 'complex' : 'moderate',
        suggestedCapabilities: ['coding', 'reasoning', 'tools'],
        confidence: 0.85,
      }
    }

    // Vision detection
    if (lower.includes('image') || lower.includes('picture') || lower.includes('visual')) {
      return {
        type: 'vision',
        complexity: 'moderate',
        suggestedCapabilities: ['vision', 'reasoning'],
        confidence: 0.9,
      }
    }

    // Research detection
    if (lower.includes('research') || lower.includes('analyze') || lower.includes('comprehensive')) {
      return {
        type: 'research',
        complexity: 'complex',
        suggestedCapabilities: ['research', 'reasoning', 'context'],
        confidence: 0.8,
      }
    }

    // Default general
    return {
      type: 'general',
      complexity: 'simple',
      suggestedCapabilities: ['reasoning', 'writing'],
      confidence: 0.5,
    }
  }

  /**
   * Log routing activity (for Developer Mode)
   */
  private log(entry: DevLogEntry): void {
    if (this.devMode) {
      this.devLogs.push(entry)
      // Keep only last 1000 entries
      if (this.devLogs.length > 1000) {
        this.devLogs.shift()
      }
    }
  }

  /**
   * Get routing logs (for Developer Mode)
   */
  getLogs(): DevLogEntry[] {
    return this.devLogs
  }

  /**
   * Clear routing logs
   */
  clearLogs(): void {
    this.devLogs = []
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RETRY & FAILOVER LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

export interface RetryConfig {
  maxAttempts: number
  initialDelay: number
  maxDelay: number
  backoffMultiplier: number
  retryableErrors: string[]
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  retryableErrors: [
    'rate_limit',
    'timeout',
    'network',
    'server_error',
    '500',
    '502',
    '503',
    '504',
  ],
}

/**
 * Execute a function with automatic retry and exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  onRetry?: (attempt: number, error: Error) => void
): Promise<T> {
  let lastError: Error | undefined
  let delay = config.initialDelay

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      
      // Check if error is retryable
      const isRetryable = config.retryableErrors.some(errType =>
        lastError!.message.toLowerCase().includes(errType.toLowerCase())
      )

      if (!isRetryable || attempt === config.maxAttempts) {
        throw lastError
      }

      // Notify about retry
      onRetry?.(attempt, lastError)

      // Wait with exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay))
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelay)
    }
  }

  throw lastError || new Error('Unknown error during retry')
}

/**
 * Execute with automatic failover to alternative providers
 */
export async function withFailover<T>(
  routingResult: RoutingResult,
  router: AuraModelRouter,
  fn: (profile: APIProfile) => Promise<T>,
  onFailover?: (attempt: number, error: Error) => void
): Promise<T> {
  let currentResult = routingResult
  let attempt = 1

  while (true) {
    try {
      return await fn(currentResult.profile)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      
      // Try failover if alternatives available
      if (currentResult.alternativeProfiles.length > 0) {
        onFailover?.(attempt, err)
        currentResult = await router.failover(currentResult)
        attempt++
      } else {
        throw err
      }
    }
  }
}
