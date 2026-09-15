/**
 * Application-owned task state for autonomous runs. The model may request a
 * transition through the agent_task tool, but it never owns or serializes the
 * UI state itself.
 */
import { BrowserWindow, ipcMain } from 'electron'
import { AURA_SYSTEM_PROMPT } from './auraPrompt'
import { getActiveProfile, listProfiles, resolveProfileForTask, detectTaskType, type APIProfile } from './aiConfig'
import { profileToConfig, streamCompletion } from './providers'
import { AURA_MODEL_IDENTITY, isAuraManagedProfile } from './auraProviderRouter'
import { workspaceManager } from './workspace/workspaceManager'
import { executeWorkspaceTool, WORKSPACE_FILE_TOOL } from './workspace/workspaceTools'
import { webSearchManager, WEB_SEARCH_TOOL, READ_PAGE_TOOL, WEB_RESEARCH_TOOL, formatSearchResults, formatPageContent, formatResearchResult } from './capabilities/webSearch'
import { sanitizeProviderError } from './toolCallNormalizer'

export type AgentTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked' | 'cancelled'
export type AgentRunStatus = 'planning' | 'executing' | 'testing' | 'verifying' | 'completed' | 'blocked' | 'failed' | 'cancelled'

export interface AgentTask {
  id: string
  title: string
  description: string
  status: AgentTaskStatus
  priority: number
  parentTaskId?: string
  dependencies: string[]
  attempts: number
  result?: string
  error?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
}

export interface AgentTaskState {
  runId: string
  objective: string
  status: AgentRunStatus
  tasks: AgentTask[]
  activeTaskId?: string
  iteration: number
  progress: { completed: number; total: number }
  filesChanged: string[]
  tests: string[]
  errors: string[]
  startedAt: number
  updatedAt: number
}

export type AgentTaskEvent =
  | 'agent:started' | 'agent:planning' | 'task:created' | 'task:started'
  | 'task:updated' | 'task:completed' | 'task:failed' | 'task:retrying'
  | 'task:blocked' | 'task:cancelled' | 'verification:started'
  | 'verification:passed' | 'verification:failed' | 'agent:completed'

export type AgentTaskListener = (event: AgentTaskEvent, state: AgentTaskState, task?: AgentTask) => void

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }

export class AgentTaskManager {
  private state: AgentTaskState
  private listeners = new Set<AgentTaskListener>()

  constructor(objective: string, runId = id('agent')) {
    const now = Date.now()
    this.state = {
      runId, objective, status: 'planning', tasks: [], iteration: 0,
      progress: { completed: 0, total: 0 }, filesChanged: [], tests: [], errors: [],
      startedAt: now, updatedAt: now,
    }
  }

  subscribe(listener: AgentTaskListener): () => void {
    this.listeners.add(listener)
    listener('agent:started', this.snapshot())
    return () => this.listeners.delete(listener)
  }

  snapshot(): AgentTaskState { return clone(this.state) }

  private emit(event: AgentTaskEvent, task?: AgentTask) {
    this.state.updatedAt = Date.now()
    this.state.progress = {
      completed: this.state.tasks.filter(item => item.status === 'completed').length,
      total: this.state.tasks.length,
    }
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(event, snapshot, task ? clone(task) : undefined)
  }

  setRunStatus(status: AgentRunStatus): void {
    this.state.status = status
    this.emit(status === 'planning' ? 'agent:planning' : status === 'completed' ? 'agent:completed' : 'task:updated')
  }

  createTask(input: Pick<AgentTask, 'title' | 'description'> & Partial<Pick<AgentTask, 'priority' | 'parentTaskId' | 'dependencies'>>): AgentTask {
    const task: AgentTask = {
      id: id('task'), title: input.title.trim().slice(0, 160) || 'Untitled task',
      description: input.description.trim().slice(0, 1200), status: 'pending',
      priority: Math.max(0, Math.min(100, input.priority ?? 50)), parentTaskId: input.parentTaskId,
      dependencies: [...new Set(input.dependencies ?? [])], attempts: 0, createdAt: Date.now(),
    }
    this.state.tasks.push(task)
    this.emit('task:created', task)
    return clone(task)
  }

  createSubtask(parentTaskId: string, input: Pick<AgentTask, 'title' | 'description'> & Partial<Pick<AgentTask, 'priority' | 'dependencies'>>): AgentTask {
    if (!this.find(parentTaskId)) throw new Error('Parent task does not exist')
    return this.createTask({ ...input, parentTaskId })
  }

