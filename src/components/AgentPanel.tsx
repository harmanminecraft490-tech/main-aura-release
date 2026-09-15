import { FormEvent, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowUp,
  Bot,
  Brain,
  Check,
  ChevronDown,
  CircleDashed,
  Loader2,
  Square,
  UserRound,
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { useAuraStore } from '@/store'
import { usePanelSession } from './usePanelSession'
import type { Message } from '@/types'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ModelPicker } from './ModelPicker'
import { PanelSessionSwitcher } from './PanelSessionSwitcher'

const AGENT_SYSTEM_HINT = `You are Aura in Agent Mode: an autonomous senior operator. For every goal:
1. Open with a one-paragraph understanding of the goal.
2. Then output a "## Plan" section as a markdown task list ("- [ ] step"). Keep steps concrete and verifiable.
3. Work through the plan step by step. When you complete a step, restate it as "- [x] step" before continuing.
4. Finish with a "## Result" section: the deliverable, risks, and how to verify completion.
Be direct and execution-focused. In this MVP you reason and produce deliverables in-app; you cannot touch the filesystem or network, so say so when a step would need it.`

type PlanStep = { text: string; done: boolean }

/** Parse "- [ ]"/"- [x]" task-list lines out of streamed markdown into a live timeline. */
function parsePlan(markdown: string): PlanStep[] {
  const steps: PlanStep[] = []
  const seen = new Set<string>()
  for (const line of markdown.split('\n')) {
    const match = /^\s*[-*]\s*\[([ xX])\]\s+(.+)$/.exec(line)
    if (!match) continue
    const text = match[2].trim()
    const done = match[1].toLowerCase() === 'x'
    const key = text.toLowerCase()
    if (seen.has(key)) {
      // Later "[x]" restatements upgrade the original entry instead of duplicating.
      const existing = steps.find(s => s.text.toLowerCase() === key)
      if (existing && done) existing.done = true
      continue
    }
    seen.add(key)
    steps.push({ text, done })
  }
  return steps
}

const suggestions = [
  'Plan the launch checklist for Aura’s desktop MVP',
  'Design a migration path from local chats to synced storage',
  'Audit the app for accessibility issues and propose fixes',
  'Draft a step-by-step plan to add plugin sandboxing',
]

function AgentTimeline({ steps, running }: { steps: PlanStep[]; running: boolean }) {
  const [collapsed, setCollapsed] = useState(false)
  const doneCount = steps.filter(s => s.done).length
  if (steps.length === 0) return null
  return (
    <div className="mb-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
      <button
        className="flex w-full items-center gap-2 text-xs text-white/50 transition hover:text-white/75"
        onClick={() => setCollapsed(v => !v)}
        type="button"
      >
        {running && doneCount < steps.length
          ? <Loader2 size={12} className="animate-spin text-aura-300" />
          : <Check size={12} className="text-emerald-400" />}
        <span className="font-medium">Plan · {doneCount}/{steps.length} steps</span>
        <ChevronDown size={11} className={cn('ml-auto transition-transform', !collapsed && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            animate={{ height: 'auto', opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
          >
            <div className="mt-2.5 space-y-1.5">
              {steps.map((step, index) => {
                const isActive = running && !step.done && steps.slice(0, index).every(s => s.done)
                return (
                  <div key={step.text} className="flex items-start gap-2 text-[13px] leading-5">
                    {step.done ? (
                      <Check size={13} className="mt-1 shrink-0 text-emerald-400" />
                    ) : isActive ? (
                      <Loader2 size={13} className="mt-1 shrink-0 animate-spin text-aura-300" />
                    ) : (
                      <CircleDashed size={13} className="mt-1 shrink-0 text-white/20" />
                    )}
                    <span className={cn(
                      step.done ? 'text-white/45' : isActive ? 'text-white/85' : 'text-white/35'
                    )}>
                      {step.text}
                    </span>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

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

export function AgentPanel() {
  const defaultModelSelection = useAuraStore(state => state.defaultModelSelection)
  const setDefaultModelSelection = useAuraStore(state => state.setDefaultModelSelection)
  const [input, setInput] = useState('')
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
  } = usePanelSession('agent')

  async function sendAgent(content: string) {
    const trimmed = content.trim()
    if (!trimmed || running) return
    setInput('')
    // First turn carries the agent operating instructions; follow-ups continue the thread.
    const historyContent = messages.length === 0
      ? `${AGENT_SYSTEM_HINT}\n\nGoal:\n${trimmed}`
      : trimmed
    await send(trimmed, historyContent)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void sendAgent(input)
  }

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/6 px-6 py-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2.5 truncate text-2xl font-semibold tracking-tight text-white">
            <Bot size={22} className="text-aura-300" /> Agent
          </h1>
          <p className="mt-1 truncate text-sm text-white/38">Give Aura a goal — it plans, executes step by step, and reports back.</p>
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
              <Bot size={28} />
            </motion.div>
            <h2 className="mt-6 text-3xl font-semibold tracking-tight text-white">What should Aura take on?</h2>
            <p className="mt-3 max-w-lg text-sm leading-6 text-white/45">
              Describe an outcome. Aura breaks it into a plan, works through each step with visible progress, and delivers a verifiable result.
            </p>
            <div className="mt-8 grid w-full gap-2.5 sm:grid-cols-2">
              {suggestions.map(suggestion => (
                <button
                  key={suggestion}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm leading-6 text-white/55 transition hover:border-aura-400/40 hover:bg-aura-500/10 hover:text-white"
                  onClick={() => void sendAgent(suggestion)}
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
              <AgentMessage key={message.id} message={message} running={running} />
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

      <form className="shrink-0 px-6 pb-6" onSubmit={onSubmit}>
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-3xl border border-white/12 bg-white/[0.05] p-2 backdrop-blur-2xl focus-within:border-aura-400/40">
          <textarea
            className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm leading-6 text-white outline-none placeholder:text-white/25"
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void sendAgent(input)
              }
            }}
            placeholder={hasMessages ? 'Follow up, refine the plan, or give the next goal…' : 'Describe the goal…'}
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
    </section>
  )
}

function AgentMessage({ message, running }: { message: Message; running: boolean }) {
  const isUser = message.role === 'user'
  const plan = useMemo(
    () => (isUser ? [] : parsePlan(message.content)),
    [isUser, message.content]
  )

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
        <Bot size={15} />
      </div>
      <div className="min-w-0 max-w-[85%] flex-1 rounded-3xl border border-white/10 bg-white/[0.055] px-5 py-4 text-[15px] leading-7 text-white/82 shadow-xl shadow-black/20 backdrop-blur-2xl">
        <ThinkingBlock streaming={Boolean(message.isStreaming)} thinking={message.thinking ?? ''} />
        <AgentTimeline running={running && Boolean(message.isStreaming)} steps={plan} />
        {message.error ? (
          <div className="text-red-200">{message.error}</div>
        ) : message.content ? (
          <MarkdownRenderer content={message.content} />
        ) : !message.thinking ? (
          <div className="flex items-center gap-2 text-sm text-white/45">
            <Loader2 size={14} className="animate-spin text-aura-300" /> Planning the approach…
          </div>
        ) : null}
        {!message.isStreaming && message.model && (
          <div className="mt-2 border-t border-white/6 pt-1.5 font-mono text-[10px] text-white/25">{message.model}</div>
        )}
      </div>
    </motion.div>
  )
}
