import type { ChatEventPayload, ChatStartOptions, Message, PipelineStep } from '@/types'

/** Lightweight UI activity for tool execution — NOT a chat message. Tool
 *  calls/results stay in model context; this is only for clean progress
 *  indicators ("Inspecting project files…", "Searching the web…"). */
export interface AgentActivity {
  type: 'tool_start' | 'tool_complete' | 'tool_error'
  tool: string
  label?: string
}

interface StreamCallbacks {
  onToken: (token: string) => void
  onThinking?: (thinking: string) => void
  onDone: (fullResponse: string, payload?: ChatEventPayload) => void
  onError: (error: Error) => void
  onAbort?: () => void
  onPipeline?: (steps: PipelineStep[]) => void
  /** A real filesystem tool call was executed (result is the verified JSON). */
  onTool?: (name: string, args: Record<string, unknown>, result: string) => void
  /** A verified file write happened — open the file in the live editor. */
  onFileOpened?: (path: string, content: string, before?: string) => void
  /** Clean tool-activity progress (tool name + friendly label only). */
  onActivity?: (activity: AgentActivity) => void
}

function generateStreamId(): string {
  return `stream_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

export async function streamChat(
  messages: Message[],
  callbacks: StreamCallbacks,
  options?: ChatStartOptions
): Promise<{ streamId: string; abort: () => Promise<void> }> {
  if (!window.aura?.chat) {
    throw new Error('Aura chat bridge is unavailable. Please run the app inside Electron.')
  }

  const streamId = generateStreamId()
  let fullResponse = ''
  const unsubscribers: Array<() => void> = []

  const cleanup = () => {
    for (const unsubscribe of unsubscribers) unsubscribe()
  }

  const onlyThisStream = (payload: ChatEventPayload) => payload.streamId === streamId

  unsubscribers.push(
    window.aura.chat.on('delta', payload => {
      if (!onlyThisStream(payload) || typeof payload.delta !== 'string') return
      fullResponse += payload.delta
      callbacks.onToken(payload.delta)
    })
  )

  unsubscribers.push(
    window.aura.chat.on('thinking', payload => {
      if (!onlyThisStream(payload) || typeof payload.delta !== 'string') return
      callbacks.onThinking?.(payload.delta)
    })
  )

  unsubscribers.push(
    window.aura.chat.on('pipeline', payload => {
      if (!onlyThisStream(payload) || !Array.isArray(payload.pipeline)) return
      callbacks.onPipeline?.(payload.pipeline as PipelineStep[])
    })
  )

  unsubscribers.push(
    window.aura.chat.on('tool', payload => {
      if (!onlyThisStream(payload)) return
      const data = payload as unknown as Record<string, unknown>
      if (typeof data.name !== 'string') return
      callbacks.onTool?.(data.name, (data.args as Record<string, unknown>) ?? {}, String(data.result ?? ''))
    })
  )

  unsubscribers.push(
    window.aura.chat.on('activity', payload => {
      if (!onlyThisStream(payload)) return
      const data = payload as unknown as { type?: string; tool?: string; label?: string }
      if (typeof data.type !== 'string' || typeof data.tool !== 'string') return
      callbacks.onActivity?.({
        type: data.type as AgentActivity['type'],
        tool: data.tool,
        label: typeof data.label === 'string' ? data.label : undefined,
      })
    })
  )

  unsubscribers.push(
    window.aura.chat.on('file-opened', payload => {
      if (!onlyThisStream(payload)) return
      const data = payload as unknown as Record<string, unknown>
      if (typeof data.path === 'string') {
        callbacks.onFileOpened?.(
          data.path,
          typeof data.content === 'string' ? data.content : '',
          typeof data.before === 'string' ? data.before : undefined
        )
      }
    })
  )

  unsubscribers.push(
    window.aura.chat.on('done', payload => {
      if (!onlyThisStream(payload)) return
      cleanup()
      callbacks.onDone(typeof payload.text === 'string' ? payload.text : fullResponse, payload)
    })
  )

  unsubscribers.push(
    window.aura.chat.on('error', payload => {
      if (!onlyThisStream(payload)) return
      cleanup()
      callbacks.onError(new Error(typeof payload.message === 'string' ? payload.message : 'Unknown AI error'))
    })
  )

  unsubscribers.push(
    window.aura.chat.on('aborted', payload => {
      if (!onlyThisStream(payload)) return
      cleanup()
      callbacks.onAbort?.()
    })
  )

  await window.aura.chat.start(streamId, messages, options)

  return {
    streamId,
    abort: async () => {
      cleanup()
      await window.aura?.chat.abort(streamId)
    },
  }
}
