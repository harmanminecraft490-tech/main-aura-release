/**
 * CHAT PERSISTENCE (renderer side)
 *
 * Bridges the Zustand store to the main-process JSON store:
 *   1. On boot, hydrate conversations + panel sessions from disk.
 *   2. On any chat/panel change, debounce-save back to disk.
 *
 * This is what keeps chats alive across app restarts and panel sessions alive
 * across tab switches. Cloud sync (per-account) is layered on top later.
 */

import { useAuraStore } from '@/store'
import type { PersistedChats } from '@/types'

let initialized = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** Attachment payloads can hold base64 bytes; drop them on the way to disk. */
function stripHeavyFields(chats: PersistedChats): PersistedChats {
  const stripMessage = (message: { attachments?: Array<{ data?: string }> }) => {
    if (!message.attachments || message.attachments.length === 0) return message
    return { ...message, attachments: message.attachments.map(attachment => ({ ...attachment, data: undefined })) }
  }
  return {
    conversations: chats.conversations.map(conversation => ({
      ...conversation,
      messages: conversation.messages.map(stripMessage as never),
    })),
    panelSessions: Object.fromEntries(
      Object.entries(chats.panelSessions).map(([panel, sessions]) => [
        panel,
        sessions.map(session => ({ ...session, messages: session.messages.map(stripMessage as never) })),
      ])
    ),
  }
}

export function initPersistence(): void {
  if (initialized) return
  initialized = true

  const bridge = typeof window !== 'undefined' ? window.aura?.conversations : undefined
  if (!bridge) return

  // 1. Hydrate once on boot (local store; cloud memory loads through accounts).
  bridge
    .load()
    .then(chats => useAuraStore.getState().hydrateChats(chats))
    .catch(() => { /* first run — nothing persisted yet */ })

  // 2. Debounced persist on store changes. CRITICAL: never write during active
  //    streaming — token-by-token updates would hammer the main process with
  //    synchronous disk writes and freeze the UI. Writes only happen once a
  //    stream has finished (or any panel run stopped) and then gone quiet.
  useAuraStore.subscribe(state => {
    const anyStreamActive = state.isStreaming || Object.values(state.panelRunning).some(Boolean)
    if (anyStreamActive) return

    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const chats: PersistedChats = {
        conversations: state.conversations,
        panelSessions: state.panelSessions,
      }
      void window.aura?.conversations.save(stripHeavyFields(chats))
    }, 1500)
  })
}
