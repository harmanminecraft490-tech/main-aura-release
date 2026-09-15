/**
 * Preload bridge: the only surface the renderer can reach.
 * Everything is invoke/on based; no Node primitives leak into the page.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

type Payload = Record<string, unknown>

function on(channel: string, callback: (payload: never) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload as never)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const CHAT_EVENTS = ['routed', 'delta', 'thinking', 'done', 'error', 'aborted'] as const
type ChatEvent = (typeof CHAT_EVENTS)[number]

const STATE_EVENTS = ['providers', 'models', 'mappings', 'suggestions', 'settings'] as const
type StateEvent = (typeof STATE_EVENTS)[number]

contextBridge.exposeInMainWorld('aura', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  },
  providers: {
    list: () => ipcRenderer.invoke('providers:list'),
    add: (input: Payload) => ipcRenderer.invoke('providers:add', input),
    update: (id: string, updates: Payload) => ipcRenderer.invoke('providers:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('providers:delete', id),
    test: (input: Payload) => ipcRenderer.invoke('providers:test', input),
    refreshModels: (id: string) => ipcRenderer.invoke('providers:refresh-models', id),
  },
  models: {
    list: () => ipcRenderer.invoke('models:list'),
    setUserState: (key: string, updates: Payload) => ipcRenderer.invoke('models:set-user-state', key, updates),
  },
  aura: {
    list: () => ipcRenderer.invoke('aura:list'),
    setMapping: (auraId: string, modelKey: string | null) => ipcRenderer.invoke('aura:set-mapping', auraId, modelKey),
    restoreDefaults: () => ipcRenderer.invoke('aura:restore-defaults'),
  },
  suggestions: {
    list: () => ipcRenderer.invoke('suggestions:list'),
    accept: (id: string) => ipcRenderer.invoke('suggestions:accept', id),
    dismiss: (id: string) => ipcRenderer.invoke('suggestions:dismiss', id),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (updates: Payload) => ipcRenderer.invoke('settings:set', updates),
  },
  chat: {
    start: (input: Payload) => ipcRenderer.invoke('chat:start', input),
    abort: (streamId: string) => ipcRenderer.invoke('chat:abort', streamId),
    on: (event: ChatEvent, callback: (payload: never) => void) => {
      if (!CHAT_EVENTS.includes(event)) throw new Error(`Unknown chat event: ${event}`)
      return on(`chat:${event}`, callback)
    },
  },
  state: {
    on: (event: StateEvent, callback: (payload: never) => void) => {
      if (!STATE_EVENTS.includes(event)) throw new Error(`Unknown state event: ${event}`)
      return on(`state:${event}`, callback)
    },
  },
  dev: {
    requestLog: () => ipcRenderer.invoke('dev:request-log'),
    clearLog: () => ipcRenderer.invoke('dev:clear-log'),
  },
})
