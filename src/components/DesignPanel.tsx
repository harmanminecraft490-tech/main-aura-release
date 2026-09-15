import { FormEvent, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowUp,
  Code2,
  Eye,
  Loader2,
  Monitor,
  Palette,
  Smartphone,
  Square,
  Tablet,
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { useAuraStore } from '@/store'
import { usePanelSession } from './usePanelSession'
import type { Message } from '@/types'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ModelPicker } from './ModelPicker'
import { PanelSessionSwitcher } from './PanelSessionSwitcher'

const DESIGN_SYSTEM_HINT = `You are Aura in Design Mode: a world-class product designer and frontend craftsperson.

For every request, produce a single self-contained HTML document with embedded <style> (and <script> only if interaction is essential). Rules:
- Output exactly one \`\`\`html code block containing the complete document. Any explanation goes before or after the block, kept brief.
- Design to a premium standard: strong typographic hierarchy, generous spacing, tasteful color, subtle shadows and motion. Think Linear, Vercel, Claude.
- Use system font stacks or Google Fonts via <link>. No external JS frameworks.
- Make it responsive by default.
- When the user iterates ("make it darker", "add a pricing section"), return the full updated document again — never a fragment.`

/** Pull the last complete ```html fenced block out of streamed markdown. */
function extractHtml(markdown: string): string | null {
  const matches = [...markdown.matchAll(/```html\s*\n([\s\S]*?)```/g)]
  if (matches.length > 0) return matches[matches.length - 1][1]
  // While streaming, render the still-open block so the preview builds live.
  const open = /```html\s*\n([\s\S]*)$/.exec(markdown)
  return open ? open[1] : null
}

const VIEWPORTS = [
  { key: 'desktop', icon: Monitor, width: '100%', label: 'Desktop' },
  { key: 'tablet', icon: Tablet, width: '768px', label: 'Tablet' },
  { key: 'mobile', icon: Smartphone, width: '390px', label: 'Mobile' },
] as const

const suggestions = [
  'A pricing page with three tiers and a highlighted pro plan',
  'A dark landing hero for an AI productivity app',
  'A dashboard card grid with stats, sparklines, and activity feed',
  'A sign-up form with social login and elegant validation states',
]

export function DesignPanel() {
  const defaultModelSelection = useAuraStore(state => state.defaultModelSelection)
  const setDefaultModelSelection = useAuraStore(state => state.setDefaultModelSelection)
  const [input, setInput] = useState('')
  const [tab, setTab] = useState<'preview' | 'code'>('preview')
  const [viewport, setViewport] = useState<(typeof VIEWPORTS)[number]['key']>('desktop')
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
  } = usePanelSession('design')

  const latestHtml = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i]
      if (message.role !== 'assistant') continue
      const html = extractHtml(message.content)
      if (html) return html
    }
    return null
  }, [messages])

  async function sendDesign(content: string) {
    const trimmed = content.trim()
    if (!trimmed || running) return
    // First turn carries the design operating instructions; follow-ups continue.
    const historyContent = messages.length === 0
      ? `${DESIGN_SYSTEM_HINT}\n\nDesign request:\n${trimmed}`
      : trimmed
    setInput('')
    setTab('preview')
    await send(trimmed, historyContent)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void sendDesign(input)
  }

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/6 px-6 py-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2.5 truncate text-2xl font-semibold tracking-tight text-white">
            <Palette size={22} className="text-aura-300" /> Design
          </h1>
          <p className="mt-1 truncate text-sm text-white/38">Describe an interface — Aura designs it with a live preview you can iterate on.</p>
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

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(340px,420px)_1fr]">
        {/* Conversation column */}
        <div className="flex min-h-0 flex-col border-r border-white/6">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
            {!hasMessages ? (
              <div className="flex min-h-full flex-col items-center justify-center px-2 text-center">
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/12 bg-white/6 text-aura-200"
                  initial={{ opacity: 0, y: 10 }}
                >
                  <Palette size={24} />
                </motion.div>
                <h2 className="mt-5 text-xl font-semibold tracking-tight text-white">What should we design?</h2>
                <div className="mt-6 grid w-full gap-2">
                  {suggestions.map(suggestion => (
                    <button
                      key={suggestion}
                      className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-left text-[13px] leading-5 text-white/55 transition hover:border-aura-400/40 hover:bg-aura-500/10 hover:text-white"
                      onClick={() => void sendDesign(suggestion)}
                      type="button"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map(message => (
                  <DesignMessage key={message.id} message={message} />
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

          <form className="shrink-0 p-4 pt-0" onSubmit={onSubmit}>
            <div className="flex items-end gap-2 rounded-2xl border border-white/12 bg-white/[0.05] p-1.5 backdrop-blur-2xl focus-within:border-aura-400/40">
              <textarea
                className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/25"
                onChange={event => setInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void sendDesign(input)
                  }
                }}
                placeholder={hasMessages ? 'Iterate: “make it warmer”, “add a footer”…' : 'Describe the interface…'}
                rows={1}
                value={input}
              />
              {running ? (
                <button
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white transition hover:bg-white/15"
                  onClick={() => void abortRef.current?.()}
                  title="Stop"
                  type="button"
                >
                  <Square size={13} />
                </button>
              ) : (
                <button
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-surface-0 transition enabled:hover:scale-105 disabled:opacity-30"
                  disabled={!input.trim()}
                  title="Send"
                  type="submit"
                >
                  <ArrowUp size={15} />
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Preview column */}
        <div className="flex min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/6 px-4 py-2.5">
            <div className="flex items-center gap-1 rounded-xl bg-white/[0.05] p-1">
              <button
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition',
                  tab === 'preview' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
                )}
                onClick={() => setTab('preview')}
                type="button"
              >
                <Eye size={12} /> Preview
              </button>
              <button
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition',
                  tab === 'code' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
                )}
                onClick={() => setTab('code')}
                type="button"
              >
                <Code2 size={12} /> Code
              </button>
            </div>
            <div className="flex items-center gap-1">
              {VIEWPORTS.map(vp => {
                const Icon = vp.icon
                return (
                  <button
                    key={vp.key}
                    className={cn(
                      'rounded-lg p-2 transition',
                      viewport === vp.key ? 'bg-white/10 text-white' : 'text-white/35 hover:text-white/70'
                    )}
                    onClick={() => setViewport(vp.key)}
                    title={vp.label}
                    type="button"
                  >
                    <Icon size={14} />
                  </button>
                )
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto bg-black/25 p-4">
            {latestHtml ? (
              tab === 'preview' ? (
                <div
                  className="mx-auto h-full overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl shadow-black/40 transition-all duration-300"
                  style={{ width: VIEWPORTS.find(v => v.key === viewport)!.width, maxWidth: '100%' }}
                >
                  <iframe
                    className="h-full w-full border-0"
                    sandbox="allow-scripts"
                    srcDoc={latestHtml}
                    title="Design preview"
                  />
                </div>
              ) : (
                <pre className="min-h-full whitespace-pre-wrap rounded-2xl border border-white/8 bg-black/30 p-5 font-mono text-[12px] leading-5 text-white/70">
                  {latestHtml}
                </pre>
              )
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                {running ? (
                  <>
                    <Loader2 size={28} className="animate-spin text-aura-300" />
                    <p className="mt-4 text-sm text-white/40">Designing…</p>
                  </>
                ) : (
                  <>
                    <div className="rounded-3xl bg-white/6 p-5 text-white/25"><Monitor size={30} /></div>
                    <p className="mt-4 max-w-xs text-sm leading-6 text-white/35">
                      The live preview appears here as Aura designs. Switch to Code to copy the source.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function DesignMessage({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  // Keep the thread scannable: hide the big html block, keep surrounding prose.
  const prose = useMemo(
    () => (isUser ? message.content : message.content.replace(/```html[\s\S]*?(```|$)/g, '').trim()),
    [isUser, message.content]
  )

  if (isUser) {
    return (
      <div className="ml-8 rounded-2xl bg-white px-4 py-2.5 text-[13px] leading-6 text-surface-0 shadow-lg shadow-black/15">
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    )
  }

  return (
    <div className="mr-8 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-[13px] leading-6 text-white/80 backdrop-blur-xl">
      {message.error ? (
        <div className="text-red-200">{message.error}</div>
      ) : message.isStreaming ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 size={13} className="animate-spin text-aura-300" />
          {extractHtml(message.content) ? 'Building the design…' : 'Thinking about the design…'}
        </div>
      ) : prose ? (
        <MarkdownRenderer content={prose} />
      ) : (
        <span className="text-white/45">Design updated — see the preview.</span>
      )}
      {!message.isStreaming && message.model && (
        <div className="mt-2 border-t border-white/6 pt-1.5 font-mono text-[10px] text-white/25">{message.model}</div>
      )}
    </div>
  )
}
