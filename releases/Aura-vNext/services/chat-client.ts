/**
 * Chat client: wires a single send() through the backend stream and into the
 * store, with hard guards against the failure modes from the old app:
 *
 *  - stale streams: every event is filtered by streamId; a superseded stream
 *    can never write tokens into the UI
 *  - stuck "Thinking…": the terminal event always clears isStreaming and
 *    unsubscribes, even on error/abort
 *  - duplicate sends: guarded by the caller (one active stream per conversation)
 *  - leaks: all listeners are removed on terminal event or abort
 */

import type {
  ChatDeltaPayload, ChatDonePayload, ChatErrorPayload, ChatRoutedPayload,
} from '../src/types'
import type { Attachment, ChatMessageUI, Conversation } from '../src/domain'
import { useStore } from './store'

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}

/** Convert stored messages to the backend wire format (with image parts). */
function toWireMessages(messages: ChatMessageUI[]) {
  return messages.map(message => {
    const images = (message.attachments ?? []).filter(a => a.kind === 'image' && a.data)
    if (images.length > 0) {
      return {
        role: message.role,
        content: message.content,
        parts: [
          ...(message.content ? [{ kind: 'text' as const, text: message.content }] : []),
          ...images.map(image => ({ kind: 'image' as const, data: image.data!, mimeType: image.mimeType })),
        ],
      }
    }
    return { role: message.role, content: message.content }
  })
}

export interface ActiveStream {
  streamId: string
  abort: () => Promise<void>
}

/**
 * Send a user message and stream the assistant reply into the conversation.
 * Returns the active stream handle (for aborting) or null if it couldn't start.
 */
export async function sendMessage(
  conversation: Conversation,
  content: string,
  attachments: Attachment[]
): Promise<ActiveStream | null> {
  const store = useStore.getState()
  const conversationId = conversation.id

  const userMessage: ChatMessageUI = {
    id: uid(),
    role: 'user',
    content,
    attachments: attachments.length ? attachments : undefined,
    createdAt: Date.now(),
  }

  const history = [...conversation.messages, userMessage]
  store.addMessage(conversationId, userMessage)

  return streamAssistantReply(conversationId, history, conversation.auraModelId, conversation.projectId)
}

/**
 * Re-run the assistant turn using `history` as-is (used by regenerate and
 * edit-resubmit — the caller has already shaped the message list).
 */
export async function streamAssistantReply(
  conversationId: string,
  history: ChatMessageUI[],
  auraModelId: Conversation['auraModelId'],
  projectId?: string | null
): Promise<ActiveStream | null> {
  const store = useStore.getState()
  const streamId = uid()

  // Project context is injected into the system prompt backend-side.
  const project = projectId ? store.projects.find(p => p.id === projectId) : undefined

  const assistantMessage: ChatMessageUI = {
    id: uid(),
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
    isStreaming: true,
  }
  store.addMessage(conversationId, assistantMessage)

  const assistantId = assistantMessage.id
  const unsubscribers: Array<() => void> = []
  let settled = false

  const cleanup = () => {
    for (const off of unsubscribers) off()
    unsubscribers.length = 0
  }

  const mine = (payload: { streamId: string }) => payload.streamId === streamId

  const finish = (updates: Partial<ChatMessageUI>) => {
    if (settled) return
    settled = true
    cleanup()
    useStore.getState().updateMessage(conversationId, assistantId, { isStreaming: false, ...updates })
  }

  unsubscribers.push(
    window.aura.chat.on('routed', (payload: ChatRoutedPayload) => {
      if (!mine(payload)) return
      useStore.getState().updateMessage(conversationId, assistantId, {
        auraModelId: payload.auraModelId,
        backendModel: payload.modelName,
        providerName: payload.providerName,
        routeReason: payload.reason,
      })
    })
  )

  unsubscribers.push(
    window.aura.chat.on('delta', (payload: ChatDeltaPayload) => {
      if (!mine(payload)) return
      const current = useStore
        .getState()
        .conversations.find(c => c.id === conversationId)
        ?.messages.find(m => m.id === assistantId)
      useStore.getState().updateMessage(conversationId, assistantId, {
        content: (current?.content ?? '') + payload.delta,
      })
    })
  )

  unsubscribers.push(
    window.aura.chat.on('thinking', (payload: ChatDeltaPayload) => {
      if (!mine(payload)) return
      const current = useStore
        .getState()
        .conversations.find(c => c.id === conversationId)
        ?.messages.find(m => m.id === assistantId)
      useStore.getState().updateMessage(conversationId, assistantId, {
        thinking: (current?.thinking ?? '') + payload.delta,
      })
    })
  )

  unsubscribers.push(
    window.aura.chat.on('done', (payload: ChatDonePayload) => {
      if (!mine(payload)) return
      finish({
        content: payload.text || useStore.getState().conversations.find(c => c.id === conversationId)?.messages.find(m => m.id === assistantId)?.content || '',
        thinking: undefined,
        backendModel: payload.model,
        auraModelId: payload.auraModelId,
        latencyMs: payload.latencyMs,
        usage: payload.usage,
      })
    })
  )

  unsubscribers.push(
    window.aura.chat.on('error', (payload: ChatErrorPayload) => {
      if (!mine(payload)) return
      finish({ error: payload.message, thinking: undefined })
    })
  )

  unsubscribers.push(
    window.aura.chat.on('aborted', payload => {
      if (!mine(payload)) return
      finish({ thinking: undefined })
    })
  )

  try {
    await window.aura.chat.start({
      streamId,
      messages: toWireMessages(history),
      auraModelId,
      ...(project?.context?.trim() ? { context: project.context.trim() } : {}),
    })
  } catch (error) {
    finish({ error: error instanceof Error ? error.message : 'Failed to start.' })
    return null
  }

  return {
    streamId,
    abort: async () => {
      await window.aura.chat.abort(streamId)
      finish({ thinking: undefined })
    },
  }
}
