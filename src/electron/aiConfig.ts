import { app, clipboard } from 'electron'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export type AIProvider =
  | 'anthropic'
  | 'openai'
  | 'moonshot'
  | 'zai'
  | 'groq'
  | 'cerebras'
  | 'aura'
  | 'openrouter'
  | 'nvidia'
  | 'gemini'
  | 'ollama'
  | 'lmstudio'
  | 'localai'
  | 'vllm'
  | 'custom'

export type AIMode = 'auto' | 'fast' | 'balanced' | 'think' | 'plan' | 'max' | 'bypass'

export type TaskType = 'chat' | 'coding' | 'planning' | 'vision' | 'voice' | 'embeddings'

export interface SmartRouting {
  chat?: string | null
  coding?: string | null
  planning?: string | null
  vision?: string | null
  voice?: string | null
  embeddings?: string | null
}

export interface APIProfile {
  id: string
  name: string
  displayName: string
  provider: AIProvider
  apiKey: string
  baseURL: string
  model: string
  organizationId?: string
  projectId?: string
  customHeaders?: Record<string, string>
  queryParameters?: Record<string, string>
  temperature: number
  topP: number
  maxTokens: number
  contextLength: number
  streaming: boolean
  timeout: number
  retryCount: number
  toolCalling: boolean
  visionSupport: boolean
  enabled: boolean
  isDefault: boolean
  /** Built-in Aura profile: baseURL and apiKey are hidden from the UI and
   *  cannot be edited or deleted by the user. */
  locked?: boolean
  category?: string
  createdAt: number
  updatedAt: number
}

export interface SavedModel {
  id: string
  name: string
  provider: AIProvider
  modelId: string
  pinned: boolean
  favorite: boolean
  category?: string
}

export interface ModelPreset {
  provider: AIProvider
  label: string
  modelId: string
  baseURL: string
}

export interface AIConfig {
  provider: AIProvider
  apiKey: string
  baseURL: string
  model: string
  organizationId?: string
  customHeaders?: Record<string, string>
  temperature: number
  topP: number
  maxTokens: number
  streaming: boolean
  reasoningEffort: 'none' | 'low' | 'medium' | 'high'
  contextLength: number
  aiMode: AIMode
  savedModels: SavedModel[]
  activeProfileId?: string
}

export interface VoiceSettings {
  enabled: boolean
  sttEngine: 'web' | 'whisper-local'
  ttsEngine: 'web' | 'api'
  voiceURI: string
  language: string
  speed: number
  pitch: number
  volume: number
  wakeWord: string
  wakeWordEnabled: boolean
  continuousMode: boolean
  bargeIn: boolean
  vadSensitivity: number
  emotionAware: boolean
}

export interface TestConnectionResult {
  success: boolean
  latencyMs?: number
  error?: string
  model?: string
  supportsStreaming?: boolean
  supportsToolCalling?: boolean
  supportsVision?: boolean
  availableModels?: string[]
}

export type PipelineStage =
  | 'intent'
  | 'context'
  | 'memory'
  | 'planning'
  | 'tools'
  | 'execution'
  | 'review'
  | 'response'

export interface PipelineStep {
  stage: PipelineStage
  status: 'pending' | 'active' | 'complete' | 'skipped'
  summary?: string
  timestamp: number
}

export interface DevLogEntry {
  id: string
  timestamp: number
  type: 'request' | 'response' | 'error'
  profileId: string
  profileName: string
  provider: AIProvider
  model: string
  tokenUsage?: { prompt: number; completion: number; total: number }
  estimatedCost?: number
  latencyMs: number
  status: 'success' | 'error' | 'aborted'
  errorMessage?: string
  requestPreview: string
  responsePreview: string
  mode?: AIMode
  /** Structured failure detail (Developer Mode): provider, model, tool-call
   *  format, parse failure, HTTP status, retry path. Never shown in normal chat. */
  diagnostics?: Record<string, unknown>
}

export interface DevDashboardStats {
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  totalTokens: number
  totalCost: number
  avgLatencyMs: number
  requestsByProvider: Record<string, number>
  requestsByMode: Record<string, number>
}

export type PluginCapability = 'provider' | 'model' | 'tool' | 'mcp' | 'panel' | 'automation' | 'command'

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  enabled: boolean
  capabilities: PluginCapability[]
  icon?: string
  installedAt: number
  config?: Record<string, unknown>
}

const ENCRYPTION_KEY_SOURCE = 'aura-titan-encryption-key-v1'
const ALGO = 'aes-256-gcm'

function deriveKey(): Buffer {
  return crypto.scryptSync(ENCRYPTION_KEY_SOURCE, `${os.hostname()}:${os.userInfo().username}`, 32)
}

