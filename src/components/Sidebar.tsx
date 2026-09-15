import { AnimatePresence, motion } from 'framer-motion'
import { Bot, Brain, Code2, MessageSquarePlus, Palette, PanelLeftClose, PanelLeftOpen, Search, Settings, Sparkles, Trash2, UserRound, Database } from 'lucide-react'
import { useCallback } from 'react'
import { cn } from '@/utils/cn'
import { useAuraStore } from '@/store'
import type { Conversation, ViewMode } from '@/types'

const navItems: { mode: ViewMode; label: string; icon: React.ElementType }[] = [
  { mode: 'chat', label: 'Chat', icon: Sparkles },
  { mode: 'agent', label: 'Agent', icon: Bot },
  { mode: 'code', label: 'Code', icon: Code2 },
  { mode: 'design', label: 'Design', icon: Palette },
  { mode: 'search', label: 'Search', icon: Search },
  { mode: 'memory', label: 'Memory', icon: Brain },
  { mode: 'projects', label: 'Projects', icon: Database },
  { mode: 'settings', label: 'Settings', icon: Settings },
]

const formatConversationTime = (conversation: Conversation) => {
  const delta = Date.now() - conversation.updatedAt
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (delta < minute) return 'now'
  if (delta < hour) return `${Math.floor(delta / minute)}m`
  if (delta < day) return `${Math.floor(delta / hour)}h`
  return `${Math.floor(delta / day)}d`
}

export function Sidebar() {
  const sidebarOpen = useAuraStore(state => state.sidebarOpen)
  const toggleSidebar = useCallback(() => useAuraStore.getState().toggleSidebar(), [])
  const viewMode = useAuraStore(state => state.viewMode)
  const setViewMode = useCallback((mode: ViewMode) => useAuraStore.getState().setViewMode(mode), [])
  const conversations = useAuraStore(state => state.conversations)
  const activeConversationId = useAuraStore(state => state.activeConversationId)
  const createConversation = useCallback(() => useAuraStore.getState().createConversation(), [])
  const setActiveConversation = useCallback((id: string) => useAuraStore.getState().setActiveConversation(id), [])
  const deleteConversation = useCallback((id: string) => useAuraStore.getState().deleteConversation(id), [])
  const account = useAuraStore(state => state.account)

  return (
    <AnimatePresence initial={false}>
      {sidebarOpen ? (
        <motion.aside
          animate={{ width: 300, opacity: 1 }}
          className="flex h-full shrink-0 flex-col border-r border-white/8 bg-black/20 backdrop-blur-3xl"
          exit={{ width: 72, opacity: 0.92 }}
          initial={{ width: 72, opacity: 0.92 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          <div className="flex items-center justify-between p-4">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-white/30">Workspace</div>
              <div className="mt-1 text-lg font-semibold text-white">Aura OS</div>
            </div>
            <button
              className="rounded-xl p-2 text-white/45 transition hover:bg-white/10 hover:text-white"
              onClick={toggleSidebar}
              type="button"
            >
              <PanelLeftClose size={18} />
            </button>
          </div>

          <div className="px-3">
            <button
              className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-aura-500 to-fuchsia-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-aura-950/30 transition hover:scale-[1.01] hover:shadow-aura-500/20"
              onClick={() => createConversation()}
              type="button"
            >
              <MessageSquarePlus size={18} />
              New conversation
            </button>
          </div>

          <nav className="mt-5 space-y-1 px-3">
            {navItems.map((item) => {
              const Icon = item.icon
              const active = viewMode === item.mode
              return (
                <button
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
                    active ? 'bg-white/12 text-white shadow-inner shadow-white/5' : 'text-white/48 hover:bg-white/8 hover:text-white/90'
                  )}
                  key={item.mode}
                  onClick={() => setViewMode(item.mode)}
                  type="button"
                >
                  <Icon size={18} />
                  {item.label}
                </button>
              )
            })}
          </nav>

          <div className="mt-6 flex min-h-0 flex-1 flex-col px-3">
            <div className="mb-2 flex items-center justify-between px-2 text-xs uppercase tracking-[0.2em] text-white/28">
              <span>Recent</span>
              <span>{conversations.length}</span>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pb-4">
              {conversations.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm leading-6 text-white/38">
                  Start with an idea, a question, or a task. Aura will turn it into progress.
                </div>
              ) : (
                conversations.map(conversation => {
                  const active = conversation.id === activeConversationId && viewMode === 'chat'
                  return (
                    <div className="group relative" key={conversation.id}>
                      <button
                        className={cn(
                          'flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition',
                          active ? 'bg-aura-500/16 text-white' : 'text-white/55 hover:bg-white/7 hover:text-white/90'
                        )}
                        onClick={() => setActiveConversation(conversation.id)}
                        type="button"
                      >
                        <div className="mt-0.5 rounded-lg bg-white/8 p-1.5 text-white/55">
                          <Sparkles size={14} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{conversation.title}</div>
                          <div className="mt-1 flex items-center gap-2 text-xs text-white/28">
                            <span>{conversation.messages.length} messages</span>
                            <span>•</span>
                            <span>{formatConversationTime(conversation)}</span>
                          </div>
                        </div>
                      </button>
                      <button
                        aria-label="Delete conversation"
                        className="absolute right-2 top-2 hidden rounded-lg p-1.5 text-white/32 transition hover:bg-red-500/15 hover:text-red-200 group-hover:block"
                        onClick={event => {
                          event.stopPropagation()
                          deleteConversation(conversation.id)
                        }}
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div className="border-t border-white/8 p-3">
            <button
              className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.06] p-3 text-left transition hover:bg-white/[0.09]"
              onClick={() => useAuraStore.getState().openSettingsSection('account')}
              type="button"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-white/14 to-white/6 text-white/70">
                <UserRound size={18} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white/80">Our Account</div>
                <div className="truncate text-xs text-white/35">
                  {account?.loggedIn
                    ? account.tier === 'dev'
                      ? 'Dev · unlimited'
                      : account.tier === 'premium'
                        ? 'Premium'
                        : account.trialActive
                          ? 'Basic · free trial'
                          : 'Basic'
                    : 'Create account · free trial'}
                </div>
              </div>
            </button>
          </div>
        </motion.aside>
      ) : (
        <motion.aside
          animate={{ width: 72, opacity: 1 }}
          className="flex h-full shrink-0 flex-col items-center border-r border-white/8 bg-black/20 py-4 backdrop-blur-3xl"
          initial={{ width: 300, opacity: 0.92 }}
          transition={{ duration: 0.2 }}
        >
          <button
            className="rounded-xl p-2 text-white/45 transition hover:bg-white/10 hover:text-white"
            onClick={toggleSidebar}
            type="button"
          >
            <PanelLeftOpen size={18} />
          </button>
          <div className="mt-5 flex flex-col gap-2">
            {navItems.map(item => {
              const Icon = item.icon
              return (
                <button
                  className={cn(
                    'rounded-xl p-3 transition',
                    viewMode === item.mode ? 'bg-white/12 text-white' : 'text-white/45 hover:bg-white/8 hover:text-white'
                  )}
                  key={item.mode}
                  onClick={() => setViewMode(item.mode)}
                  title={item.label}
                  type="button"
                >
                  <Icon size={18} />
                </button>
              )
            })}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
