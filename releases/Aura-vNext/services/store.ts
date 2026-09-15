/**
 * Zustand store: renderer UI + local chat state, plus a mirror of backend
 * model/provider/mapping state pushed over IPC.
 *
 * Conversations/folders/projects/prefs persist to localStorage (debounced).
 * Backend-owned state (models, providers, mappings, suggestions, settings) is
 * never persisted here — it is the backend's source of truth.
 */

import { create } from 'zustand'
import type {
  AppSettings, AuraMappingView, AuraModelId, MappingSuggestion, ProviderConfig, RegistryModel,
} from '../src/types'
import type { Conversation, Folder, Project, ChatMessageUI } from '../src/domain'

const STORAGE_KEY = 'aura-vnext:workspace'

interface PersistedWorkspace {
  conversations: Conversation[]
  folders: Folder[]
  projects: Project[]
  activeConversationId: string | null
}

function loadWorkspace(): PersistedWorkspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as PersistedWorkspace
  } catch {
    // corrupt storage → fresh workspace
  }
  return { conversations: [], folders: [], projects: [], activeConversationId: null }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
function persist(state: PersistedWorkspace): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // ignore quota errors
    }
  }, 250)
}

export type View = 'chat' | 'settings' | 'projects'

interface StoreState {
  // Workspace
  conversations: Conversation[]
  folders: Folder[]
  projects: Project[]
  activeConversationId: string | null
  view: View
  settingsTab: string
  sidebarOpen: boolean
  searchQuery: string

  // Backend-mirrored state
  models: RegistryModel[]
  providers: ProviderConfig[]
  mappings: AuraMappingView[]
  suggestions: MappingSuggestion[]
  appSettings: AppSettings

  // Derived helpers
  activeConversation: () => Conversation | undefined

  // Workspace actions
  setView: (view: View) => void
  setSettingsTab: (tab: string) => void
  toggleSidebar: () => void
  setSearchQuery: (query: string) => void
  createConversation: (init?: Partial<Conversation>) => string
  deleteConversation: (id: string) => void
  setActiveConversation: (id: string) => void
  updateConversation: (id: string, updates: Partial<Conversation>) => void
  addMessage: (conversationId: string, message: ChatMessageUI) => void
  updateMessage: (conversationId: string, messageId: string, updates: Partial<ChatMessageUI>) => void
  removeMessage: (conversationId: string, messageId: string) => void
  setConversationModel: (conversationId: string, auraModelId: AuraModelId) => void

  createFolder: (name: string, parentId?: string | null) => void
  renameFolder: (id: string, name: string) => void
  deleteFolder: (id: string) => void
  moveConversation: (conversationId: string, folderId: string | null) => void

  createProject: (init: Partial<Project>) => string
  updateProject: (id: string, updates: Partial<Project>) => void
  deleteProject: (id: string) => void

  // Backend state setters
  setModels: (models: RegistryModel[]) => void
  setProviders: (providers: ProviderConfig[]) => void
  setMappings: (mappings: AuraMappingView[]) => void
  setSuggestions: (suggestions: MappingSuggestion[]) => void
  setAppSettings: (settings: AppSettings) => void
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}

const initial = loadWorkspace()

const DEFAULT_SETTINGS: AppSettings = {
  developerMode: false,
  defaultAuraModel: 'aura-auto',
  sendOnEnter: true,
  reduceMotion: false,
}