  updateTask(taskId: string, patch: Partial<Pick<AgentTask, 'title' | 'description' | 'priority' | 'dependencies' | 'result' | 'error'>>): AgentTask {
    const task = this.require(taskId)
    if (patch.title !== undefined) task.title = patch.title.trim().slice(0, 160) || task.title
    if (patch.description !== undefined) task.description = patch.description.trim().slice(0, 1200)
    if (patch.priority !== undefined) task.priority = Math.max(0, Math.min(100, patch.priority))
    if (patch.dependencies !== undefined) task.dependencies = [...new Set(patch.dependencies)]
    if (patch.result !== undefined) task.result = patch.result.slice(0, 4000)
    if (patch.error !== undefined) task.error = patch.error.slice(0, 2000)
    this.emit('task:updated', task)
    return clone(task)
  }

  nextExecutable(): AgentTask | undefined {
    const executable = this.state.tasks
      .filter(task => task.status === 'pending' && task.dependencies.every(dep => this.find(dep)?.status === 'completed'))
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)[0]
    return executable ? clone(executable) : undefined
  }

  startTask(taskId?: string): AgentTask {
    const task = taskId ? this.require(taskId) : this.nextExecutable()
    if (!task) throw new Error('No executable task is available')
    const internal = this.require(task.id)
    if (internal.status !== 'pending') throw new Error('Task is not pending')
    if (!internal.dependencies.every(dep => this.find(dep)?.status === 'completed')) throw new Error('Task dependencies are incomplete')
    if (this.state.activeTaskId && this.state.activeTaskId !== internal.id) {
      const active = this.find(this.state.activeTaskId)
      if (active?.status === 'in_progress') active.status = 'pending'
    }
    internal.status = 'in_progress'
    internal.attempts += 1
    internal.startedAt ??= Date.now()
    internal.error = undefined
    this.state.activeTaskId = internal.id
    this.state.status = 'executing'
    this.emit('task:started', internal)
    return clone(internal)
  }

  completeTask(taskId: string, result?: string): AgentTask {
    const task = this.require(taskId)
    task.status = 'completed'
    task.completedAt = Date.now()
    task.result = result?.slice(0, 4000) ?? task.result
    task.error = undefined
    if (this.state.activeTaskId === taskId) this.state.activeTaskId = undefined
    this.emit('task:completed', task)
    return clone(task)
  }

  failTask(taskId: string, error: string): AgentTask {
    const task = this.require(taskId)
    task.status = 'failed'
    task.error = error.slice(0, 2000)
    this.state.errors.push(task.error)
    if (this.state.activeTaskId === taskId) this.state.activeTaskId = undefined
    this.emit('task:failed', task)
    return clone(task)
  }

  retryTask(taskId: string): AgentTask {
    const task = this.require(taskId)
    if (!['failed', 'blocked'].includes(task.status)) throw new Error('Only failed or blocked tasks can be retried')
    task.status = 'pending'
    task.error = undefined
    this.emit('task:retrying', task)
    return clone(task)
  }

  blockTask(taskId: string, error: string): AgentTask {
    const task = this.require(taskId)
    task.status = 'blocked'
    task.error = error.slice(0, 2000)
    this.state.errors.push(task.error)
    if (this.state.activeTaskId === taskId) this.state.activeTaskId = undefined
    this.emit('task:blocked', task)
    return clone(task)
  }

  cancelTask(taskId: string): AgentTask {
    const task = this.require(taskId)
    task.status = 'cancelled'
    task.completedAt = Date.now()
    if (this.state.activeTaskId === taskId) this.state.activeTaskId = undefined
    this.emit('task:cancelled', task)
    return clone(task)
  }

  reorderTask(taskId: string, priority: number): AgentTask { return this.updateTask(taskId, { priority }) }
  addFile(path: string) { if (path && !this.state.filesChanged.includes(path)) this.state.filesChanged.push(path); this.emit('task:updated') }
  addTest(result: string) { if (result) this.state.tests.push(result.slice(0, 1000)); this.emit('task:updated') }
  incrementIteration() { this.state.iteration += 1; this.emit('task:updated') }
  beginVerification() { this.state.status = 'verifying'; this.emit('verification:started') }
  passVerification() { this.state.status = 'completed'; this.emit('verification:passed') }
  failVerification(error: string) { this.state.status = 'blocked'; this.state.errors.push(error); this.emit('verification:failed') }
  cancelRun() { for (const task of this.state.tasks.filter(t => t.status === 'in_progress' || t.status === 'pending')) task.status = 'cancelled'; this.state.activeTaskId = undefined; this.state.status = 'cancelled'; this.emit('task:cancelled') }

  private find(taskId: string | undefined): AgentTask | undefined { return this.state.tasks.find(task => task.id === taskId) }
  private require(taskId: string): AgentTask { const task = this.find(taskId); if (!task) throw new Error(`Unknown task: ${taskId}`); return task }
}

