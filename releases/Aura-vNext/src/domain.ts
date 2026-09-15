/**
 * Local chat domain types (conversations, folders, projects) — renderer-owned,
 * persisted to localStorage. Distinct from the backend model/provider state.
 */

import type { AuraModelId } from './types'

export interface Attachment {
  id: string
  name: string
  mimeType: string
  size: number
  /** base64 (no data: prefix) for images we send to vision models. */
  data?: string
  /** object URL for preview only. */
  previewUrl?: string
  kind: 'image' | 'file'
}

export interface ChatMessageUI {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  attachments?: Attachment[]
  createdAt: number
  isStreaming?: boolean
  error?: string
  /** Aura model that produced this message. */
  auraModelId?: AuraModelId
  /** Backend model behind the Aura alias (shown only in Developer Mode). */
  backendModel?: string
  providerName?: string
  latencyMs?: number
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
  routeReason?: string
}

export interface Conversation {
  id: string
  title: string
  messages: ChatMessageUI[]
  createdAt: number
  updatedAt: number
  pinned?: boolean
  folderId?: string | null
  projectId?: string | null
  /** Aura model chosen for this conversation. */
  auraModelId: AuraModelId
}

export interface Folder {
  id: string
  name: string
  parentId: string | null
  createdAt: number
}

export interface ProjectNote {
  id: string
  content: string
  createdAt: number
}

export interface Project {
  id: string
  name: string
  icon: string
  description?: string
  notes: ProjectNote[]
  pinnedPrompts: string[]
  /** Extra context injected into every chat in this project. */
  context?: string
  auraModelId?: AuraModelId
  createdAt: number
  updatedAt: number
}
