/**
 * Aura mapping resolution: turns an Aura model id into a concrete backend
 * model, using (in order):
 *
 *   1. The user's override, if it still exists in the registry
 *   2. The definition's default target patterns
 *   3. A capability-scored fallback over everything discovered
 *
 * Also produces the fallback chain used by the chat orchestrator when a
 * provider fails before emitting a token.
 */

import type { RegistryModel, RegistrySnapshot } from '../registry/registry'
import { matchModels, visibleModels } from '../registry/registry'
import { modelKey } from '../../providers/types'
import type { AuraMappings, AuraModelDefinition, CapabilityFocus } from './definitions'
import { AURA_MODELS_BY_ID, type AuraModelId } from './definitions'

export interface ResolvedMapping {
  aura: AuraModelDefinition
  model: RegistryModel | null
  source: 'override' | 'default' | 'capability' | 'none'
  /** Ordered alternates to try if the primary fails before first token. */
  fallbacks: RegistryModel[]
}

/**
 * Score a model for a capability focus. Pattern/heuristic based — works for
 * models that don't exist yet. Higher is better.
 */
export function scoreForFocus(model: RegistryModel, focus: CapabilityFocus): number {
  const id = model.id.toLowerCase()
  const caps = model.capabilities
  let score = 0

  // Universal signals.
  if (model.userState.favorite) score += 6
  if (model.userState.pinned) score += 4
  if (model.userState.hidden) score -= 100
  if (caps.streaming) score += 2
  const context = model.contextLength ?? 0

  switch (focus) {
    case 'speed':
      if (/flash|mini|haiku|lite|small|terra|turbo|nano|8b|7b/.test(id)) score += 20
      if (/opus|thinking|reason|o[13]|large|405b|670b/.test(id)) score -= 15
      break
    case 'balanced':
      if (/sonnet|sol|pro\b|medium|70b|chat/.test(id)) score += 15
      if (/mini|nano|lite/.test(id)) score -= 4
      break
    case 'quality':
      if (/sonnet|opus|gpt-5|o3|pro/.test(id)) score += 15
      if (caps.reasoning) score += 5
      if (/mini|nano|lite|flash|haiku/.test(id)) score -= 10
      break
    case 'coding':
      if (/cod(e|er|ing)|sonnet|deepseek|qwen/.test(id)) score += 15
      if (caps.reasoning) score += 8
      if (caps.tools) score += 5
      break
    case 'vision':
      if (!caps.vision) return -1000
      score += 20
      if (/4o|gemini|vision|vl/.test(id)) score += 8
      break
    case 'creative':
      if (/opus|gpt-5|creative|sonnet/.test(id)) score += 12
      if (/mini|nano|lite/.test(id)) score -= 8
      break
    case 'research':
      if (caps.reasoning) score += 12
      if (context >= 200_000) score += 10
      else if (context >= 100_000) score += 5
      if (/opus|thinking|pro|r1/.test(id)) score += 8
      break
    case 'max':
      if (caps.reasoning) score += 12
      if (/opus|o3|thinking|ultra|max/.test(id)) score += 15
      if (context >= 200_000) score += 5
      if (/mini|nano|lite|flash|haiku|small/.test(id)) score -= 20
      break
  }

  return score
}

/** Best capability-based candidates for a focus, best first. */
export function rankByFocus(snapshot: RegistrySnapshot, focus: CapabilityFocus): RegistryModel[] {
  return visibleModels(snapshot)
    .map(model => ({ model, score: scoreForFocus(model, focus) }))
    .filter(entry => entry.score > -100)
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.model)
}

function resolveDefaultTarget(snapshot: RegistrySnapshot, definition: AuraModelDefinition): RegistryModel | null {
  for (const pattern of definition.defaultTargets) {
    const matches = matchModels(snapshot, pattern).filter(model => !model.userState.hidden)
    if (matches.length > 0) return matches[0]
  }
  return null
}

/** Resolve one Aura model to its backend model + fallback chain. */
export function resolveAuraModel(
  auraId: AuraModelId,
  snapshot: RegistrySnapshot,
  mappings: AuraMappings
): ResolvedMapping {
  const aura = AURA_MODELS_BY_ID.get(auraId)
  if (!aura) throw new Error(`Unknown Aura model: ${auraId}`)

  const ranked = rankByFocus(snapshot, aura.focus)
  const override = mappings[auraId]
  const overridden = override ? snapshot.byKey.get(modelKey(override.target)) ?? null : null

  let model: RegistryModel | null = null
  let source: ResolvedMapping['source'] = 'none'

  if (overridden && !overridden.userState.hidden) {
    model = overridden
    source = 'override'
  } else {
    const fromDefault = resolveDefaultTarget(snapshot, aura)
    if (fromDefault) {
      model = fromDefault
      source = 'default'
    } else if (ranked.length > 0) {
      model = ranked[0]
      source = 'capability'
    }
  }

  // Fallback chain: capability ranking minus the primary, capped to keep
  // failover fast. Prefer models on *other* providers first so a provider
  // outage doesn't burn every attempt on the same dead endpoint.
  const fallbacks = model
    ? [...ranked]
        .filter(candidate => candidate.key !== model!.key)
        .sort((a, b) => {
          const aOther = a.providerId !== model!.providerId ? 0 : 1
          const bOther = b.providerId !== model!.providerId ? 0 : 1
          return aOther - bOther
        })
        .slice(0, 3)
    : []

  return { aura, model, source, fallbacks }
}

/** Resolve every Aura model at once (for the settings page). */
export function resolveAllMappings(
  snapshot: RegistrySnapshot,
  mappings: AuraMappings
): Record<AuraModelId, ResolvedMapping> {
  const result = {} as Record<AuraModelId, ResolvedMapping>
  for (const auraId of AURA_MODELS_BY_ID.keys()) {
    result[auraId] = resolveAuraModel(auraId, snapshot, mappings)
  }
  return result
}
