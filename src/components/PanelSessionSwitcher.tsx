import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, MessageSquarePlus, Trash2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { PanelSession } from '@/types'

/**
 * Session picker for the Agent / Code / Design panels. Lets the user keep
 * multiple threads per panel, switch between them, start new ones, and delete
 * old ones — all persisted.
 */
export function PanelSessionSwitcher({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: {
  sessions: PanelSession[]
  activeId: string
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const active = sessions.find(session => session.id === activeId) ?? sessions[0]

  function toggle(event: React.MouseEvent) {
    event.stopPropagation()
    setOpen(value => !value)
  }

  function pick(event: React.MouseEvent, id: string) {
    event.stopPropagation()
    onSelect(id)
    setOpen(false)
  }

  function remove(event: React.MouseEvent, id: string) {
    event.stopPropagation()
    onDelete(id)
    if (id === activeId) setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative" onClick={event => event.stopPropagation()}>
      <button
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/65 transition hover:border-white/20 hover:text-white"
        onClick={toggle}
        type="button"
      >
        <MessageSquarePlus size={12} className="text-aura-300" />
        <span className="max-w-[180px] truncate">{active?.title ?? 'New session'}</span>
        <span className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/40">{sessions.length}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="absolute right-0 z-50 mt-2 max-h-72 w-72 overflow-y-auto rounded-2xl border border-white/10 bg-[#15151d]/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-2xl"
            exit={{ opacity: 0, y: -4 }}
            initial={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
          >
            <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/30">Sessions</div>
            {sessions.length === 0 && (
              <div className="px-2 py-2 text-xs text-white/40">No sessions yet — start a new chat.</div>
            )}
            {sessions.map(session => {
              const isActive = session.id === activeId
              return (
                <div
                  className={cn(
                    'group flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-xs transition',
                    isActive ? 'bg-white/10 text-white' : 'text-white/55 hover:bg-white/6 hover:text-white/85'
                  )}
                  key={session.id}
                  onClick={event => pick(event, session.id)}
                  role="button"
                >
                  <span className="min-w-0 flex-1 truncate">{session.title}</span>
                  <span className="shrink-0 font-mono text-[10px] text-white/30">{session.messages.length}</span>
                  {isActive && <Check size={12} className="shrink-0 text-aura-300" />}
                  <span
                    className="shrink-0 rounded-md p-1 text-white/25 transition hover:text-red-400"
                    onClick={event => remove(event, session.id)}
                    role="button"
                    title="Delete session"
                  >
                    <Trash2 size={11} />
                  </span>
                </div>
              )
            })}
            <div
              className="mt-1 flex cursor-pointer items-center gap-2 rounded-xl border-t border-white/8 px-2.5 py-2 text-xs font-medium text-aura-200 transition hover:bg-aura-500/10"
              onClick={event => { event.stopPropagation(); onNew(); setOpen(false) }}
              role="button"
            >
              <MessageSquarePlus size={12} />
              Start a new session
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
