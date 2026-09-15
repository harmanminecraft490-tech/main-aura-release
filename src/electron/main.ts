import { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, dialog, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { AURA_SYSTEM_PROMPT } from './auraPrompt'
import {
  loadConfig,
  repairAccidentalClaudeProfiles,
  lockBuiltInProfiles,
  sanitizeProfile,
  mergeConfig,
  saveConfig,
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  duplicateProfile,
  setDefaultProfile,
  enableProfile,
  getActiveProfile,
  setActiveProfile,
  exportAllProfiles,
  importAllProfiles,
  backupSettings,
  restoreSettings,
  migrateLegacyToProfile,
  migrateAuraManagedProfile,
  listModels,
  addModel,
  updateModel,
  deleteModel,
  toggleModelPin,
  toggleModelFavorite,
  exportModels,
  importModels,
  getRouting,
  setRouting,
  resolveProfileForTask,
  detectTaskType,
  autoSelectProfile,
  getVoiceSettings,
  setVoiceSettings,
  listDevLogs,
  clearDevLogs,
  getDevStats,
  listPlugins,
  installPlugin,
  enablePlugin,
  disablePlugin,
  removePlugin,
  maskKey,
  secureCopyToClipboard,
  ensureEnvLoaded,
} from './aiConfig'
import { getModeAddendum, PROVIDER_PRESETS, streamCompletion, testConnection, profileToConfig } from './providers'
import { getModelCapabilities } from './modelCapabilities'
import { autoCaptureMemories, buildMemoryContext, createMemory, deleteMemory, listMemories, maybeCaptureUserMemory, updateMemory } from './memory'
import { attachmentStore } from './files/attachmentStore'
import { projectManager } from './services/ProjectManager'
import { workspaceManager } from './workspace/workspaceManager'
import { executeWorkspaceTool, WORKSPACE_FILE_TOOL } from './workspace/workspaceTools'
import { previewManager } from './preview/previewManager'
import { perfLog, perfMark, perfSince } from './perf'
import { capabilityManager } from './capabilities/capabilityManager'
import {
  webSearchManager,
  WEB_SEARCH_TOOL,
  READ_PAGE_TOOL,
  WEB_RESEARCH_TOOL,
  formatSearchResults,
  formatPageContent,
  formatResearchResult,
} from './capabilities/webSearch'
import { deriveSearchQuery, sanitizeProviderError } from './toolCallNormalizer'
import { AURA_MODEL_IDENTITY, isAuraManagedProfile } from './auraProviderRouter'
import { loadChats, saveChats } from './conversations'
import { getAccountStatus, getAccountLimits, login as accountLogin, logout as accountLogout, signup as accountSignup } from './accounts'
import {
  resolveEffectiveMode,
  planPhaseSystemAddendum,
  implementPhaseSystemAddendum,
  isMutatingWorkspaceAction,
  type EffectiveAIMode,
} from './modeRouter'
import {
  shouldPromptForTool,
  waitForToolPermission,
  summarizeToolArgs,
  rememberSessionAllow,
  sessionKeyForTool,
  resolveToolPermissionResponse,
  type ToolPermissionDecision,
} from './toolPermissions'
import { AgentTaskManager, createInitialAgentTasks, type AgentTaskState } from './agentTaskManager'

type RendererChatMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

type ChatStartOptions = {
  memoryEnabled?: boolean
  /** Explicit profile picked in the renderer's model picker; wins over keyword routing. */
  profileId?: string
  /** Attachment IDs (from the attachments bridge) whose relevant content should be injected. */
  attachmentIds?: string[]
}

type ChatStartRequest = {
  streamId: string
  messages: RendererChatMessage[]
  options?: ChatStartOptions
}

/**
 * Reads the environment block from ~/.claude/settings.json so that
 * secrets like NEON_DATABASE_URL configured there reach the memory backend.
 * Falls back to an empty object; process.env still takes precedence downstream.
 */
function readSettingsEnv(): Record<string, string | undefined> {
  try {
    const settingsPath = path.join(require('os').homedir(), '.claude', 'settings.json')
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { env?: Record<string, string> }
    return parsed.env ?? {}
  } catch {
    return {}
  }
}

const settingsEnv = readSettingsEnv()
ensureEnvLoaded()
perfMark('module-loaded')

let mainWindow: any | null = null
const activeStreams = new Map<string, AbortController>()
const activeAgentRuns = new Map<string, { controller: AbortController; manager: AgentTaskManager }>()

const AGENT_TASK_TOOL = {
  type: 'function' as const,
  function: {
    name: 'agent_task',
    description: 'Update Aura\'s real Agent task state. Use this after real observations: create a discovered subtask, start a task, complete a verified task, retry a failed task, or block a task with the exact reason. Never claim task completion without evidence.',
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

function getOptionalIconPath() {
  const candidates = [
    path.join(__dirname, '../../public/icon.png'),
    path.join(process.cwd(), 'public/icon.png'),
  ]
  return candidates.find(candidate => fs.existsSync(candidate))
}

function createWindow() {
  const icon = getOptionalIconPath()

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    transparent: true,
    vibrancy: 'under-window',
    backgroundMaterial: 'mica',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    ...(icon ? { icon } : {}),
    show: false,
  })

  // Production / post-build: always load the Vite-built renderer from dist/.
  // Dev with hot reload: set AURA_DEV=1 and run `npm run dev` (Vite on :5173).
  // Legacy override: AURA_LOAD_BUILT=1 also forces the built files.
  const useViteDevServer = !app.isPackaged
    && process.env.AURA_DEV === '1'
    && process.env.AURA_LOAD_BUILT !== '1'

  if (useViteDevServer) {
    void mainWindow.loadURL('http://localhost:5173')
  } else {
    const rendererHtml = path.join(__dirname, '../../renderer/index.html')
    // eslint-disable-next-line no-console
    console.log(`[aura] loading built renderer: ${rendererHtml}`)
    void mainWindow.loadFile(rendererHtml)
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
    perfLog('window ready-to-show (cold start)', perfSince('module-loaded'))
  })

  mainWindow.webContents.once('did-finish-load', () => {
    perfLog('renderer did-finish-load', perfSince('module-loaded'))
  })

  // Surface renderer console errors/warnings in the main-process log so a
  // renderer crash is diagnosable instead of a silent black window.
  mainWindow.webContents.on('console-message', (event: unknown, level: unknown, message: unknown) => {
    const details = typeof level === 'object' && level !== null ? level as { level?: number; message?: string } : null
    const lvl = details ? (details.level ?? 0) : (typeof level === 'number' ? level : 0)
    const msg = details ? (details.message ?? '') : (typeof message === 'string' ? message : '')
    if (lvl >= 2 && msg) console.warn(`[renderer:${lvl}] ${msg}`)
  })

  mainWindow.on('closed', () => {
    for (const controller of activeStreams.values()) controller.abort()
    activeStreams.clear()
    mainWindow = null
  })
}