export function encrypt(plaintext: string): string {
  if (!plaintext) return ''
  if (plaintext.includes(':') && plaintext.split(':').length === 3) return plaintext
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, deriveKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':')
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext || !ciphertext.includes(':')) return ciphertext
  try {
    const [ivHex, tagHex, dataHex] = ciphertext.split(':')
    const decipher = crypto.createDecipheriv(ALGO, deriveKey(), Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
  } catch {
    return ciphertext
  }
}

export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '•'.repeat(key.length)
  return `${key.slice(0, 4)}${'•'.repeat(Math.max(4, key.length - 8))}${key.slice(-4)}`
}

export function secureCopyToClipboard(text: string): boolean {
  try {
    clipboard.writeText(text)
    setTimeout(() => {
      if (clipboard.readText() === text) clipboard.clear()
    }, 30000)
    return true
  } catch {
    return false
  }
}

export function sanitizeForLogging(obj: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['apiKey', 'api_key', 'password', 'secret', 'token', 'authorization']
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => {
      const lower = key.toLowerCase()
      return [key, sensitiveKeys.some(item => lower.includes(item)) ? '[REDACTED]' : value]
    })
  )
}

function getBasePath(): string {
  return app.getPath('userData')
}

function getConfigPath(): string {
  return path.join(getBasePath(), 'aura-config.json')
}

function getProfilesPath(): string {
  return path.join(getBasePath(), 'aura-profiles.json')
}

function getModelsPath(): string {
  return path.join(getBasePath(), 'aura-models.json')
}

function getRoutingPath(): string {
  return path.join(getBasePath(), 'aura-routing.json')
}

function getVoicePath(): string {
  return path.join(getBasePath(), 'aura-voice.json')
}

function getDevLogsPath(): string {
  return path.join(getBasePath(), 'aura-devlogs.json')
}

function getPluginsPath(): string {
  return path.join(getBasePath(), 'aura-plugins.json')
}

