/** Shared persisted panel session hook for Agent / Code / Design. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuraStore } from '@/store'
import { streamAgent, streamChat, type AgentActivity, type AgentTaskState } from '@/services/ai'
import type { APIProfile, AuraVirtualModel, Message, PanelSession } from '@/types'

function generateId(): string { return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}` }
const EMPTY_SESSIONS: PanelSession[] = []
const EMPTY_MESSAGES: Message[] = []

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
  const sessions = useAuraStore(state => state.panelSessions[panel]) ?? EMPTY_SESSIONS
  const activeId = useAuraStore(state => state.activePanelSessionId[panel]) ?? ''
  const running = useAuraStore(state => state.panelRunning[panel]) ?? false
  const abortRef = useRef<null | (() => Promise<void>)>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [activity, setActivity] = useState<AgentActivity | null>(null)
  const [agentState, setAgentState] = useState<AgentTaskState | null>(null)
  const activeSession = sessions.find(session => session.id === activeId) ?? sessions[0] ?? null
  const messages = activeSession?.messages ?? EMPTY_MESSAGES
  const hasMessages = messages.length > 0
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null
  const scrollKey = lastMessage ? `${lastMessage.id}:${messages.length}:${lastMessage.content.length}` : ''

  useEffect(() => {
    if (scrollKey) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [scrollKey])

  const setRunning = useCallback((value: boolean) => useAuraStore.getState().setPanelRunning(panel, value), [panel])
  const ensureSession = useCallback((): string => {
    const state = useAuraStore.getState()
    const current = (state.panelSessions[panel] ?? []).find(session => session.id === state.activePanelSessionId[panel])
    return current?.id ?? state.createPanelSession(panel)
  }, [panel])
  const newSession = useCallback(() => { void abortRef.current?.(); setAgentState(null); useAuraStore.getState().createPanelSession(panel) }, [panel])
  const selectSession = useCallback((sessionId: string) => useAuraStore.getState().setActivePanelSession(panel, sessionId), [panel])
  const deleteSession = useCallback((sessionId: string) => useAuraStore.getState().deletePanelSession(panel, sessionId), [panel])

  const send = useCallback(async (displayContent: string, historyContent: string): Promise<void> => {
    const trimmed = displayContent.trim()
    if (!trimmed || running) return
    const sessionId = ensureSession()
    const userMessage: Message = { id: generateId(), role: 'user', content: trimmed, timestamp: Date.now() }
    const assistantMessage: Message = { id: generateId(), role: 'assistant', content: '', timestamp: Date.now(), isStreaming: true }
    const store = useAuraStore.getState()
    const history = store.panelSessions[panel].find(session => session.id === sessionId)?.messages ?? []
    const historyForModel = history.length === 0 ? [{ ...userMessage, content: historyContent }] : [...history, { ...userMessage, content: historyContent }]
    store.addPanelMessage(panel, sessionId, userMessage)
    store.addPanelMessage(panel, sessionId, assistantMessage)
    setRunning(true)
    setAgentState(null)
    const patch = (updates: Partial<Message>) => useAuraStore.getState().updatePanelMessage(panel, sessionId, assistantMessage.id, updates)
    let text = ''
    let thinking = ''
    const { profileId, modelLabel } = await resolveProfile()

    try {
      if (panel === 'agent') {
        const stream = await streamAgent(sessionId, historyForModel, {
          onToken: token => { text += token; patch({ content: text }) },
          onThinking: delta => { thinking += delta; patch({ thinking }) },
          onState: state => setAgentState(state),
          onActivity: act => {
            if (act.type === 'tool_start') setActivity(act)
            else if (act.type === 'tool_complete' || act.type === 'tool_error') setActivity(prev => prev?.tool === act.tool ? null : prev)
          },
          onDone: finalText => { setActivity(null); patch({ content: finalText || text, isStreaming: false, model: 'Aura Agent' }); setRunning(false); abortRef.current = null },
          onError: error => { setActivity(null); patch({ isStreaming: false, error: error.message }); setRunning(false); abortRef.current = null },
          onAbort: () => { setActivity(null); patch({ isStreaming: false }); setRunning(false); abortRef.current = null },
        }, profileId ? { profileId } : undefined)
        abortRef.current = stream.abort
        return
      }

      const stream = await streamChat(historyForModel, {
        onToken: token => { text += token; patch({ content: text }) },
        onThinking: delta => { thinking += delta; patch({ thinking }) },
        onActivity: act => {
          if (act.type === 'tool_start') setActivity(act)
          else if (act.type === 'tool_complete' || act.type === 'tool_error') setActivity(prev => prev?.tool === act.tool ? null : prev)
        },
        onDone: finalText => { setActivity(null); patch({ content: finalText || text, isStreaming: false, model: modelLabel }); setRunning(false); abortRef.current = null },
        onError: error => { setActivity(null); patch({ isStreaming: false, error: error.message }); setRunning(false); abortRef.current = null },
        onAbort: () => { setActivity(null); patch({ isStreaming: false }); setRunning(false); abortRef.current = null },
      }, profileId ? { profileId } : undefined)
      abortRef.current = stream.abort
    } catch (error) {
      patch({ isStreaming: false, error: error instanceof Error ? error.message : 'Panel run failed.' })
      setRunning(false)
      abortRef.current = null
    }
  }, [panel, running, ensureSession, setRunning])

  return { sessions, activeId, activeSession, messages, hasMessages, running, activity, agentState, abortRef, scrollRef, send, setRunning, newSession, selectSession, deleteSession }
}