function sendToRenderer(channel: string, payload: unknown) {
  mainWindow?.webContents.send(channel, payload)
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

/**
 * TRUST RULE enforcement: scan the model's final response for claims of file
 * operations ("I created X", "I saved Y", "I placed the file at Z", "implemented"…)
 * and verify each claimed path against the REAL filesystem. Any claim whose
 * path does not exist is corrected before the user sees it.
 *
 * The model's words are NEVER proof; the filesystem is.
 */
function verifyFileClaims(text: string): { corrections: string[]; note: string } {
  const corrections: string[] = []
  if (!text) return { corrections, note: '' }

  const claimPatterns: RegExp[] = [
    // Windows absolute paths near an action verb.
    /\b(?:created?|saved|wrote|written|implemented|placed?|made|put|edited)\b[^.!?\n]{0,80}?([A-Za-z]:[\\/][^\s`"'.,;)\]}]+)/gi,
    // Relative paths (file.ext / folder/file.ext) near an action verb.
    /\b(?:created?|saved|wrote|written|implemented|placed?|made|put|edited)\b[^.!?\n]{0,80}?([A-Za-z0-9_][\w.-]*(?:[\\/][\w.-]+)*\.\w{1,10})/gi,
  ]

  const seen = new Set<string>()
  for (const pattern of claimPatterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[1]
      if (seen.has(raw) || raw.length > 200) continue
      seen.add(raw)

      let abs: string | null = null
      if (/^[A-Za-z]:[\\/]/.test(raw)) {
        abs = raw
      } else if (workspaceManager.active) {
        abs = workspaceManager.abs(raw)
      }
      if (!abs) continue
      try {
        if (!fs.existsSync(abs)) {
          corrections.push(
            `I said I created/wrote "${raw}", but the file does not exist at ${abs}.`
          )
        }
      } catch {
        corrections.push(`I could not verify the file "${raw}" on disk.`)
      }
    }
  }

  if (corrections.length === 0) return { corrections, note: '' }

  const note = '\n\n> ⚠️ **Correction from Aura:** ' +
    corrections.join(' ') +
    ' The operation did NOT actually happen on disk. I can\'t modify that folder from this Aura session because filesystem write access isn\'t available.'
  return { corrections, note }
}

/**
 * Deterministic file-intent parser — the APP executes explicit file requests
 * even if the model did not emit a tool call. Handles the common phrasings:
 *   "create a simple file named 123"          → write 123 (empty content)
 *   "create a file named test.txt"            → write test.txt
 *   "create folder test" / "create directory" → mkdir test
 *   "create test/a.txt"                       → write test/a.txt (parent dirs)
 *   "write hello world into test.txt"         → write test.txt with content
 *   "create calc.py"                          → write calc.py
 */
function extractFileIntents(text: string): Array<{ op: 'write' | 'mkdir'; path: string; content: string }> {
  const intents: Array<{ op: 'write' | 'mkdir'; path: string; content: string }> = []
  const t = text.trim()
  if (!t) return intents
  const clean = (p: string) => p.replace(/^["'`\\/]+|["'`\\/]+$/g, '').replace(/\\/g, '/').trim()

  // write "<content>" into/to <path>
  const write = /write\s+["'`]([\s\S]+?)["'`]\s+(?:into|to)\s+["'`]?([a-z0-9_][\w./\\-]*)/i.exec(t)
  if (write) {
    const p = clean(write[2])
    if (p) intents.push({ op: 'write', path: p, content: write[1] })
    return intents
  }
  // write <content> into/to <path.ext> (unquoted content)
  const writeBare = /write\s+([\s\S]+?)\s+(?:into|to)\s+["'`]?([a-z0-9_][\w./\\-]*\.[a-z0-9]{1,8})["'`]?$/i.exec(t)
  if (writeBare) {
    const p = clean(writeBare[2])
    if (p) intents.push({ op: 'write', path: p, content: writeBare[1].trim() })
    return intents
  }

  // create/make ... file named X
  const namedFile = /(?:create|make|add)\s+(?:a\s+|new\s+)?(?:simple\s+)?file\s+named\s+["'`]?([a-z0-9_][\w./\\-]*)/i.exec(t)
  if (namedFile) {
    const p = clean(namedFile[1])
    if (p) intents.push({ op: 'write', path: p, content: '' })
    return intents
  }

  // create/make ... folder|directory [named] X
  const folder = /(?:create|make|add)\s+(?:a\s+|new\s+)?(?:folder|directory)\s+(?:named\s+)?["'`]?([a-z0-9_][\w./\\-]*)/i.exec(t)
  if (folder) {
    const p = clean(folder[1])
    if (p) intents.push({ op: 'mkdir', path: p, content: '' })
    return intents
  }

  // create/make ... file X
  const bareFile = /(?:create|make|add)\s+(?:a\s+|new\s+)?(?:simple\s+)?file\s+["'`]?([a-z0-9_][\w./\\-]*)/i.exec(t)
  if (bareFile) {
    const p = clean(bareFile[1])
    if (p) intents.push({ op: 'write', path: p, content: '' })
    return intents
  }

  // create X.ext  (a path with an extension, e.g. "create calc.py", "create test/a.txt")
  const extFile = /(?:create|make|add)\s+["'`]?([a-z0-9_][\w./\\-]*\.[a-z0-9]{1,8})(?:["'`]|\s|$)/i.exec(t)
  if (extFile) {
    const p = clean(extFile[1])
    if (p) intents.push({ op: 'write', path: p, content: '' })
    return intents
  }

  return intents
}

/**
 * Execute parsed file intents against the REAL workspace (verified writes).
 * Runs only when a non-bypass workspace is active and the model did not
 * already perform the write via the workspace_file tool.
 */
async function executeFileIntents(userText: string): Promise<void> {
  if (!workspaceManager.active || workspaceManager.isBypass) return
  const intents = extractFileIntents(userText)
  for (const intent of intents) {
    try {
      const result = await workspaceManager.execute({
        action: intent.op === 'mkdir' ? 'mkdir' : 'write',
        path: intent.path,
        content: intent.content,
        overwrite: true,
      })
      // eslint-disable-next-line no-console
      console.log(`[agent] deterministic ${intent.op} "${intent.path}" → success=${result.success}${result.error ? ` error=${result.error}` : ''} path=${result.path}`)
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[agent] deterministic intent failed:', error instanceof Error ? error.message : error)
    }
  }
}

app.whenReady().then(() => {
  perfLog('app ready', perfSince('module-loaded'))
  migrateLegacyToProfile()
  repairAccidentalClaudeProfiles()
  lockBuiltInProfiles()
  migrateAuraManagedProfile()

  // Re-read env (including SERPER_API_KEY) after app is ready
  webSearchManager.reloadEnv()
  capabilityManager.refresh()

  // Log capability status at startup
  const caps = capabilityManager.all()
  for (const cap of caps) {
    // eslint-disable-next-line no-console
    console.log(`[capability] ${cap.name}: ${cap.connected ? 'connected' : cap.error ?? 'unavailable'}`)
  }

  // Restore the last active project's workspace after restart (rule 17/E).
  const restoredProject = projectManager.getActiveProject()
  if (restoredProject) {
    workspaceManager.activateProject(restoredProject.id)
    capabilityManager.setWorkspaceState(true)
  }
  createWindow()

  globalShortcut.register('CommandOrControl+K', () => {
    mainWindow?.webContents.send('toggle-command-palette')
  })

  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send('theme-updated', nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  for (const controller of activeStreams.values()) controller.abort()
  activeStreams.clear()
  globalShortcut.unregisterAll()
})

ipcMain.handle('window-minimize', () => mainWindow?.minimize())
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.handle('window-close', () => mainWindow?.close())
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized())
ipcMain.handle('shell:open-external', async (_event, url: string) => {
  const target = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(target)) throw new Error('Only http(s) URLs can be opened.')
  await shell.openExternal(target)
  return true
})
ipcMain.handle('get-theme', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))

ipcMain.handle('ai:get-status', () => {
  const config = loadConfig()
  const profile = getActiveProfile()
  const visibleProfile = profile ? sanitizeProfile(profile) : null
  return {
    hasApiKey: Boolean(profile?.apiKey || config.apiKey),
    baseURL: visibleProfile?.baseURL ?? config.baseURL,
    model: visibleProfile?.model ?? config.model,
    provider: visibleProfile?.provider ?? config.provider,
    mode: config.aiMode,
    activeProfileName: visibleProfile?.displayName,
  }
})

ipcMain.handle('ai:get-config', () => loadConfig())
ipcMain.handle('ai:set-config', (_event, partial: Record<string, unknown>) => {
  const current = loadConfig()
  const updated = mergeConfig(current, partial as Partial<typeof current>)
  saveConfig(updated)
  return updated
})
ipcMain.handle('ai:test-connection', async (_event, partial: Record<string, unknown>) => {
  const current = loadConfig()
  const config = mergeConfig(current, partial as Partial<typeof current>)
  return testConnection(config)
})
ipcMain.handle('ai:get-presets', () => PROVIDER_PRESETS)
ipcMain.handle('ai:export-config', () => JSON.stringify(loadConfig(), null, 2))
ipcMain.handle('ai:import-config', (_event, json: string) => {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`Invalid config JSON: ${error instanceof Error ? error.message : 'parse error'}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Config import must be a JSON object.')
  }
  // Only accept keys that belong to AIConfig; drop anything unexpected.
  const allowed: Array<keyof ReturnType<typeof loadConfig>> = [
    'provider', 'apiKey', 'baseURL', 'model', 'organizationId', 'customHeaders',
    'temperature', 'topP', 'maxTokens', 'streaming', 'reasoningEffort',
    'contextLength', 'aiMode', 'savedModels', 'activeProfileId',
  ]
  const source = parsed as Record<string, unknown>
  const clean: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in source) clean[key] = source[key]
  }
  const updated = mergeConfig(loadConfig(), clean as never)
  saveConfig(updated)
})

// Locked (built-in Aura) profiles never expose their base URL or API key to
// the renderer; the main process keeps the real secrets for streaming.
ipcMain.handle('profiles:list', () => listProfiles().map(sanitizeProfile))
ipcMain.handle('profiles:create', (_event, input) => sanitizeProfile(createProfile(input)))
ipcMain.handle('profiles:update', (_event, id: string, updates) => {
  const updated = updateProfile(id, updates)
  return updated ? sanitizeProfile(updated) : null
})
ipcMain.handle('profiles:delete', (_event, id: string) => deleteProfile(id))
ipcMain.handle('profiles:duplicate', (_event, id: string) => {
  const duplicate = duplicateProfile(id)
  return duplicate ? sanitizeProfile(duplicate) : null
})
ipcMain.handle('profiles:set-default', (_event, id: string) => setDefaultProfile(id))
ipcMain.handle('profiles:enable', (_event, id: string, enabled: boolean) => enableProfile(id, enabled))
ipcMain.handle('profiles:get-active', () => {
  const active = getActiveProfile()
  return active ? sanitizeProfile(active) : null
})
ipcMain.handle('profiles:set-active', (_event, id: string) => setActiveProfile(id))
ipcMain.handle('profiles:test-connection', async (_event, profile) => {
  // Locked profiles arrive without apiKey/baseURL (sanitized); resolve the real
  // stored secrets server-side so the connection test still works.
  const stored = listProfiles().find(item => item.id === profile?.id)
  const resolved = stored
    ? { ...profile, apiKey: profile?.apiKey || stored.apiKey, baseURL: profile?.baseURL || stored.baseURL, provider: stored.provider, model: stored.model }
    : profile

  // Aura managed Default Profile: test the active backend chain but never
  // report raw vendor model ids to the renderer.
  if (stored && isAuraManagedProfile(stored)) {
    const result = await testConnection(resolved)
    return {
      ...result,
      model: result.success ? AURA_MODEL_IDENTITY.modelName : result.model,
      error: result.error ? sanitizeProviderError(result.error).message : result.error,
    }
  }

  return testConnection(resolved)
})
ipcMain.handle('profiles:export-all', () => exportAllProfiles())
ipcMain.handle('profiles:import-all', (_event, json: string) => importAllProfiles(json))
ipcMain.handle('profiles:backup', () => backupSettings())
ipcMain.handle('profiles:restore', (_event, json: string) => restoreSettings(json))

ipcMain.handle('routing:get', () => getRouting())
ipcMain.handle('routing:set', (_event, partial) => setRouting(partial))
ipcMain.handle('routing:resolve', (_event, task: string) => resolveProfileForTask(task as Parameters<typeof resolveProfileForTask>[0]))
ipcMain.handle('routing:detect-task', (_event, content: string) => detectTaskType(content))
ipcMain.handle('routing:auto-select', (_event, content: string) => autoSelectProfile(content))

ipcMain.handle('models:list', () => listModels())
ipcMain.handle('models:add', (_event, input) => addModel(input))
ipcMain.handle('models:update', (_event, id: string, updates) => updateModel(id, updates))
ipcMain.handle('models:delete', (_event, id: string) => deleteModel(id))
ipcMain.handle('models:toggle-pin', (_event, id: string) => toggleModelPin(id))
ipcMain.handle('models:toggle-favorite', (_event, id: string) => toggleModelFavorite(id))
ipcMain.handle('models:export-all', () => exportModels())
ipcMain.handle('models:import-all', (_event, json: string) => importModels(json))

ipcMain.handle('devlogs:list', () => listDevLogs())
ipcMain.handle('devlogs:clear', () => clearDevLogs())
ipcMain.handle('devlogs:stats', () => getDevStats())

ipcMain.handle('voice:get-settings', () => getVoiceSettings())
ipcMain.handle('voice:set-settings', (_event, partial) => setVoiceSettings(partial))
ipcMain.handle('voice:get-voices', () => [])

ipcMain.handle('plugins:list', () => listPlugins())
ipcMain.handle('plugins:enable', (_event, id: string) => enablePlugin(id))
ipcMain.handle('plugins:disable', (_event, id: string) => disablePlugin(id))
ipcMain.handle('plugins:remove', (_event, id: string) => removePlugin(id))
ipcMain.handle('plugins:install', (_event, manifest) => installPlugin(manifest))

ipcMain.handle('security:mask-key', (_event, key: string) => maskKey(key))
ipcMain.handle('security:secure-copy', (_event, text: string) => secureCopyToClipboard(text))

ipcMain.handle('projects:list', () => projectManager.list())
ipcMain.handle('projects:create', async (_event, project) => {
  const created = projectManager.create(project)
  // Open the newly created workspace folder in the OS file manager.
  if (created?.settings?.workspace) {
    try {
      await shell.openPath(created.settings.workspace)
    } catch {
      // non-fatal — folder may not exist yet; creation is still valid
    }
  }
  return created
})
ipcMain.handle('projects:update', (_event, id, updates) => projectManager.update(id, updates))
ipcMain.handle('projects:delete', (_event, id) => projectManager.delete(id))
ipcMain.handle('projects:setActive', (_event, id) => {
  projectManager.setActive(id)
  workspaceManager.activateProject(id)
  capabilityManager.setWorkspaceState(true)
  return { activeProjectId: id, workspace: workspaceManager.state() }
})
ipcMain.handle('projects:getActive', () => projectManager.getActiveProject())
ipcMain.handle('projects:pickFolder', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select a folder as the project workspace',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return { canceled: true, path: null }
  return { canceled: false, path: result.filePaths[0] }
})

ipcMain.handle('attachments:add', async (_event, paths: string[]) => attachmentStore.add(Array.isArray(paths) ? paths : []))
ipcMain.handle('attachments:list', () => attachmentStore.list())
ipcMain.handle('attachments:remove', (_event, id: string) => attachmentStore.remove(id))
ipcMain.handle('attachments:clear', () => {
  attachmentStore.clear()
  return true
})

// ── Workspace (real filesystem) API ──────────────────────────────────────────
ipcMain.handle('workspace:state', () => workspaceManager.state())
ipcMain.handle('workspace:execute', async (_event, action: unknown) => {
  const a = (action ?? {}) as Record<string, unknown>
  return workspaceManager.execute({
    action: String(a.action ?? '') as Parameters<typeof workspaceManager.execute>[0]['action'],
    path: String(a.path ?? ''),
    content: typeof a.content === 'string' ? a.content : undefined,
    newPath: typeof a.newPath === 'string' ? a.newPath : undefined,
    overwrite: a.overwrite === false ? false : true,
  })
})
ipcMain.handle('workspace:grant', (_event, ops: string[]) => {
  workspaceManager.grant(ops as Parameters<typeof workspaceManager.grant>[0])
  const state = workspaceManager.state()
  capabilityManager.setRunAuthorized(state.permissions.includes('run'))
  capabilityManager.setWorkspaceState(Boolean(state.root))
  return state
})
ipcMain.handle('workspace:revoke', (_event, op: string) => {
  workspaceManager.revoke(op as Parameters<typeof workspaceManager.revoke>[0])
  const state = workspaceManager.state()
  capabilityManager.setRunAuthorized(state.permissions.includes('run'))
  capabilityManager.setWorkspaceState(Boolean(state.root))
  return state
})
ipcMain.handle('workspace:setCurrentFile', (_event, relPath: string) => {
  workspaceManager.setCurrentFile(relPath)
  return workspaceManager.state()
})
ipcMain.handle('workspace:setCurrentFolder', (_event, relPath: string) => {
  workspaceManager.setCurrentFolder(relPath)
  return workspaceManager.state()
})
ipcMain.handle('workspace:opsLog', () => workspaceManager.opsLog.list())
ipcMain.handle('workspace:opsLogClear', () => {
  workspaceManager.opsLog.clear()
  return true
})
ipcMain.handle('workspace:indexStatus', () => workspaceManager.indexStatus())
ipcMain.handle('workspace:search', (_event, query: string) => workspaceManager.search(String(query ?? ''), 50))

// ── Design preview (dev server for the active project) ───────────────────────
// The renderer drives the lifecycle; previewManager guarantees one server per
// workspace root and reuses an already-running one.
ipcMain.handle('preview:start', async (_event, root: string, opts?: { force?: boolean }) => {
  return previewManager.start(String(root ?? ''), opts)
})
ipcMain.handle('preview:stop', (_event, root: string) => previewManager.stop(String(root ?? '')))
ipcMain.handle('preview:status', (_event, root: string) => previewManager.status(String(root ?? '')))
ipcMain.handle('preview:list', () => previewManager.list())
// Forward preview lifecycle events to the renderer.
previewManager.onEvent(state => sendToRenderer('preview:event', state))
ipcMain.handle('projects:uploadFile', async (_event, { projectId, file }) => {
  return projectManager.uploadFile(projectId, file)
})
ipcMain.handle('projects:deleteFile', async (_event, { projectId, fileId }) => {
  return projectManager.deleteFile(projectId, fileId)
})

// ── Capability API ────────────────────────────────────────────────────────────
ipcMain.handle('capabilities:list', () => capabilityManager.all())
ipcMain.handle('capabilities:configure-search', (_event, provider: string, key: string) => {
  capabilityManager.configureWebSearch(provider as 'serper' | 'brave' | 'tavily', key)
  return capabilityManager.all()
})
ipcMain.handle('capabilities:configure-figma', (_event, token: string) => {
  capabilityManager.updateFigma(token)
  return capabilityManager.all()
})
ipcMain.handle('capabilities:configure-github', (_event, token: string) => {
  capabilityManager.updateGitHub(token)
  return capabilityManager.all()
})
ipcMain.handle('capabilities:configure-mcp', (_event, servers: Array<{ name: string; url: string; enabled: boolean }>) => {
  capabilityManager.updateMcpServers(Array.isArray(servers) ? servers : [])
  return capabilityManager.all()
})
ipcMain.handle('capabilities:refresh', () => {
  webSearchManager.reloadEnv()
  capabilityManager.refresh()
  return capabilityManager.all()
})

// ── Web Search (direct IPC) ───────────────────────────────────────────────────
ipcMain.handle('web:search', async (_event, query: string, opts?: Record<string, unknown>) => {
  if (!webSearchManager.isConnected) {
    return { success: false, query, results: [], provider: 'none', error: webSearchManager.statusMessage, duration: 0 }
  }
  return webSearchManager.search(query, opts as never)
})
ipcMain.handle('web:read-page', async (_event, url: string, maxChars?: number) => {
  return webSearchManager.readPage(url, maxChars ?? 3000)
})
ipcMain.handle('web:search-status', () => ({
  connected: webSearchManager.isConnected,
  provider: webSearchManager.provider,
  message: webSearchManager.statusMessage,
}))

// ─── Chat persistence ─────────────────────────────────────────────────────────
ipcMain.handle('conversations:load', () => loadChats())
ipcMain.handle('conversations:save', async (_event, state: unknown) => {
  const chats = state as Parameters<typeof saveChats>[0]
  await saveChats({
    conversations: Array.isArray(chats?.conversations) ? chats.conversations : [],
    panelSessions: chats?.panelSessions && typeof chats.panelSessions === 'object' ? chats.panelSessions : {},
  })
})

// ─── Per-account login & cloud memory ─────────────────────────────────────────
ipcMain.handle('account:status', () => {
  ensureEnvLoaded()
  return getAccountStatus(settingsEnv)
})
ipcMain.handle('account:signup', async (_event, email: unknown, password: unknown) => {
  ensureEnvLoaded()
  try {
    return await accountSignup(settingsEnv, String(email ?? ''), String(password ?? ''))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Sign up failed.')
  }
})
ipcMain.handle('account:login', async (_event, email: unknown, password: unknown) => {
  ensureEnvLoaded()
  try {
    return await accountLogin(settingsEnv, String(email ?? ''), String(password ?? ''))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Login failed.')
  }
})
ipcMain.handle('account:logout', async () => {
  ensureEnvLoaded()
  return accountLogout()
})

ipcMain.handle('memory:list', async () => listMemories(settingsEnv))
ipcMain.handle('memory:create', async (_event, input) => createMemory(settingsEnv, input))
ipcMain.handle('memory:delete', async (_event, id: string) => deleteMemory(settingsEnv, id))
ipcMain.handle('memory:update', async (_event, id: string, patch: unknown) => {
  // Backward compatible: a bare string is treated as a content-only update.
  const normalized = typeof patch === 'string' ? { content: patch } : (patch as Record<string, unknown>)
  const result = await updateMemory(settingsEnv, id, {
    content: typeof normalized.content === 'string' ? normalized.content : undefined,
    type: normalized.type as never,
    context: typeof normalized.context === 'string' ? normalized.context : undefined,
    relevance: typeof normalized.relevance === 'number' ? normalized.relevance : undefined,
    expiresAt: normalized.expiresAt as number | null | undefined,
  })
  return result.memory
})
ipcMain.handle('memory:export', async () => {
  const { memories } = await listMemories(settingsEnv)
  return JSON.stringify(memories, null, 2)
})
ipcMain.handle('memory:import', async (_event, json: string) => {
  const parsed = JSON.parse(json)
  if (!Array.isArray(parsed)) throw new Error('Invalid memory JSON')
  for (const memory of parsed) {
    if (!memory || typeof memory.content !== 'string') continue
    await createMemory(settingsEnv, {
      type: memory.type,
      content: memory.content,
      context: memory.context,
      relevance: memory.relevance,
      expiresAt: memory.expiresAt ?? null,
    })
  }
})

ipcMain.handle('chat:abort', (_event, streamId: string) => {
  activeStreams.get(streamId)?.abort()
  activeStreams.delete(streamId)
})

ipcMain.handle('chat:tool-permission-response', (_event, payload: unknown) => {
  const data = payload as { requestId?: string; decision?: ToolPermissionDecision }
  if (!data?.requestId || !data.decision) return false
  return resolveToolPermissionResponse(data.requestId, data.decision)
})

/** Friendly, user-visible label for a tool execution (never raw args/results). */
function toolActivityLabel(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'workspace_file': {
      switch (String(args.action ?? '')) {
        case 'list': return 'Inspecting project files…'
        case 'read': return 'Reading a file…'
        case 'write': case 'append': case 'edit': return 'Updating files…'
        case 'delete': case 'rename': case 'move': case 'copy': return 'Managing files…'
        case 'mkdir': return 'Creating a folder…'
        case 'run': return 'Running…'
        case 'stat': return 'Checking a file…'
        default: return 'Working with files…'
      }
    }
    case 'web_search': return 'Searching the web…'
    case 'read_webpage': return 'Reading a page…'
    case 'web_research': return 'Researching…'
    default: return 'Working…'
  }
}

/**
 * Snapshot the current content of a workspace file BEFORE it is overwritten, so
 * the renderer can diff it against the new content. Missing/unreadable files
 * yield '' (a brand-new file). Read-only, never blocks the write.
 */
function readFileBeforeWrite(relPath: string): string {
  try {
    const abs = workspaceManager.abs(String(relPath ?? ''))
    if (!abs) return ''
    if (!fs.existsSync(abs)) return ''
    return fs.readFileSync(abs, 'utf8')
  } catch {
    return ''
  }
}

ipcMain.handle('chat:start', async (_event, request: ChatStartRequest) => {
  const { streamId, messages, options } = request
  const controller = new AbortController()
  activeStreams.set(streamId, controller)

  const limits = getAccountLimits(settingsEnv)
  if (!limits.allowed) {
    sendToRenderer('chat:error', {
      streamId,
      message: limits.reason ?? 'Create an Aura account to continue.',
    })
    activeStreams.delete(streamId)
    return
  }

  const config = loadConfig()
  const lastUserMessage = [...messages].reverse().find(message => message.role === 'user')?.content ?? ''
  const userTurnCount = messages.filter(message => message.role === 'user').length
  const memoryEnabled = options?.memoryEnabled ?? true

  // Pre-write file snapshots (rel path → content). Populated just before a
  // workspace_file write/append executes, consumed when emitting chat:file-opened
  // so the Design code panel can show a REAL before→after diff (highlighted
  // changed lines), not just the new file. Cleared when the stream settles.
  const fileBeforeCache = new Map<string, string>()

  const selectedMode = config.aiMode ?? 'auto'
  const effectiveMode: EffectiveAIMode = resolveEffectiveMode(lastUserMessage, selectedMode)
  sendToRenderer('chat:mode', { streamId, selected: selectedMode, effective: effectiveMode })

  // Bypass mode: full-computer file access (no workspace-root confinement).
  workspaceManager.setBypass(effectiveMode === 'bypass')

  // An explicit model choice from the renderer's picker always wins.
  // Smart routing only picks a profile on the first turn (and only when no
  // explicit choice was sent) so the provider does not silently swap
  // mid-conversation based on the latest message's keywords.
  const allProfiles = listProfiles().filter(p => p.enabled)
  const explicitProfile = options?.profileId
    ? allProfiles.find(p => p.id === options.profileId) ?? null
    : null
  const routedProfile = !explicitProfile && userTurnCount <= 1 ? autoSelectProfile(lastUserMessage) : null

  // Failover chain: preferred profile first, then the remaining enabled
  // profiles. If a provider dies before producing a single token, the next
  // candidate is tried transparently instead of surfacing "fetch failed".
  // Aura's locked Default Profile owns its own Cerebras→Groq router — never
  // spill into other user profiles (which would leak provider identity).
  const preferred = explicitProfile || routedProfile || getActiveProfile() || undefined
  const candidates: NonNullable<typeof preferred>[] = []
  if (preferred) candidates.push(preferred)
  if (!(preferred && isAuraManagedProfile(preferred))) {
    for (const profile of allProfiles) {
      if (!candidates.some(candidate => candidate.id === profile.id)) candidates.push(profile)
    }
  }

  let memoryContext = ''
  let hasMemory = false

  if (memoryEnabled) {
    try {
      await maybeCaptureUserMemory(settingsEnv, lastUserMessage)
      // Automatic memory: capture durable facts ("my name is…", "I use React…")
      // so Aura remembers people, preferences, and goals without being asked.
      const autoCaptured = await autoCaptureMemories(settingsEnv, lastUserMessage)
      if (autoCaptured.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[memory] auto-captured ${autoCaptured.length} fact(s): ${autoCaptured.map(memory => memory.content).join(' | ')}`)
      }
      memoryContext = await buildMemoryContext(settingsEnv, lastUserMessage)
      hasMemory = Boolean(memoryContext)
    } catch (error) {
      console.warn('Aura memory unavailable:', error)
    }
  }

  // Attachment pipeline: (1) the AI always learns WHAT is attached via a
  // manifest, (2) text attachments contribute relevant chunks, (3) image
  // attachments are carried to the provider as real vision content.
  let attachmentContext = ''
  const attachmentIds = options?.attachmentIds ?? []
  const imageAttachments: Array<{ path: string; mimeType: string; size?: number }> = []
  // True if the model performed a real, verified file write via the tool this turn.
  let fileToolSucceeded = false
  if (attachmentIds.length > 0) {
    const manifest: string[] = []
    for (const id of attachmentIds) {
      const record = attachmentStore.get(id)?.record
      if (!record) continue
      const dims = record.metadata?.width && record.metadata?.height
        ? `, ${record.metadata.width}x${record.metadata.height}px`
        : ''
      manifest.push(`- ${record.name} (${record.mimeType}, ${formatBytes(record.size)}${dims})`)
      if (record.mimeType.startsWith('image/')) {
        imageAttachments.push({ path: record.path, mimeType: record.mimeType, size: record.size })
      }
    }
    const manifestText = manifest.length ? `## Attached files\n${manifest.join('\n')}` : ''
    let relevant = ''
    try {
      relevant = attachmentStore.retrieveContext(lastUserMessage, 2000)
    } catch (error) {
      console.warn('Aura attachment context unavailable:', error)
    }
    attachmentContext = [manifestText, relevant].filter(Boolean).join('\n\n')
  }

  // Vision capability: explicit profile flag, else model-name heuristic.
  const activeProfile = getActiveProfile()
  const activeCapabilities = getModelCapabilities(
    activeProfile?.provider ?? config.provider,
    activeProfile?.model ?? config.model,
    { visionSupport: activeProfile?.visionSupport, toolCalling: activeProfile?.toolCalling }
  )
  const supportsVision = activeCapabilities.vision

  // Vision-aware failover ordering: when the user attached an image and did NOT
  // explicitly pick a profile, prefer vision-capable profiles first so a
  // text-only default never silently swallows the image.
  if (imageAttachments.length > 0 && !explicitProfile) {
    const visionScore = (profile: NonNullable<typeof preferred>) =>
      getModelCapabilities(profile.provider, profile.model, { visionSupport: profile.visionSupport }).vision ? 1 : 0
    candidates.sort((a, b) => visionScore(b) - visionScore(a))
  }

  // Instrument the vision pipeline (developer visibility).
  // eslint-disable-next-line no-console
  console.log(`[vision] attachments=${attachmentIds.length} images=${imageAttachments.length} model=${config.model} supportsVision=${supportsVision}`)

  // Detect whether this request is likely to need web search.
  // Heuristic: search only when the user EXPLICITLY asks for it, or the question
  // is genuinely TIME-SENSITIVE (current/latest/news/releases/prices/weather).
  // Static knowledge questions ("what is the capital of France", "what is 25*47",
  // "explain React hooks") must NOT trigger a search automatically.
  const EXPLICIT_SEARCH_INTENT = /search (the web|for|about|up|online)|look.*up online|find.*online|check.*website|browse|web search|search for|what can you find|google/i
  const TIME_SENSITIVE = /\b(latest|current|recent|today|tonight|this (week|month|year)|breaking|news|update|release|version|announce|launch|price|pricing|stock|weather|forecast|2024|2025|2026|available now|in stock)\b/i
  const needsWebSearch = webSearchManager.isConnected && (
    EXPLICIT_SEARCH_INTENT.test(lastUserMessage) ||
    TIME_SENSITIVE.test(lastUserMessage)
  )

  // AURA-CONTROLLED PRE-SEARCH.
  // Groq gpt-oss (and some other OpenAI-compatible models) cannot reliably emit
  // parseable tool calls, so depending on the model to trigger web_search is
  // fragile. When the intent is clear, Aura runs the search ITSELF (Serper) and
  // hands the model the REAL results, so the answer completes without requiring
  // the model to produce tool syntax. The model keeps its tools for follow-ups.
  const STRONG_SEARCH_INTENT = /search (the web|about|for|up|online)|look.*up online|find.*online|check.*website|browse|search for|web search/i
  const CODING_INTENT = /\b(code|coding|implement|implementation|function|script|write|create|build|refactor|bug|fix|test|app|component|module|config|install|npm|deploy|error|class|import|file)\b|\.(json|ts|tsx|js|jsx|py|css|html|md)\b|package\.json/i
  const profileToolCallsDisabled = Boolean(preferred && preferred.toolCalling === false)
  const shouldPreSearch = needsWebSearch && (
    STRONG_SEARCH_INTENT.test(lastUserMessage) ||
    (profileToolCallsDisabled && !CODING_INTENT.test(lastUserMessage))
  )

  // Run the search synchronously so the model never has to synthesize tool
  // syntax to get web results. Emits "Searching the web…" / "Reading …" status.
  let webSearchResultsContext = ''
  if (shouldPreSearch) {
    try {
      const researchQuery = deriveSearchQuery(lastUserMessage) || lastUserMessage.slice(0, 160)
      // Only read a full page when the user named a specific site; otherwise
      // snippets suffice. This keeps pre-search to ~2s instead of blocking the
      // chat on multiple page reads.
      const isDomainQuery = /^[a-z0-9-]+\.[a-z]{2,}$/i.test(researchQuery)
      // eslint-disable-next-line no-console
      console.log(`[web] Aura-controlled search: query="${researchQuery}" domainQuery=${isDomainQuery} profile.toolCalling=${preferred?.toolCalling}`)
      // Bound the pre-search so slow reads never stall the chat. If it exceeds
      // the budget we proceed without injected results — the model's own tools
      // or the tool-call fallback still cover the search.
      const PRE_SEARCH_TIMEOUT_MS = 8000
      const research = await Promise.race([
        webSearchManager.research(
          researchQuery,
          { num: 5, preferDomain: isDomainQuery ? researchQuery : undefined },
          {
            // Tight caps keep the injected context token-cheap: snippets alone
            // (unless a site was named, then a single page read) are plenty for
            // the model to synthesize, and every injected char costs input TPM.
            maxSources: 5,
            maxPagesRead: isDomainQuery ? 1 : 0,   // snippets only, unless a site was named
            maxCharsPerPage: 1800,
            maxTotalChars: 3200,
            timeoutMs: 8000,
          },
          (state, target) => {
            if (state === 'searching') sendToRenderer('chat:research-status', { streamId, state: 'searching', query: target.slice(0, 60) })
            else sendToRenderer('chat:research-status', { streamId, state: 'reading', url: target })
          }
        ),
        new Promise<null>(resolve => setTimeout(() => resolve(null), PRE_SEARCH_TIMEOUT_MS)),
      ])
      sendToRenderer('chat:research-status', { streamId, state: 'done' })
      if (research && research.context && research.context.trim()) {
        const sourceList = research.sources
          .slice(0, 5)
          .map((source, index) => `[${index + 1}] ${source.title} — ${source.url}`)
          .join('\n')
        webSearchResultsContext = `${research.context}\n\nSOURCES USED:\n${sourceList}`
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[web] Aura-controlled pre-search failed:', error)
      sendToRenderer('chat:research-status', { streamId, state: 'done' })
    }
  }

  // ── TOOL PLAN — SINGLE SOURCE OF TRUTH ──────────────────────────────────────
  // This ONE list is used for (1) `request.tools` sent to the provider, (2) the
  // capability prompt the model sees, and (3) enabling the tool-calling loop.
  // Never keep a separate "advertised tools" list: the model can only call tools
  // that were actually sent in the request, and advertising a tool that isn't
  // registered makes providers reject the call ("attempted to call tool 'X'
  // which was not in request.tools") and leaves the user with no answer.
  const requestTools: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }> = [
    ...(workspaceManager.active ? [WORKSPACE_FILE_TOOL] : []),
    ...(needsWebSearch ? [WEB_SEARCH_TOOL, READ_PAGE_TOOL, WEB_RESEARCH_TOOL] : []),
  ]
  const registeredToolNames = new Set(requestTools.map(tool => tool.function.name))
  // eslint-disable-next-line no-console
  console.log(`[tools] request.tools: ${registeredToolNames.size ? [...registeredToolNames].join(', ') : '(none)'}`)

  // Split the system prompt into a STABLE prefix (byte-identical across turns
  // within a session) and VOLATILE context (changes every turn). The stable
  // prefix is what Anthropic's prompt cache can serve at ~10% input cost on
  // repeat turns; volatile context must never sit inside the cached prefix or
  // it would invalidate the cache on every request.
  const stableParts = [AURA_SYSTEM_PROMPT]
  if (workspaceManager.active) {
    stableParts.push(
      'FILESYSTEM RULE (absolute): You can perform REAL filesystem operations with the workspace_file tool. ' +
      'Always use it to create, edit, delete, rename, read, or list files. ' +
      'NEVER claim an operation succeeded unless the tool result contains success:true. ' +
      'If the tool returns an error, report that exact error. Never fabricate a file or its contents.'
    )
  } else {
    stableParts.push(
      'FILESYSTEM RULE (absolute): You have NO filesystem access in this session — no workspace folder is open. ' +
      'Never claim that you created, saved, wrote, modified, renamed, moved, or deleted any file. ' +
      'If the user asks you to create or edit files, do NOT pretend success. Reply exactly: ' +
      '"I can\'t modify that folder from this Aura session because filesystem write access isn\'t available."'
    )
  }
  // Always include an honest capability addendum — filtered to the tools this
  // request actually registered, so the model never reaches for an unregistered
  // tool (see the TOOL PLAN note above).
  stableParts.push(capabilityManager.buildCapabilityPrompt(registeredToolNames))
  const stableSystem = stableParts.join('\n\n')

  const volatileParts: string[] = []
  if (memoryContext) volatileParts.push(memoryContext)
  if (attachmentContext) volatileParts.push(attachmentContext)
  if (needsWebSearch) {
    if (webSearchResultsContext) {
      // Aura already performed the search — the model must synthesize from the
      // provided REAL results instead of emitting its own tool call.
      volatileParts.push(
        'WEB RESEARCH INSTRUCTIONS:\n' +
        'You have been given REAL, current web search results below (searched by Aura). ' +
        'Base your answer ONLY on them. Do NOT call the web_search tool again unless you need different information. ' +
        'Use read_webpage only if you need more detail on a specific URL. ' +
        'Never invent sources — cite only the URLs provided below. ' +
        'Never reproduce raw tool output, JSON, or internal fields in your answer — synthesize a clean, readable response.\n\n' +
        webSearchResultsContext
      )
    } else {
      volatileParts.push(
        'WEB RESEARCH INSTRUCTIONS:\n' +
        '1. Use the web_search tool to find REAL, current information from the internet.\n' +
        '2. After getting search results, use read_webpage to read the most relevant sources.\n' +
        '3. If results are insufficient, run a second, more specific search.\n' +
        '4. Base your answer ONLY on what the tools actually returned — never invent sources.\n' +
        '5. Present a clear, synthesized answer and list all sources used at the end.\n' +
        '6. Source format: "**Sources:** [Title](URL) — domain.com"\n' +
        '7. Never cite a URL that was not returned by the search tool or read_webpage tool.\n' +
        '8. NEVER quote or reproduce tool arguments, tool output JSON, or internal fields in your answer — write in natural prose.'
      )
    }
  }
  const systemPrompt = [stableSystem, ...volatileParts].filter(Boolean).join('\n\n')

  // Instrumentation (no optimization): decompose the payload into named
  // sections so the request-debug log shows exactly where tokens originate.
  const debugSections = [
    { name: 'System Prompt', content: AURA_SYSTEM_PROMPT },
    { name: 'Developer Prompt', content: getModeAddendum(effectiveMode) },
    { name: 'Memory', content: memoryContext },
    { name: 'Workspace Context', content: workspaceManager.active ? `Workspace root: ${workspaceManager.state().root ?? ''}` : '' },
    { name: 'Project Context', content: '' },
    { name: 'Retrieved Documents', content: attachmentContext },
    { name: 'Tool Definitions', content: '' },
    { name: 'Hidden Instructions', content: '' },
  ]

  queueMicrotask(async () => {
    try {
      // No profiles at all: legacy single-config path, no failover.
      const attempts: Array<ReturnType<typeof getActiveProfile>> = candidates.length > 0 ? candidates : [null]

      for (let index = 0; index < attempts.length; index += 1) {
        const profile = attempts[index] ?? undefined
        const streamConfig = profile
          ? profileToConfig(profile, effectiveMode)
          : { ...config, aiMode: effectiveMode }
        const isLastAttempt = index === attempts.length - 1
        let tokensSent = false
        let planPhase: 'off' | 'planning' | 'implementing' =
          effectiveMode === 'plan' ? 'planning' : 'off'

        const runToolExecutor = async (toolName: string, toolArgs: Record<string, unknown>) => {
          // eslint-disable-next-line no-console
          console.log(`[tool-call] ${toolName} args=${JSON.stringify(toolArgs).slice(0, 200)}`)
          // Clean UI activity (label only — never args/results). Tool protocol
          // stays internal to model context.
          sendToRenderer('chat:activity', { streamId, type: 'tool_start', tool: toolName, label: toolActivityLabel(toolName, toolArgs) })
          try {
            const result = await (async (): Promise<string> => {
              if (
                planPhase === 'planning' &&
                toolName === 'workspace_file' &&
                isMutatingWorkspaceAction(String(toolArgs.action ?? ''))
              ) {
                return JSON.stringify({
                  success: false,
                  error:
                    'PLAN PHASE: mutating filesystem tools are locked. Finish a numbered plan first; Aura will unlock tools for the implement phase.',
                })
              }

              if (shouldPromptForTool(toolName, toolArgs, { bypass: workspaceManager.isBypass, effectiveMode })) {
                const summary = summarizeToolArgs(toolName, toolArgs)
                const { requestId, promise } = waitForToolPermission({})
                sendToRenderer('chat:tool-permission', {
                  streamId,
                  requestId,
                  toolName,
                  args: toolArgs,
                  title: summary.title,
                  detail: summary.detail,
                })
                const decision = await promise
                if (decision === 'deny') {
                  return JSON.stringify({
                    success: false,
                    error: 'User denied this tool action. Do not retry the same action unless the user asks.',
                  })
                }
                if (decision === 'allow-session') {
                  rememberSessionAllow(sessionKeyForTool(toolName, toolArgs))
                }
              }

              if (toolName === 'workspace_file') {
                // Snapshot the pre-write content so the renderer can show a real
                // diff (highlighted changed lines), not just the new file.
                const action = String(toolArgs.action ?? '')
                if (action === 'write' || action === 'append') {
                  const rel = String(toolArgs.path ?? '')
                  fileBeforeCache.set(rel, readFileBeforeWrite(rel))
                }
                return executeWorkspaceTool(toolArgs)
              }
              if (toolName === 'web_search') {
                if (!webSearchManager.isConnected) {
                  return `Web search is not configured. ${webSearchManager.statusMessage}`
                }
                const searchResp = await webSearchManager.search(
                  String(toolArgs.query ?? ''),
                  {
                    num: typeof toolArgs.num === 'number' ? toolArgs.num : 8,
                    recency: toolArgs.recency as never,
                    site: typeof toolArgs.site === 'string' ? toolArgs.site : undefined,
                    type: (toolArgs.type ?? 'search') as 'search' | 'news',
                  }
                )
                sendToRenderer('chat:research-status', { streamId, state: 'searching', query: toolArgs.query })
                // STRICT TOOL BOUNDARY: never return the raw SearchResponse (it
                // carries provider, duration, query, debug fields that must not leak
                // into the model's reply or the UI). Hand the model only the
                // normalized, research-useful text.
                return formatSearchResults(searchResp)
              }
              if (toolName === 'read_webpage') {
                const targetUrl = String(toolArgs.url ?? '').trim()
                let statusUrl: string | undefined
                try {
                  const parsed = new URL(targetUrl)
                  statusUrl = ['http:', 'https:'].includes(parsed.protocol) ? targetUrl : undefined
                } catch { statusUrl = undefined }
                if (statusUrl) sendToRenderer('chat:research-status', { streamId, state: 'reading', url: statusUrl })
                const page = await webSearchManager.readPage(
                  targetUrl,
                  typeof toolArgs.max_chars === 'number' ? toolArgs.max_chars : 3000
                )
                // STRICT TOOL BOUNDARY: normalized readable text only — never the
                // raw PageContent object (wordCount, links, internal fields).
                return formatPageContent(page)
              }
              if (toolName === 'web_research') {
                sendToRenderer('chat:research-status', { streamId, state: 'researching', query: toolArgs.query })
                const res = await webSearchManager.research(
                  String(toolArgs.query ?? ''),
                  {
                    recency: toolArgs.recency as never,
                    site: typeof toolArgs.site === 'string' ? toolArgs.site : undefined,
                  },
                  { maxSources: typeof toolArgs.max_sources === 'number' ? toolArgs.max_sources : 4 }
                )
                sendToRenderer('chat:research-status', { streamId, state: 'done' })
                return formatResearchResult(res)
              }
              return executeWorkspaceTool(toolArgs)
            })()
            sendToRenderer('chat:activity', { streamId, type: 'tool_complete', tool: toolName })
            return result
          } catch (error) {
            // eslint-disable-next-line no-console
            console.warn(`[tool-call] ${toolName} failed:`, error instanceof Error ? error.message : error)
            sendToRenderer('chat:activity', { streamId, type: 'tool_error', tool: toolName })
            return JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'tool execution failed' })
          }
        }

        const outcome = await new Promise<'done' | 'failed'>(resolve => {
          const finishOk = async (text: string, model: string | undefined, usage: unknown) => {
            if (workspaceManager.active && !workspaceManager.isBypass && !fileToolSucceeded) {
              await executeFileIntents(lastUserMessage)
            }
            const verified = verifyFileClaims(text)
            if (verified.corrections.length > 0) {
              // eslint-disable-next-line no-console
              console.warn(`[trust] claim correction: ${verified.corrections.join(' | ')}`)
              sendToRenderer('chat:delta', { streamId, delta: verified.note })
            }
            sendToRenderer('chat:done', {
              streamId,
              text,
              model: profile && isAuraManagedProfile(profile) ? AURA_MODEL_IDENTITY.modelName : model,
              usage,
            })
            resolve('done')
          }

          const baseCallbacks = {
            onToken: (token: string) => {
              tokensSent = true
              sendToRenderer('chat:delta', { streamId, delta: token })
            },
            onThinking: (thinking: string) => {
              tokensSent = true
              sendToRenderer('chat:thinking', { streamId, delta: thinking })
            },
            onPipeline: (steps: Parameters<NonNullable<Parameters<typeof streamCompletion>[4]['onPipeline']>>[0]) =>
              sendToRenderer('chat:pipeline', { streamId, pipeline: steps }),
            onTool: (name: string, args: Record<string, unknown>, result: string) => {
              sendToRenderer('chat:tool', { streamId, name, args, result })
              try {
                const parsed = JSON.parse(result) as { success?: boolean; operation?: string; path?: string; error?: string }
                if (parsed.success && (parsed.operation === 'write' || parsed.operation === 'append') && parsed.path) {
                  fileToolSucceeded = true
                  const content = typeof args.content === 'string' ? args.content : ''
                  const before = fileBeforeCache.get(parsed.path)
                  sendToRenderer('chat:file-opened', { streamId, path: parsed.path, content, ...(before !== undefined ? { before } : {}) })
                  sendToRenderer('chat:editor-status', { streamId, state: 'writing', fileName: parsed.path.split(/[/\\]/).pop() ?? parsed.path })
                } else if (!parsed.success && parsed.operation) {
                  sendToRenderer('chat:editor-status', { streamId, state: 'error', message: parsed.error })
                }
              } catch {
                /* ignore */
              }
            },
            onError: (error: Error) => {
              if (!tokensSent && !isLastAttempt && !controller.signal.aborted) {
                // eslint-disable-next-line no-console
                console.warn(`[AURA] primary temporarily unavailable — trying next profile`)
                resolve('failed')
                return
              }
              sendToRenderer('chat:error', { streamId, message: sanitizeProviderError(error).message })
              resolve('done')
            },
            onAbort: () => {
              sendToRenderer('chat:aborted', { streamId })
              resolve('done')
            },
          }

          const toolOpts = {
            profile,
            hasMemory,
            debug: debugSections,
            images: imageAttachments,
            stableSystem,
            tools: {
              enabled: requestTools.length > 0,
              executor: runToolExecutor,
              extraTools: requestTools,
            },
          }

          void (async () => {
            try {
              if (effectiveMode === 'plan') {
                sendToRenderer('chat:delta', { streamId, delta: '### Plan\n\n' })
                let planText = ''
                planPhase = 'planning'
                await streamCompletion(
                  streamConfig,
                  messages,
                  `${systemPrompt}\n${planPhaseSystemAddendum()}`,
                  controller.signal,
                  {
                    ...baseCallbacks,
                    onToken: token => {
                      tokensSent = true
                      planText += token
                      sendToRenderer('chat:delta', { streamId, delta: token })
                    },
                    onDone: async () => {
                      /* continue to implement phase */
                    },
                  },
                  toolOpts
                )

                if (controller.signal.aborted) {
                  sendToRenderer('chat:aborted', { streamId })
                  resolve('done')
                  return
                }

                planPhase = 'implementing'
                sendToRenderer('chat:delta', { streamId, delta: '\n\n---\n\n### Implementing\n\n' })
                const implementMessages = [
                  ...messages,
                  { role: 'assistant' as const, content: planText || 'Plan: proceed carefully with a minimal safe implementation.' },
                  {
                    role: 'user' as const,
                    content: 'Implement the approved plan now using tools. Do not re-plan unless blocked. Summarize changes when done.',
                  },
                ]
                await streamCompletion(
                  streamConfig,
                  implementMessages,
                  `${systemPrompt}\n${implementPhaseSystemAddendum(planText)}`,
                  controller.signal,
                  {
                    ...baseCallbacks,
                    onDone: (text, model, usage) => {
                      void finishOk(`${planText}\n\n---\n\n${text}`, model, usage)
                    },
                  },
                  toolOpts
                )
                return
              }

              planPhase = 'off'
              await streamCompletion(
                streamConfig,
                messages,
                systemPrompt,
                controller.signal,
                {
                  ...baseCallbacks,
                  onDone: (text, model, usage) => {
                    void finishOk(text, model, usage)
                  },
                },
                toolOpts
              )
            } catch (error) {
              if (controller.signal.aborted) {
                sendToRenderer('chat:aborted', { streamId })
                resolve('done')
                return
              }
              if (!tokensSent && !isLastAttempt) {
                resolve('failed')
                return
              }
              sendToRenderer('chat:error', { streamId, message: sanitizeProviderError(error).message })
              resolve('done')
            }
          })()
        })

        if (outcome === 'done') break
      }
    } catch (error) {
      if (controller.signal.aborted) {
        sendToRenderer('chat:aborted', { streamId })
        return
      }

      const message = sanitizeProviderError(error).message
      sendToRenderer('chat:error', { streamId, message })
    } finally {
      activeStreams.delete(streamId)
    }
  })

  return { streamId }
})