function atomicWrite(filePath: string, data: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp`
  fs.writeFileSync(tempPath, data, 'utf8')
  fs.renameSync(tempPath, filePath)
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}

export const DEFAULT_CONFIG: AIConfig = {
  // Aura must never inherit another application's provider (for example
  // Claude Code's ANTHROPIC_* environment). Provider selection is Aura-owned.
  // Internal primary is Cerebras; Groq is a hidden failover — never a second profile.
  provider: 'cerebras',
  apiKey: '',
  baseURL: 'https://api.cerebras.ai/v1',
  model: 'gpt-oss-120b',
  organizationId: '',
  customHeaders: {},
  temperature: 0.7,
  topP: 1,
  maxTokens: 2048,
  streaming: true,
  reasoningEffort: 'none',
  contextLength: 32768,
  aiMode: 'auto',
  savedModels: [],
}

export const DEFAULT_VOICE: VoiceSettings = {
  enabled: false,
  sttEngine: 'web',
  ttsEngine: 'web',
  voiceURI: '',
  language: 'en-US',
  speed: 1,
  pitch: 1,
  volume: 1,
  wakeWord: 'Aura',
  wakeWordEnabled: false,
  continuousMode: false,
  bargeIn: true,
  vadSensitivity: 0.5,
  emotionAware: false,
}

export const DEFAULT_ROUTING: SmartRouting = {
  chat: null,
  coding: null,
  planning: null,
  vision: null,
  voice: null,
  embeddings: null,
}

export const PROVIDER_BASE_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  moonshot: 'https://api.moonshot.ai/v1',
  zai: 'https://api.z.ai/api/paas/v4/',
  groq: 'https://api.groq.com/openai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  aura: '',
  openrouter: 'https://openrouter.ai/api/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
  localai: 'http://localhost:8080/v1',
  vllm: 'http://localhost:8000/v1',
  custom: '',
}

// ─────────────────────────────────────────────────────────────────────────────
// .env loading
// ─────────────────────────────────────────────────────────────────────────────
// Electron does not load .env files automatically. Aura-owned credentials
// (CEREBRAS_API_KEY, GROQ_API_KEY, NEON_DATABASE_URL, …) can live in a .env /
// .env.local next to the project instead of on disk, so we parse the standard
// files at first config read. Precedence: real process.env > .env.local > .env > .env.example.
// (Never read another application's environment — only Aura-owned variables.)

let envLoaded = false

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key) out[key] = value
  }
  return out
}

export function ensureEnvLoaded(): void {
  if (envLoaded) return
  envLoaded = true
  // Dev runs from the project root; packaged builds resolve app.getAppPath().
  const roots = [...new Set([process.cwd(), app.getAppPath()])]
  const files = ['.env.local', '.env', '.env.example']
  for (const root of roots) {
    for (const file of files) {
      const envPath = path.join(root, file)
      if (!fs.existsSync(envPath)) continue
      try {
        const parsed = parseEnv(fs.readFileSync(envPath, 'utf8'))
        for (const [key, value] of Object.entries(parsed)) {
          // Never override variables already set in the real environment.
          if (process.env[key] === undefined) process.env[key] = value
        }
      } catch {
        // A malformed env file must not break startup.
      }
    }
  }
}

/**
 * Reads Aura's explicit Cerebras configuration (primary backend).
 * Never import credentials from another application.
 */
export function readAuraCerebrasEnvironment(): Partial<AIConfig> {
  ensureEnvLoaded()
  const apiKey = process.env.AURA_CEREBRAS_API_KEY || process.env.CEREBRAS_API_KEY || ''
  const model = process.env.AURA_CEREBRAS_MODEL || process.env.CEREBRAS_MODEL || DEFAULT_CONFIG.model
  const baseURL = process.env.AURA_CEREBRAS_BASE_URL || process.env.CEREBRAS_BASE_URL || DEFAULT_CONFIG.baseURL
  return { provider: 'cerebras', apiKey, baseURL, model }
}

/**
 * Reads Aura's explicit Groq configuration (hidden failover backend).
 * Never import the Codex/Claude environment; those credentials belong elsewhere.
 */
export function readAuraGroqEnvironment(): Partial<AIConfig> {
  ensureEnvLoaded()
  const apiKey = process.env.AURA_GROQ_API_KEY || process.env.GROQ_API_KEY || ''
  const model = process.env.AURA_GROQ_MODEL || process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
  const baseURL = process.env.AURA_GROQ_BASE_URL || process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1'
  return { provider: 'groq', apiKey, baseURL, model }
}

function isAccidentalClaudeImport(raw: Partial<AIConfig>): boolean {
  const model = String(raw.model ?? '')
  const baseURL = String(raw.baseURL ?? '')
  return raw.provider === 'anthropic' && (model.startsWith('auto/') || /localhost|127\.0\.0\.1/i.test(baseURL))
}

function readRawConfig(): Partial<AIConfig> {
  return readJson<Partial<AIConfig>>(getConfigPath(), {})
}

export function loadConfig(): AIConfig {
  const raw = readRawConfig()
  if (Object.keys(raw).length > 0 && !isAccidentalClaudeImport(raw)) {
    const primaryEnv = raw.provider === 'cerebras' || raw.provider === 'aura'
      ? readAuraCerebrasEnvironment()
      : raw.provider === 'groq'
        ? readAuraGroqEnvironment()
        : {}
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      // A deployment may keep the key in CEREBRAS_API_KEY / GROQ_API_KEY rather than on disk.
      // Never fall back to ANTHROPIC_* here.
      apiKey: raw.apiKey ? decrypt(raw.apiKey) : (primaryEnv.apiKey ?? ''),
    }
  }

  const initial: AIConfig = { ...DEFAULT_CONFIG, ...readAuraCerebrasEnvironment() }
  saveConfig(initial)
  return initial
}

export function saveConfig(config: AIConfig): void {
  atomicWrite(
    getConfigPath(),
    JSON.stringify(
      {
        ...config,
        apiKey: config.apiKey ? encrypt(config.apiKey) : '',
      },
      null,
      2
    )
  )
}

export function mergeConfig(current: AIConfig, partial: Partial<AIConfig>): AIConfig {
  return { ...current, ...partial }
}

interface ProfilesFile {
  profiles: APIProfile[]
  activeProfileId: string | null
}

function readRawProfiles(): ProfilesFile {
  return readJson<ProfilesFile>(getProfilesPath(), { profiles: [], activeProfileId: null })
}

function readProfiles(): ProfilesFile {
  ensureEnvLoaded()
  const raw = readRawProfiles()
  const cerebrasEnv = readAuraCerebrasEnvironment()
  const groqEnv = readAuraGroqEnvironment()
  return {
    activeProfileId: raw.activeProfileId ?? null,
    profiles: raw.profiles.map(profile => {
      const lockedAura = profile.locked && (
        profile.isDefault
        || profile.name === 'Aura'
        || profile.name === 'Default Profile'
      )
      // Locked built-in Aura profiles are managed from env. Primary = Cerebras;
      // Groq credentials are never stored on a second profile — the router reads
      // them at stream time. sanitizeProfile still hides secrets from the renderer.
      if (lockedAura && cerebrasEnv.apiKey) {
        return {
          ...profile,
          provider: 'cerebras' as AIProvider,
          apiKey: cerebrasEnv.apiKey ?? '',
          baseURL: (cerebrasEnv.baseURL ?? PROVIDER_BASE_URLS.cerebras).trim(),
          model: (cerebrasEnv.model ?? DEFAULT_CONFIG.model).trim(),
          toolCalling: true,
          visionSupport: true,
        }
      }
      if (profile.locked && profile.provider === 'groq' && groqEnv.apiKey) {
        return {
          ...profile,
          apiKey: groqEnv.apiKey ?? '',
          baseURL: (groqEnv.baseURL ?? '').trim(),
          model: (groqEnv.model ?? '').trim(),
        }
      }
      if (profile.locked && profile.provider === 'cerebras' && cerebrasEnv.apiKey) {
        return {
          ...profile,
          apiKey: cerebrasEnv.apiKey ?? '',
          baseURL: (cerebrasEnv.baseURL ?? '').trim(),
          model: (cerebrasEnv.model ?? '').trim(),
        }
      }
      return {
        ...profile,
        apiKey: profile.apiKey ? decrypt(profile.apiKey).trim() : '',
        baseURL: (profile.baseURL ?? '').trim(),
        model: (profile.model ?? '').trim(),
      }
    }),
  }
}

function writeProfiles(data: ProfilesFile): void {
  atomicWrite(
    getProfilesPath(),
    JSON.stringify(
      {
        activeProfileId: data.activeProfileId,
        profiles: data.profiles.map(profile => ({
          ...profile,
          apiKey: profile.apiKey ? encrypt(profile.apiKey) : '',
        })),
      },
      null,
      2
    )
  )
}

function generateId(): string {
  return crypto.randomUUID()
}

export function listProfiles(): APIProfile[] {
  return readProfiles().profiles
}

export function isLockedProfile(profile: APIProfile | null | undefined): boolean {
  return Boolean(profile?.locked)
}

/**
 * Repairs profiles accidentally created from ~/.claude/settings.json by older
 * Aura builds. That file belongs to Codex/Claude, never to Aura.
 */
export function repairAccidentalClaudeProfiles(): void {
  const data = readProfiles()
  const cerebras = readAuraCerebrasEnvironment()
  let changed = false

  for (const profile of data.profiles) {
    if (!isAccidentalClaudeImport(profile)) continue
    profile.provider = 'cerebras'
    profile.apiKey = cerebras.apiKey ?? ''
    profile.baseURL = cerebras.baseURL ?? PROVIDER_BASE_URLS.cerebras
    profile.model = cerebras.model ?? DEFAULT_CONFIG.model
    profile.maxTokens = Math.min(profile.maxTokens || DEFAULT_CONFIG.maxTokens, 2048)
    profile.locked = true
    profile.updatedAt = Date.now()
    changed = true
  }

  if (changed) writeProfiles(data)
}

/**
 * Returns a copy of the profile with connection secrets stripped when the
 * profile is locked. Applied at the IPC boundary so the renderer never
 * receives the built-in Aura profile's base URL, API key, or raw vendor model.
 */
export function sanitizeProfile(profile: APIProfile): APIProfile {
  if (!profile.locked) return profile
  const auraManaged = profile.isDefault
    || profile.name === 'Aura'
    || profile.name === 'Default Profile'
  if (auraManaged) {
    return {
      ...profile,
      apiKey: '',
      baseURL: '',
      provider: 'aura',
      model: 'Aura Model',
    }
  }
  return { ...profile, apiKey: '', baseURL: '' }
}

/**
 * One-time migration: mark the built-in default Aura profile as locked so its
 * connection secrets are hidden even for profiles created before the `locked`
 * flag existed (e.g. the default profile already stored on disk).
 */
export function lockBuiltInProfiles(): void {
  const data = readProfiles()
  let changed = false
  for (const profile of data.profiles) {
    if (!profile.locked && profile.isDefault && (profile.name === 'Aura' || profile.name === 'Default Profile')) {
      profile.locked = true
      changed = true
    }
  }
  if (changed) writeProfiles(data)
}

/**
 * Ensure the locked Default Profile uses Cerebras as the internal primary
 * (Groq remains a hidden failover via the Aura provider router — never a
 * second user-facing profile). Enables tool calling for agent capabilities.
 */
export function migrateAuraManagedProfile(): void {
  ensureEnvLoaded()
  const data = readRawProfiles()
  const cerebras = readAuraCerebrasEnvironment()
  let fileChanged = false

  for (const profile of data.profiles) {
    const isManaged = Boolean(profile.locked)
      && (Boolean(profile.isDefault) || profile.name === 'Aura' || profile.name === 'Default Profile')
    if (!isManaged) continue

    let profileChanged = false
    // Keep the user-facing name "Default Profile"; only the internal backend moves.
    if (profile.provider !== 'cerebras') {
      profile.provider = 'cerebras'
      profileChanged = true
    }
    if (cerebras.apiKey) {
      const currentKey = profile.apiKey ? decrypt(profile.apiKey).trim() : ''
      if (currentKey !== cerebras.apiKey) {
        profile.apiKey = cerebras.apiKey
        profileChanged = true
      }
    }
    if (cerebras.baseURL && profile.baseURL !== cerebras.baseURL) {
      profile.baseURL = cerebras.baseURL
      profileChanged = true
    }
    if (cerebras.model && profile.model !== cerebras.model) {
      profile.model = cerebras.model
      profileChanged = true
    }
    if (profile.toolCalling !== true) {
      profile.toolCalling = true
      profileChanged = true
    }
    // Locked Aura Model: enable vision so image attachments work on the
    // default profile without requiring a separate unlocked provider.
    if (profile.visionSupport !== true) {
      profile.visionSupport = true
      profileChanged = true
    }
    if (!profile.locked) {
      profile.locked = true
      profileChanged = true
    }
    if (profileChanged) {
      profile.updatedAt = Date.now()
      fileChanged = true
    }
  }

  if (fileChanged) writeProfiles(data)
}

export function getActiveProfile(): APIProfile | null {
  const data = readProfiles()
  if (!data.activeProfileId) {
    return data.profiles.find(profile => profile.isDefault && profile.enabled)
      ?? data.profiles.find(profile => profile.enabled)
      ?? null
  }
  return data.profiles.find(profile => profile.id === data.activeProfileId && profile.enabled)
    ?? data.profiles.find(profile => profile.isDefault && profile.enabled)
    ?? data.profiles.find(profile => profile.enabled)
    ?? null
}

export function setActiveProfile(id: string): void {
  const data = readProfiles()
  if (!data.profiles.some(profile => profile.id === id)) return
  data.activeProfileId = id
  writeProfiles(data)
}

export function createProfile(input: Partial<APIProfile>): APIProfile {
  const data = readProfiles()
  const now = Date.now()
  const isFirst = data.profiles.length === 0
  const provider = input.provider ?? 'custom'

  const profile: APIProfile = {
    id: input.id ?? generateId(),
    name: input.name ?? `Profile ${data.profiles.length + 1}`,
    displayName: input.displayName ?? input.name ?? `Profile ${data.profiles.length + 1}`,
    provider,
    apiKey: (input.apiKey ?? '').trim(),
    baseURL: (input.baseURL ?? PROVIDER_BASE_URLS[provider] ?? '').trim(),
    model: (input.model ?? '').trim(),
    organizationId: input.organizationId ?? '',
    projectId: input.projectId ?? '',
    customHeaders: input.customHeaders ?? {},
    queryParameters: input.queryParameters ?? {},
    temperature: input.temperature ?? 0.7,
    topP: input.topP ?? 1,
    maxTokens: input.maxTokens ?? 8192,
    contextLength: input.contextLength ?? 32768,
    streaming: input.streaming ?? true,
    timeout: input.timeout ?? 600000,
    retryCount: input.retryCount ?? 2,
    toolCalling: input.toolCalling ?? false,
    visionSupport: input.visionSupport ?? false,
    enabled: input.enabled ?? true,
    isDefault: input.isDefault ?? isFirst,
    locked: input.locked ?? false,
    category: input.category ?? 'general',
    createdAt: now,
    updatedAt: now,
  }

  if (profile.isDefault) {
    data.profiles = data.profiles.map(existing => ({ ...existing, isDefault: false }))
    data.activeProfileId = profile.id
  }

  data.profiles.push(profile)
  writeProfiles(data)
  return profile
}

export function updateProfile(id: string, updates: Partial<APIProfile>): APIProfile | null {
  const data = readProfiles()
  const index = data.profiles.findIndex(profile => profile.id === id)
  if (index === -1) return null

  const existing = data.profiles[index]
  const updated: APIProfile = {
    ...existing,
    ...updates,
    id,
    updatedAt: Date.now(),
  }
  // Whitespace in connection fields produces malformed URLs → "fetch failed".
  updated.apiKey = updated.apiKey.trim()
  updated.baseURL = updated.baseURL.trim()
  updated.model = updated.model.trim()

  // Locked (built-in Aura) profiles never expose connection secrets to edits.
  // Provider/model for the managed Default Profile are Aura-owned (Cerebras
  // primary + Groq failover) and must not be overwritten from the renderer.
  if (existing.locked) {
    updated.apiKey = existing.apiKey
    updated.baseURL = existing.baseURL
    updated.locked = true
    if (existing.isDefault || existing.name === 'Aura' || existing.name === 'Default Profile') {
      updated.provider = existing.provider
      updated.model = existing.model
      updated.toolCalling = true
      updated.visionSupport = true
    }
  }

  if (updates.isDefault) {
    data.profiles = data.profiles.map(profile => ({ ...profile, isDefault: profile.id === id }))
    data.activeProfileId = id
  }

  data.profiles[index] = updated
  writeProfiles(data)
  return updated
}

export function deleteProfile(id: string): boolean {
  const data = readProfiles()
  const existing = data.profiles.find(profile => profile.id === id)
  if (!existing || existing.locked) return false

  data.profiles = data.profiles.filter(profile => profile.id !== id)

  if (data.activeProfileId === id) {
    data.activeProfileId = data.profiles.find(profile => profile.enabled)?.id ?? data.profiles[0]?.id ?? null
  }

  if (existing.isDefault && data.profiles.length > 0) {
    data.profiles[0] = { ...data.profiles[0], isDefault: true }
    data.activeProfileId = data.profiles[0].id
  }

  writeProfiles(data)
  return true
}

export function duplicateProfile(id: string): APIProfile | null {
  const original = readProfiles().profiles.find(profile => profile.id === id)
  // Locked (built-in Aura) profiles cannot be duplicated: the copy is unlocked
  // and editable, which would expose the hidden base URL / API key.
  if (!original || original.locked) return null

  return createProfile({
    ...original,
    id: generateId(),
    name: `${original.name} (Copy)`,
    displayName: `${original.displayName} (Copy)`,
    isDefault: false,
    enabled: false,
    locked: false,
  })
}

export function setDefaultProfile(id: string): void {
  const data = readProfiles()
  if (!data.profiles.some(profile => profile.id === id)) return
  data.profiles = data.profiles.map(profile => ({ ...profile, isDefault: profile.id === id }))
  data.activeProfileId = id
  writeProfiles(data)
}

export function enableProfile(id: string, enabled: boolean): void {
  updateProfile(id, { enabled })
}

export function exportAllProfiles(): string {
  return JSON.stringify(readRawProfiles(), null, 2)
}

export function importAllProfiles(json: string): void {
  const parsed = JSON.parse(json) as Partial<ProfilesFile>
  if (!Array.isArray(parsed.profiles)) throw new Error('Invalid profiles JSON')
  const normalized: ProfilesFile = {
    activeProfileId: parsed.activeProfileId ?? null,
    profiles: parsed.profiles.map(profile => ({
      ...profile,
      apiKey: profile.apiKey ? decrypt(profile.apiKey) : '',
    })) as APIProfile[],
  }
  writeProfiles(normalized)
}

export function backupSettings(): string {
  return JSON.stringify(
    {
      config: readRawConfig(),
      profiles: readRawProfiles(),
      models: readModels(),
      routing: readRouting(),
      voice: readVoice(),
      plugins: listPlugins(),
      timestamp: Date.now(),
    },
    null,
    2
  )
}

export function restoreSettings(json: string): void {
  const parsed = JSON.parse(json) as {
    config?: Partial<AIConfig>
    profiles?: ProfilesFile
    models?: SavedModel[]
    routing?: SmartRouting
    voice?: Partial<VoiceSettings>
    plugins?: PluginManifest[]
  }

  if (parsed.config) {
    const restoredConfig: AIConfig = {
      ...DEFAULT_CONFIG,
      ...parsed.config,
      apiKey: parsed.config.apiKey ? decrypt(parsed.config.apiKey) : '',
    }
    saveConfig(restoredConfig)
  }

  if (parsed.profiles) {
    importAllProfiles(JSON.stringify(parsed.profiles))
  }

  if (parsed.models) writeModels(parsed.models)
  if (parsed.routing) writeRouting(parsed.routing)
  if (parsed.voice) writeVoice({ ...DEFAULT_VOICE, ...parsed.voice })
  if (parsed.plugins) atomicWrite(getPluginsPath(), JSON.stringify(parsed.plugins, null, 2))
}

function readModels(): SavedModel[] {
  return readJson<SavedModel[]>(getModelsPath(), [])
}

function writeModels(models: SavedModel[]): void {
  atomicWrite(getModelsPath(), JSON.stringify(models, null, 2))
}

export function listModels(): SavedModel[] {
  return readModels().sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.favorite) - Number(a.favorite)
  )
}

export function addModel(input: Omit<SavedModel, 'id'>): SavedModel {
  const model: SavedModel = { ...input, id: generateId() }
  const models = readModels()
  models.push(model)
  writeModels(models)
  return model
}

export function updateModel(id: string, updates: Partial<SavedModel>): SavedModel | null {
  const models = readModels()
  const index = models.findIndex(model => model.id === id)
  if (index === -1) return null
  models[index] = { ...models[index], ...updates, id }
  writeModels(models)
  return models[index]
}

export function deleteModel(id: string): boolean {
  const models = readModels()
  const next = models.filter(model => model.id !== id)
  writeModels(next)
  return next.length < models.length
}

export function toggleModelPin(id: string): void {
  const model = readModels().find(item => item.id === id)
  if (!model) return
  updateModel(id, { pinned: !model.pinned })
}

export function toggleModelFavorite(id: string): void {
  const model = readModels().find(item => item.id === id)
  if (!model) return
  updateModel(id, { favorite: !model.favorite })
}

export function exportModels(): string {
  return JSON.stringify(readModels(), null, 2)
}

export function importModels(json: string): void {
  const parsed = JSON.parse(json) as SavedModel[]
  if (!Array.isArray(parsed)) throw new Error('Invalid models JSON')
  writeModels(parsed)
}

function readRouting(): SmartRouting {
  return { ...DEFAULT_ROUTING, ...readJson<SmartRouting>(getRoutingPath(), DEFAULT_ROUTING) }
}

function writeRouting(routing: SmartRouting): void {
  atomicWrite(getRoutingPath(), JSON.stringify(routing, null, 2))
}

export function getRouting(): SmartRouting {
  return readRouting()
}

export function setRouting(partial: Partial<SmartRouting>): SmartRouting {
  const updated = { ...readRouting(), ...partial }
  writeRouting(updated)
  return updated
}

export function resolveProfileForTask(task: TaskType): APIProfile | null {
  const routing = readRouting()
  const profileId = routing[task]
  const data = readProfiles()

  if (profileId) {
    const routed = data.profiles.find(profile => profile.id === profileId && profile.enabled)
    if (routed) return routed
  }

  return data.profiles.find(profile => profile.id === data.activeProfileId && profile.enabled)
    ?? data.profiles.find(profile => profile.isDefault && profile.enabled)
    ?? data.profiles.find(profile => profile.enabled)
    ?? null
}

export function detectTaskType(content: string): TaskType {
  const lower = content.toLowerCase()

  if (
    lower.includes('code') ||
    lower.includes('function') ||
    lower.includes('class') ||
    lower.includes('debug') ||
    lower.includes('fix bug') ||
    lower.includes('implement') ||
    lower.includes('refactor') ||
    lower.includes('endpoint') ||
    lower.includes('import ') ||
    lower.includes('export ') ||
    lower.includes('```')
  ) {
    return 'coding'
  }

  if (
    lower.includes('plan') ||
    lower.includes('architecture') ||
    lower.includes('design') ||
    lower.includes('structure') ||
    lower.includes('outline') ||
    lower.includes('strategy') ||
    lower.includes('roadmap') ||
    lower.includes('step by step')
  ) {
    return 'planning'
  }

  if (
    lower.includes('embedding') ||
    lower.includes('vector search') ||
    lower.includes('semantic search') ||
    lower.includes('similarity search')
  ) {
    return 'embeddings'
  }

  if (
    lower.includes('image') ||
    lower.includes('picture') ||
    lower.includes('photo') ||
    lower.includes('diagram') ||
    lower.includes('screenshot') ||
    lower.includes('this image')
  ) {
    return 'vision'
  }

  // Only route to a dedicated voice model for explicit voice/speech intent —
  // generic phrasings like "what is" or "how do I" belong to normal chat.
  if (
    lower.includes('read aloud') ||
    lower.includes('text to speech') ||
    lower.includes('speak this') ||
    lower.includes('say this out loud') ||
    lower.includes('voice mode')
  ) {
    return 'voice'
  }

  return 'chat'
}

