/**
 * Bridge sync: loads backend state once on boot and subscribes to push
 * updates so the store always mirrors providers/models/mappings/suggestions/
 * settings. Returns an unsubscribe function for teardown.
 */

import { useStore } from './store'

export async function initBridge(): Promise<() => void> {
  const store = useStore.getState()

  // Initial pull.
  const [providers, models, mappings, suggestions, settings] = await Promise.all([
    window.aura.providers.list(),
    window.aura.models.list(),
    window.aura.aura.list(),
    window.aura.suggestions.list(),
    window.aura.settings.get(),
  ])
  store.setProviders(providers)
  store.setModels(models)
  store.setMappings(mappings)
  store.setSuggestions(suggestions)
  store.setAppSettings(settings)

  // Live updates.
  const offs = [
    window.aura.state.on('providers', p => useStore.getState().setProviders(p)),
    window.aura.state.on('models', m => useStore.getState().setModels(m)),
    window.aura.state.on('mappings', m => useStore.getState().setMappings(m)),
    window.aura.state.on('suggestions', s => useStore.getState().setSuggestions(s)),
    window.aura.state.on('settings', s => useStore.getState().setAppSettings(s)),
  ]

  return () => {
    for (const off of offs) off()
  }
}