export const useStore = create<StoreState>((set, get) => {
  const commit = () => {
    const { conversations, folders, projects, activeConversationId } = get()
    persist({ conversations, folders, projects, activeConversationId })
  }

  return {
    conversations: initial.conversations,
    folders: initial.folders,
    projects: initial.projects,
    activeConversationId: initial.activeConversationId,
    view: 'chat',
    settingsTab: 'general',
    sidebarOpen: true,
    searchQuery: '',

    models: [],
    providers: [],
    mappings: [],
    suggestions: [],
    appSettings: DEFAULT_SETTINGS,

    activeConversation: () => get().conversations.find(c => c.id === get().activeConversationId),

    setView: view => set({ view }),
    setSettingsTab: tab => set({ settingsTab: tab, view: 'settings' }),
    toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),
    setSearchQuery: query => set({ searchQuery: query }),

    createConversation: init => {
      const id = uid()
      const conversation: Conversation = {
        id,
        title: 'New chat',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        folderId: init?.folderId ?? null,
        projectId: init?.projectId ?? null,
        auraModelId: init?.auraModelId ?? (get().appSettings.defaultAuraModel as AuraModelId),
        ...init,
      }
      set(state => ({
        conversations: [conversation, ...state.conversations],
        activeConversationId: id,
        view: 'chat',
      }))
      commit()
      return id
    },

    deleteConversation: id => {
      set(state => {
        const conversations = state.conversations.filter(c => c.id !== id)
        return {
          conversations,
          activeConversationId:
            state.activeConversationId === id ? conversations[0]?.id ?? null : state.activeConversationId,
        }
      })
      commit()
    },

    setActiveConversation: id => {
      set({ activeConversationId: id, view: 'chat' })
      commit()
    },

    updateConversation: (id, updates) => {
      set(state => ({
        conversations: state.conversations.map(c =>
          c.id === id ? { ...c, ...updates, updatedAt: Date.now() } : c
        ),
      }))
      commit()
    },

    addMessage: (conversationId, message) => {
      set(state => ({
        conversations: state.conversations.map(c =>
          c.id === conversationId
            ? {
                ...c,
                messages: [...c.messages, message],
                updatedAt: Date.now(),
                title:
                  c.messages.length === 0 && message.role === 'user'
                    ? message.content.slice(0, 60) + (message.content.length > 60 ? '…' : '')
                    : c.title,
              }
            : c
        ),
      }))
      commit()
    },

    updateMessage: (conversationId, messageId, updates) => {
      set(state => ({
        conversations: state.conversations.map(c =>
          c.id === conversationId
            ? { ...c, messages: c.messages.map(m => (m.id === messageId ? { ...m, ...updates } : m)) }
            : c
        ),
      }))
      // Streaming updates are frequent; persist is debounced so this is cheap.
      commit()
    },

    removeMessage: (conversationId, messageId) => {
      set(state => ({
        conversations: state.conversations.map(c =>
          c.id === conversationId ? { ...c, messages: c.messages.filter(m => m.id !== messageId) } : c
        ),
      }))
      commit()
    },

    setConversationModel: (conversationId, auraModelId) => {
      set(state => ({
        conversations: state.conversations.map(c =>
          c.id === conversationId ? { ...c, auraModelId } : c
        ),
      }))
      commit()
    },

    createFolder: (name, parentId = null) => {
      set(state => ({
        folders: [...state.folders, { id: uid(), name, parentId, createdAt: Date.now() }],
      }))
      commit()
    },

    renameFolder: (id, name) => {
      set(state => ({ folders: state.folders.map(f => (f.id === id ? { ...f, name } : f)) }))
      commit()
    },

    deleteFolder: id => {
      set(state => ({
        // Delete folder + descendants; orphan their conversations to root.
        folders: state.folders.filter(f => f.id !== id && f.parentId !== id),
        conversations: state.conversations.map(c => (c.folderId === id ? { ...c, folderId: null } : c)),
      }))
      commit()
    },

    moveConversation: (conversationId, folderId) => {
      set(state => ({
        conversations: state.conversations.map(c =>
          c.id === conversationId ? { ...c, folderId } : c
        ),
      }))
      commit()
    },

    createProject: init => {
      const id = uid()
      const project: Project = {
        id,
        name: init.name ?? 'New project',
        icon: init.icon ?? '📁',
        description: init.description,
        notes: [],
        pinnedPrompts: [],
        context: init.context,
        auraModelId: init.auraModelId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      set(state => ({ projects: [project, ...state.projects] }))
      commit()
      return id
    },

    updateProject: (id, updates) => {
      set(state => ({
        projects: state.projects.map(p =>
          p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
        ),
      }))
      commit()
    },

    deleteProject: id => {
      set(state => ({
        projects: state.projects.filter(p => p.id !== id),
        conversations: state.conversations.map(c => (c.projectId === id ? { ...c, projectId: null } : c)),
      }))
      commit()
    },

    setModels: models => set({ models }),
    setProviders: providers => set({ providers }),
    setMappings: mappings => set({ mappings }),
    setSuggestions: suggestions => set({ suggestions }),
    setAppSettings: appSettings => set({ appSettings }),
  }
})