export function autoSelectProfile(content: string): APIProfile | null {
  return resolveProfileForTask(detectTaskType(content))
}

function readVoice(): VoiceSettings {
  return { ...DEFAULT_VOICE, ...readJson<VoiceSettings>(getVoicePath(), DEFAULT_VOICE) }
}

function writeVoice(voice: VoiceSettings): void {
  atomicWrite(getVoicePath(), JSON.stringify(voice, null, 2))
}

export function getVoiceSettings(): VoiceSettings {
  return readVoice()
}

export function setVoiceSettings(partial: Partial<VoiceSettings>): VoiceSettings {
  const updated = { ...readVoice(), ...partial }
  writeVoice(updated)
  return updated
}

const MAX_LOGS = 500

export function listDevLogs(): DevLogEntry[] {
  return readJson<DevLogEntry[]>(getDevLogsPath(), [])
}

export function addDevLog(entry: Omit<DevLogEntry, 'id' | 'timestamp'>): DevLogEntry {
  const logs = listDevLogs()
  const full: DevLogEntry = { ...entry, id: generateId(), timestamp: Date.now() }
  logs.unshift(full)
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS
  atomicWrite(getDevLogsPath(), JSON.stringify(logs, null, 2))
  return full
}

export function clearDevLogs(): void {
  atomicWrite(getDevLogsPath(), '[]')
}

