import { useCallback, useRef, useState } from 'react'
import { ArrowUp, Square, Paperclip, X, ImageIcon } from 'lucide-react'
import type { Attachment } from '@/domain'
import { cn } from '../cn'

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}

async function toAttachment(file: File): Promise<Attachment> {
  const isImage = file.type.startsWith('image/')
  const base: Attachment = {
    id: uid(),
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    kind: isImage ? 'image' : 'file',
  }
  if (isImage) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    base.data = dataUrl.split(',')[1]
    base.previewUrl = dataUrl
  }
  return base
}

interface Props {
  disabled?: boolean
  isStreaming: boolean
  sendOnEnter: boolean
  onSend: (text: string, attachments: Attachment[]) => void
  onAbort: () => void
}

export function Composer({ disabled, isStreaming, sendOnEnter, onSend, onAbort }: Props) {
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dragging, setDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const grow = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [])

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const next = await Promise.all(Array.from(files).map(toAttachment))
    setAttachments(prev => [...prev, ...next])
  }, [])

  const submit = () => {
    const text = value.trim()
    if ((!text && attachments.length === 0) || isStreaming) return
    onSend(text, attachments)
    setValue('')
    setAttachments([])
    requestAnimationFrame(grow)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      const shouldSend = sendOnEnter ? !event.shiftKey : event.metaKey || event.ctrlKey
      if (shouldSend) {
        event.preventDefault()
        submit()
      }
    }
  }

  const onPaste = (event: React.ClipboardEvent) => {
    const images = Array.from(event.clipboardData.items)
      .filter(item => item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (images.length) {
      event.preventDefault()
      void addFiles(images)
    }
  }

  return (
    <div className="shrink-0 px-4 pb-4 pt-2">
      <div
        className={cn(
          'mx-auto max-w-3xl rounded-3xl border bg-surface-2/70 p-2 backdrop-blur-2xl transition',
          dragging ? 'border-aura-400/60 ring-2 ring-aura-500/30' : 'border-white/10'
        )}
        onDragOver={event => { event.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => {
          event.preventDefault()
          setDragging(false)
          if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files)
        }}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-2 pb-2 pt-1">
            {attachments.map(attachment => (
              <div key={attachment.id} className="group relative flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1.5 text-xs text-white/70">
                {attachment.kind === 'image' && attachment.previewUrl ? (
                  <img src={attachment.previewUrl} alt="" className="h-8 w-8 rounded object-cover" />
                ) : (
                  <ImageIcon className="h-4 w-4 text-white/40" />
                )}
                <span className="max-w-[120px] truncate">{attachment.name}</span>
                <button onClick={() => setAttachments(prev => prev.filter(a => a.id !== attachment.id))}>
                  <X className="h-3.5 w-3.5 text-white/40 hover:text-white" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <button
            className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white/50 transition hover:bg-white/10 hover:text-white"
            onClick={() => fileInputRef.current?.click()}
            title="Attach files"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={event => { if (event.target.files) void addFiles(event.target.files); event.target.value = '' }}
          />

          <textarea
            ref={textareaRef}
            className="max-h-60 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[15px] leading-6 text-white outline-none placeholder:text-white/30"
            placeholder="Message Aura…"
            rows={1}
            value={value}
            disabled={disabled && !isStreaming}
            onChange={event => { setValue(event.target.value); grow() }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />

          {isStreaming ? (
            <button
              className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white transition hover:bg-white/20"
              onClick={onAbort}
              title="Stop generating"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button
              className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-aura-500 text-white shadow-lg shadow-aura-900/50 transition hover:bg-aura-400 disabled:opacity-30"
              onClick={submit}
              disabled={!value.trim() && attachments.length === 0}
              title="Send"
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
      <p className="mt-1.5 text-center text-[11px] text-white/25">
        Aura can make mistakes. {sendOnEnter ? 'Enter to send · Shift+Enter for newline' : 'Ctrl+Enter to send'}
      </p>
    </div>
  )
}