export function createInitialAgentTasks(manager: AgentTaskManager, objective: string, hasWorkspace: boolean): AgentTask[] {
  const lower = objective.toLowerCase()
  const tasks: AgentTask[] = []
  const inspect = manager.createTask({ title: hasWorkspace ? 'Inspect the relevant workspace' : 'Understand the requested outcome', description: 'Gather only the context needed to act on the objective.', priority: 100 })
  tasks.push(inspect)
  const implement = manager.createTask({ title: /fix|bug|error|debug/.test(lower) ? 'Diagnose and fix the reported issue' : 'Implement the requested changes', description: 'Perform verified changes using the available tools.', priority: 80, dependencies: [inspect.id] })
  tasks.push(implement)
  if (hasWorkspace && /fix|build|implement|create|add|change|update|refactor|test/.test(lower)) {
    tasks.push(manager.createTask({ title: 'Verify the result', description: 'Run the relevant checks and confirm the original objective is addressed.', priority: 60, dependencies: [implement.id] }))
  }
  return tasks
}

type AgentRequest = {
  runId: string
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  options?: { profileId?: string; memoryEnabled?: boolean; attachmentIds?: string[] }
}

type AgentRun = { controller: AbortController; manager: AgentTaskManager }
const activeRuns = new Map<string, AgentRun>()
const completedStates = new Map<string, AgentTaskState>()
const MAX_AGENT_ITERATIONS = 32
const MAX_TASK_ATTEMPTS = 3

const AGENT_TASK_TOOL = {
  type: 'function' as const,
  function: {
    name: 'agent_task',
    description: 'Mutate Aura application-owned task state after real observations. Create dynamic subtasks when discoveries expand scope. Complete tasks only with evidence. The task list is authoritative, not markdown.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'start', 'complete', 'fail', 'retry', 'block', 'update'] },
        taskId: { type: 'string' }, parentTaskId: { type: 'string' }, title: { type: 'string' },
        description: { type: 'string' }, result: { type: 'string' }, error: { type: 'string' },
        priority: { type: 'number' }, dependencies: { type: 'array', items: { type: 'string' } },
      },
      required: ['action'],
    },
  },
}

function send(channel: string, payload: Record<string, unknown>): void {
  const window = BrowserWindow.getAllWindows()[0]
  window?.webContents.send(channel, payload)
}

function taskSummary(state: AgentTaskState): string {
  return state.tasks.map(task => `${task.status === 'completed' ? '✓' : task.status === 'in_progress' ? '●' : '○'} ${task.id} ${task.title} deps=[${task.dependencies.join(',') || 'none'}] result=${(task.result ?? '').slice(0, 300)}`).join('\n')
}

function executionContext(state: AgentTaskState, objective: string): string {
  return [
    `OBJECTIVE: ${objective}`,
    `RUN: ${state.runId} STATUS: ${state.status} ITERATION: ${state.iteration}`,
    `ACTIVE TASK: ${state.activeTaskId ?? 'none'}`,
    `PROGRESS: ${state.progress.completed}/${state.progress.total}`,
    `FILES CHANGED: ${state.filesChanged.slice(-12).join(', ') || 'none'}`,
    `TESTS: ${state.tests.slice(-8).join(' | ') || 'none'}`,
    `ERRORS: ${state.errors.slice(-6).join(' | ') || 'none'}`,
    'TASK GRAPH:', taskSummary(state),
  ].join('\n')
}

function candidateProfiles(objective: string, task: AgentTask, explicitProfileId?: string): APIProfile[] {
  const profiles = listProfiles().filter(profile => profile.enabled)
  const explicit = explicitProfileId ? profiles.find(profile => profile.id === explicitProfileId) : undefined
  const routed = resolveProfileForTask(detectTaskType(`${objective}\n${task.title}`))
  const active = getActiveProfile()
  const ordered: APIProfile[] = []
  for (const profile of [explicit, routed, active, ...profiles]) {
    if (profile && !ordered.some(item => item.id === profile.id)) ordered.push(profile)
  }
  return ordered
}

