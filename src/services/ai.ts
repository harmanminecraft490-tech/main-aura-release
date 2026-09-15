import type { ChatEventPayload, ChatStartOptions, Message, PipelineStep } from '@/types'

export interface AgentTaskState {
  runId: string
  objective: string
  status: 'planning' | 'executing' | 'testing' | 'verifying' | 'completed' | 'blocked' | 'failed' | 'cancelled'
  tasks: Array<{ id: string; title: string; description: string; status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked' | 'cancelled'; priority: number; parentTaskId?: string; dependencies: string[]; attempts: number; result?: string; error?: string; createdAt: number; startedAt?: number; completedAt?: number }>
  activeTaskId?: string
  iteration: number
  progress: { completed: number; total: number }
  filesChanged: string[]
  tests: string[]
  errors: string[]
  startedAt: number
  updatedAt: number
}

export interface AgentActivity { type: 'tool_start' | 'tool_complete' | 'tool_error'; tool: string; label?: string }
interface StreamCallbacks { onToken: (token: string) => void; onThinking?: (thinking: string) => void; onDone: (fullResponse: string, payload?: ChatEventPayload) => void; onError: (error: Error) => void; onAbort?: () => void; onPipeline?: (steps: PipelineStep[]) => void; onTool?: (name: string, args: Record<string, unknown>, result: string) => void; onFileOpened?: (path: string, content: string, before?: string) => void; onActivity?: (activity: AgentActivity) => void }
function generateStreamId(): string { return `stream_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}` }

export async function streamAgent(runId: string, messages: Message[], callbacks: StreamCallbacks & { onState?: (state: AgentTaskState) => void; onEvent?: (event: ChatEventPayload) => void }, options?: ChatStartOptions): Promise<{ runId: string; abort: () => Promise<void> }> {
  if (!window.aura?.agent) throw new Error('Aura Agent bridge is unavailable. Please run the app inside Electron.')
  const unsubscribers: Array<() => void> = []
  const cleanup = () => { for (const unsubscribe of unsubscribers) unsubscribe() }
  const onlyThisRun = (payload: ChatEventPayload) => (payload as unknown as { runId?: string }).runId === runId
  unsubscribers.push(window.aura.agent.on('delta', payload => { if (onlyThisRun(payload) && typeof payload.delta === 'string') callbacks.onToken(payload.delta) }))
  unsubscribers.push(window.aura.agent.on('thinking', payload => { if (onlyThisRun(payload) && typeof payload.delta === 'string') callbacks.onThinking?.(payload.delta) }))
  unsubscribers.push(window.aura.agent.on('state', payload => { if (onlyThisRun(payload)) callbacks.onState?.(payload as unknown as AgentTaskState) }))
  unsubscribers.push(window.aura.agent.on('event', payload => { if (onlyThisRun(payload)) callbacks.onEvent?.(payload) }))
  unsubscribers.push(window.aura.agent.on('activity', payload => { if (!onlyThisRun(payload)) return; const data = payload as unknown as { type?: string; tool?: string; label?: string }; if (typeof data.type === 'string' && typeof data.tool === 'string') callbacks.onActivity?.({ type: data.type as AgentActivity['type'], tool: data.tool, label: data.label }) }))
  unsubscribers.push(window.aura.agent.on('done', payload => { if (!onlyThisRun(payload)) return; cleanup(); callbacks.onDone(typeof payload.text === 'string' ? payload.text : '', payload) }))
  unsubscribers.push(window.aura.agent.on('error', payload => { if (!onlyThisRun(payload)) return; cleanup(); callbacks.onError(new Error(typeof payload.message === 'string' ? payload.message : 'Agent run failed.')) }))
  unsubscribers.push(window.aura.agent.on('aborted', payload => { if (!onlyThisRun(payload)) return; cleanup(); callbacks.onAbort?.() }))
  await window.aura.agent.start(runId, messages, options)
  return { runId, abort: async () => { cleanup(); await window.aura?.agent.abort(runId) } }
}

export async function streamChat(messages: Message[], callbacks: StreamCallbacks, options?: ChatStartOptions): Promise<{ streamId: string; abort: () => Promise<void> }> {
  if (!window.aura?.chat) throw new Error('Aura chat bridge is unavailable. Please run the app inside Electron.')
  const streamId = generateStreamId(); let fullResponse = ''; const unsubscribers: Array<() => void> = []; const cleanup = () => { for (const unsubscribe of unsubscribers) unsubscribe() }; const onlyThisStream = (payload: ChatEventPayload) => payload.streamId === streamId
  unsubscribers.push(window.aura.chat.on('delta', payload => { if (onlyThisStream(payload) && typeof payload.delta === 'string') { fullResponse += payload.delta; callbacks.onToken(payload.delta) } }))
  unsubscribers.push(window.aura.chat.on('thinking', payload => { if (onlyThisStream(payload) && typeof payload.delta === 'string') callbacks.onThinking?.(payload.delta) }))
  unsubscribers.push(window.aura.chat.on('pipeline', payload => { if (onlyThisStream(payload) && Array.isArray(payload.pipeline)) callbacks.onPipeline?.(payload.pipeline as PipelineStep[]) }))
  unsubscribers.push(window.aura.chat.on('tool', payload => { if (!onlyThisStream(payload)) return; const data = payload as unknown as Record<string, unknown>; if (typeof data.name === 'string') callbacks.onTool?.(data.name, (data.args as Record<string, unknown>) ?? {}, String(data.result ?? '')) }))
  unsubscribers.push(window.aura.chat.on('activity', payload => { if (!onlyThisStream(payload)) return; const data = payload as unknown as { type?: string; tool?: string; label?: string }; if (typeof data.type === 'string' && typeof data.tool === 'string') callbacks.onActivity?.({ type: data.type as AgentActivity['type'], tool: data.tool, label: data.label }) }))
  unsubscribers.push(window.aura.chat.on('file-opened', payload => { if (!onlyThisStream(payload)) return; const data = payload as unknown as Record<string, unknown>; if (typeof data.path === 'string') callbacks.onFileOpened?.(data.path, typeof data.content === 'string' ? data.content : '', typeof data.before === 'string' ? data.before : undefined) }))
  unsubscribers.push(window.aura.chat.on('done', payload => { if (!onlyThisStream(payload)) return; cleanup(); callbacks.onDone(typeof payload.text === 'string' ? payload.text : fullResponse, payload) }))
  unsubscribers.push(window.aura.chat.on('error', payload => { if (!onlyThisStream(payload)) return; cleanup(); callbacks.onError(new Error(typeof payload.message === 'string' ? payload.message : 'Unknown AI error')) }))
  unsubscribers.push(window.aura.chat.on('aborted', payload => { if (!onlyThisStream(payload)) return; cleanup(); callbacks.onAbort?.() }))
  await window.aura.chat.start(streamId, messages, options)
  return { streamId, abort: async () => { cleanup(); await window.aura?.chat.abort(streamId) } }
}
