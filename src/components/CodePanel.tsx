import { FormEvent, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowUp, Brain, ChevronDown, Code2, FileCode2, Loader2, Square, UserRound, X } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useAuraStore } from '@/store'
import { usePanelSession } from './usePanelSession'
import type { Message } from '@/types'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ModelPicker } from './ModelPicker'
import { PanelSessionSwitcher } from './PanelSessionSwitcher'

const CODE_SYSTEM_HINT = `You are Aura in Code Mode: a senior engineer pairing with the user.
- Return production-quality code in fenced blocks with the correct language tag.
- Lead with the code or the direct answer; keep explanation tight and after the code.
- When reviewing, be specific: file/line-level observations, concrete fixes, no vague advice.
- When the user iterates, return complete updated code, not fragments, unless they ask for a diff.`

const suggestions = [
  'Review this code for bugs and edge cases',
  'Refactor for readability and performance',
  'Convert this to TypeScript with strict types',
  'Write unit tests covering the tricky paths',
]

function ThinkingBlock({ thinking, streaming }: { thinking: string; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  if (!thinking) return null
  return (
    <div className="mb-3">
      <button
        className="flex items-center gap-2 text-xs text-white/40 transition hover:text-white/65"
        onClick={() => setOpen(v => !v)}
        type="button"
      >
        <Brain size={12} className={cn(streaming && 'animate-pulse text-aura-300')} />
        <span className="font-medium">{streaming ? 'Thinking…' : 'Reasoning'}</span>
        <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            animate={{ height: 'auto', opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
          >
            <p className="mt-2 whitespace-pre-wrap rounded-xl bg-black/20 px-3 py-2 font-mono text-[11px] leading-5 text-white/40">
              {thinking}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function CodePanel() {
  const defaultModelSelection = useAuraStore(state => state.defaultModelSelection)
  const setDefaultModelSelection = useAuraStore(state => state.setDefaultModelSelection)
  const [input, setInput] = useState('')
  const [context, setContext] = useState('')
  const [contextOpen, setContextOpen] = useState(true)
  const {
    sessions,
    activeId,
    messages,
    hasMessages,
    running,
    activity,
    abortRef,
    scrollRef,
    send,
    newSession,
    selectSession,
    deleteSession,
  } = usePanelSession('code')

  async function sendCode(content: string) {
    const trimmed = content.trim()
    if (!trimmed || running) return

    const contextBlock = context.trim()
      ? `\n\nCode/context:\n\`\`\`\n${context.trim()}\n\`\`\``
      : ''

    // First turn carries operating instructions + editor context. Follow-ups
    // re-include the context block.
    const historyContent = messages.length === 0
      ? `${CODE_SYSTEM_HINT}\n\nTask:\n${trimmed}${contextBlock}`
      : `${trimmed}${contextBlock}`

    setInput('')
    await send(trimmed, historyContent)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void sendCode(input)
  }

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/6 px-6 py-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2.5 truncate text-2xl font-semibold tracking-tight text-white">
            <Code2 size={22} className="text-aura-300" /> Code
          </h1>
          <p className="mt-1 truncate text-sm text-white/38">Pair with Aura — paste code as context, then build, review, and refactor conversationally.</p>
        </div>
        <div className="flex items-center gap-2">
          <PanelSessionSwitcher
            activeId={activeId}
            onDelete={deleteSession}
            onNew={newSession}
            onSelect={selectSession}
            sessions={sessions}
          />
          <ModelPicker value={defaultModelSelection} onChange={setDefaultModelSelection} />
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-6">
        {!hasMessages ? (
          <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center px-6 text-center">
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="flex h-16 w-16 items-center justify-center rounded-3xl border border-white/12 bg-white/6 text-aura-200"
              initial={{ opacity: 0, y: 10 }}
            >
              <Code2 size={28} />
            </motion.div>
            <h2 className="mt-6 text-3xl font-semibold tracking-tight text-white">What are we building?</h2>
            <p className="mt-3 max-w-lg text-sm leading-6 text-white/45">
              Add code below as context, then ask anything — Aura reviews, debugs, refactors, and writes production-quality code.
            </p>
            <div className="mt-8 grid w-full gap-2.5 sm:grid-cols-2">
              {suggestions.map(suggestion => (
                <button
                  key={suggestion}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm leading-6 text-white/55 transition hover:border-aura-400/40 hover:bg-aura-500/10 hover:text-white"
                  onClick={() => setInput(suggestion)}
                  type="button"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 pb-6">
            {messages.map(message => (
              <CodeMessage key={message.id} message={message} />
            ))}
            {activity && (
              <div className="flex items-center gap-2 text-[13px] text-white/45">
                <Loader2 size={13} className="animate-spin text-aura-300" />
                <span>{activity.label ?? 'Working…'}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 px-6 pb-6">
        <div className="mx-auto max-w-3xl">
          {/* Collapsible code context */}
          <div className="mb-2 overflow-hidden rounded-2xl border border-white/10 bg-black/20 backdrop-blur-2xl">
            <button
              className="flex w-full items-center gap-2 px-4 py-2.5 text-xs font-medium text-white/50 transition hover:text-white/75"
              onClick={() => setContextOpen(v => !v)}
              type="button"
            >
              <FileCode2 size={13} />
              Code context {context.trim() ? `· ${context.trim().split('\n').length} lines` : '· empty'}
              <ChevronDown size={12} className={cn('ml-auto transition-transform', contextOpen && 'rotate-180')} />
              {context.trim() && (
                <span
                  className="rounded-lg p-1 text-white/30 transition hover:text-red-400"
                  onClick={event => { event.stopPropagation(); setContext('') }}
                  role="button"
                  title="Clear context"
                >
                  <X size={12} />
                </span>
              )}
            </button>
            {contextOpen && (
              <textarea
                className="max-h-48 min-h-[96px] w-full resize-y border-t border-white/8 bg-transparent p-4 font-mono text-[12.5px] leading-5 text-white/75 outline-none placeholder:text-white/20"
                onChange={event => setContext(event.target.value)}
                placeholder="Paste code here — it's sent with your next message as context."
                spellCheck={false}
                value={context}
              />
            )}
          </div>

          <form onSubmit={onSubmit}>
            <div className="flex items-end gap-2 rounded-3xl border border-white/12 bg-white/[0.05] p-2 backdrop-blur-2xl focus-within:border-aura-400/40">
              <textarea
                className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm leading-6 text-white outline-none placeholder:text-white/25"
                onChange={event => setInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void sendCode(input)
                  }
                }}
                placeholder={hasMessages ? 'Follow up — refine, fix, extend…' : 'Refactor this, find bugs, explain it, write tests…'}
                rows={1}
                value={input}
              />
              {running ? (
                <button
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white transition hover:bg-white/15"
                  onClick={() => void abortRef.current?.()}
                  title="Stop"
                  type="button"
                >
                  <Square size={15} />
                </button>
              ) : (
                <button
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-surface-0 transition enabled:hover:scale-105 disabled:opacity-30"
                  disabled={!input.trim()}
                  title="Send"
                  type="submit"
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </section>
  )
}

function CodeMessage({ message }: { message: Message }) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <motion.div animate={{ opacity: 1, y: 0 }} className="flex justify-end gap-3" initial={{ opacity: 0, y: 8 }}>
        <div className="max-w-[85%] rounded-3xl bg-white px-5 py-3.5 text-[15px] leading-7 text-surface-0 shadow-xl shadow-black/20">
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/70">
          <UserRound size={15} />
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div animate={{ opacity: 1, y: 0 }} className="flex gap-3" initial={{ opacity: 0, y: 8 }}>
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-aura-500 to-fuchsia-500 shadow-lg shadow-aura-950/30">
        <Code2 size={15} />
      </div>
      <div className="min-w-0 max-w-[85%] flex-1 rounded-3xl border border-white/10 bg-white/[0.055] px-5 py-4 text-[15px] leading-7 text-white/82 shadow-xl shadow-black/20 backdrop-blur-2xl">
        <ThinkingBlock streaming={Boolean(message.isStreaming)} thinking={message.thinking ?? ''} />
        {message.error ? (
          <div className="text-red-200">{message.error}</div>
        ) : message.content ? (
          <MarkdownRenderer content={message.content} />
        ) : !message.thinking ? (
          <div className="flex items-center gap-2 text-sm text-white/45">
            <Loader2 size={14} className="animate-spin text-aura-300" /> Working on it…
          </div>
        ) : null}
        {!message.isStreaming && message.model && (
          <div className="mt-2 border-t border-white/6 pt-1.5 font-mono text-[10px] text-white/25">{message.model}</div>
        )}
      </div>
    </motion.div>
  )
}
