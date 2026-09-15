import { useEffect, useState } from 'react'
import { useStore } from '@services/store'
import { initBridge } from '@services/bridge'
import { TitleBar } from '@ui/TitleBar'
import { Sidebar } from '@ui/Sidebar'
import { ChatView } from '@ui/chat/ChatView'
import { SettingsView } from '@settings/SettingsView'
import { ProjectsView } from '@ui/projects/ProjectsView'

export function App() {
  const view = useStore(state => state.view)
  const sidebarOpen = useStore(state => state.sidebarOpen)
  const [ready, setReady] = useState(false)
  const [bridgeError, setBridgeError] = useState<string | null>(null)

  useEffect(() => {
    let dispose: (() => void) | undefined
    initBridge()
      .then(off => {
        dispose = off
        setReady(true)
      })
      .catch((error: unknown) => {
        setBridgeError(error instanceof Error ? error.message : 'Failed to reach the Aura backend.')
        setReady(true)
      })
    return () => dispose?.()
  }, [])

  return (
    <div className="flex h-full flex-col bg-surface-0">
      <TitleBar />
      <div className="relative flex min-h-0 flex-1">
        {/* Ambient background glows */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-aura-600/20 blur-[120px]" />
          <div className="absolute -bottom-40 right-0 h-96 w-96 rounded-full bg-fuchsia-600/10 blur-[120px]" />
        </div>

        {sidebarOpen && <Sidebar />}

        <main className="relative z-10 flex min-w-0 flex-1 flex-col">
          {bridgeError && (
            <div className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-sm text-amber-200">
              {bridgeError}
            </div>
          )}
          {!ready ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="aura-orb h-14 w-14 rounded-full animate-pulse-soft" />
            </div>
          ) : view === 'settings' ? (
            <SettingsView />
          ) : view === 'projects' ? (
            <ProjectsView />
          ) : (
            <ChatView />
          )}
        </main>
      </div>
    </div>
  )
}
