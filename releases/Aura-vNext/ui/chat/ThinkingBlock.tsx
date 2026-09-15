import { useState } from 'react'
import { ChevronDown, Brain } from 'lucide-react'
import { cn } from '../cn'

/**
 * Thinking disclosure. While the message is streaming and has thinking text,
 * it shows a live "Thinking…" state; once streaming ends it collapses to a
 * static, expandable block. Crucially, the spinner is driven purely by
 * `isStreaming` — when the terminal chat event flips that false, the animation
 * stops. No independent timer can leave it spinning forever.
 */
export function ThinkingBlock({ thinking, isStreaming }: { thinking?: string; isStreaming: boolean }) {
  const [open, setOpen] = useState(false)
  const hasThinking = Boolean(thinking && thinking.trim().length > 0)

  if (!hasThinking && !isStreaming) return null

  // Streaming with no thinking yet → minimal live indicator.
  if (isStreaming && !hasThinking) {
    return (
      <div className="mb-2 flex items-center gap-2 text-sm text-white/45">
        <Brain className="h-4 w-4 animate-pulse-soft text-aura-300" />
        <span className="shimmer font-medium">Thinking…</span>
      </div>
    )
  }

  return (
    <div className="mb-2.5 overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.03]">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white/55 transition hover:text-white/80"
        onClick={() => setOpen(o => !o)}
      >
        <Brain className={cn('h-4 w-4 text-aura-300', isStreaming && 'animate-pulse-soft')} />
        <span className={cn('font-medium', isStreaming && 'shimmer')}>
          {isStreaming ? 'Thinking…' : 'Thought process'}
        </span>
        <ChevronDown className={cn('ml-auto h-4 w-4 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="selectable whitespace-pre-wrap border-t border-white/[0.06] px-3 py-2.5 font-mono text-xs leading-6 text-white/55">
          {thinking}
        </div>
      )}
    </div>
  )
}
