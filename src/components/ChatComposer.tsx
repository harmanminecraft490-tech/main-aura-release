import { ArrowUp, Mic, MicOff, Paperclip, Square, Zap, Scale, Brain, ListChecks, Rocket, Flame, FileText, Loader2, RotateCw, X } from 'lucide-react'
import { FormEvent, KeyboardEvent, useRef, useState } from 'react'
import { cn } from '@/utils/cn'
import { useAuraStore } from '@/store'
import type { AIMode, Attachment } from '@/types'

const MODES: { mode: AIMode; icon: React.ElementType; label: string; color: string }[] = [
  { mode: 'auto', icon: Zap, label: 'Auto', color: 'text-aura-400' },
  { mode: 'fast', icon: Zap, label: 'Fast', color: 'text-yellow-400' },
  { mode: 'balanced', icon: Scale, label: 'Balanced', color: 'text-emerald-400' },
  { mode: 'think', icon: Brain, label: 'Think', color: 'text-blue-400' },
  { mode: 'plan', icon: ListChecks, label: 'Plan', color: 'text-teal-400' },
  { mode: 'max', icon: Rocket, label: 'Max', color: 'text-purple-400' },
  { mode: 'bypass', icon: Flame, label: 'Bypass', color: 'text-red-400' },
]

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