async function executeAgentTool(manager: AgentTaskManager, runId: string, toolName: string, args: Record<string, unknown>): Promise<string> {
  const toolCallId = id('tool')
  send('agent:event', { runId, event: 'tool:started', toolCallId, toolName })
  send('agent:activity', { runId, type: 'tool_start', tool: toolName, label: toolName === 'workspace_file' ? 'Working with project files…' : toolName === 'web_search' ? 'Searching the web…' : toolName === 'read_webpage' ? 'Reading a page…' : 'Updating task state…' })

  try {
    if (toolName === 'agent_task') {
      const action = String(args.action ?? '')
      if (action === 'create') return JSON.stringify({ success: true, task: manager.createTask({ title: String(args.title ?? 'Discovered task'), description: String(args.description ?? ''), priority: typeof args.priority === 'number' ? args.priority : 50, parentTaskId: typeof args.parentTaskId === 'string' ? args.parentTaskId : undefined, dependencies: Array.isArray(args.dependencies) ? args.dependencies.filter((v): v is string => typeof v === 'string') : undefined }) })
      if (action === 'start') return JSON.stringify({ success: true, task: manager.startTask(typeof args.taskId === 'string' ? args.taskId : undefined) })
      if (action === 'complete') return JSON.stringify({ success: true, task: manager.completeTask(String(args.taskId ?? ''), typeof args.result === 'string' ? args.result : undefined) })
      if (action === 'fail') return JSON.stringify({ success: true, task: manager.failTask(String(args.taskId ?? ''), String(args.error ?? 'Agent reported failure')) })
      if (action === 'retry') return JSON.stringify({ success: true, task: manager.retryTask(String(args.taskId ?? '')) })
      if (action === 'block') return JSON.stringify({ success: true, task: manager.blockTask(String(args.taskId ?? ''), String(args.error ?? 'Blocked')) })
      if (action === 'update') return JSON.stringify({ success: true, task: manager.updateTask(String(args.taskId ?? ''), { title: typeof args.title === 'string' ? args.title : undefined, description: typeof args.description === 'string' ? args.description : undefined, priority: typeof args.priority === 'number' ? args.priority : undefined, dependencies: Array.isArray(args.dependencies) ? args.dependencies.filter((v): v is string => typeof v === 'string') : undefined, result: typeof args.result === 'string' ? args.result : undefined, error: typeof args.error === 'string' ? args.error : undefined }) })
      throw new Error(`Unsupported agent task action: ${action}`)
    }

    if (toolName === 'workspace_file') {
      const result = await executeWorkspaceTool(args)
      try {
        const parsed = JSON.parse(result) as { success?: boolean; path?: string; operation?: string; data?: string }
        if (parsed.success && parsed.path) manager.addFile(parsed.path)
        if (parsed.success && (parsed.operation === 'run' || String(args.action ?? '') === 'run')) manager.addTest(`workspace run succeeded: ${parsed.path ?? String(args.content ?? '').slice(0, 120)}`)
      } catch { /* result is still returned to the model */ }
      return result
    }

    if (toolName === 'web_search') return formatSearchResults(await webSearchManager.search(String(args.query ?? ''), { num: typeof args.num === 'number' ? args.num : 8 }))
    if (toolName === 'read_webpage') return formatPageContent(await webSearchManager.readPage(String(args.url ?? ''), typeof args.max_chars === 'number' ? args.max_chars : 3000))
    if (toolName === 'web_research') return formatResearchResult(await webSearchManager.research(String(args.query ?? ''), {}, { maxSources: typeof args.max_sources === 'number' ? args.max_sources : 4 }))

    throw new Error(`Unknown Agent tool: ${toolName}`)
  } finally {
    send('agent:activity', { runId, type: 'tool_complete', tool: toolName })
    send('agent:event', { runId, event: 'tool:completed', tool: toolName, toolCallId })
  }
}

export function getAgentState(runId: string): AgentTaskState | null {
  return completedStates.get(runId) ?? activeRuns.get(runId)?.manager.snapshot() ?? null
}

export function abortAgentRun(runId: string): void {
  const run = activeRuns.get(runId)
  if (!run) return
  run.controller.abort()
  run.manager.cancelRun()
  completedStates.set(runId, run.manager.snapshot())
  send('agent:aborted', { runId })
  activeRuns.delete(runId)
}

