import { contextBridge, ipcRenderer, webUtils } from 'electron'

type BridgeMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

type BridgeMemoryInput = {
  type?: 'short_term' | 'long_term' | 'preference' | 'project' | 'coding' | 'learning' | 'goal'
  content: string
  context?: string
  relevance?: number
  expiresAt?: number | null
}

type ChatEventName = 'delta' | 'thinking' | 'done' | 'error' | 'aborted' | 'pipeline' | 'tool' | 'file-opened' | 'editor-status' | 'research-status' | 'tool-permission' | 'mode' | 'activity'
type AgentEventName = 'delta' | 'thinking' | 'done' | 'error' | 'aborted' | 'state' | 'event' | 'activity'
type ChatEventPayload = Record<string, unknown>
type ChatStartOptions = { memoryEnabled?: boolean; profileId?: string; attachmentIds?: string[] }

contextBridge.exposeInMainWorld('aura', {
  window: {
    minimize: () => ipcRenderer.invoke('window-minimize'),
    maximize: () => ipcRenderer.invoke('window-maximize'),
    close: () => ipcRenderer.invoke('window-close'),
    isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  ai: {
    getStatus: () => ipcRenderer.invoke('ai:get-status'),
    getConfig: () => ipcRenderer.invoke('ai:get-config'),
    setConfig: (partial: Record<string, unknown>) => ipcRenderer.invoke('ai:set-config', partial),
    testConnection: (config: Record<string, unknown>) => ipcRenderer.invoke('ai:test-connection', config),
    getPresets: () => ipcRenderer.invoke('ai:get-presets'),
    exportConfig: () => ipcRenderer.invoke('ai:export-config'),
    importConfig: (json: string) => ipcRenderer.invoke('ai:import-config', json),
  },
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    create: (profile: Record<string, unknown>) => ipcRenderer.invoke('profiles:create', profile),
    update: (id: string, updates: Record<string, unknown>) => ipcRenderer.invoke('profiles:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('profiles:delete', id),
    duplicate: (id: string) => ipcRenderer.invoke('profiles:duplicate', id),
    setDefault: (id: string) => ipcRenderer.invoke('profiles:set-default', id),
    enable: (id: string, enabled: boolean) => ipcRenderer.invoke('profiles:enable', id, enabled),
    getActive: () => ipcRenderer.invoke('profiles:get-active'),
    setActive: (id: string) => ipcRenderer.invoke('profiles:set-active', id),
    testConnection: (profile: Record<string, unknown>) => ipcRenderer.invoke('profiles:test-connection', profile),
    exportAll: () => ipcRenderer.invoke('profiles:export-all'),
    importAll: (json: string) => ipcRenderer.invoke('profiles:import-all', json),
    backup: () => ipcRenderer.invoke('profiles:backup'),
    restore: (json: string) => ipcRenderer.invoke('profiles:restore', json),
  },
  routing: {
    get: () => ipcRenderer.invoke('routing:get'),
    set: (routing: Record<string, unknown>) => ipcRenderer.invoke('routing:set', routing),
    resolve: (task: string) => ipcRenderer.invoke('routing:resolve', task),
    detectTask: (content: string) => ipcRenderer.invoke('routing:detect-task', content),
    autoSelect: (content: string) => ipcRenderer.invoke('routing:auto-select', content),
  },
  models: {
    list: () => ipcRenderer.invoke('models:list'),
    add: (model: Record<string, unknown>) => ipcRenderer.invoke('models:add', model),
    update: (id: string, updates: Record<string, unknown>) => ipcRenderer.invoke('models:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('models:delete', id),
    togglePin: (id: string) => ipcRenderer.invoke('models:toggle-pin', id),
    toggleFavorite: (id: string) => ipcRenderer.invoke('models:toggle-favorite', id),
    exportAll: () => ipcRenderer.invoke('models:export-all'),
    importAll: (json: string) => ipcRenderer.invoke('models:import-all', json),
  },
  devlogs: {
    list: () => ipcRenderer.invoke('devlogs:list'),
    clear: () => ipcRenderer.invoke('devlogs:clear'),
    stats: () => ipcRenderer.invoke('devlogs:stats'),
  },
  voice: {
    getSettings: () => ipcRenderer.invoke('voice:get-settings'),
    setSettings: (settings: Record<string, unknown>) => ipcRenderer.invoke('voice:set-settings', settings),
    getVoices: () => ipcRenderer.invoke('voice:get-voices'),
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    enable: (id: string) => ipcRenderer.invoke('plugins:enable', id),
    disable: (id: string) => ipcRenderer.invoke('plugins:disable', id),
    remove: (id: string) => ipcRenderer.invoke('plugins:remove', id),
    install: (manifest: Record<string, unknown>) => ipcRenderer.invoke('plugins:install', manifest),
  },
  security: {
    maskKey: (key: string) => ipcRenderer.invoke('security:mask-key', key),
    secureCopy: (text: string) => ipcRenderer.invoke('security:secure-copy', text),
  },
  chat: {
    start: (streamId: string, messages: BridgeMessage[], options?: ChatStartOptions) =>
      ipcRenderer.invoke('chat:start', {
        streamId,
        messages: messages.map(message => ({
          role: message.role,
          content: message.content,
        })),
        ...(options ? { options: { memoryEnabled: options.memoryEnabled, profileId: options.profileId, attachmentIds: options.attachmentIds } } : {}),
      }),
    abort: (streamId: string) => ipcRenderer.invoke('chat:abort', streamId),
    respondToolPermission: (requestId: string, decision: 'allow' | 'allow-session' | 'deny') =>
      ipcRenderer.invoke('chat:tool-permission-response', { requestId, decision }),
    on: (eventName: ChatEventName, callback: (payload: ChatEventPayload) => void) => {
      const channel = `chat:${eventName}`
      const listener = (_event: Electron.IpcRendererEvent, payload: ChatEventPayload) => callback(payload)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
  },
  agent: {
    start: (runId: string, messages: BridgeMessage[], options?: ChatStartOptions) =>
      ipcRenderer.invoke('agent:start', {
        runId,
        messages: messages.map(message => ({ role: message.role, content: message.content })),
        ...(options ? { options: { memoryEnabled: options.memoryEnabled, profileId: options.profileId, attachmentIds: options.attachmentIds } } : {}),
      }),
    abort: (runId: string) => ipcRenderer.invoke('agent:abort', runId),
    on: (eventName: AgentEventName, callback: (payload: ChatEventPayload) => void) => {
      const channel = `agent:${eventName}`
      const listener = (_event: Electron.IpcRendererEvent, payload: ChatEventPayload) => callback(payload)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
  },
  memory: {
    list: () => ipcRenderer.invoke('memory:list'),
    create: (input: BridgeMemoryInput) => ipcRenderer.invoke('memory:create', input),
    delete: (id: string) => ipcRenderer.invoke('memory:delete', id),
    update: (id: string, content: string) => ipcRenderer.invoke('memory:update', id, content),
    export: () => ipcRenderer.invoke('memory:export'),
    import: (json: string) => ipcRenderer.invoke('memory:import', json),
  },
  files: {
    /** Real filesystem path for a renderer File (drag & drop or file picker). */
    getPath: (file: unknown) => {
      try {
        return webUtils.getPathForFile(file as never)
      } catch {
        return (file as { path?: string })?.path ?? ''
      }
    },
  },
  attachments: {
    add: (paths: string[]) => ipcRenderer.invoke('attachments:add', paths),
    list: () => ipcRenderer.invoke('attachments:list'),
    remove: (id: string) => ipcRenderer.invoke('attachments:remove', id),
    clear: () => ipcRenderer.invoke('attachments:clear'),
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (project: Record<string, unknown>) => ipcRenderer.invoke('projects:create', project),
    update: (id: string, updates: Record<string, unknown>) => ipcRenderer.invoke('projects:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('projects:delete', id),
    setActive: (id: string) => ipcRenderer.invoke('projects:setActive', id),
    getActive: () => ipcRenderer.invoke('projects:getActive'),
    pickFolder: () => ipcRenderer.invoke('projects:pickFolder'),
  },
  workspace: {
    state: () => ipcRenderer.invoke('workspace:state'),
    execute: (action: Record<string, unknown>) => ipcRenderer.invoke('workspace:execute', action),
    grant: (ops: string[]) => ipcRenderer.invoke('workspace:grant', ops),
    revoke: (op: string) => ipcRenderer.invoke('workspace:revoke', op),
    setCurrentFile: (relPath: string) => ipcRenderer.invoke('workspace:setCurrentFile', relPath),
    setCurrentFolder: (relPath: string) => ipcRenderer.invoke('workspace:setCurrentFolder', relPath),
    opsLog: () => ipcRenderer.invoke('workspace:opsLog'),
    opsLogClear: () => ipcRenderer.invoke('workspace:opsLogClear'),
    indexStatus: () => ipcRenderer.invoke('workspace:indexStatus'),
    search: (query: string) => ipcRenderer.invoke('workspace:search', query),
  },
  onToggleCommandPalette: (callback: () => void) => {
    ipcRenderer.on('toggle-command-palette', callback)
    return () => ipcRenderer.removeListener('toggle-command-palette', callback)
  },
  getTheme: () => ipcRenderer.invoke('get-theme'),
  capabilities: {
    list: () => ipcRenderer.invoke('capabilities:list'),
    configureSearch: (provider: string, key: string) => ipcRenderer.invoke('capabilities:configure-search', provider, key),
    configureFigma: (token: string) => ipcRenderer.invoke('capabilities:configure-figma', token),
    configureGitHub: (token: string) => ipcRenderer.invoke('capabilities:configure-github', token),
    configureMcp: (servers: Array<{ name: string; url: string; enabled: boolean }>) => ipcRenderer.invoke('capabilities:configure-mcp', servers),
    refresh: () => ipcRenderer.invoke('capabilities:refresh'),
  },
  web: {
    search: (query: string, opts?: Record<string, unknown>) => ipcRenderer.invoke('web:search', query, opts),
    readPage: (url: string, maxChars?: number) => ipcRenderer.invoke('web:read-page', url, maxChars),
    searchStatus: () => ipcRenderer.invoke('web:search-status'),
  },
  conversations: {
    load: () => ipcRenderer.invoke('conversations:load'),
    save: (state: Record<string, unknown>) => ipcRenderer.invoke('conversations:save', state),
  },
  account: {
    status: () => ipcRenderer.invoke('account:status'),
    signup: (email: string, password: string) => ipcRenderer.invoke('account:signup', email, password),
    login: (email: string, password: string) => ipcRenderer.invoke('account:login', email, password),
    logout: () => ipcRenderer.invoke('account:logout'),
  },
})
