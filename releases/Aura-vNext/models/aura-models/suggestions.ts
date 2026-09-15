/**
 * Smart mapping suggestions: when discovery finds new models that score
 * better than an Aura model's current target, propose a switch.
 *
 * Hard rules:
 *  - NEVER auto-apply. Suggestions are shown; the user accepts or dismisses.
 *  - Never re-suggest a (auraId, modelKey) pair the user dismissed.
 *  - Only consider models newer than the user's own mapping choice, so we
 *    don't nag about models they already saw and rejected implicitly.
 */

import type { RegistrySnapshot } from '../registry/registry'
import type { AuraMappings, AuraModelId } from './definitions'
import { AURA_MODELS } from './definitions'
import { rankByFocus, resolveAuraModel, scoreForFocus } from './mapping'

export interface MappingSuggestion {
  id: string
  auraId: AuraModelId
  auraName: string
  /** Registry key of the suggested backend model. */
  suggestedKey: string
  suggestedName: string
  providerName: string
  /** Registry key of the current target (if any). */
  currentKey?: string
  currentName?: string
  reason: string
  createdAt: number
}

export interface SuggestionState {
  /** `${auraId}:${modelKey}` pairs the user dismissed. */
  dismissed: string[]
}

const MIN_SCORE_ADVANTAGE = 8

export function computeSuggestions(
  snapshot: RegistrySnapshot,
  mappings: AuraMappings,
  state: SuggestionState
): MappingSuggestion[] {
  const dismissed = new Set(state.dismissed)
  const suggestions: MappingSuggestion[] = []
  const now = Date.now()

  for (const aura of AURA_MODELS) {
    if (aura.id === 'aura-auto') continue

    const resolved = resolveAuraModel(aura.id, snapshot, mappings)
    if (!resolved.model) continue

    const [best] = rankByFocus(snapshot, aura.focus)
    if (!best || best.key === resolved.model.key) continue

    const dismissKey = `${aura.id}:${best.key}`
    if (dismissed.has(dismissKey)) continue

    // Respect explicit user choices: only nudge about models that appeared
    // *after* the user set their mapping.
    const override = mappings[aura.id]
    if (override && best.firstSeenAt <= override.setAt) continue

    const bestScore = scoreForFocus(best, aura.focus)
    const currentScore = scoreForFocus(resolved.model, aura.focus)
    if (bestScore - currentScore < MIN_SCORE_ADVANTAGE) continue

    suggestions.push({
      id: dismissKey,
      auraId: aura.id,
      auraName: aura.name,
      suggestedKey: best.key,
      suggestedName: best.displayName,
      providerName: best.providerName,
      currentKey: resolved.model.key,
      currentName: resolved.model.displayName,
      reason: buildReason(aura.name, best.displayName, aura.focus),
      createdAt: now,
    })
  }

  return suggestions
}

function buildReason(auraName: string, modelName: string, focus: string): string {
  const focusLabel: Record<string, string> = {
    speed: 'faster',
    balanced: 'more capable',
    quality: 'higher quality',
    coding: 'better at coding',
    vision: 'better at vision',
    creative: 'more creative',
    research: 'stronger at deep analysis',
    max: 'more powerful',
  }
  return `A newer, ${focusLabel[focus] ?? 'better'} model is available. Switch ${auraName} to ${modelName}?`
}
