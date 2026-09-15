import { create } from 'zustand'
import type {
  Conversation, Message, ViewMode, UserPreferences, Memory,
  AIConfig, AIMode, AIProvider,
  APIProfile, SmartRouting, SavedModel, ModelPreset,
  AuraVirtualModel, ModelSelection,
  DevLogEntry, DevDashboardStats,
  VoiceSettings, PluginManifest,
  PipelineStep, TaskType, PanelSession, PersistedChats,
  AccountStatus,
} from '@/types'
import {
  loadDefaultSelection,
  loadVirtualModels,
  saveDefaultSelection,
  saveVirtualModels,
} from '@/services/auraModels'

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}

/** A file opened in the live editor (backed by the real workspace file). */
export interface FileOpen {
  id: string
  name: string
  path: string
  content: string
  dirty: boolean
  language?: string
}

/** Status of the live editor during AI coding. */
export interface EditorStatus {
  state: 'idle' | 'writing' | 'saved' | 'error'
  fileName?: string
  message?: string
  timestamp: number
}

interface AuraState {
  // ─── Conversations ────────────────────────────────────────────────────────
  conversations: Conversation[]
  activeConversationId: string | null
  viewMode: ViewMode
  /** Agent / Code / Design threads — persisted so tab switches don't lose them. */
  panelSessions: Record<string, PanelSession[]>
  activePanelSessionId: Record<string, string>
  /** Per-panel streaming flag — survives tab switches so an in-flight run keeps going. */
  panelRunning: Record<string, boolean>
  sidebarOpen: boolean
  commandPaletteOpen: boolean
  isStreaming: boolean
  activePipeline: PipelineStep[] | null

  // ─── Memory ────────────────────────────────────────────────────────────────
  memories: Memory[]
  memoryEnabled: boolean

  // ─── Preferences ───────────────────────────────────────────────────────────
  preferences: UserPreferences

  // ─── AI Config (legacy) ────────────────────────────────────────────────────
  aiConfig: AIConfig | null
  aiMode: AIMode

  // ─── API Profiles ──────────────────────────────────────────────────────────
  profiles: APIProfile[]
  activeProfileId: string | null
  presets: ModelPreset[]

  // ─── Smart Routing ──────────────────────────────────────────────────────────
  routing: SmartRouting

  // ─── Models ──────────────────────────────────────────────────────────────────
  savedModels: SavedModel[]

  // ─── Aura virtual models ─────────────────────────────────────────────────────
  virtualModels: AuraVirtualModel[]
  defaultModelSelection: ModelSelection

  // ─── Developer Dashboard ─────────────────────────────────────────────────────
  devLogs: DevLogEntry[]
  devStats: DevDashboardStats | null

  // ─── Voice ────────────────────────────────────────────────────────────────────
  voiceSettings: VoiceSettings | null
  voiceListening: boolean
  voiceSpeaking: boolean
  availableVoices: { uri: string; name: string; lang: string }[]

  // ─── Plugins ──────────────────────────────────────────────────────────────────
  plugins: PluginManifest[]

  // ─── Account (Our Account / free trial / tiers) ───────────────────────────────
  account: AccountStatus | null
  /** When set, Settings opens on this section then clears. */
  pendingSettingsSection: string | null

  // ─── Live Editor (open files, backed by the real workspace) ───────────────────
  openFiles: FileOpen[]
  activeFileId: string | null

  // ─── Live Coding Layout ──────────────────────────────────────────────────────
  /** True when the editor pane is visible beside chat (split layout) */
  isLiveCoding: boolean
  /** Small status indicator shown during AI coding */
  editorStatus: EditorStatus | null
  /** Whether the file explorer panel is open */
  explorerOpen: boolean

  // ─── Actions ───────────────────────────────────────────────────────────────────
  activeConversation: () => Conversation | null
  createConversation: () => string
  deleteConversation: (id: string) => void
  setActiveConversation: (id: string) => void
  addMessage: (conversationId: string, message: Message) => void
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void
  setViewMode: (mode: ViewMode) => void
  toggleSidebar: () => void
  toggleCommandPalette: () => void
  setStreaming: (streaming: boolean) => void
  setActivePipeline: (steps: PipelineStep[] | null) => void
  addMemory: (memory: Memory) => void
  setMemories: (memories: Memory[]) => void
  updatePreferences: (prefs: Partial<UserPreferences>) => void
  setAIConfig: (config: AIConfig) => void
  setAIMode: (mode: AIMode) => void
  setProfiles: (profiles: APIProfile[]) => void
  setActiveProfileId: (id: string | null) => void
  setPresets: (presets: ModelPreset[]) => void
  setRouting: (routing: SmartRouting) => void
  setSavedModels: (models: SavedModel[]) => void
  setVirtualModels: (models: AuraVirtualModel[]) => void
  setDefaultModelSelection: (selection: ModelSelection) => void
  setConversationModelSelection: (conversationId: string, selection: ModelSelection) => void