function AttachmentChip({ attachment, onRemove, onRetry }: {
  attachment: Attachment
  onRemove: (id: string) => void
  onRetry: (id: string) => void
}) {
  const ready = attachment.status === 'ready'
  const processing = attachment.status === 'processing'
  const error = attachment.status === 'error'

  return (
    <div className={cn(
      'flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs',
      error ? 'border-red-500/30 bg-red-500/8'
        : ready ? 'border-white/10 bg-white/[0.04]'
        : 'border-white/10 bg-white/[0.04]'
    )}>
      <FileText size={14} className={cn(error ? 'text-red-400' : 'text-aura-300')} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="max-w-[160px] truncate font-medium text-white/85">{attachment.name}</span>
          {attachment.ext && <span className="rounded bg-white/8 px-1 py-px text-[9px] uppercase text-white/40">{attachment.ext}</span>}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-white/40">
          <span>{formatBytes(attachment.size)}</span>
          {ready && attachment.parser && <span>· {attachment.parser}</span>}
          {ready && typeof attachment.pages === 'number' && <span>· {attachment.pages}p</span>}
          {ready && typeof attachment.lines === 'number' && <span>· {attachment.lines} lines</span>}
          {ready && typeof attachment.words === 'number' && <span>· {attachment.words} words</span>}
          {ready && attachment.indexed && <span className="text-emerald-400/80">· indexed</span>}
          {processing && <span className="flex items-center gap-1 text-aura-300/80"><Loader2 size={9} className="animate-spin" /> processing</span>}
          {error && <span className="max-w-[180px] truncate text-red-400">· {attachment.error ?? 'failed'}</span>}
        </div>
      </div>
      <div className="ml-1 flex items-center gap-0.5">
        {error && (
          <button
            className="rounded-md p-1 text-white/35 transition hover:bg-white/8 hover:text-white"
            onClick={() => onRetry(attachment.id)}
            title="Retry"
            type="button"
          >
            <RotateCw size={12} />
          </button>
        )}
        <button
          className="rounded-md p-1 text-white/35 transition hover:bg-red-500/15 hover:text-red-400"
          onClick={() => onRemove(attachment.id)}
          title={processing ? 'Cancel upload' : 'Remove'}
          type="button"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}

export function ChatComposer({ disabled, isStreaming, onAbort, onSend }: {
  disabled?: boolean
  isStreaming: boolean
  onAbort: () => void
  onSend: (message: string | { text: string; attachments: Attachment[] }) => void
}) {
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pathByAttachment = useRef<Map<string, string>>(new Map())
  const attachCounter = useRef(0)

  const aiMode = useAuraStore(state => state.aiMode)
  const setAIMode = useAuraStore(state => state.setAIMode)
  const voiceListening = useAuraStore(state => state.voiceListening)
  const setVoiceListening = useAuraStore(state => state.setVoiceListening)

  async function processFile(file: File) {
    const tempId = `local_${Date.now().toString(36)}_${attachCounter.current++}`
    setAttachments(prev => [...prev, {
      id: tempId,
      name: file.name,
      type: file.type || 'application/octet-stream',
      ext: file.name.split('.').pop()?.toLowerCase() ?? '',
      size: file.size,
      status: 'processing',
    }])

    const filePath = window.aura?.files.getPath(file)
    if (!filePath) {
      setAttachments(prev => prev.map(a => a.id === tempId ? { ...a, status: 'error', error: 'Cannot resolve file path' } : a))
      return
    }
    pathByAttachment.current.set(tempId, filePath)

    try {
      const [result] = await window.aura!.attachments.add([filePath])
      setAttachments(prev => prev.map(a => a.id === tempId
        ? (result ? { ...a, ...result, id: result.id } : { ...a, status: 'error', error: 'Processing failed' })
        : a))
      if (result && result.id !== tempId) {
        pathByAttachment.current.set(result.id, filePath)
        pathByAttachment.current.delete(tempId)
      }
    } catch {
      setAttachments(prev => prev.map(a => a.id === tempId ? { ...a, status: 'error', error: 'Upload failed' } : a))
    }
  }

  function handleFiles(files: FileList | File[] | null) {
    if (!files || files.length === 0) return
    for (const file of Array.from(files)) {
      void processFile(file)
    }
  }

  function removeAttachment(id: string) {
    setAttachments(prev => prev.filter(a => a.id !== id))
    pathByAttachment.current.delete(id)
    if (!id.startsWith('local_')) {
      window.aura?.attachments.remove(id).catch(() => {})
    }
  }

  async function retryAttachment(id: string) {
    const filePath = pathByAttachment.current.get(id)
    if (!filePath) return
    setAttachments(prev => prev.map(a => a.id === id ? { ...a, status: 'processing', error: undefined } : a))
    try {
      const [result] = await window.aura!.attachments.add([filePath])
      setAttachments(prev => prev.map(a => a.id === id
        ? (result ? { ...a, ...result, id: result.id } : { ...a, status: 'error', error: 'Processing failed' })
        : a))
      if (result && result.id !== id) {
        pathByAttachment.current.set(result.id, filePath)
        pathByAttachment.current.delete(id)
      }
    } catch {
      setAttachments(prev => prev.map(a => a.id === id ? { ...a, status: 'error', error: 'Upload failed' } : a))
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    const trimmed = value.trim()
    const ready = attachments.filter(a => a.status === 'ready')
    if (!trimmed && ready.length === 0) return

    onSend(ready.length > 0 ? { text: trimmed, attachments: ready } : trimmed)
    setAttachments([])
    setValue('')
    pathByAttachment.current.clear()
    if (textareaRef.current) textareaRef.current.style.height = '48px'
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  function switchMode(mode: AIMode) {
    setAIMode(mode)
    window.aura?.ai.setConfig({ aiMode: mode }).catch(() => {})
  }

  function toggleVoice() {
    setVoiceListening(!voiceListening)
  }

  const canSend = Boolean(value.trim()) || attachments.some(a => a.status === 'ready')

  return (
    <form
      className={cn('mx-auto w-full max-w-4xl px-4 pb-5', isDragging && 'relative')}
      onSubmit={submit}
    >
      <input
        ref={fileInputRef}
        className="hidden"
        multiple
        onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
        type="file"
      />
      {isDragging && (
        <div className="pointer-events-none absolute inset-x-4 top-0 bottom-0 z-10 flex items-center justify-center rounded-3xl border-2 border-dashed border-aura-400/60 bg-aura-500/10 backdrop-blur-sm">
          <p className="text-sm font-medium text-aura-300">Drop files to attach — Aura will read them automatically</p>
        </div>
      )}
      <div
        className="rounded-3xl border border-white/12 bg-surface-1/90 p-2 shadow-2xl shadow-black/40 backdrop-blur-3xl"
        onDragEnter={() => setIsDragging(true)}
        onDragLeave={e => { if (e.currentTarget === e.target) setIsDragging(false) }}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files) }}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pb-2 pt-1">
            {attachments.map(attachment => (
              <AttachmentChip
                key={attachment.id}
                attachment={attachment}
                onRemove={removeAttachment}
                onRetry={retryAttachment}
              />
            ))}
          </div>
        )}
        <div className="flex items-start">
          <textarea
            className="max-h-44 min-h-12 w-full resize-none bg-transparent px-4 py-3 text-[15px] leading-7 text-white outline-none placeholder:text-white/28"
            disabled={disabled}
            onChange={event => {
              setValue(event.target.value)
              event.target.style.height = '48px'
              event.target.style.height = `${Math.min(event.target.scrollHeight, 176)}px`
            }}
            onKeyDown={onKeyDown}
            placeholder="Ask Aura anything — attach files and ask about them…"
            ref={textareaRef}
            rows={1}
            value={value}
          />
        </div>
        <div className="flex items-end w-full pt-1">
          <div className="flex items-center gap-1 px-3 pb-1.5 pt-0.5">
            {MODES.map(({ mode, icon: Icon, label, color }) => {
              const active = aiMode === mode || (!aiMode && mode === 'auto')
              return (
                <button
                  key={mode}
                  className={cn(
                    'flex items-center gap-1 rounded-xl px-2.5 py-1 text-[11px] font-medium transition',
                    active
                      ? cn('bg-white/10', color)
                      : 'text-white/30 hover:bg-white/6 hover:text-white/60'
                  )}
                  onClick={() => switchMode(mode)}
                  title={label}
                  type="button"
                >
                  <Icon size={11} />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center justify-between w-full px-2 pb-1">
            <div className="flex items-center gap-1">
              <button
                className="rounded-xl p-2 text-white/35 transition hover:bg-white/8 hover:text-white/75"
                onClick={() => fileInputRef.current?.click()}
                title="Attach files"
                type="button"
              >
                <Paperclip size={18} />
              </button>
              <button
                className={cn(
                  'rounded-xl p-2 transition',
                  voiceListening
                    ? 'bg-red-500/20 text-red-400'
                    : 'text-white/35 hover:bg-white/8 hover:text-white/75'
                )}
                onClick={toggleVoice}
                title={voiceListening ? 'Stop voice input' : 'Voice input'}
                type="button"
              >
                {voiceListening ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
              <div className="ml-2 hidden text-xs text-white/28 sm:block">Enter to send · Shift Enter for newline · drop files to attach</div>
            </div>
            {isStreaming ? (
              <button
                className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/12 text-white transition hover:bg-white/18"
                onClick={onAbort}
                type="button"
              >
                <Square size={15} fill="currentColor" />
              </button>
            ) : (
              <button
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-2xl transition',
                  canSend && !disabled
                    ? 'bg-white text-surface-0 hover:scale-105'
                    : 'bg-white/8 text-white/28'
                )}
                disabled={!canSend || disabled}
                type="submit"
              >
                <ArrowUp size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  )
}
