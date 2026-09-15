import { memo, useState } from 'react'
import { motion } from 'framer-motion'
import { Copy, Check, RefreshCw, Pencil, GitFork, Trash2, AlertTriangle, Gauge } from 'lucide-react'
import type { ChatMessageUI } from '@/domain'
import { useStore } from '@services/store'
import { AURA_MODELS_BY_ID } from '@models/aura-models/definitions'
import { AuraModelIcon } from '../AuraModelIcon'
import { Markdown } from './Markdown'
import { ThinkingBlock } from './ThinkingBlock'
import { cn } from '../cn'

interface Props {
  message: ChatMessageUI
  onRegenerate?: () => void
  onEdit?: (content: string) => void
  onFork?: () => void
  reduceMotion?: boolean
}

export const MessageBubble = memo(function MessageBubble({ message, onRegenerate, onEdit, onFork, reduceMotion }: Props) {
  const developerMode = useStore(state => state.appSettings.developerMode)
  const removeMessage = useStore(state => state.removeMessage)
  const activeId = useStore(state => state.activeConversationId)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)

  const isUser = message.role === 'user'
  const definition = message.auraModelId ? AURA_MODELS_BY_ID.get(message.auraModelId) : undefined

  const copy = () => {
    void navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <motion.div
      className={cn('group flex gap-3.5', isUser ? 'flex-row-reverse' : 'flex-row')}
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* Avatar */}
      {isUser ? (
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-sm font-semibold text-white/70">
          You
        </div>
      ) : (
        <div className="mt-0.5">
          {message.auraModelId ? <AuraModelIcon id={message.auraModelId} /> : (
            <div className="aura-orb flex h-8 w-8 items-center justify-center rounded-xl text-sm">✦</div>
          )}
        </div>
      )}

      <div className={cn('flex min-w-0 max-w-[min(760px,85%)] flex-col', isUser && 'items-end')}>
        {/* Model label */}
        {!isUser && (definition || message.providerName) && (
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-white/40">
            <span className="font-medium text-white/60">{definition?.name ?? 'Aura'}</span>
            {developerMode && message.backendModel && (
              <span className="badge !text-[10px]">{message.backendModel}</span>
            )}
            {developerMode && message.providerName && (
              <span className="badge !text-[10px]">{message.providerName}</span>
            )}
            {developerMode && message.latencyMs != null && (
              <span className="badge !text-[10px]"><Gauge className="h-3 w-3" />{(message.latencyMs / 1000).toFixed(1)}s</span>
            )}
            {developerMode && message.usage && (
              <span className="badge !text-[10px]">{message.usage.totalTokens} tok</span>
            )}
          </div>
        )}

        {/* Thinking */}
        {!isUser && <ThinkingBlock thinking={message.thinking} isStreaming={Boolean(message.isStreaming)} />}

        {/* Bubble body */}
        <div
          className={cn(
            'rounded-2xl px-4 py-3',
            isUser
              ? 'bg-aura-500/18 text-white ring-1 ring-aura-400/25'
              : 'glass'
          )}
        >
          {/* Attachments (images) */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {message.attachments.map(attachment =>
                attachment.kind === 'image' && attachment.previewUrl ? (
                  <img key={attachment.id} src={attachment.previewUrl} alt={attachment.name}
                    className="h-24 w-24 rounded-lg object-cover ring-1 ring-white/10" />
                ) : (
                  <span key={attachment.id} className="badge">{attachment.name}</span>
                )
              )}
            </div>
          )}

          {editing ? (
            <div className="flex flex-col gap-2">
              <textarea
                className="field min-h-[80px] resize-y"
                value={draft}
                onChange={event => setDraft(event.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button className="btn-subtle" onClick={() => { setEditing(false); setDraft(message.content) }}>Cancel</button>
                <button className="btn-primary" onClick={() => { onEdit?.(draft); setEditing(false) }}>Save & submit</button>
              </div>
            </div>
          ) : isUser ? (
            <p className="selectable whitespace-pre-wrap text-[15px] leading-7">{message.content}</p>
          ) : (
            <>
              <Markdown content={message.content} />
              {message.isStreaming && !message.content && !message.thinking && (
                <span className="caret text-white/40" />
              )}
              {message.isStreaming && message.content && <span className="caret" />}
            </>
          )}

          {message.error && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{message.error}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        {!message.isStreaming && !editing && (
          <div className={cn('mt-1.5 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100', isUser && 'flex-row-reverse')}>
            <ActionButton icon={copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />} label="Copy" onClick={copy} />
            {isUser && onEdit && <ActionButton icon={<Pencil className="h-3.5 w-3.5" />} label="Edit" onClick={() => setEditing(true)} />}
            {!isUser && onRegenerate && <ActionButton icon={<RefreshCw className="h-3.5 w-3.5" />} label="Regenerate" onClick={onRegenerate} />}
            {!isUser && onFork && <ActionButton icon={<GitFork className="h-3.5 w-3.5" />} label="Fork" onClick={onFork} />}
            <ActionButton icon={<Trash2 className="h-3.5 w-3.5" />} label="Delete" onClick={() => activeId && removeMessage(activeId, message.id)} />
          </div>
        )}
      </div>
    </motion.div>
  )
})

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-white/45 transition hover:bg-white/[0.08] hover:text-white/80"
      onClick={onClick}
      title={label}
    >
      {icon}
    </button>
  )
}