  // ─── Panel sessions (Agent / Code / Design) ────────────────────────────────
  hydrateChats: (chats: PersistedChats) => void
  setPanelSessions: (panel: PanelSession['panel'], sessions: PanelSession[]) => void
  createPanelSession: (panel: PanelSession['panel']) => string
  setActivePanelSession: (panel: PanelSession['panel'], sessionId: string) => void
  addPanelMessage: (panel: PanelSession['panel'], sessionId: string, message: Message) => void
  updatePanelMessage: (panel: PanelSession['panel'], sessionId: string, messageId: string, updates: Partial<Message>) => void
  deletePanelSession: (panel: PanelSession['panel'], sessionId: string) => void
  setPanelRunning: (panel: PanelSession['panel'], running: boolean) => void
  setDevLogs: (logs: DevLogEntry[]) => void
  setDevStats: (stats: DevDashboardStats | null) => void
  setVoiceSettings: (settings: VoiceSettings) => void
  setVoiceListening: (listening: boolean) => void
  setVoiceSpeaking: (speaking: boolean) => void
  setAvailableVoices: (voices: { uri: string; name: string; lang: string }[]) => void
  setPlugins: (plugins: PluginManifest[]) => void
  setAccount: (account: AccountStatus | null) => void
  openSettingsSection: (section: string) => void
  consumePendingSettingsSection: () => string | null

  // ─── Live editor actions ─────────────────────────────────────────────────────
  openFile: (file: Omit<FileOpen, 'id' | 'dirty'>) => string
  closeFile: (id: string) => void
  setActiveFile: (id: string) => void
  setFileContent: (id: string, content: string) => void
  markFileSaved: (id: string) => void

  // ─── Live coding layout actions ──────────────────────────────────────────────
  setIsLiveCoding: (active: boolean) => void
  setEditorStatus: (status: EditorStatus | null) => void
  toggleExplorer: () => void
  setExplorerOpen: (open: boolean) => void
}

