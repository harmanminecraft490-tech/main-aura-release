import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Virtuoso } from 'react-virtuoso'
import { FolderPlus, Globe, Loader2, BookOpen, CheckCircle2 } from 'lucide-react'
import { useAuraStore } from '@/store'
import { streamChat, type AgentActivity } from '@/services/ai'
import type { Message, PipelineStep, APIProfile, AuraVirtualModel, Attachment } from '@/types'
import { ChatComposer } from './ChatComposer'
import { MessageBubble } from './MessageBubble'

function id() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

function formatToolResult(result: string): string {
  try {
    const parsed = JSON.parse(result) as {
      success?: boolean; operation?: string; path?: string; bytesWritten?: number; error?: string
    }
    if (parsed.success) {
      const bytes = typeof parsed.bytesWritten === 'number' ? ` · ${parsed.bytesWritten} B` : ''
      return `${parsed.operation ?? 'op'} ${parsed.path ?? ''}${bytes} ✓`
    }
    return `${parsed.operation ?? 'op'} ${parsed.path ?? ''} ✗ ${parsed.error ?? 'failed'}`
  } catch {
    return result.slice(0, 100)
  }
}

/** Safe hostname extraction — a malformed URL from a tool status must never crash the UI. */
function safeHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname || rawUrl
  } catch {
    return rawUrl
  }
}

const suggestions = [
  'Design Aura’s memory architecture with Neon and vector search',
  'Build a polished React component for a command palette',
  'Research the best way to add real-time voice mode',
  'Plan a desktop AI coding workspace like Cursor + Raycast',
]

