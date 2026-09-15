export type AIProvider =
  | 'anthropic'
  | 'openai'
  | 'moonshot'
  | 'zai'
  | 'groq'
  | 'cerebras'
  | 'aura'
  | 'openrouter'
  | 'nvidia'
  | 'gemini'
  | 'ollama'
  | 'lmstudio'
  | 'localai'
  | 'vllm'
  | 'deepseek'
  | 'custom'

export type AIMode = 'auto' | 'fast' | 'balanced' | 'think' | 'plan' | 'max' | 'bypass'

export type TaskType = 'chat' | 'coding' | 'planning' | 'vision' | 'voice' | 'embeddings'

export interface SmartRouting {
  chat?: string | null
  coding?: string | null
  planning?: string | null
  vision?: string | null
  voice?: string | null
  embeddings?: string | null
}

// ═══════════════════════════════════════════════════════════════════════════════
// AURA VIRTUAL MODELS - Complete Brand Abstraction
// ═══════════════════════════════════════════════════════════════════════════════

export type AuraCapability =
  | 'coding'
  | 'reasoning'
  | 'research'
  | 'writing'
  | 'vision'
  | 'speed'
  | 'context'
  | 'reliability'
  | 'tools'

export type AuraModelCategory = 
  | 'speed' 
  | 'general' 
  | 'reasoning' 
  | 'expert' 
  | 'creative' 
  | 'vision' 
  | 'smart' 
  | 'experimental' 
  | 'enterprise'
  | 'specialized'

export type CostTier = 'free' | 'low' | 'medium' | 'high' | 'premium' | 'dynamic' | 'variable'

export interface AuraModelMatcher {
  profileId?: string
  provider?: AIProvider
  modelPattern?: string
}

export interface AuraVirtualModel {
  id: string
  name: string
  tagline: string
  description?: string
  capabilities: AuraCapability[]
  chain: AuraModelMatcher[]
  autoFallback: boolean
  builtIn: boolean
  icon?: string
  color?: string
  category?: AuraModelCategory
  contextWindow?: number
  costTier?: CostTier
  systemPrompt?: string
  temperature?: number
  customSettings?: Record<string, any>
}

