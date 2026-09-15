import * as Dialog from '@radix-ui/react-dialog'
import { AnimatePresence, motion } from 'framer-motion'
import { Bot, Brain, Code2, MessageSquarePlus, Palette, Search, Settings, Sparkles } from 'lucide-react'
import { Command } from 'cmdk'
import { useEffect } from 'react'
import { useAuraStore } from '@/store'

const commands = [
  { label: 'New conversation', hint: 'Start fresh', icon: MessageSquarePlus, action: 'new-chat' },
  { label: 'Open Chat', hint: 'Talk to Aura', icon: Sparkles, action: 'chat' },
  { label: 'Open Agent', hint: 'Plan and execute goals', icon: Bot, action: 'agent' },
  { label: 'Open Code Workspace', hint: 'Build and debug', icon: Code2, action: 'code' },
  { label: 'Open Design Studio', hint: 'Design UI with live preview', icon: Palette, action: 'design' },
  { label: 'Open Search', hint: 'Research with citations', icon: Search, action: 'search' },
  { label: 'Open Memory', hint: 'Inspect what Aura remembers', icon: Brain, action: 'memory' },
  { label: 'Open Settings', hint: 'Configure Aura', icon: Settings, action: 'settings' },
] as const

export function CommandPalette() {
  const open = useAuraStore(state => state.commandPaletteOpen)
  const toggleCommandPalette = useAuraStore(state => state.toggleCommandPalette)
  const createConversation = useAuraStore(state => state.createConversation)
  const setViewMode = useAuraStore(state => state.setViewMode)

  useEffect(() => {
    const dispose = window.aura?.onToggleCommandPalette?.(() => toggleCommandPalette())
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        toggleCommandPalette()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      dispose?.()
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [toggleCommandPalette])

  function run(action: (typeof commands)[number]['action']) {
    if (action === 'new-chat') createConversation()
    if (action === 'chat') setViewMode('chat')
    if (action === 'agent') setViewMode('agent')
    if (action === 'code') setViewMode('code')
    if (action === 'design') setViewMode('design')
    if (action === 'search') setViewMode('search')
    if (action === 'memory') setViewMode('memory')
    if (action === 'settings') setViewMode('settings')
    toggleCommandPalette()
  }

  return (
    <Dialog.Root open={open} onOpenChange={toggleCommandPalette}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                animate={{ opacity: 1 }}
                className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xl"
                exit={{ opacity: 0 }}
                initial={{ opacity: 0 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="fixed left-1/2 top-24 z-50 w-[min(720px,calc(100vw-48px))] -translate-x-1/2 overflow-hidden rounded-3xl border border-white/12 bg-surface-1/92 shadow-2xl shadow-black/50 backdrop-blur-3xl"
                exit={{ opacity: 0, scale: 0.98, y: -10 }}
                initial={{ opacity: 0, scale: 0.98, y: -10 }}
                transition={{ duration: 0.16 }}
              >
                <Command className="bg-transparent">
                  <div className="border-b border-white/8 p-4">
                    <Command.Input
                      autoFocus
                      className="w-full bg-transparent text-lg text-white outline-none placeholder:text-white/28"
                      placeholder="Ask Aura to do anything…"
                    />
                  </div>
                  <Command.List className="max-h-[420px] overflow-y-auto p-2">
                    <Command.Empty className="px-4 py-10 text-center text-sm text-white/38">
                      No command found. Type a task in chat and Aura will figure it out.
                    </Command.Empty>
                    <Command.Group heading="Actions" className="p-2 text-xs uppercase tracking-[0.2em] text-white/25">
                      {commands.map(command => {
                        const Icon = command.icon
                        return (
                          <Command.Item
                            className="group mt-1 flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-3 text-sm text-white/70 outline-none transition data-[selected=true]:bg-white/10 data-[selected=true]:text-white"
                            key={command.action}
                            onSelect={() => run(command.action)}
                          >
                            <div className="rounded-xl bg-white/8 p-2 text-white/50 group-data-[selected=true]:bg-aura-500/20 group-data-[selected=true]:text-aura-200">
                              <Icon size={18} />
                            </div>
                            <div className="flex-1">
                              <div className="font-medium">{command.label}</div>
                              <div className="mt-0.5 text-xs text-white/35">{command.hint}</div>
                            </div>
                          </Command.Item>
                        )
                      })}
                    </Command.Group>
                  </Command.List>
                </Command>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}
