import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { PanelLeft, Sparkles } from 'lucide-react'
import { useStore } from '@services/store'
import { sendMessage, streamAssistantReply, type ActiveStream } from '@services/chat-client'
import type { Attachment, ChatMessageUI } from '@/domain'
import { AURA_MODELS_BY_ID, type AuraModelId } from '@models/aura-models/definitions'
import { MessageBubble } from './MessageBubble'
import { ModelPicker } from './ModelPicker'
import { Composer } from './Composer'

const EMPTY_SUGGESTIONS = [
  'Design a caching layer for a high-traffic API',
  'Explain the trade-offs between SSE and WebSockets',
  'Write a Python script to dedupe a large CSV',
  'Plan a 3-day trip to Kyoto with a foodie focus',
]

export function ChatView() {
  const activeConversation = useStore(state => state.activeConversation())
  const createConversation = useStore(state => state.createConversation)
  const setConversationModel = useStore(state => state.setConversationModel)
  const updateMessage = useStore(state => state.updateMessage)
  const sidebarOpen = useStore(state => state.sidebarOpen)
  const toggleSidebar = useStore(state => state.toggleSidebar)
  const sendOnEnter = useStore(state => state.appSettings.sendOnEnter)
  const reduceMotion = useStore(state => state.appSettings.reduceMotion)
  const providers = useStore(state => state.providers)

  const [isStreaming, setIsStreaming] = useState(false)
  const streamRef = useRef<ActiveStream | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const messages = activeConversation?.messages ?? []
  const hasMessages = messages.length > 0
  const modelId: AuraModelId = activeConversation?.auraModelId ?? 'aura-auto'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [messages.length, reduceMotion])

  // If the last assistant message is streaming, keep local streaming flag in sync
  // (covers reload mid-stream: the backend stream is gone, so we clear it).
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (last?.isStreaming && !streamRef.current) {
      updateMessage(activeConversation!.id, last.id, { isStreaming: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversation?.id])

  const noProviders = providers.length === 0

  async function handleSend(text: string, attachments: Attachment[]) {
    if (isStreaming) return
    let conversation = activeConversation
    if (!conversation) {
      const id = createConversation()
      conversation = useStore.getState().conversations.find(c => c.id === id)!
    }
    setIsStreaming(true)
    const stream = await sendMessage(conversation, text, attachments)
    streamRef.current = stream
    // Poll the store's last message to release the streaming flag when it settles.
  }

  // Watch the active assistant message; when it stops streaming, release the UI.
  useEffect(() => {
    if (!isStreaming) return
    const unsub = useStore.subscribe(state => {
      const conversation = state.conversations.find(c => c.id === state.activeConversationId)
      const last = conversation?.messages[conversation.messages.length - 1]
      if (last && last.role === 'assistant' && !last.isStreaming) {
        setIsStreaming(false)
        streamRef.current = null
      }
    })
    return unsub
  }, [isStreaming])

  async function handleAbort() {
    await streamRef.current?.abort()
    streamRef.current = null
    setIsStreaming(false)
  }

  /** Regenerate: drop the assistant message (and any after it), re-run from history. */
  async function handleRegenerate(message: ChatMessageUI) {
    if (isStreaming || !activeConversation) return
    const index = activeConversation.messages.findIndex(m => m.id === message.id)
    if (index === -1) return
    const history = activeConversation.messages.slice(0, index)
    if (history.length === 0 || history[history.length - 1].role !== 'user') return
    // Trim the conversation to just before this assistant turn.
    for (const stale of activeConversation.messages.slice(index)) {
      useStore.getState().removeMessage(activeConversation.id, stale.id)
    }
    setIsStreaming(true)
    streamRef.current = await streamAssistantReply(
      activeConversation.id, history, activeConversation.auraModelId, activeConversation.projectId
    )
  }

  /** Edit a user message: replace its content, drop everything after, resubmit. */
  async function handleEdit(message: ChatMessageUI, newContent: string) {
    if (isStreaming || !activeConversation || !newContent.trim()) return
    const index = activeConversation.messages.findIndex(m => m.id === message.id)
    if (index === -1) return
    useStore.getState().updateMessage(activeConversation.id, message.id, { content: newContent.trim() })
    for (const stale of activeConversation.messages.slice(index + 1)) {
      useStore.getState().removeMessage(activeConversation.id, stale.id)
    }
    const history = [
      ...activeConversation.messages.slice(0, index),
      { ...message, content: newContent.trim() },
    ]
    setIsStreaming(true)
    streamRef.current = await streamAssistantReply(
      activeConversation.id, history, activeConversation.auraModelId, activeConversation.projectId
    )
  }

  /** Fork: copy the conversation up to and including this message into a new chat. */
  function handleFork(message: ChatMessageUI) {
    if (!activeConversation) return
    const index = activeConversation.messages.findIndex(m => m.id === message.id)
    if (index === -1) return
    const slice = activeConversation.messages
      .slice(0, index + 1)
      .map(m => ({ ...m, id: `${m.id}-fork`, isStreaming: false }))
    const id = createConversation({
      auraModelId: activeConversation.auraModelId,
      folderId: activeConversation.folderId,
      projectId: activeConversation.projectId,
      title: `${activeConversation.title} (fork)`,
    })
    useStore.getState().updateConversation(id, { messages: slice })
  }

  const definition = AURA_MODELS_BY_ID.get(modelId)

  const title = useMemo(() => {
    if (hasMessages) return activeConversation?.title ?? 'Chat'
    return 'How can I help you today?'
  }, [hasMessages, activeConversation?.title])

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-white/[0.06] px-4">
        <div className="flex min-w-0 items-center gap-3">
          {!sidebarOpen && (
            <button className="btn-subtle !px-2" onClick={toggleSidebar} title="Show sidebar">
              <PanelLeft className="h-4 w-4" />
            </button>
          )}
          <h1 className="truncate text-[15px] font-semibold text-white/90">{hasMessages ? title : 'Aura'}</h1>
        </div>
        <ModelPicker value={modelId} onChange={id => {
          if (activeConversation) setConversationModel(activeConversation.id, id)
        }} />
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {!hasMessages ? (
          <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center px-6 py-12 text-center">
            <motion.div
              className="aura-orb h-16 w-16 rounded-2xl"
              initial={reduceMotion ? false : { scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            />
            <h2 className="mt-6 text-3xl font-semibold tracking-tight text-white">{title}</h2>
            <p className="mt-2 text-white/45">
              {definition ? definition.tagline : 'Ask anything, or start with a suggestion.'}
            </p>

            {noProviders && (
              <div className="mt-6 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
                <Sparkles className="h-4 w-4" />
                Add a provider in Settings → Providers to start chatting.
              </div>
            )}

            <div className="mt-8 grid w-full gap-2.5 sm:grid-cols-2">
              {EMPTY_SUGGESTIONS.map(suggestion => (
                <button
                  key={suggestion}
                  className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5 text-left text-sm text-white/60 transition hover:border-aura-400/40 hover:bg-aura-500/10 hover:text-white"
                  onClick={() => void handleSend(suggestion, [])}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
            {messages.map(message => (
              <MessageBubble
                key={message.id}
                message={message}
                reduceMotion={reduceMotion}
                onRegenerate={message.role === 'assistant' ? () => void handleRegenerate(message) : undefined}
                onEdit={message.role === 'user' ? content => void handleEdit(message, content) : undefined}
                onFork={message.role === 'assistant' ? () => handleFork(message) : undefined}
              />
            ))}
            <div ref={bottomRef} className="h-1" />
          </div>
        )}
      </div>

      <Composer
        isStreaming={isStreaming}
        sendOnEnter={sendOnEnter}
        onSend={handleSend}
        onAbort={handleAbort}
      />
    </section>
  )
}
