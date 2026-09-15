/**
 * Model registry: the single in-memory view of every discovered model across
 * all providers, merged with per-model user state (favorite/pin/hide).
 * Pure data structure — persistence lives in backend/persistence.ts.
 */

import type { DiscoveredModel, ModelRef, ModelUserState, ProviderConfig } from '../../providers/types'
import { modelKey } from '../../providers/types'

export interface RegistryModel extends DiscoveredModel {
  key: string
  providerName: string
  userState: ModelUserState
}

export interface RegistrySnapshot {
  models: RegistryModel[]
  byKey: Map<string, RegistryModel>
}

export function buildRegistry(
  providers: ProviderConfig[],
  modelsByProvider: Record<string, DiscoveredModel[]>,
  userState: Record<string, ModelUserState>
): RegistrySnapshot {
  const providerNames = new Map(providers.map(provider => [provider.id, provider.name]))
  const enabled = new Set(providers.filter(provider => provider.enabled).map(provider => provider.id))
  const models: RegistryModel[] = []

  for (const [providerId, discovered] of Object.entries(modelsByProvider)) {
    if (!enabled.has(providerId)) continue
    for (const model of discovered) {
      const key = modelKey({ providerId, modelId: model.id })
      models.push({
        ...model,
        key,
        providerName: providerNames.get(providerId) ?? providerId,
        userState: userState[key] ?? {},
      })
    }
  }

  models.sort((a, b) => {
    // Pinned first, then favorites, then alphabetical.
    const rank = (m: RegistryModel) => (m.userState.pinned ? 0 : m.userState.favorite ? 1 : 2)
    return rank(a) - rank(b) || a.displayName.localeCompare(b.displayName)
  })

  return { models, byKey: new Map(models.map(model => [model.key, model])) }
}

export function findModel(snapshot: RegistrySnapshot, ref: ModelRef): RegistryModel | undefined {
  return snapshot.byKey.get(modelKey(ref))
}

/** Visible (non-hidden) models, e.g. for pickers. */
export function visibleModels(snapshot: RegistrySnapshot): RegistryModel[] {
  return snapshot.models.filter(model => !model.userState.hidden)
}

/**
 * Find models matching a loose pattern (used by Aura default mappings so a
 * default like "claude-sonnet-5" also matches "claude-sonnet-5-20260101").
 */
export function matchModels(snapshot: RegistrySnapshot, pattern: string): RegistryModel[] {
  const needle = pattern.toLowerCase()
  const exact = snapshot.models.filter(model => model.id.toLowerCase() === needle)
  if (exact.length > 0) return exact
  return snapshot.models.filter(model => {
    const id = model.id.toLowerCase()
    // Suffix-safe prefix match: "claude-sonnet-5" matches "claude-sonnet-5-thinking"
    // only when asked for; require a boundary so "gpt-4" doesn't match "gpt-4o".
    return id === needle || id.startsWith(`${needle}-`) || id.endsWith(`/${needle}`) || id.includes(`/${needle}-`)
  })
}