async function runAgent(request: AgentRequest): Promise<void> {
  const { runId, messages, options } = request
  const objective = [...messages].reverse().find(message => message.role === 'user')?.content?.trim() ?? ''
  const controller = activeRuns.get(runId)?.controller
  const manager = activeRuns.get(runId)?.manager
  if (!controller || !manager || !objective) return

  try {
    const hasWorkspace = Boolean(workspaceManager.active)
    createInitialAgentTasks(manager, objective, hasWorkspace)
    manager.setRunStatus('executing')
    send('agent:event', { runId, event: 'agent:planning' })

    let transcript = messages.filter(message => message.role !== 'system').slice(-6).map(message => `${message.role}: ${message.content.slice(0, 1800)}`).join('\n')
    let finalText = ''
    let stagnant = 0

    for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration += 1) {
      if (controller.signal.aborted) throw new Error('Agent run cancelled.')
      manager.incrementIteration()
      let state = manager.snapshot()
      let active = state.activeTaskId ? state.tasks.find(task => task.id === state.activeTaskId) : manager.nextExecutable()

      if (!active) {
        const pending = state.tasks.filter(task => task.status === 'pending')
        if (pending.length > 0) active = manager.startTask(pending[0].id)
      }

      if (!active) {
        const unfinished = state.tasks.filter(task => task.status === 'in_progress' || task.status === 'pending')
        if (unfinished.length === 0) {
          manager.beginVerification()
          const verification = manager.snapshot().tasks.find(task => /verify/i.test(task.title))
          if (verification && verification.status !== 'completed') {
            active = verification.status === 'pending' ? manager.startTask(verification.id) : verification
          } else {
            const allCompleted = manager.snapshot().tasks.every(task => task.status === 'completed')
            if (allCompleted) {
              manager.passVerification()
              break
            }
          }
        }
      }

      if (!active) {
        stagnant += 1
        if (stagnant >= 3) { manager.setRunStatus('blocked'); break }
        continue
      }

      if (active.status === 'pending') active = manager.startTask(active.id)
      state = manager.snapshot()
      const profiles = candidateProfiles(objective, active, options?.profileId)
      let completedThisRound = false
      let turnText = ''
      let lastError: Error | null = null

      for (const profile of profiles.length ? profiles : [undefined]) {
        if (controller.signal.aborted) throw new Error('Agent run cancelled.')
        const attemptId = id('attempt')
        send('agent:event', { runId, event: 'model:selected', attemptId, model: isAuraManagedProfile(profile) ? AURA_MODEL_IDENTITY.modelName : profile?.model ?? 'configured', provider: isAuraManagedProfile(profile) ? 'Aura' : profile?.provider ?? 'configured' })
        if (!profile) { lastError = new Error('No enabled AI profile is available.'); continue }

        const tools = [WORKSPACE_FILE_TOOL, AGENT_TASK_TOOL, ...(webSearchManager.isConnected ? [WEB_SEARCH_TOOL, READ_PAGE_TOOL, WEB_RESEARCH_TOOL] : [])]
        const context = executionContext(state, objective)
        const prompt = [
          'AURA AGENT EXECUTION — DO REAL WORK NOW.',
          'The application owns the task state. Markdown checklists are NOT task state.',
          'Never say you performed an action unless a real tool returned success:true.',
          'For routine requested work, execute without asking permission.',
          'Use agent_task to create dynamic subtasks when discovery requires them.',
          'Use agent_task complete only after real evidence. If output is cut by a model limit, continue the same task next iteration.',
          context,
          `CURRENT TASK: ${active.id}\nTITLE: ${active.title}\nDESCRIPTION: ${active.description}`,
          `RECENT RUN TRANSCRIPT:\n${transcript.slice(-9000)}`,
        ].join('\n\n')

        try {
          await new Promise<void>((resolve, reject) => {
            streamCompletion(
              profileToConfig(profile, 'max'),
              [{ role: 'user', content: prompt }],
              `${AURA_SYSTEM_PROMPT}\n\nAGENT MODE: Execute tools, observe results, mutate application-owned tasks, test, recover, and verify. A normal text response never proves completion.`,
              controller.signal,
              {
                onToken: token => { turnText += token; finalText += token; send('agent:delta', { runId, delta: token }) },
                onThinking: thinking => send('agent:thinking', { runId, delta: thinking }),
                onTool: (name, args, result) => send('agent:event', { runId, event: 'tool:observed', tool: name, args, result: result.slice(0, 2000) }),
                onDone: (_text, _model, _usage, finishReason) => {
                  send('agent:event', { runId, event: 'stream:ended', finishReason: finishReason ?? 'unknown', taskId: active?.id, outputChars: turnText.length })
                  if (finishReason === 'length') send('agent:event', { runId, event: 'agent:continued_after_length', taskId: active?.id })
                  resolve()
                },
                onError: error => reject(error),
                onAbort: () => reject(new Error('Agent run cancelled.')),
              },
              { profile, hasMemory: false, stableSystem: AURA_SYSTEM_PROMPT, tools: { enabled: true, executor: (name, args) => executeAgentTool(manager, runId, name, args), extraTools: tools } }
            ).catch(reject)
          })

          const after = manager.snapshot()
          const taskAfter = after.tasks.find(task => task.id === active?.id)
          completedThisRound = taskAfter?.status === 'completed'
          lastError = null
          break
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))
          if (turnText.length > 0) break
          send('agent:event', { runId, event: 'model:fallback', attemptId, error: sanitizeProviderError(lastError).message })
        }
      }

      if (controller.signal.aborted) throw new Error('Agent run cancelled.')
      transcript = `${transcript}\nassistant: ${turnText.slice(-6000)}`.slice(-16000)

      if (lastError) {
        const current = manager.snapshot().tasks.find(task => task.id === active?.id)
        if (current && current.status === 'in_progress') {
          manager.failTask(current.id, sanitizeProviderError(lastError).message)
          if (current.attempts < MAX_TASK_ATTEMPTS) manager.retryTask(current.id)
        }
        stagnant += 1
        continue
      }

      if (completedThisRound) stagnant = 0
      else stagnant += 1

      if (stagnant >= 4) {
        const current = manager.snapshot().tasks.find(task => task.id === active?.id)
        if (current?.status === 'in_progress') {
          manager.failTask(current.id, 'No real task-state transition after repeated execution rounds.')
          if (current.attempts < MAX_TASK_ATTEMPTS) manager.retryTask(current.id)
        }
        stagnant = 0
      }

      state = manager.snapshot()
      const unfinished = state.tasks.some(task => task.status === 'pending' || task.status === 'in_progress')
      if (!unfinished && state.tasks.length > 0) {
        manager.beginVerification()
        if (state.tasks.every(task => task.status === 'completed')) {
          manager.passVerification()
          break
        }
      }
    }

    const finalState = manager.snapshot()
    completedStates.set(runId, finalState)
    if (finalState.status === 'completed') {
      send('agent:event', { runId, event: 'agent:completed', state: finalState })
      send('agent:done', { runId, text: finalText, model: AURA_MODEL_IDENTITY.modelName, state: finalState })
    } else if (finalState.status === 'cancelled') {
      send('agent:aborted', { runId, state: finalState })
    } else {
      send('agent:error', { runId, message: finalState.status === 'blocked' ? 'Agent is blocked and needs a real blocking condition resolved.' : 'Agent did not reach verified completion within the execution budget.', state: finalState })
    }
  } catch (error) {
    if (controller.signal.aborted) {
      manager.cancelRun()
      completedStates.set(runId, manager.snapshot())
      send('agent:aborted', { runId, state: manager.snapshot() })
    } else {
      manager.setRunStatus('failed')
      completedStates.set(runId, manager.snapshot())
      send('agent:error', { runId, message: sanitizeProviderError(error).message, state: manager.snapshot() })
    }
  } finally {
    activeRuns.delete(runId)
  }
}

function registerAgentIpc(): void {
  try {
    ipcMain.removeHandler('agent:start')
    ipcMain.removeHandler('agent:abort')
    ipcMain.removeHandler('agent:get-state')
  } catch { /* first registration */ }

  ipcMain.handle('agent:start', async (_event, request: AgentRequest) => {
    if (!request?.runId || activeRuns.has(request.runId)) throw new Error('An Agent run is already active for this session.')
    const manager = new AgentTaskManager([...request.messages].reverse().find(message => message.role === 'user')?.content ?? '', request.runId)
    const controller = new AbortController()
    activeRuns.set(request.runId, { controller, manager })
    void runAgent(request)
    return { runId: request.runId }
  })

  ipcMain.handle('agent:abort', (_event, runId: string) => { abortAgentRun(runId); return true })
  ipcMain.handle('agent:get-state', (_event, runId: string) => getAgentState(runId))
}

registerAgentIpc()