export function getDevStats(): DevDashboardStats {
  const logs = listDevLogs()
  const responses = logs.filter(log => log.type === 'response' || log.type === 'error')
  const successful = responses.filter(log => log.status === 'success')
  const failed = responses.filter(log => log.status === 'error')
  const totalTokens = successful.reduce((sum, log) => sum + (log.tokenUsage?.total ?? 0), 0)
  const totalCost = successful.reduce((sum, log) => sum + (log.estimatedCost ?? 0), 0)
  const latencies = successful.map(log => log.latencyMs).filter(Boolean)
  const avgLatency = latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : 0

  const requestsByProvider: Record<string, number> = {}
  const requestsByMode: Record<string, number> = {}

  for (const log of responses) {
    requestsByProvider[log.provider] = (requestsByProvider[log.provider] ?? 0) + 1
    if (log.mode) requestsByMode[log.mode] = (requestsByMode[log.mode] ?? 0) + 1
  }

  return {
    totalRequests: responses.length,
    successfulRequests: successful.length,
    failedRequests: failed.length,
    totalTokens,
    totalCost,
    avgLatencyMs: Math.round(avgLatency),
    requestsByProvider,
    requestsByMode,
  }
}

export function listPlugins(): PluginManifest[] {
  return readJson<PluginManifest[]>(getPluginsPath(), [])
}