export interface ModelSelection {
  kind: 'aura' | 'provider'
  id: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// API PROFILES & CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

export interface APIProfile {
  id: string
  name: string
  displayName: string
  provider: AIProvider
  apiKey: string
  baseURL: string
  model: string
  organizationId?: string
  projectId?: string
  customHeaders?: Record<string, string>
  queryParameters?: Record<string, string>
  temperature: number
  topP: number
  maxTokens: number
  contextLength: number
  streaming: boolean
  timeout: number
  retryCount: number
  toolCalling: boolean
  visionSupport: boolean
  enabled: boolean
  isDefault: boolean
  /** Built-in Aura profile: baseURL and apiKey are hidden and non-editable. */
  locked?: boolean
  category?: string
  createdAt: number
  updatedAt: number
}

// Mirrors the main-process shapes in src/electron/aiConfig.ts — data crosses
// IPC verbatim, so these fields must match (modelId, not model).
export interface SavedModel {
  id: string
  name: string
  provider: AIProvider
  modelId: string
  pinned: boolean
  favorite: boolean
  category?: string
}

export interface ModelPreset {
  provider: AIProvider
  label: string
  modelId: string
  baseURL: string
}

export interface AIConfig {
  provider: AIProvider
  apiKey: string
  baseURL: string
  model: string
  temperature: number
  maxTokens: number
  streaming: boolean
  aiMode?: AIMode
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSATIONS & MESSAGES
// ═══════════════════════════════════════════════════════════════════════════════

export type MessageRole = 'user' | 'assistant' | 'system'

export interface Message {
  id: string
  role: MessageRole
  content: string
  timestamp: number
  attachments?: Attachment[]
  thinking?: string
  isThinking?: boolean
  isStreaming?: boolean
  modelUsed?: string // Track which Aura model was used
  model?: string // Legacy compatibility
  error?: string
  regenerated?: boolean
  edited?: boolean
  pipeline?: PipelineStep[]
}

export interface Attachment {
  id: string
  name: string
  type: string
  ext: string
  size: number
  status?: 'processing' | 'ready' | 'error'
  parser?: string
  pages?: number
  lines?: number
  words?: number
  chunks?: number
  indexed?: boolean
  error?: string
  processingMs?: number
  url?: string
  data?: string
  thumbnail?: string
  createdAt?: number
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  pinned?: boolean
  folder?: string
  tags?: string[]
  modelSelection?: ModelSelection
  archived?: boolean
}

/** A chat thread owned by the Agent / Code / Design panels. Persisted so it
 *  survives tab switches and app restarts. */
export interface PanelSession {
  id: string
  title: string
  panel: 'agent' | 'code' | 'design'
  messages: Message[]
  createdAt: number
  updatedAt: number
}

/** Everything persisted by the conversations bridge. */
export interface PersistedChats {
  conversations: Conversation[]
  panelSessions: Record<string, PanelSession[]>
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROJECTS - Cursor-like functionality
// ═══════════════════════════════════════════════════════════════════════════════

export interface ProjectFile {
  id: string
  name: string
  type: 'file' | 'folder'
  path: string
  content?: string
  size?: number
  mimeType?: string
  thumbnail?: string
  children?: ProjectFile[]
  createdAt: number
  updatedAt: number
  indexed?: boolean
  embeddings?: number[]
}

export interface Project {
  id: string
  name: string
  description?: string
  icon?: string
  color?: string
  files: ProjectFile[]
  conversations: string[] // conversation IDs
  memories: string[] // memory IDs
  settings?: ProjectSettings
  createdAt: number
  updatedAt: number
  lastAccessed: number
  pinned?: boolean
  tags?: string[]
}

export interface ProjectSettings {
  defaultModel?: ModelSelection
  contextFiles?: string[] // file paths to always include
  gitIntegration?: boolean
  autoSave?: boolean
  workspace?: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

export type MemoryType = 'user' | 'workspace' | 'chat' | 'project' | 'temporary' | 'long_term'

export interface Memory {
  id: string
  type: MemoryType
  content: string
  context?: string // Alias for content (compatibility)
  summary?: string
  tags?: string[]
  importance: number
  relevance?: number
  createdAt: number
  updatedAt: number
  lastAccessed: number
  expiresAt?: number
  projectId?: string
  conversationId?: string
  embeddings?: number[]
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGENTS
// ═══════════════════════════════════════════════════════════════════════════════

export type AgentTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked' | 'cancelled'
export type AgentRunStatus = 'planning' | 'executing' | 'testing' | 'verifying' | 'completed' | 'blocked' | 'failed' | 'cancelled'

export interface AgentTaskStateItem {
  id: string
  title: string
  description: string
  status: AgentTaskStatus
  priority: number
  parentTaskId?: string
  dependencies: string[]
  attempts: number
  result?: string
  error?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
}

export interface AgentTaskState {
  runId: string
  objective: string
  status: AgentRunStatus
  tasks: AgentTaskStateItem[]
  activeTaskId?: string
  iteration: number
  progress: { completed: number; total: number }
  filesChanged: string[]
  tests: string[]
  errors: string[]
  startedAt: number
  updatedAt: number
}

export type AgentType = 
  | 'coding' 
  | 'writing' 
  | 'research' 
  | 'marketing' 
  | 'business' 
  | 'teacher' 
  | 'designer' 
  | 'architect' 
  | 'devops'
  | 'custom'

export interface Agent {
  id: string
  name: string
  type: AgentType
  description: string
  systemPrompt: string
  icon?: string
  color?: string
  modelSelection: ModelSelection
  temperature?: number
  capabilities?: AuraCapability[]
  tools?: string[]
  createdAt: number
  updatedAt: number
  builtIn?: boolean
}

// ═══════════════════════════════════════════════════════════════════════════════
// THEMES
// ═══════════════════════════════════════════════════════════════════════════════

export type ThemeMode = 'dark' | 'light' | 'midnight' | 'oled' | 'glass' | 'cyber' | 'minimal' | 'aura-blue' | 'aura-purple' | 'aura-emerald' | 'system'

export interface Theme {
  id: string
  name: string
  mode: ThemeMode
  colors: {
    primary: string
    secondary: string
    accent: string
    background: string
    surface: string
    text: string
    textSecondary: string
    border: string
  }
  effects?: {
    blur?: number
    opacity?: number
    shadows?: boolean
    animations?: boolean
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIEW MODES
// ═══════════════════════════════════════════════════════════════════════════════

export type ViewMode =
  | 'chat'
  | 'agent'
  | 'code'
  | 'design'
  | 'search'
  | 'memory'
  | 'settings'
  | 'projects'
  | 'knowledge'

// ═══════════════════════════════════════════════════════════════════════════════
// USER PREFERENCES
// ═══════════════════════════════════════════════════════════════════════════════

export interface UserPreferences {
  theme: ThemeMode
  accentColor: string
  fontSize: number
  messageSpacing: 'compact' | 'normal' | 'relaxed'
  codeTheme: string
  developerMode: boolean
  showModelInMessages: boolean
  showTimestamps: boolean
  soundEffects: boolean
  notifications: boolean
  autoSave: boolean
  sendOnEnter: boolean
  spellCheck: boolean
  language?: string
  responseLength?: 'short' | 'medium' | 'long' | 'concise' | 'balanced' | 'detailed'
  showPipeline?: boolean
  enableMemory?: boolean
}

// ═══════════════════════════════════════════════════════════════════════════════
// VOICE SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

// Mirrors src/electron/aiConfig.ts VoiceSettings — served verbatim over IPC.
export interface VoiceSettings {
  enabled: boolean
  sttEngine: 'web' | 'whisper-local'
  ttsEngine: 'web' | 'api'
  voiceURI: string
  language: string
  speed: number
  pitch: number
  volume: number
  wakeWord: string
  wakeWordEnabled: boolean
  continuousMode: boolean
  bargeIn: boolean
  vadSensitivity: number
  emotionAware: boolean
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEVELOPER DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

export interface DevLogEntry {
  id: string
  timestamp: number
  type: 'request' | 'response' | 'error' | 'routing'
  provider?: AIProvider
  model?: string
  auraModel?: string
  prompt?: string
  response?: string
  tokens?: {
    input: number
    output: number
    total: number
  }
  latency?: number
  cost?: number
  error?: string
}

export interface DevDashboardStats {
  totalRequests: number
  totalTokens: number
  totalCost: number
  avgLatency: number
  providerBreakdown: Record<string, number>
  modelBreakdown: Record<string, number>
  errorRate: number
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLUGINS
// ═══════════════════════════════════════════════════════════════════════════════

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  enabled: boolean
  entrypoint: string
  permissions: string[]
  icon?: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE STEPS (for visual feedback)
// ═══════════════════════════════════════════════════════════════════════════════

export interface PipelineStep {
  id: string
  label: string
  status: 'pending' | 'active' | 'complete' | 'error' | 'skipped'
  provider?: AIProvider
  model?: string
  stage?: string
  startTime?: number
  endTime?: number
}

// Legacy alias
export type PipelineStage = PipelineStep

// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════════════════════════

export interface SearchResult {
  type: 'conversation' | 'message' | 'file' | 'memory' | 'project'
  id: string
  title: string
  content: string
  timestamp?: number
  relevance: number
  metadata?: Record<string, any>
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT OPTIONS & EVENTS (for existing code compatibility)
// ═══════════════════════════════════════════════════════════════════════════════

export interface ChatStartOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  streaming?: boolean
  profileId?: string
  /** IDs of attachments (uploaded via the attachments bridge) to use for this turn. */
  attachmentIds?: string[]
}

export interface ChatEventPayload {
  type: 'token' | 'thinking' | 'done' | 'error' | 'abort' | 'pipeline'
  streamId?: string
  delta?: string
  text?: string
  message?: string
  pipeline?: PipelineStep[]
  data?: any
  error?: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// WINDOW API (Electron)
// ═══════════════════════════════════════════════════════════════════════════════

export interface TestConnectionResult {
  success: boolean
  error?: string
  latency?: number
  latencyMs?: number
  model?: string
  supportsStreaming?: boolean
  supportsToolCalling?: boolean
  supportsVision?: boolean
  availableModels?: string[]
}

export interface AIStatus {
  connected: boolean
  provider?: AIProvider
  model?: string
  latency?: number
  hasApiKey?: boolean
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKSPACE (real filesystem)
// ═══════════════════════════════════════════════════════════════════════════════

export type FilePermission = 'read' | 'write' | 'delete' | 'rename' | 'run'

export interface WorkspaceState {
  projectId: string | null
  root: string | null
  currentFile: string | null
  currentFolder: string | null
  permissions: FilePermission[]
  /** True when AI Modes → Bypass grants full-computer access (skips permission gates). */
  bypass?: boolean
}

export interface WorkspaceAction {
  action: 'write' | 'read' | 'append' | 'mkdir' | 'list' | 'stat' | 'delete' | 'rename' | 'move' | 'copy' | 'open' | 'run'
  path: string
  content?: string
  newPath?: string
  overwrite?: boolean
}

export interface WorkspaceActionResult {
  success: boolean
  operation: string
  path: string
  exists: boolean
  bytesWritten?: number
  size?: number
  modifiedTime?: number
  checksum?: string
  data?: unknown
  error?: string
  durationMs?: number
}

export interface CapabilityStatus {
  id: string
  name: string
  available: boolean
  connected: boolean
  authorized: boolean
  configured: boolean
  tools: string[]
  health: 'ok' | 'degraded' | 'unavailable'
  error?: string
  meta?: Record<string, unknown>
}

export interface WebSearchStatus {
  connected: boolean
  provider: string | null
  message: string
}

export type AccountTier = 'dev' | 'basic' | 'premium'

export interface AccountStatus {
  loggedIn: boolean
  email: string | null
  userId: string | null
  backend: 'neon' | 'local' | 'none'
  /** Subscription / access tier. Dev = unlimited owner account. */
  tier: AccountTier
  tierLabel: 'Dev' | 'Basic' | 'Premium'
  unlimited: boolean
  trialActive: boolean
  trialEndsAt: number | null
}

export interface WebSearchResult {
  success: boolean
  query: string
  results: Array<{ title: string; url: string; snippet: string; domain: string; position: number }>
  newsResults?: Array<{ title: string; url: string; snippet: string; domain: string }>
  provider: string
  error?: string
  duration: number
  cached?: boolean
}

export interface PageReadResult {
  url: string
  title: string
  text: string
  headings: string[]
  links: Array<{ text: string; url: string }>
  wordCount: number
  error?: string
}

export interface AuraAPI {
  chat: {
    start: (streamId: string, messages: Message[], options?: ChatStartOptions) => Promise<void>
    on: (event: string, callback: (payload: ChatEventPayload) => void) => () => void
    abort: (streamId: string) => Promise<void>
    respondToolPermission?: (requestId: string, decision: 'allow' | 'allow-session' | 'deny') => Promise<boolean>
  }
  agent: {
    start: (runId: string, messages: Message[], options?: ChatStartOptions) => Promise<{ runId: string }>
    on: (event: string, callback: (payload: ChatEventPayload & { state?: AgentTaskState; event?: string }) => void) => () => void
    abort: (runId: string) => Promise<void>
  }
  ai: {
    getConfig: () => Promise<AIConfig>
    saveConfig: (config: AIConfig) => Promise<void>
    setConfig: (config: Partial<AIConfig>) => Promise<AIConfig>
    chat: (messages: Message[], config?: Partial<AIConfig>) => Promise<string>
    stream: (messages: Message[], onChunk: (chunk: string) => void, config?: Partial<AIConfig>) => Promise<void>
    getStatus: () => Promise<AIStatus>
    getPresets: () => Promise<ModelPreset[]>
  }
  profiles: {
    list: () => Promise<APIProfile[]>
    create: (profile: Partial<APIProfile>) => Promise<APIProfile>
    update: (id: string, updates: Partial<APIProfile>) => Promise<APIProfile>
    delete: (id: string) => Promise<void>
    getActive: () => Promise<APIProfile | null>
    setActive: (id: string) => Promise<void>
    test: (profileOrId: string | APIProfile) => Promise<TestConnectionResult>
    testConnection: (profileOrId: string | APIProfile) => Promise<TestConnectionResult>
    duplicate: (id: string) => Promise<APIProfile>
    setDefault: (id: string) => Promise<void>
    enable: (id: string, enabled: boolean) => Promise<void>
    exportAll: () => Promise<string>
    importAll: (json: string) => Promise<void>
    backup: () => Promise<string>
  }
  models: {
    list: () => Promise<SavedModel[]>
    add: (model: Omit<SavedModel, 'id'>) => Promise<SavedModel>
    update: (id: string, updates: Partial<SavedModel>) => Promise<SavedModel>
    delete: (id: string) => Promise<void>
    togglePin: (id: string) => Promise<void>
    toggleFavorite: (id: string) => Promise<void>
    exportAll: () => Promise<string>
    importAll: (json: string) => Promise<void>
    virtual: {
      list: () => Promise<AuraVirtualModel[]>
      create: (model: Omit<AuraVirtualModel, 'id' | 'builtIn'>) => Promise<AuraVirtualModel>
      update: (id: string, updates: Partial<AuraVirtualModel>) => Promise<AuraVirtualModel>
      delete: (id: string) => Promise<void>
      export: (id: string) => Promise<string>
      import: (json: string) => Promise<AuraVirtualModel>
    }
  }
  memory: {
    list: () => Promise<Memory[]>
    create: (memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Memory>
    update: (id: string, updates: Partial<Memory>) => Promise<Memory>
    delete: (id: string) => Promise<void>
  }
  projects: {
    list: () => Promise<Project[]>
    create: (project: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'lastAccessed'>>) => Promise<Project>
    update: (id: string, updates: Partial<Project>) => Promise<Project>
    delete: (id: string) => Promise<void>
    setActive: (id: string) => Promise<void>
    getActive: () => Promise<Project | null>
    pickFolder: () => Promise<{ canceled: boolean; path: string | null }>
    uploadFile: (projectId: string, file: File) => Promise<ProjectFile>
    deleteFile: (projectId: string, fileId: string) => Promise<void>
  }
  files: {
    /** Real filesystem path for a renderer File (drag & drop or file picker). */
    getPath: (file: unknown) => string
  }
  attachments: {
    add: (paths: string[]) => Promise<Attachment[]>
    list: () => Promise<Attachment[]>
    remove: (id: string) => Promise<boolean>
    clear: () => Promise<boolean>
  }
  workspace: {
    state: () => Promise<WorkspaceState>
    execute: (action: WorkspaceAction) => Promise<WorkspaceActionResult>
    grant: (ops: FilePermission[]) => Promise<WorkspaceState>
    revoke: (op: FilePermission) => Promise<WorkspaceState>
    setCurrentFile: (relPath: string) => Promise<WorkspaceState>
    setCurrentFolder: (relPath: string) => Promise<WorkspaceState>
    opsLog: () => Promise<Record<string, unknown>[]>
    opsLogClear: () => Promise<boolean>
    indexStatus: () => Promise<{ indexing: boolean; indexed: number; watched: boolean }>
    search: (query: string) => Promise<Array<{ path: string; rel: string; name: string; score: number }>>
  }
  agents: {
    list: () => Promise<Agent[]>
    create: (agent: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Agent>
    update: (id: string, updates: Partial<Agent>) => Promise<Agent>
    delete: (id: string) => Promise<void>
  }
  search: {
    global: (query: string) => Promise<SearchResult[]>
  }
  themes: {
    list: () => Promise<Theme[]>
    apply: (themeId: string) => Promise<void>
  }
  window: {
    minimize: () => void
    maximize: () => void
    close: () => void
    toggleDevTools: () => void
  }
  openExternal: (url: string) => Promise<boolean>
  routing: {
    getConfig: () => Promise<any>
    setConfig: (config: any) => Promise<void>
    get: () => Promise<any>
    set: (config: any) => Promise<void>
  }
  voice: {
    getSettings: () => Promise<VoiceSettings>
    setSettings: (settings: Partial<VoiceSettings>) => Promise<void>
  }
  devlogs: {
    list: () => Promise<DevLogEntry[]>
    clear: () => Promise<void>
    stats: () => Promise<DevDashboardStats>
  }
  plugins: {
    list: () => Promise<PluginManifest[]>
  }
  capabilities: {
    list: () => Promise<CapabilityStatus[]>
    configureSearch: (provider: string, key: string) => Promise<CapabilityStatus[]>
    configureFigma: (token: string) => Promise<CapabilityStatus[]>
    configureGitHub: (token: string) => Promise<CapabilityStatus[]>
    configureMcp: (servers: Array<{ name: string; url: string; enabled: boolean }>) => Promise<CapabilityStatus[]>
    refresh: () => Promise<CapabilityStatus[]>
  }
  web: {
    search: (query: string, opts?: Record<string, unknown>) => Promise<WebSearchResult>
    readPage: (url: string, maxChars?: number) => Promise<PageReadResult>
    searchStatus: () => Promise<WebSearchStatus>
  }
  conversations: {
    load: () => Promise<PersistedChats>
    save: (state: PersistedChats) => Promise<void>
  }
  account: {
    status: () => Promise<AccountStatus>
    signup: (email: string, password: string) => Promise<AccountStatus>
    login: (email: string, password: string) => Promise<AccountStatus>
    logout: () => Promise<AccountStatus>
  }
  onToggleCommandPalette?: (callback: () => void) => () => void
}

declare global {
  interface Window {
    aura?: AuraAPI
  }
}
