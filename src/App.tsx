import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AuthGate } from '@/components/AuthGate'
import { CommandPalette } from '@/components/CommandPalette'
import { ChatView } from '@/components/ChatView'
import { Sidebar } from '@/components/Sidebar'
import { TitleBar } from '@/components/TitleBar'
import { FileExplorer } from '@/components/FileExplorer'
import { TerminalPanel } from '@/components/TerminalPanel'
import { ToolPermissionPrompt } from '@/components/ToolPermissionPrompt'
import { useAuraStore } from '@/store'
import { initPersistence } from '@/services/persistence'

// Non-default panels load on demand — keeps cold start lean and the first
// frame fast. Never blocks the UI.
const AgentPanel = lazy(() => import('@/components/AgentPanel').then(m => ({ default: m.AgentPanel })))
const FileEditor = lazy(() => import('@/components/FileEditor').then(m => ({ default: m.FileEditor })))
const DesignPanel = lazy(() => import('@/components/DesignPanel').then(m => ({ default: m.DesignPanel })))
const MemoryPanel = lazy(() => import('@/components/MemoryPanel').then(m => ({ default: m.MemoryPanel })))
const ProjectsView = lazy(() => import('@/components/ProjectsView').then(m => ({ default: m.ProjectsView })))
const SearchPanel = lazy(() => import('@/components/SearchPanel').then(m => ({ default: m.SearchPanel })))
const SettingsPanel = lazy(() => import('@/components/SettingsPanel').then(m => ({ default: m.SettingsPanel })))
const CodePanel = lazy(() => import('@/components/CodePanel').then(m => ({ default: m.CodePanel })))

const MIN_CHAT_WIDTH = 340
const MIN_EDITOR_WIDTH = 280

/**
 * LIVE CODING LAYOUT — chat on left, editor on right, smoothly animated.
 *
 * When Aura starts writing a file during a chat, the editor pane smoothly
 * expands beside the chat. The chat stays fully visible. The user watches
 * real code being written in real time.
 *
 * When files are closed, the editor stays open — the user can keep working.
 */
