import { motion, AnimatePresence } from 'framer-motion'
import { Bot, ChevronDown, UserRound, Check, Loader2, Minus } from 'lucide-react'
import { memo, useState, useMemo } from 'react'
import type { Message, PipelineStep } from '@/types'
import { cn } from '@/utils/cn'
import { useAuraStore } from '@/store'
import { MarkdownRenderer } from './MarkdownRenderer'

const STAGE_LABELS: Record<string, string> = {
  intent: 'Intent Analysis',
  context: 'Context Retrieval',
  memory: 'Memory Retrieval',
  planning: 'Planning',
  tools: 'Tool Selection',
  execution: 'Execution',
  review: 'Self-Review',
  response: 'Final Response',
}

function PipelineIndicator({ steps }: { steps: PipelineStep[] }) {
  const [expanded, setExpanded] = useState(false)

  // Memoize expensive calculations
  const activeStep = useMemo(() => steps.find(s => s.status === 'active'), [steps]);
  const completedCount = useMemo(() => steps.filter(s => s.status === 'complete').length, [steps]);
  const totalSteps = useMemo(() => steps.filter(s => s.status !== 'skipped').length, [steps]);

  return (
    <div className="mb-3">
      <button
        className="flex items-center gap-2 text-xs text-white/45 transition hover:text-white/70"
        onClick={() => setExpanded(e => !e)}
        type="button"
      >
        {activeStep ? (
          <Loader2 size={12} className="animate-spin text-aura-300" />
        ) : (
          <Check size={12} className="text-emerald-400" />
        )}
        <span className="font-medium">
          {activeStep ? (activeStep.stage !== undefined ? STAGE_LABELS[activeStep.stage] ?? activeStep.stage : 'Unknown') : `Pipeline complete (${completedCount}/${totalSteps})`}
        </span>
        <ChevronDown size={11} className={cn('transition-transform', expanded && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-1">

              {steps.map((step, i) => {
                const stageLabel = step.stage ? STAGE_LABELS[step.stage] ?? step.stage : 'Unknown';
                return (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    {step.status === 'complete' && <Check size={10} className="text-emerald-400" />}
                    {step.status === 'active' && <Loader2 size={10} className="animate-spin text-aura-300" />}
                    {step.status === 'pending' && <div className="h-2 w-2 rounded-full border border-white/20" />}
                    {step.status === 'skipped' && <Minus size={10} className="text-white/20" />}
                    <span className={cn(
                      step.status === 'complete' && 'text-white/60',
                      step.status === 'active' && 'text-aura-200',
                      step.status === 'pending' && 'text-white/30',
                      step.status === 'skipped' && 'text-white/15 line-through',
                    )}>
                      {stageLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// memo: during streaming the store updates ~30x/sec — only the streaming
// bubble should re-render, not every message in the conversation.
export const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  // The detailed pipeline indicator ("Pipeline complete (7/7)") is developer
  // tooling — normal users get the clean answer, not the internal trace.
  const developerMode = useAuraStore(state => state.preferences.developerMode)
  const showPipelineTrace = developerMode

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex gap-4 px-4', isUser ? 'justify-end' : 'justify-start')}
      initial={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.2 }}
    >
      {!isUser && (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-aura-500 to-fuchsia-500 shadow-lg shadow-aura-950/30">
          <Bot size={18} />
        </div>
      )}
      <div
        className={cn(
          'max-w-[min(760px,calc(100vw-260px))] rounded-3xl px-5 py-4 text-[15px] leading-7 shadow-xl',
          isUser
            ? 'bg-white text-surface-0 shadow-black/20'
            : 'border border-white/10 bg-white/[0.065] text-white/82 shadow-black/20 backdrop-blur-2xl'
        )}
      >
        {message.error ? (
          <div className="text-red-200">
            {message.error.includes('Failed to fetch')
              ? 'Unable to connect to AI service. Please check your internet connection and try again.'
              : message.error.includes('timeout')
                ? 'The request took too long to complete. Please try again with a simpler query.'
                : message.error}
          </div>
        ) : isUser ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : message.content ? (
          <>
            {showPipelineTrace && message.pipeline && message.pipeline.length > 0 && (
              <PipelineIndicator steps={message.pipeline} />
            )}
            <MarkdownRenderer content={message.content} />
            {!message.isStreaming && message.model && (
              <div className="mt-2 border-t border-white/6 pt-1.5 font-mono text-[10px] text-white/25">
                {message.model}
              </div>
            )}
          </>
        ) : (
          <>
            {showPipelineTrace && message.pipeline && message.pipeline.length > 0 && (
              <PipelineIndicator steps={message.pipeline} />
            )}
            <div className="flex items-center gap-2 text-white/45">
              <span className="h-2 w-2 animate-thinking rounded-full bg-aura-300" />
              <span className="h-2 w-2 animate-thinking rounded-full bg-fuchsia-300 [animation-delay:120ms]" />
              <span className="h-2 w-2 animate-thinking rounded-full bg-pink-300 [animation-delay:240ms]" />
              <span className="ml-2 text-sm">Aura is thinking…</span>
            </div>
          </>
        )}
        {message.isStreaming && message.content && (
          <span className="ml-1 inline-block h-4 w-1 animate-pulse rounded-full bg-aura-300 align-middle" />
        )}
      </div>
      {isUser && (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white/70">
          <UserRound size={18} />
        </div>
      )}
    </motion.div>
  )
})