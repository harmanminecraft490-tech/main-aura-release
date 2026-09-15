/**
 * Application-owned task state for autonomous runs.  The model may request a
 * transition through the `agent_task` tool, but it never owns or serializes the
 * UI state itself.
 */
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
    return this.state.tasks
      .filter(task => task.status === 'pending' && task.dependencies.every(dep => this.find(dep)?.status === 'completed'))
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)[0]
      ? clone(this.state.tasks.filter(task => task.status === 'pending' && task.dependencies.every(dep => this.find(dep)?.status === 'completed')).sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)[0])
      : undefined
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
    internal.status = 'in_progress'; internal.attempts += 1; internal.startedAt ??= Date.now(); internal.error = undefined
    this.state.activeTaskId = internal.id; this.state.status = 'executing'
    this.emit('task:started', internal)
    return clone(internal)
  }

  completeTask(taskId: string, result?: string): AgentTask {
    const task = this.require(taskId)
    task.status = 'completed'; task.completedAt = Date.now(); task.result = result?.slice(0, 4000) ?? task.result; task.error = undefined
    if (this.state.activeTaskId === taskId) this.state.activeTaskId = undefined
    this.emit('task:completed', task)
    return clone(task)
  }

  failTask(taskId: string, error: string): AgentTask {
    const task = this.require(taskId)
    task.status = 'failed'; task.error = error.slice(0, 2000); this.state.errors.push(task.error)
    if (this.state.activeTaskId === taskId) this.state.activeTaskId = undefined
    this.emit('task:failed', task)
    return clone(task)
  }

  retryTask(taskId: string): AgentTask {
    const task = this.require(taskId)
    if (!['failed', 'blocked'].includes(task.status)) throw new Error('Only failed or blocked tasks can be retried')
    task.status = 'pending'; task.error = undefined
    this.emit('task:retrying', task)
    return clone(task)
  }

  blockTask(taskId: string, error: string): AgentTask {
    const task = this.require(taskId)
    task.status = 'blocked'; task.error = error.slice(0, 2000); this.state.errors.push(task.error)
    if (this.state.activeTaskId === taskId) this.state.activeTaskId = undefined
    this.emit('task:blocked', task)
    return clone(task)
  }

  cancelTask(taskId: string): AgentTask {
    const task = this.require(taskId)
    task.status = 'cancelled'; task.completedAt = Date.now()
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

/** Seed a small, objective-specific execution graph. Discoveries are added as subtasks at runtime. */
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