function LiveCodingLayout({ explorerOpen }: { explorerOpen: boolean }) {
  const hasFiles = useAuraStore(state => state.openFiles.length > 0)
  const isLiveCoding = useAuraStore(state => state.isLiveCoding)

  // Panel widths (editor = flex fraction 0–60%)
  const containerRef = useRef<HTMLDivElement>(null)
  const [editorFraction, setEditorFraction] = useState(0.5) // default 50%
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef<{ x: number; fraction: number } | null>(null)

  function startDrag(e: React.MouseEvent) {
    e.preventDefault()
    dragStart.current = { x: e.clientX, fraction: editorFraction }
    setIsDragging(true)
  }

  useEffect(() => {
    if (!isDragging) return
    function onMove(e: MouseEvent) {
      if (!containerRef.current || !dragStart.current) return
      const width = containerRef.current.offsetWidth
      const delta = e.clientX - dragStart.current.x
      const newFraction = Math.max(MIN_EDITOR_WIDTH / width, Math.min(0.72, dragStart.current.fraction - delta / width))
      setEditorFraction(newFraction)
    }
    function onUp() { setIsDragging(false); dragStart.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [isDragging])

  const showEditor = isLiveCoding && hasFiles

  return (
    <div ref={containerRef} className="flex h-full min-w-0 flex-1 overflow-hidden">
      {/* File Explorer panel (left strip) */}
      <AnimatePresence>
        {explorerOpen && (
          <motion.div
            animate={{ width: 220, opacity: 1 }}
            className="flex h-full shrink-0 flex-col border-r border-white/8 bg-black/25"
            exit={{ width: 0, opacity: 0 }}
            initial={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <Suspense fallback={null}>
              <FileExplorer />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat panel */}
      <div
        className="flex h-full min-w-0 flex-col transition-all duration-300"
        style={{ flex: showEditor ? `0 0 ${Math.round((1 - editorFraction) * 100)}%` : '1 1 auto' }}
      >
        <ChatView />
      </div>

      {/* Resize divider */}
      <AnimatePresence>
        {showEditor && (
          <motion.div
            animate={{ width: 4, opacity: 1 }}
            className="group relative flex h-full shrink-0 cursor-col-resize items-center justify-center"
            exit={{ width: 0, opacity: 0 }}
            initial={{ width: 0, opacity: 0 }}
            onMouseDown={startDrag}
            style={{ background: isDragging ? 'rgba(167,139,250,0.3)' : undefined }}
          >
            <div className="h-12 w-px rounded-full bg-white/10 transition-all group-hover:w-[3px] group-hover:bg-aura-400/60" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Editor panel — smoothly expands when AI starts coding */}
      <AnimatePresence>
        {showEditor && (
          <motion.div
            animate={{ width: `${Math.round(editorFraction * 100)}%`, opacity: 1 }}
            className="flex h-full min-w-0 flex-col border-l border-white/8"
            exit={{ width: 0, opacity: 0, x: 20 }}
            initial={{ width: 0, opacity: 0, x: 20 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <Suspense fallback={<EditorSkeleton />}>
              <EditorErrorBoundary>
                <FileEditor />
              </EditorErrorBoundary>
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function EditorSkeleton() {
  return (
    <div className="flex h-full flex-col" style={{ background: '#0a0a0f' }}>
      <div className="flex h-9 shrink-0 items-center border-b border-white/8 bg-black/30 px-3">
        <div className="h-2.5 w-24 rounded-full bg-white/8 animate-pulse" />
      </div>
      <div className="flex-1 p-4 space-y-2">
        {[60, 80, 45, 90, 55, 70].map((w, i) => (
          <div key={i} className="h-2 rounded-full bg-white/[0.03] animate-pulse" style={{ width: `${w}%`, animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
    </div>
  )
}

/** Keeps an editor crash from taking down the whole app (black window). */
class EditorErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center bg-[#0a0a0f] p-6">
          <div className="max-w-sm rounded-2xl border border-red-500/20 bg-red-500/5 px-5 py-4 text-center">
            <p className="text-sm font-medium text-red-300">Editor failed to load</p>
            <p className="mt-1 text-xs text-white/40">{this.state.error.message}</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

/** Last line of defence: a render crash shows a recovery card (and logs the real
 *  error) instead of a silent black window. */
class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[AppErrorBoundary] render crashed:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-surface-0 p-6">
          <div className="max-w-md rounded-3xl border border-red-500/20 bg-red-500/5 px-7 py-6 text-center">
            <p className="text-lg font-semibold text-white/90">Aura hit an unexpected error</p>
            <p className="mt-2 text-xs leading-5 text-white/45">The UI crashed while rendering. Reload to continue — your chats and memory are saved.</p>
            <p className="mt-3 max-h-24 overflow-auto rounded-lg bg-black/30 px-3 py-2 font-mono text-[11px] text-red-300/80">{this.state.error.message}</p>
            <button
              className="mt-5 rounded-xl bg-white px-5 py-2 text-sm font-semibold text-surface-0 transition hover:scale-105"
              onClick={() => window.location.reload()}
              type="button"
            >
              Reload Aura
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

/** Standalone code workspace (Code view tab) — preserved as-is. */
function CodeWorkspace({ explorerOpen }: { explorerOpen: boolean }) {
  const hasFiles = useAuraStore(state => state.openFiles.length > 0)
  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden">
      <AnimatePresence>
        {explorerOpen && (
          <motion.div
            animate={{ width: 220, opacity: 1 }}
            className="flex h-full shrink-0 flex-col border-r border-white/8 bg-black/25"
            exit={{ width: 0, opacity: 0 }}
            initial={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <Suspense fallback={null}>
              <FileExplorer />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex min-h-0 flex-1 flex-col">
        {hasFiles ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1">
              <Suspense fallback={<EditorSkeleton />}>
                <EditorErrorBoundary>
                  <FileEditor />
                </EditorErrorBoundary>
              </Suspense>
            </div>
          </div>
        ) : (
          <Suspense fallback={null}>
            <CodePanel />
          </Suspense>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const viewMode = useAuraStore(state => state.viewMode)
  const setAIConfig = useAuraStore(state => state.setAIConfig)
  const setProfiles = useAuraStore(state => state.setProfiles)
  const setActiveProfileId = useAuraStore(state => state.setActiveProfileId)
  const account = useAuraStore(state => state.account)
  const setAccount = useAuraStore(state => state.setAccount)
  const explorerOpen = useAuraStore(state => state.explorerOpen)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(240)
  const [authChecked, setAuthChecked] = useState(false)

  // Load AI config + profiles once on startup so the mode strip and the
  // chat model picker are correct before Settings is ever opened.
  useEffect(() => {
    window.aura?.ai.getConfig().then(setAIConfig).catch(() => {})
    window.aura?.profiles.list()
      .then(profiles => {
        setProfiles(profiles)
        return window.aura?.profiles.getActive()
      })
      .then(active => { if (active) setActiveProfileId(active.id) })
      .catch(() => {})
    // Restore chats + panel sessions from disk; keep them saved from now on.
    initPersistence()
    window.aura?.account.status()
      .then(status => {
        setAccount(status)
        setAuthChecked(true)
      })
      .catch(() => {
        setAccount(null)
        setAuthChecked(true)
      })
  }, [setAIConfig, setProfiles, setActiveProfileId, setAccount])

  const isChat = viewMode === 'chat'
  const isCode = viewMode === 'code'
  const isChatOrCode = isChat || isCode
  const needsAuth = authChecked && !account?.loggedIn

  return (
    <AppErrorBoundary>
    <div className="relative h-screen overflow-hidden bg-surface-0 text-white">
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-36 -top-40 h-[520px] w-[520px] rounded-full bg-aura-600/22 blur-3xl" />
        <div className="absolute right-[-160px] top-24 h-[560px] w-[560px] rounded-full bg-fuchsia-500/16 blur-3xl" />
        <div className="absolute bottom-[-220px] left-1/3 h-[480px] w-[480px] rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_35%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent)]" />
      </div>

      <div className="relative z-10 flex h-full flex-col border border-white/8 bg-surface-0/68 shadow-2xl shadow-black/60 backdrop-blur-3xl">
        <TitleBar />

        <div className="flex min-h-0 flex-1 flex-col">
          {/* Main content row */}
          <div className="flex min-h-0 flex-1">
            <Sidebar />

            <div className="flex min-h-0 flex-1 flex-col">
              <Suspense fallback={null}>
                {/* Chat view with embedded live coding split when AI is coding */}
                {viewMode === 'chat' && (
                  <LiveCodingLayout explorerOpen={explorerOpen} />
                )}

                {/* Code view = explorer + Monaco editor or CodePanel */}
                {viewMode === 'code' && (
                  <CodeWorkspace explorerOpen={explorerOpen} />
                )}

                {viewMode === 'agent' && <AgentPanel />}
                {viewMode === 'design' && <DesignPanel />}
                {viewMode === 'search' && <SearchPanel />}
                {viewMode === 'memory' && <MemoryPanel />}
                {viewMode === 'projects' && <ProjectsView />}
                {viewMode === 'settings' && <SettingsPanel />}
              </Suspense>
            </div>
          </div>

          {/* Integrated terminal (resizable from bottom) */}
          <AnimatePresence>
            {terminalOpen && (
              <motion.div
                animate={{ height: terminalHeight }}
                className="shrink-0 border-t border-white/10"
                exit={{ height: 0 }}
                initial={{ height: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                <TerminalResizeHandle
                  height={terminalHeight}
                  onResize={setTerminalHeight}
                />
                <div style={{ height: terminalHeight - 4 }}>
                  <TerminalPanel onClose={() => setTerminalOpen(false)} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <CommandPalette />
      <ToolPermissionPrompt />

      {needsAuth && (
        <AuthGate
          onAuthenticated={status => {
            setAccount(status)
          }}
        />
      )}
    </div>
    </AppErrorBoundary>
  )
}

function TerminalResizeHandle({
  height,
  onResize,
}: {
  height: number
  onResize: (h: number) => void
}) {
  const isDragging = useRef(false)
  const startY = useRef(0)
  const startH = useRef(0)

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    isDragging.current = true
    startY.current = e.clientY
    startH.current = height

    function onMove(ev: MouseEvent) {
      if (!isDragging.current) return
      const delta = startY.current - ev.clientY
      onResize(Math.max(120, Math.min(600, startH.current + delta)))
    }
    function onUp() {
      isDragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      className="flex h-1 w-full cursor-row-resize items-center justify-center hover:bg-aura-500/20"
      onMouseDown={onMouseDown}
    >
      <div className="h-px w-8 rounded-full bg-white/15" />
    </div>
  )
}
