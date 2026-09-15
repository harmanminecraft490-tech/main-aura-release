/**
 * PANEL SESSION HOOK — shared by the Agent / Code / Design panels.
 *
 * Moves each panel's thread out of local component state into the persisted
 * store, so chats survive tab switches and app restarts. Streaming also keeps
 * running across tab switches: callbacks write to the store, never to component
 * state, so an in-flight response finishes even while the panel is unmounted.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuraStore } from '@/store'
import { streamChat, type AgentActivity } from '@/services/ai'
import type { APIProfile, AuraVirtualModel, Message, PanelSession } from '@/types'

function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

// ── Stable default references ─────────────────────────────────────────────────
// CRITICAL: a Zustand selector must return a STABLE reference. Writing
// `state.panelSessions[panel] ?? []` inside the selector fabricates a brand-new
// array on EVERY call, so useSyncExternalStore's getSnapshot returns a fresh
// value each render → React reads the external store as perpetually changing →
// "Maximum update depth exceeded" (React error #185) the moment any store update
// lands while a panel is mounted (hydration, streaming flags, persistence, …).
// Select the stored value (a stable reference, or `undefined`) and default to
// these module-level constants OUTSIDE the selector instead.
const EMPTY_SESSIONS: PanelSession[] = []
const EMPTY_MESSAGES: Message[] = []

/** Resolve the picker's model to a profile id + branded label (shared logic). */
async function resolveProfile(): Promise<{ profileId?: string; modelLabel: string }> {
  const state = useAuraStore.getState()
  const selection = state.defaultModelSelection
  let profile: APIProfile | undefined
  let virtualModel: AuraVirtualModel | undefined
  let modelLabel = 'Aura'

  if (selection.kind === 'aura') {
    virtualModel = state.virtualModels.find(model => model.id === selection.id)
    if (virtualModel) modelLabel = virtualModel.name
  } else {
    profile = state.profiles.find(model => model.id === selection.id)
    if (profile) modelLabel = profile.displayName
  }

  if (profile) {
    await window.aura?.profiles.setActive(profile.id)
    state.setActiveProfileId(profile.id)
    return { profileId: profile.id, modelLabel }
  }
  return { modelLabel }
}

export function usePanelSession(panel: PanelSession['panel']) {
  // Stable selectors — see EMPTY_SESSIONS note above. `?? '`'`/`?? false` are
  // stable primitives, so only the array needs the module-level default.
  const sessions = useAuraStore(state => state.panelSessions[panel]) ?? EMPTY_SESSIONS
  const activeId = useAuraStore(state => state.activePanelSessionId[panel]) ?? ''
  const running = useAuraStore(state => state.panelRunning[panel]) ?? false
  const abortRef = useRef<null | (() => Promise<void>)>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // Lightweight tool-progress indicator (label only — never raw tool JSON).
  const [activity, setActivity] = useState<AgentActivity | null>(null)

  const activeSession = sessions.find(session => session.id === activeId) ?? sessions[0] ?? null
  const messages = activeSession?.messages ?? EMPTY_MESSAGES
  const hasMessages = messages.length > 0

  // Auto-scroll keyed on a stable string (last message id + count + content
  // length), never on the `messages` array reference — when a panel has no
  // sessions yet that reference is a fresh empty array every render, which must
  // not appear in a dependency array.
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null
  const scrollKey = lastMessage
    ? `${lastMessage.id}:${messages.length}:${lastMessage.content.length}`
    : ''
  useEffect(() => {
    if (!scrollKey) return
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [scrollKey])

  const setRunning = useCallback((value: boolean) => {
    useAuraStore.getState().setPanelRunning(panel, value)
  }, [panel])

  const ensureSession = useCallback((): string => {
    const state = useAuraStore.getState()
    const current = (state.panelSessions[panel] ?? []).find(session => session.id === state.activePanelSessionId[panel])
    if (current) return current.id
    return state.createPanelSession(panel)
  }, [panel])

  const newSession = useCallback(() => {
    abortRef.current?.()
    useAuraStore.getState().createPanelSession(panel)
  }, [panel])

  const selectSession = useCallback((sessionId: string) => {
    useAuraStore.getState().setActivePanelSession(panel, sessionId)
  }, [panel])

  const deleteSession = useCallback((sessionId: string) => {
    useAuraStore.getState().deletePanelSession(panel, sessionId)
  }, [panel])

  /**
   * Run a turn against the active session.
   * @param displayContent the user message shown + persisted
   * @param historyContent what is actually sent to the model (first-turn system
   *                       hints, code context blocks are baked in by the caller)
   */
  const send = useCallback(async (displayContent: string, historyContent: string): Promise<void> => {
    const trimmed = displayContent.trim()
    if (!trimmed || running) return

    const sessionId = ensureSession()
    const userMessage: Message = { id: generateId(), role: 'user', content: trimmed, timestamp: Date.now() }
    const assistantMessage: Message = { id: generateId(), role: 'assistant', content: '', timestamp: Date.now(), isStreaming: true }

    const store = useAuraStore.getState()
    const history: Message[] = store.panelSessions[panel]
      .find(session => session.id === sessionId)?.messages ?? []
    const historyForModel: Message[] = history.length === 0
      ? [{ ...userMessage, content: historyContent }]
      : [...history, { ...userMessage, content: historyContent }]

    store.addPanelMessage(panel, sessionId, userMessage)
    store.addPanelMessage(panel, sessionId, assistantMessage)
    setRunning(true)

    const patch = (updates: Partial<Message>) => {
      useAuraStore.getState().updatePanelMessage(panel, sessionId, assistantMessage.id, updates)
    }
    let text = ''
    let thinking = ''
    const { profileId, modelLabel } = await resolveProfile()

    try {
      const stream = await streamChat(historyForModel, {
        onToken: token => {
          text += token
          patch({ content: text })
        },
        onThinking: delta => {
          thinking += delta
          patch({ thinking })
        },
        onActivity: act => {
          // Clean progress only — tool calls/results never enter chat state.
          if (act.type === 'tool_start') {
            setActivity(act)
          } else if (act.type === 'tool_complete' || act.type === 'tool_error') {
            setActivity(prev => (prev && prev.tool === act.tool ? null : prev))
          }
        },
        onDone: finalText => {
          setActivity(null)
          patch({ content: finalText || text, isStreaming: false, model: modelLabel })
          setRunning(false)
          abortRef.current = null
        },
        onError: error => {
          setActivity(null)
          patch({ isStreaming: false, error: error.message })
          setRunning(false)
          abortRef.current = null
        },
        onAbort: () => {
          setActivity(null)
          patch({ isStreaming: false })
          setRunning(false)
          abortRef.current = null
        },
      }, profileId ? { profileId } : undefined)
      abortRef.current = stream.abort
    } catch (error) {
      patch({ isStreaming: false, error: error instanceof Error ? error.message : 'Panel run failed.' })
      setRunning(false)
    }
  }, [panel, running, ensureSession, setRunning])

  return {
    sessions,
    activeId,
    activeSession,
    messages,
    hasMessages,
    running,
    activity,
    abortRef,
    scrollRef,
    send,
    setRunning,
    newSession,
    selectSession,
    deleteSession,
  }
}
