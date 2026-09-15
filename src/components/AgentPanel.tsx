import { FormEvent, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, Bot, Brain, Check, ChevronDown, CircleDashed, Loader2, Square, UserRound } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useAuraStore } from '@/store'
import { usePanelSession } from './usePanelSession'
import type { Message } from '@/types'
import type { AgentTaskState } from '@/services/ai'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ModelPicker } from './ModelPicker'
import { PanelSessionSwitcher } from './PanelSessionSwitcher'

const suggestions = [
  'Audit the project, fix the highest-impact issue, test it, and verify the result.',
  'Build the requested feature end to end, including tests and a production build.',
  'Find the root cause of the current bug, implement the fix, and prove it works.',
  'Review this workspace and make the necessary changes autonomously.',
]

function AgentTimeline({ state }: { state: AgentTaskState | null }) {
  const [collapsed, setCollapsed] = useState(false)
  if (!state || state.tasks.length === 0) return null
  const doneCount = state.tasks.filter(task => task.status === 'completed').length
  const renderChildren = (parentId: string, depth: number): JSX.Element[] => state.tasks.filter(task => task.parentTaskId === parentId).flatMap(task => [
    <div key={task.id} className="flex items-start gap-2 text-[13px] leading-5" style={{ paddingLeft: depth * 16 }}>
      {task.status === 'completed' ? <Check size={13} className="mt-1 shrink-0 text-emerald-400" /> : task.id === state.activeTaskId && task.status === 'in_progress' ? <Loader2 size={13} className="mt-1 shrink-0 animate-spin text-aura-300" /> : <CircleDashed size={13} className="mt-1 shrink-0 text-white/20" />}
      <span className={cn(task.status === 'completed' ? 'text-white/45' : task.id === state.activeTaskId ? 'text-white/85' : 'text-white/35')}>
        {task.title}{task.status === 'failed' ? ' · failed/retrying' : task.status === 'blocked' ? ' · blocked' : ''}
      </span>
    </div>,
    ...renderChildren(task.id, depth + 1),
  ])
  const roots = state.tasks.filter(task => !task.parentTaskId)
  return (
    <div className="mb-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
      <button className="flex w-full items-center gap-2 text-xs text-white/50 transition hover:text-white/75" onClick={() => setCollapsed(value => !value)} type="button">
        {state.status === 'completed' ? <Check size={12} className="text-emerald-400" /> : <Loader2 size={12} className="animate-spin text-aura-300" />}
        <span className="font-medium">Agent · {doneCount}/{state.tasks.length} tasks</span>
        <ChevronDown size={11} className={cn('ml-auto transition-transform', !collapsed && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {!collapsed && <motion.div animate={{ height: 'auto', opacity: 1 }} className="overflow-hidden" exit={{ height: 0, opacity: 0 }} initial={{ height: 0, opacity: 0 }}><div className="mt-2.5 space-y-1.5">{roots.flatMap(task => [
          <div key={task.id} className="flex items-start gap-2 text-[13px] leading-5">
            {task.status === 'completed' ? <Check size={13} className="mt-1 shrink-0 text-emerald-400" /> : task.id === state.activeTaskId ? <Loader2 size={13} className="mt-1 shrink-0 animate-spin text-aura-300" /> : <CircleDashed size={13} className="mt-1 shrink-0 text-white/20" />}
            <span className={cn(task.status === 'completed' ? 'text-white/45' : task.id === state.activeTaskId ? 'text-white/85' : 'text-white/35')}>{task.title}</span>
          </div>,
          ...renderChildren(task.id, 1),
        ])}</div></motion.div>}
      </AnimatePresence>
    </div>
  )
}

function ThinkingBlock({ thinking, streaming }: { thinking: string; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  if (!thinking) return null
  return <div className="mb-3"><button className="flex items-center gap-2 text-xs text-white/40 transition hover:text-white/65" onClick={() => setOpen(value => !value)} type="button"><Brain size={12} className={cn(streaming && 'animate-pulse text-aura-300')} /><span className="font-medium">{streaming ? 'Thinking…' : 'Reasoning'}</span><ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} /></button><AnimatePresence initial={false}>{open && <motion.div animate={{ height: 'auto', opacity: 1 }} className="overflow-hidden" exit={{ height: 0, opacity: 0 }} initial={{ height: 0, opacity: 0 }}><p className="mt-2 whitespace-pre-wrap rounded-xl bg-black/20 px-3 py-2 font-mono text-[11px] leading-5 text-white/40">{thinking}</p></motion.div>}</AnimatePresence></div>
}

export function AgentPanel() {
  const defaultModelSelection = useAuraStore(state => state.defaultModelSelection)
  const setDefaultModelSelection = useAuraStore(state => state.setDefaultModelSelection)
  const [input, setInput] = useState('')
  const { sessions, activeId, messages, hasMessages, running, activity, agentState, abortRef, scrollRef, send, newSession, selectSession, deleteSession } = usePanelSession('agent')

  async function sendAgent(content: string) {
    const trimmed = content.trim()
    if (!trimmed || running) return
    setInput('')
    await send(trimmed, trimmed)
  }
  function onSubmit(event: FormEvent) { event.preventDefault(); void sendAgent(input) }

  return <section className="flex h-full min-w-0 flex-1 flex-col">
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/6 px-6 py-4"><div className="min-w-0"><h1 className="flex items-center gap-2.5 truncate text-2xl font-semibold tracking-tight text-white"><Bot size={22} className="text-aura-300" /> Agent</h1><p className="mt-1 truncate text-sm text-white/38">Give Aura a goal — it plans, executes, verifies, and keeps working.</p></div><div className="flex items-center gap-2"><PanelSessionSwitcher activeId={activeId} onDelete={deleteSession} onNew={newSession} onSelect={selectSession} sessions={sessions} /><ModelPicker value={defaultModelSelection} onChange={setDefaultModelSelection} /></div></header>
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-6">
      {!hasMessages ? <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center px-6 text-center"><motion.div animate={{ opacity: 1, y: 0 }} className="flex h-16 w-16 items-center justify-center rounded-3xl border border-white/12 bg-white/6 text-aura-200" initial={{ opacity: 0, y: 10 }}><Bot size={28} /></motion.div><h2 className="mt-6 text-3xl font-semibold tracking-tight text-white">What should Aura take on?</h2><p className="mt-3 max-w-lg text-sm leading-6 text-white/45">Describe an outcome. Aura owns the task state, uses real tools, adapts its task graph, and verifies before completion.</p><div className="mt-8 grid w-full gap-2.5 sm:grid-cols-2">{suggestions.map(suggestion => <button key={suggestion} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm leading-6 text-white/55 transition hover:border-aura-400/40 hover:bg-aura-500/10 hover:text-white" onClick={() => void sendAgent(suggestion)} type="button">{suggestion}</button>)}</div></div> : <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 pb-6">{messages.map(message => <AgentMessage key={message.id} message={message} running={running} agentState={agentState} />)}{activity && <div className="flex items-center gap-2 text-[13px] text-white/45"><Loader2 size={13} className="animate-spin text-aura-300" /><span>{activity.label ?? 'Working…'}</span></div>}</div>}
    </div>
    <form className="shrink-0 px-6 pb-6" onSubmit={onSubmit}><div className="mx-auto flex max-w-3xl items-end gap-2 rounded-3xl border border-white/12 bg-white/[0.05] p-2 backdrop-blur-2xl focus-within:border-aura-400/40"><textarea className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm leading-6 text-white outline-none placeholder:text-white/25" onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendAgent(input) } }} placeholder={hasMessages ? 'Follow up or refine the goal…' : 'Describe the goal…'} rows={1} value={input} />{running ? <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white transition hover:bg-white/15" onClick={() => void abortRef.current?.()} title="Stop" type="button"><Square size={15} /></button> : <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-surface-0 transition enabled:hover:scale-105 disabled:opacity-30" disabled={!input.trim()} title="Send" type="submit"><ArrowUp size={16} /></button>}</div></form>
  </section>
}

function AgentMessage({ message, running, agentState }: { message: Message; running: boolean; agentState: AgentTaskState | null }) {
  if (message.role === 'user') return <motion.div animate={{ opacity: 1, y: 0 }} className="flex justify-end gap-3" initial={{ opacity: 0, y: 8 }}><div className="max-w-[85%] rounded-3xl bg-white px-5 py-3.5 text-[15px] leading-7 text-surface-0 shadow-xl shadow-black/20"><div className="whitespace-pre-wrap">{message.content}</div></div><div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/70"><UserRound size={15} /></div></motion.div>
  return <motion.div animate={{ opacity: 1, y: 0 }} className="flex gap-3" initial={{ opacity: 0, y: 8 }}><div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-aura-500 to-fuchsia-500 shadow-lg shadow-aura-950/30"><Bot size={15} /></div><div className="min-w-0 max-w-[85%] flex-1 rounded-3xl border border-white/10 bg-white/[0.055] px-5 py-4 text-[15px] leading-7 text-white/82 shadow-xl shadow-black/20 backdrop-blur-2xl"><ThinkingBlock streaming={Boolean(message.isStreaming)} thinking={message.thinking ?? ''} />{agentState && <AgentTimeline state={agentState} />}{message.error ? <div className="text-red-200">{message.error}</div> : message.content ? <MarkdownRenderer content={message.content} /> : !message.thinking ? <div className="flex items-center gap-2 text-sm text-white/45"><Loader2 size={14} className="animate-spin text-aura-300" /> Working…</div> : null}{!message.isStreaming && message.model && <div className="mt-2 border-t border-white/6 pt-1.5 font-mono text-[10px] text-white/25">{message.model}</div>}</div></motion.div>
}