export function ChatView() {
  const activeConversationId = useAuraStore(state => state.activeConversationId)
  const conversations = useAuraStore(state => state.conversations)
  const createConversation = useAuraStore(state => state.createConversation)
  const addMessage = useAuraStore(state => state.addMessage)
  const updateMessage = useAuraStore(state => state.updateMessage)
  const isStreaming = useAuraStore(state => state.isStreaming)
  const setStreaming = useAuraStore(state => state.setStreaming)
  // Derive from the already-selected slices. A selector that CALLS an action
  // (`state.activeConversation()`) is fragile: it re-runs on every store change
  // and the result reference is only stable while the active conversation object
  // itself is untouched. Deriving here keeps the getSnapshot stable and simple.
  const activeConversation = useMemo(
    () => conversations.find(c => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  )
  const abortRef = useRef<null | (() => Promise<void>)>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [toolSteps, setToolSteps] = useState<string[]>([])
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const [indexStatus, setIndexStatus] = useState<{ indexing: boolean; indexed: number } | null>(null)
  const [researchStatus, setResearchStatus] = useState<{ state: string; query?: string; url?: string } | null>(null)
  // Clean tool-progress indicator (label only — raw tool JSON never reaches chat).
  const [activity, setActivity] = useState<AgentActivity | null>(null)

  useEffect(() => {
    window.aura?.workspace.state().then(state => setWorkspaceRoot(state.root)).catch(() => {})
  }, [])

  // Poll the background indexer while a workspace is open (cheap IPC, no blocking).
  useEffect(() => {
    if (!workspaceRoot) { setIndexStatus(null); return }
    let active = true
    const tick = () => {
      window.aura?.workspace.indexStatus().then(status => { if (active) setIndexStatus(status) }).catch(() => {})
    }
    tick()
    const timer = setInterval(tick, 1200)
    return () => { active = false; clearInterval(timer) }
  }, [workspaceRoot])

  // Research status events from main process
  useEffect(() => {
    const off = window.aura?.chat.on('research-status', (payload) => {
      const p = payload as unknown as { state: string; query?: string; url?: string }
      if (p.state === 'done') {
        // Auto-clear after 2s
        setTimeout(() => setResearchStatus(null), 2000)
        setResearchStatus({ state: 'done' })
      } else {
        setResearchStatus(p)
      }
    })
    return () => { off?.() }
  }, [])

  // Tool activity (clean labels only) — shown as a transient status line.
  useEffect(() => {
    const off = window.aura?.chat.on('activity', (payload) => {
      const p = payload as unknown as { type?: string; tool?: string; label?: string }
      if (!p.type || !p.tool) return
      if (p.type === 'tool_start') {
        setActivity({ type: 'tool_start', tool: p.tool, label: p.label })
      } else if (p.type === 'tool_complete' || p.type === 'tool_error') {
        setActivity(prev => (prev && prev.tool === p.tool ? null : prev))
      }
    })
    return () => { off?.() }
  }, [])

  // New Project = pick an existing folder (Aura never creates its own folder).
  async function openNewProject() {
    const picked = await window.aura?.projects.pickFolder()
    if (!picked || picked.canceled || !picked.path) return
    const name = picked.path.split(/[\\/]/).pop() || 'Project'
    try {
      const project = await window.aura?.projects.create({
        name,
        description: '',
        settings: { workspace: picked.path },
      })
      if (project) await window.aura?.projects.setActive(project.id)
      setWorkspaceRoot(picked.path)
    } catch (error) {
      console.error('Failed to create project', error)
    }
  }

  useEffect(() => {
    if (!activeConversationId && conversations.length === 0) createConversation()
  }, [activeConversationId, conversations.length, createConversation])

  const messages = activeConversation?.messages ?? []
  const hasMessages = messages.length > 0
  const viewMode = useAuraStore(state => state.viewMode)
  const developerMode = useAuraStore(state => state.preferences.developerMode)

  const subtitle = useMemo(() => {
    if (!hasMessages) return 'A deeply capable AI companion for thinking, coding, researching, and creating.'
    return activeConversation?.title ?? 'Conversation'
  }, [activeConversation?.title, hasMessages])

  const send = useCallback(async (message: string | { text: string; attachments: Attachment[] }) => {
    // One stream at a time: a second send while streaming could interleave
    // profiles.setActive and chat:start across streams (wrong model race).
    if (useAuraStore.getState().isStreaming) return

    // Read from the store, not the closure: send is memoized with [] deps, so
    // a captured activeConversationId would go stale and spawn a fresh
    // conversation on every message.
    //
    // Resolve an id that ALWAYS exists in the list, mirroring the panels'
    // ensureSession(). A non-null-but-orphaned id (e.g. a conversation dropped
    // when hydration reconciled before this send) would make addMessage and
    // updateMessage no-ops: the message reaches the AI but never appears.
    let conversationId = useAuraStore.getState().activeConversationId
    const conversationExists = useAuraStore.getState().conversations.some(c => c.id === conversationId)
    if (!conversationId || !conversationExists) conversationId = createConversation()

    // Resolve the picked Aura/provider model to a concrete profile and make it
    // active before streaming. Uses the existing profiles bridge only — if
    // nothing resolves (no profiles yet), the backend keeps its own default.
    // setActive is called unconditionally: the renderer's activeProfileId is a
    // best-effort mirror and must not gate the authoritative backend switch.
    let resolvedProfileId: string | undefined
    // Aura-branded label shown on the finished message — never the raw provider model id.
    let modelLabel = 'Aura'
    try {
      const state = useAuraStore.getState()
      const selection = state.conversations.find(c => c.id === conversationId)?.modelSelection ?? state.defaultModelSelection
      let profile: APIProfile | undefined
      let virtualModel: AuraVirtualModel | undefined

      if (selection.kind === 'aura') {
        virtualModel = state.virtualModels.find(m => m.id === selection.id)
        if (virtualModel) modelLabel = virtualModel.name
      } else {
        profile = state.profiles.find(p => p.id === selection.id)
        if (profile) modelLabel = profile.displayName
      }

      if (profile) {
        resolvedProfileId = profile.id
        await window.aura?.profiles.setActive(profile.id)
        state.setActiveProfileId(profile.id)
      }
    } catch (error) {
      console.warn('Model resolution failed, using active profile:', error)
    }

    // Extract text content for the user message
    const textContent = typeof message === 'string' ? message : message.text
    const attachments = typeof message === 'string' ? undefined : message.attachments

    const userMessage: Message = {
      id: id(),
      role: 'user',
      content: textContent,
      timestamp: Date.now(),
      attachments: attachments,
    }
    const attachmentIds = attachments?.length ? attachments.map(attachment => attachment.id) : undefined
    const assistantMessage: Message = {
      id: id(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    }

    const history = [...(useAuraStore.getState().conversations.find(c => c.id === conversationId)?.messages ?? []), userMessage]

    addMessage(conversationId, userMessage)
    addMessage(conversationId, assistantMessage)
    setStreaming(true)

    try {
      // Accumulate deltas locally and flush at most ~30x/sec. Per-token store
      // scans + full conversation remaps made long replies progressively slower.
      let pendingContent = ''
      let pendingThinking = ''
      let flushTimer: ReturnType<typeof setTimeout> | null = null
      const flush = () => {
        flushTimer = null
        const updates: Partial<Message> = {}
        if (pendingContent) updates.content = pendingContent
        if (pendingThinking) updates.thinking = pendingThinking
        if (Object.keys(updates).length > 0) updateMessage(conversationId!, assistantMessage.id, updates)
      }
      const scheduleFlush = () => {
        if (flushTimer === null) flushTimer = setTimeout(flush, 33)
      }
      const stopFlush = () => {
        if (flushTimer !== null) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
      }

      const stream = await streamChat(history, {
        onToken: token => {
          pendingContent += token
          scheduleFlush()
        },
        onThinking: thinking => {
          pendingThinking += thinking
          scheduleFlush()
        },
        onPipeline: (steps: PipelineStep[]) => {
          useAuraStore.getState().setActivePipeline(steps)
          updateMessage(conversationId!, assistantMessage.id, {
            pipeline: steps,
          })
        },
        onTool: (_name, _args, result) => {
          setToolSteps(prev => [...prev.slice(-6), formatToolResult(result)])
        },
        onFileOpened: (filePath, content) => {
          // LIVE CODING: the AI wrote a real file — open it in the side editor.
          // Stay in chat view (isLiveCoding handles the split layout).
          const name = filePath.split(/[\/\\]/).pop() || 'file'
          useAuraStore.getState().openFile({ name, path: filePath, content })
          useAuraStore.getState().setIsLiveCoding(true)
        },
        onDone: (fullResponse) => {
          stopFlush()
          setToolSteps([])

          const currentPipeline = useAuraStore.getState().conversations.find(c => c.id === conversationId)?.messages.find(m => m.id === assistantMessage.id)?.pipeline ?? []
          const finalPipeline = currentPipeline.map(step =>
            step.status === 'active' || step.status === 'pending'
              ? { ...step, status: 'complete' as const }
              : step
          )

          // Never render an empty assistant bubble: if the provider truly
          // returned no content, show a real fallback message instead.
          const finalContent = (fullResponse || pendingContent).trim()
          updateMessage(conversationId!, assistantMessage.id, {
            content: finalContent || 'Aura completed the request but received an empty response.',
            isStreaming: false,
            thinking: undefined, // Clear thinking state to stop animation
            model: modelLabel,
            pipeline: finalPipeline,
          })
          useAuraStore.getState().setActivePipeline(null)
          setStreaming(false)
          abortRef.current = null
        },
        onError: error => {
          stopFlush()
          setToolSteps([])

          const currentPipeline = useAuraStore.getState().conversations.find(c => c.id === conversationId)?.messages.find(m => m.id === assistantMessage.id)?.pipeline ?? []
          const finalPipeline = currentPipeline.map(step =>
            step.status === 'active' || step.status === 'pending'
              ? { ...step, status: 'error' as const }
              : step
          )

          // Provide user-friendly error messages
          const userFriendlyError = error.message.includes('Failed to fetch')
            ? 'Unable to connect to AI service. Please check your internet connection and try again.'
            : error.message.includes('timeout')
              ? 'The request took too long to complete. Please try again with a simpler query.'
              : error.message

          updateMessage(conversationId!, assistantMessage.id, {
            isStreaming: false,
            error: userFriendlyError,
            pipeline: finalPipeline,
          })
          useAuraStore.getState().setActivePipeline(null)
          setStreaming(false)
          abortRef.current = null
        },
        onAbort: () => {
          stopFlush()
          setToolSteps([])

          const currentPipeline = useAuraStore.getState().conversations.find(c => c.id === conversationId)?.messages.find(m => m.id === assistantMessage.id)?.pipeline ?? []
          const finalPipeline = currentPipeline.map(step =>
            step.status === 'active' || step.status === 'pending'
              ? { ...step, status: 'skipped' as const }
              : step
          )

          updateMessage(conversationId!, assistantMessage.id, {
            content: pendingContent,
            isStreaming: false,
            pipeline: finalPipeline,
          })
          useAuraStore.getState().setActivePipeline(null)
          setStreaming(false)
          abortRef.current = null
        },
      }, {
        ...(resolvedProfileId ? { profileId: resolvedProfileId } : {}),
        ...(attachmentIds?.length ? { attachmentIds } : {}),
      })
      abortRef.current = stream.abort
    } catch (error) {
      // Provide user-friendly error messages
      const userFriendlyError = error instanceof Error
        ? error.message.includes('Failed to fetch')
          ? 'Unable to connect to AI service. Please check your internet connection and try again.'
          : error.message.includes('timeout')
            ? 'The request took too long to complete. Please try again with a simpler query.'
            : error.message
        : 'An unexpected error occurred. Please try again.';

      updateMessage(conversationId, assistantMessage.id, {
        isStreaming: false,
        error: userFriendlyError,
      })
      setStreaming(false)
      abortRef.current = null
    }
  }, [])

  const abort = useCallback(async () => {
    await abortRef.current?.()
    setStreaming(false)
  }, [])

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/6 px-6 py-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-white">{hasMessages ? activeConversation?.title : 'How can I amplify you today?'}</h1>
          <p className="mt-1 truncate text-sm text-white/38">{subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {workspaceRoot && (
            <span
              className="hidden max-w-[220px] truncate rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-2.5 py-1 text-[11px] text-emerald-300/80 lg:inline"
              title={workspaceRoot}
            >
              📁 {workspaceRoot.split(/[\\/]/).pop()}
            </span>
          )}
          {developerMode && workspaceRoot && indexStatus && (
            <span
              className={indexStatus.indexing
                ? 'flex items-center gap-1 rounded-lg border border-cyan-500/20 bg-cyan-500/8 px-2.5 py-1 text-[11px] text-cyan-300/80'
                : 'flex items-center gap-1 rounded-lg border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/45'}
              title={indexStatus.indexing ? `Indexing ${indexStatus.indexed} files in background` : `${indexStatus.indexed} files indexed`}
            >
              {indexStatus.indexing && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />}
              {indexStatus.indexing ? `Indexing ${indexStatus.indexed}…` : `${indexStatus.indexed} indexed ✓`}
            </span>
          )}
          <button
            className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-1.5 text-sm font-medium text-white/70 transition hover:border-white/20 hover:bg-white/8 hover:text-white"
            onClick={() => void openNewProject()}
            type="button"
          >
            <FolderPlus size={15} /> Open Folder
          </button>
        </div>
      </header>

      {/* Research status indicator — minimal, non-intrusive */}
      <AnimatePresence>
        {researchStatus && (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="flex shrink-0 items-center gap-2 border-b border-white/6 bg-black/20 px-6 py-2"
            exit={{ opacity: 0, y: -4 }}
            initial={{ opacity: 0, y: -4 }}
          >
            {researchStatus.state === 'done' ? (
              <>
                <CheckCircle2 size={13} className="text-emerald-400" />
                <span className="text-[12px] text-white/50">Research complete</span>
              </>
            ) : researchStatus.state === 'reading' ? (
              <>
                <BookOpen size={13} className="animate-pulse text-aura-400" />
                <span className="text-[12px] text-white/50">Reading source…</span>
                {researchStatus.url && (
                  <span className="truncate text-[11px] text-white/25">{safeHostname(researchStatus.url)}</span>
                )}
              </>
            ) : (
              <>
                <Globe size={13} className="text-aura-400" />
                <Loader2 size={11} className="animate-spin text-white/40" />
                <span className="text-[12px] text-white/50">
                  {researchStatus.state === 'researching' ? 'Researching' : 'Searching the web'}
                  {researchStatus.query && <span className="ml-1 text-white/30">· {String(researchStatus.query).slice(0, 40)}</span>}
                </span>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tool activity — clean progress labels only (never raw tool JSON). */}
      {activity && (
        <div className="flex shrink-0 items-center gap-2 border-b border-white/6 bg-black/20 px-6 py-2">
          <Loader2 size={13} className="animate-spin text-aura-400" />
          <span className="text-[12px] text-white/50">{activity.label ?? 'Working…'}</span>
        </div>
      )}

      {developerMode && toolSteps.length > 0 && (
        <div className="shrink-0 border-b border-white/6 px-6 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-white/30">File ops</span>
            {toolSteps.map((step, index) => (
              <span key={index} className="rounded-lg bg-emerald-500/10 px-2 py-1 font-mono text-[11px] text-emerald-300/90">
                {step}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {hasMessages ? (
          <Virtuoso
            className="h-full"
            data={messages}
            followOutput="smooth"
            itemContent={(_index, message) => (
              <div className="mx-auto max-w-5xl px-6 pb-4">
                <MessageBubble message={message} />
              </div>
            )}
          />
        ) : (
          <div ref={scrollRef} className="h-full overflow-y-auto py-7">
            <div className="mx-auto flex min-h-full max-w-4xl flex-col items-center justify-center px-6 text-center">
              <motion.div
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="flex h-24 w-24 items-center justify-center rounded-[2rem] border border-white/15 bg-white/8 shadow-2xl shadow-aura-950/50 backdrop-blur-2xl"
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
              >
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-aura-300 via-fuchsia-300 to-pink-300 shadow-[0_0_42px_rgba(124,111,255,0.8)]" />
              </motion.div>
              <motion.h2 animate={{ opacity: 1, y: 0 }} className="mt-8 text-5xl font-semibold tracking-tight text-white" initial={{ opacity: 0, y: 12 }}>
                Meet Aura
              </motion.h2>
              <motion.p animate={{ opacity: 1, y: 0 }} className="mt-4 max-w-2xl text-balance text-lg leading-8 text-white/52" initial={{ opacity: 0, y: 12 }} transition={{ delay: 0.06 }}>
                Your premium AI operating system for natural conversation, coding, research, creation, planning, and long-running work.
              </motion.p>
              <div className="mt-9 grid w-full gap-3 sm:grid-cols-2">
                {suggestions.map(suggestion => (
                  <button
                    className="rounded-3xl border border-white/10 bg-white/[0.045] p-4 text-left text-sm leading-6 text-white/58 transition hover:border-aura-400/40 hover:bg-aura-500/10 hover:text-white"
                    key={suggestion}
                    onClick={() => send(suggestion)}
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <ChatComposer disabled={isStreaming} isStreaming={isStreaming} onAbort={abort} onSend={send} />
    </section>
  )
}