export const useAuraStore = create<AuraState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  viewMode: 'chat',
  panelSessions: {},
  activePanelSessionId: {},
  panelRunning: {},
  sidebarOpen: true,
  commandPaletteOpen: false,
  isStreaming: false,
  activePipeline: null,

  memories: [],
  memoryEnabled: true,

  preferences: {
    theme: 'dark',
    accentColor: '#3b82f6', // blue-500 as default
    fontSize: 14,
    messageSpacing: 'normal',
    codeTheme: 'default',
    developerMode: false,
    showModelInMessages: true,
    showTimestamps: true,
    soundEffects: true,
    notifications: true,
    autoSave: true,
    sendOnEnter: true,
    spellCheck: true,
    language: 'en',
    responseLength: 'balanced',
    showPipeline: true,
    enableMemory: true,
  },

  aiConfig: null,
  aiMode: 'auto',

  profiles: [],
  activeProfileId: null,
  presets: [],

  routing: {
    chat: null,
    coding: null,
    planning: null,
    vision: null,
    voice: null,
    embeddings: null,
  },

  savedModels: [],
  virtualModels: loadVirtualModels(),
  defaultModelSelection: loadDefaultSelection(),
  devLogs: [],
  devStats: null,
  voiceSettings: null,
  voiceListening: false,
  voiceSpeaking: false,
  availableVoices: [],
  plugins: [],
  account: null,
  pendingSettingsSection: null,
  openFiles: [],
  activeFileId: null,
  isLiveCoding: false,
  editorStatus: null,
  explorerOpen: false,

  // ─── Conversation actions ─────────────────────────────────────────────────
  activeConversation: () => {
    const state = get()
    return state.conversations.find(c => c.id === state.activeConversationId) ?? null
  },

  createConversation: () => {
    const id = generateId()
    const conversation: Conversation = {
      id,
      title: 'New conversation',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    set(state => ({
      conversations: [conversation, ...state.conversations],
      activeConversationId: id,
      viewMode: 'chat',
    }))
    return id
  },

  deleteConversation: (id) => {
    set(state => {
      const filtered = state.conversations.filter(c => c.id !== id)
      return {
        conversations: filtered,
        activeConversationId: state.activeConversationId === id
          ? (filtered[0]?.id ?? null)
          : state.activeConversationId,
      }
    })
  },

  setActiveConversation: (id) => {
    set({ activeConversationId: id, viewMode: 'chat' })
  },

  addMessage: (conversationId, message) => {
    set(state => ({
      conversations: state.conversations.map(c =>
        c.id === conversationId
          ? {
              ...c,
              messages: [...c.messages, message],
              updatedAt: Date.now(),
              title: c.messages.length === 0 && message.role === 'user'
                ? message.content.slice(0, 60) + (message.content.length > 60 ? '…' : '')
                : c.title,
            }
          : c
      ),
    }))
  },

  updateMessage: (conversationId, messageId, updates) => {
    set(state => ({
      conversations: state.conversations.map(c =>
        c.id === conversationId
          ? {
              ...c,
              messages: c.messages.map(m =>
                m.id === messageId ? { ...m, ...updates } : m
              ),
              updatedAt: Date.now(),
            }
          : c
      ),
    }))
  },

  // ─── UI actions ───────────────────────────────────────────────────────────
  setViewMode: (mode) => set({ viewMode: mode }),
  toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),
  toggleCommandPalette: () => set(state => ({ commandPaletteOpen: !state.commandPaletteOpen })),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  setActivePipeline: (steps) => set({ activePipeline: steps }),

  // ─── Memory actions ────────────────────────────────────────────────────────
  addMemory: (memory) => set(state => ({ memories: [...state.memories, memory] })),
  setMemories: (memories) => set({ memories }),
  updatePreferences: (prefs) => set(state => ({
    preferences: { ...state.preferences, ...prefs },
  })),

  // ─── AI config actions ────────────────────────────────────────────────────
  setAIConfig: (config) => set({ aiConfig: config, aiMode: config.aiMode }),
  setAIMode: (mode) => set({ aiMode: mode }),

  // ─── Profile actions ───────────────────────────────────────────────────────
  setProfiles: (profiles) => {
    const active = profiles.find(p => p.isDefault)?.id ?? profiles[0]?.id ?? null
    set({ profiles, activeProfileId: active })
  },
  setActiveProfileId: (id) => set({ activeProfileId: id }),
  setPresets: (presets) => set({ presets }),

  // ─── Routing actions ────────────────────────────────────────────────────────
  setRouting: (routing) => set({ routing }),

  // ─── Model actions ──────────────────────────────────────────────────────────
  setSavedModels: (models) => set({ savedModels: models }),
  setVirtualModels: (models) => {
    saveVirtualModels(models)
    set({ virtualModels: models })
  },
  setDefaultModelSelection: (selection) => {
    saveDefaultSelection(selection)
    set({ defaultModelSelection: selection })
  },
  setConversationModelSelection: (conversationId, selection) => {
    set(state => ({
      conversations: state.conversations.map(c =>
        c.id === conversationId ? { ...c, modelSelection: selection } : c
      ),
    }))
  },

  // ─── Panel sessions (Agent / Code / Design) ────────────────────────────────
  hydrateChats: (chats) => {
    set(state => {
      const loaded = chats.conversations
      // Reconcile the active conversation: hydrate can resolve AFTER the UI
      // already created a fresh conversation (ChatView auto-creates one on
      // mount). CRITICAL: never leave activeConversationId pointing at a
      // conversation that isn't in the list — a stale id silently swallows every
      // addMessage/updateMessage, so the message reaches the AI but never shows
      // (and the empty list gets saved, self-perpetuating the bug). Keep the
      // fresh conversation when it already holds messages, or when there is no
      // persisted history at all; otherwise fall back to the most recent one.
      const current = state.activeConversationId
      const currentInStore = state.conversations.find(c => c.id === current)
      const existsInLoaded = current !== null && loaded.some(c => c.id === current)
      const preserveFresh = currentInStore !== undefined && !existsInLoaded
        && (currentInStore.messages.length > 0 || loaded.length === 0)
      const conversations = preserveFresh ? [currentInStore, ...loaded] : loaded
      return {
        conversations,
        panelSessions: chats.panelSessions ?? {},
        activeConversationId: existsInLoaded || preserveFresh
          ? current
          : (conversations[0]?.id ?? null),
      }
    })
  },

  setPanelSessions: (panel, sessions) => {
    set(state => ({
      panelSessions: { ...state.panelSessions, [panel]: sessions },
    }))
  },

  createPanelSession: (panel) => {
    const id = generateId()
    const session: PanelSession = {
      id,
      title: `New ${panel === 'agent' ? 'agent' : panel === 'code' ? 'coding' : 'design'} session`,
      panel,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    set(state => ({
      panelSessions: { ...state.panelSessions, [panel]: [session, ...(state.panelSessions[panel] ?? [])] },
      activePanelSessionId: { ...state.activePanelSessionId, [panel]: id },
    }))
    return id
  },

  setActivePanelSession: (panel, sessionId) => {
    set(state => ({
      activePanelSessionId: { ...state.activePanelSessionId, [panel]: sessionId },
    }))
  },

  addPanelMessage: (panel, sessionId, message) => {
    set(state => {
      const sessions = (state.panelSessions[panel] ?? []).map(session => {
        if (session.id !== sessionId) return session
        const next = {
          ...session,
          messages: [...session.messages, message],
          updatedAt: Date.now(),
          title: session.messages.length === 0 && message.role === 'user'
            ? message.content.slice(0, 60) + (message.content.length > 60 ? '…' : '')
            : session.title,
        }
        return next
      })
      return { panelSessions: { ...state.panelSessions, [panel]: sessions } }
    })
  },

  updatePanelMessage: (panel, sessionId, messageId, updates) => {
    set(state => {
      const sessions = (state.panelSessions[panel] ?? []).map(session => {
        if (session.id !== sessionId) return session
        return {
          ...session,
          messages: session.messages.map(message =>
            message.id === messageId ? { ...message, ...updates } : message
          ),
          updatedAt: Date.now(),
        }
      })
      return { panelSessions: { ...state.panelSessions, [panel]: sessions } }
    })
  },

  deletePanelSession: (panel, sessionId) => {
    set(state => {
      const sessions = (state.panelSessions[panel] ?? []).filter(session => session.id !== sessionId)
      const activeId = state.activePanelSessionId[panel]
      return {
        panelSessions: { ...state.panelSessions, [panel]: sessions },
        activePanelSessionId: {
          ...state.activePanelSessionId,
          [panel]: activeId === sessionId ? (sessions[0]?.id ?? '') : activeId,
        },
      }
    })
  },

  setPanelRunning: (panel, running) => {
    set(state => ({ panelRunning: { ...state.panelRunning, [panel]: running } }))
  },

  // ─── Dev dashboard actions ──────────────────────────────────────────────────
  setDevLogs: (logs) => set({ devLogs: logs }),
  setDevStats: (stats) => set({ devStats: stats }),

  // ─── Voice actions ───────────────────────────────────────────────────────────
  setVoiceSettings: (settings) => set({ voiceSettings: settings }),
  setVoiceListening: (listening) => set({ voiceListening: listening }),
  setVoiceSpeaking: (speaking) => set({ voiceSpeaking: speaking }),
  setAvailableVoices: (voices) => set({ availableVoices: voices }),

  // ─── Plugin actions ──────────────────────────────────────────────────────────
  setPlugins: (plugins) => set({ plugins }),
  setAccount: (account) => set({ account }),
  openSettingsSection: (section) => set({ pendingSettingsSection: section, viewMode: 'settings' }),
  consumePendingSettingsSection: () => {
    const section = get().pendingSettingsSection
    if (section) set({ pendingSettingsSection: null })
    return section
  },

  // ─── Live editor actions ─────────────────────────────────────────────────────
  openFile: (file) => {
    const existing = get().openFiles.find(f => f.path === file.path)
    if (existing) {
      set({ activeFileId: existing.id })
      return existing.id
    }
    const id = generateId()
    set(state => ({
      openFiles: [...state.openFiles, { ...file, id, dirty: false }],
      activeFileId: id,
    }))
    return id
  },
  closeFile: (id) => set(state => {
    const remaining = state.openFiles.filter(f => f.id !== id)
    const newIsLiveCoding = remaining.length > 0 ? state.isLiveCoding : false
    return {
      openFiles: remaining,
      activeFileId: state.activeFileId === id ? (remaining[remaining.length - 1]?.id ?? null) : state.activeFileId,
      isLiveCoding: newIsLiveCoding,
    }
  }),
  setActiveFile: (id) => set({ activeFileId: id }),
  setFileContent: (id, content) => set(state => ({
    openFiles: state.openFiles.map(f => f.id === id ? { ...f, content, dirty: true } : f),
  })),
  markFileSaved: (id) => set(state => ({
    openFiles: state.openFiles.map(f => f.id === id ? { ...f, dirty: false } : f),
  })),

  // ─── Live coding layout actions ──────────────────────────────────────────────
  setIsLiveCoding: (active) => set({ isLiveCoding: active }),
  setEditorStatus: (status) => set({ editorStatus: status }),
  toggleExplorer: () => set(state => ({ explorerOpen: !state.explorerOpen })),
  setExplorerOpen: (open) => set({ explorerOpen: open }),
}))