export function installPlugin(input: Partial<PluginManifest>): PluginManifest {
  const plugin: PluginManifest = {
    id: input.id ?? generateId(),
    name: input.name ?? 'Unnamed Plugin',
    version: input.version ?? '1.0.0',
    description: input.description ?? '',
    author: input.author ?? 'Unknown',
    enabled: input.enabled ?? true,
    capabilities: input.capabilities ?? [],
    icon: input.icon,
    installedAt: Date.now(),
    config: input.config,
  }

  const plugins = listPlugins().filter(existing => existing.id !== plugin.id)
  plugins.push(plugin)
  atomicWrite(getPluginsPath(), JSON.stringify(plugins, null, 2))
  return plugin
}

export function enablePlugin(id: string): void {
  const plugins = listPlugins()
  const plugin = plugins.find(item => item.id === id)
  if (!plugin) return
  plugin.enabled = true
  atomicWrite(getPluginsPath(), JSON.stringify(plugins, null, 2))
}

export function disablePlugin(id: string): void {
  const plugins = listPlugins()
  const plugin = plugins.find(item => item.id === id)
  if (!plugin) return
  plugin.enabled = false
  atomicWrite(getPluginsPath(), JSON.stringify(plugins, null, 2))
}

export function removePlugin(id: string): void {
  atomicWrite(getPluginsPath(), JSON.stringify(listPlugins().filter(plugin => plugin.id !== id), null, 2))
}

export function migrateLegacyToProfile(): void {
  const profiles = readProfiles()
  if (profiles.profiles.length > 0) return

  const legacy = loadConfig()
  if (!legacy.apiKey && legacy.provider === 'anthropic' && !legacy.model) return

  const cerebras = readAuraCerebrasEnvironment()
  createProfile({
    name: 'Default Profile',
    displayName: 'Default Profile',
    provider: 'cerebras',
    apiKey: cerebras.apiKey || legacy.apiKey,
    baseURL: cerebras.baseURL || legacy.baseURL || PROVIDER_BASE_URLS.cerebras,
    model: cerebras.model || legacy.model || DEFAULT_CONFIG.model,
    organizationId: legacy.organizationId,
    customHeaders: legacy.customHeaders,
    temperature: legacy.temperature,
    topP: legacy.topP,
    maxTokens: Math.min(legacy.maxTokens || DEFAULT_CONFIG.maxTokens, 2048),
    contextLength: legacy.contextLength,
    streaming: legacy.streaming,
    toolCalling: true,
    visionSupport: true,
    isDefault: true,
    enabled: true,
    locked: true,
  })
}
