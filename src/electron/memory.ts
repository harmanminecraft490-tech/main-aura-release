import { neon } from '@neondatabase/serverless'
import { app } from 'electron'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { getActiveUserId } from './accounts'

export type AuraMemory = {
  id: string
  type: 'short_term' | 'long_term' | 'preference' | 'project' | 'coding' | 'learning' | 'goal'
  content: string
  context: string
  relevance: number
  createdAt: number
  expiresAt?: number | null
}

type CreateMemoryInput = {
  type?: AuraMemory['type']
  content: string
  context?: string
  relevance?: number
  expiresAt?: number | null
}

type SettingsEnv = Record<string, string | undefined>

let schemaReadyForUrl: string | null = null

function getDatabaseUrl(settingsEnv: SettingsEnv): string | undefined {
  // Keep in sync with accounts — Neon URL may only live in .env / .env.example.
  try {
    // Lazy require avoids circular import with accounts during module init.
    const { ensureEnvLoaded } = require('./aiConfig') as typeof import('./aiConfig')
    ensureEnvLoaded()
  } catch { /* ignore */ }
  return process.env.NEON_DATABASE_URL || settingsEnv.NEON_DATABASE_URL || 'postgresql://neondb_owner:npg_aPSd5Ofq2szU@ep-late-boat-atgavgxe-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
}

function getLocalMemoryPath() {
  return path.join(app.getPath('userData'), 'aura-memories.json')
}

function readLocalMemories(): AuraMemory[] {
  try {
    const file = getLocalMemoryPath()
    if (!fs.existsSync(file)) return []
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeLocalMemories(memories: AuraMemory[]) {
  const file = getLocalMemoryPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(memories, null, 2), 'utf8')
}

async function ensureSchema(databaseUrl: string) {
  if (schemaReadyForUrl === databaseUrl) return
  const sql = neon(databaseUrl)
  await sql`
    CREATE TABLE IF NOT EXISTS aura_memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '',
      relevance DOUBLE PRECISION NOT NULL DEFAULT 0.5,
      created_at BIGINT NOT NULL,
      expires_at BIGINT
    )
  `
  // Per-account scoping (idempotent; existing rows stay NULL = anonymous/local).
  await sql`ALTER TABLE aura_memories ADD COLUMN IF NOT EXISTS user_id TEXT`
  await sql`CREATE INDEX IF NOT EXISTS aura_memories_user_idx ON aura_memories (user_id)`
  await sql`CREATE INDEX IF NOT EXISTS aura_memories_type_idx ON aura_memories (type)`
  await sql`CREATE INDEX IF NOT EXISTS aura_memories_created_at_idx ON aura_memories (created_at DESC)`
  schemaReadyForUrl = databaseUrl
}

function normalizeMemory(row: any): AuraMemory {
  return {
    id: String(row.id),
    type: row.type as AuraMemory['type'],
    content: String(row.content),
    context: String(row.context ?? ''),
    relevance: Number(row.relevance ?? 0.5),
    createdAt: Number(row.created_at ?? row.createdAt ?? Date.now()),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
  }
}

export async function listMemories(settingsEnv: SettingsEnv): Promise<{ backend: 'neon' | 'local'; memories: AuraMemory[] }> {
  const databaseUrl = getDatabaseUrl(settingsEnv)
  const now = Date.now()

  if (!databaseUrl) {
    const memories = readLocalMemories()
      .filter(memory => !memory.expiresAt || memory.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt)
    return { backend: 'local', memories }
  }

  await ensureSchema(databaseUrl)
  const sql = neon(databaseUrl)
  // Per-account scoping: logged-in users see their own memories plus any
  // anonymous ones (pre-login / device-local rows) so nothing "disappears"
  // on login. Anonymous users see only anonymous memories.
  const userId = getActiveUserId()
  const rows = userId
    ? await sql`
        SELECT id, type, content, context, relevance, created_at, expires_at
        FROM aura_memories
        WHERE (user_id = ${userId} OR user_id IS NULL)
          AND (expires_at IS NULL OR expires_at > ${now})
        ORDER BY created_at DESC
        LIMIT 500
      `
    : await sql`
        SELECT id, type, content, context, relevance, created_at, expires_at
        FROM aura_memories
        WHERE user_id IS NULL
          AND (expires_at IS NULL OR expires_at > ${now})
        ORDER BY created_at DESC
        LIMIT 500
      `
  return { backend: 'neon', memories: rows.map(normalizeMemory) }
}

export async function createMemory(settingsEnv: SettingsEnv, input: CreateMemoryInput): Promise<{ backend: 'neon' | 'local'; memory: AuraMemory }> {
  const memory: AuraMemory = {
    id: crypto.randomUUID(),
    type: input.type ?? 'long_term',
    content: input.content.trim(),
    context: input.context?.trim() ?? '',
    relevance: input.relevance ?? 0.7,
    createdAt: Date.now(),
    expiresAt: input.expiresAt ?? null,
  }

  if (!memory.content) throw new Error('Memory content is required.')

  const databaseUrl = getDatabaseUrl(settingsEnv)
  if (!databaseUrl) {
    const memories = readLocalMemories()
    memories.unshift(memory)
    writeLocalMemories(memories)
    return { backend: 'local', memory }
  }

  await ensureSchema(databaseUrl)
  const sql = neon(databaseUrl)
  const userId = getActiveUserId()
  await sql`
    INSERT INTO aura_memories (id, type, content, context, relevance, created_at, expires_at, user_id)
    VALUES (${memory.id}, ${memory.type}, ${memory.content}, ${memory.context}, ${memory.relevance}, ${memory.createdAt}, ${memory.expiresAt ?? null}, ${userId ?? null})
  `
  return { backend: 'neon', memory }
}

type UpdateMemoryPatch = {
  content?: string
  type?: AuraMemory['type']
  context?: string
  relevance?: number
  expiresAt?: number | null
}

export async function updateMemory(
  settingsEnv: SettingsEnv,
  id: string,
  patch: UpdateMemoryPatch
): Promise<{ backend: 'neon' | 'local'; memory: AuraMemory | null }> {
  const databaseUrl = getDatabaseUrl(settingsEnv)

  const normalizedContent = patch.content?.trim()
  if (patch.content !== undefined && !normalizedContent) {
    throw new Error('Memory content cannot be empty.')
  }

  if (!databaseUrl) {
    const memories = readLocalMemories()
    const index = memories.findIndex(memory => memory.id === id)
    if (index === -1) return { backend: 'local', memory: null }
    const existing = memories[index]
    const updated: AuraMemory = {
      ...existing,
      content: normalizedContent ?? existing.content,
      type: patch.type ?? existing.type,
      context: patch.context !== undefined ? patch.context.trim() : existing.context,
      relevance: patch.relevance ?? existing.relevance,
      expiresAt: patch.expiresAt !== undefined ? patch.expiresAt : existing.expiresAt,
    }
    memories[index] = updated
    writeLocalMemories(memories)
    return { backend: 'local', memory: updated }
  }

  await ensureSchema(databaseUrl)
  const sql = neon(databaseUrl)
  const userId = getActiveUserId()
  const rows = userId
    ? await sql`
        UPDATE aura_memories SET
          content = COALESCE(${normalizedContent ?? null}, content),
          type = COALESCE(${patch.type ?? null}, type),
          context = COALESCE(${patch.context !== undefined ? patch.context.trim() : null}, context),
          relevance = COALESCE(${patch.relevance ?? null}, relevance),
          expires_at = COALESCE(${patch.expiresAt ?? null}, expires_at)
        WHERE id = ${id} AND (user_id = ${userId} OR user_id IS NULL)
        RETURNING id, type, content, context, relevance, created_at, expires_at
      `
    : await sql`
        UPDATE aura_memories SET
          content = COALESCE(${normalizedContent ?? null}, content),
          type = COALESCE(${patch.type ?? null}, type),
          context = COALESCE(${patch.context !== undefined ? patch.context.trim() : null}, context),
          relevance = COALESCE(${patch.relevance ?? null}, relevance),
          expires_at = COALESCE(${patch.expiresAt ?? null}, expires_at)
        WHERE id = ${id} AND user_id IS NULL
        RETURNING id, type, content, context, relevance, created_at, expires_at
      `
  return { backend: 'neon', memory: rows[0] ? normalizeMemory(rows[0]) : null }
}

export async function deleteMemory(settingsEnv: SettingsEnv, id: string): Promise<{ backend: 'neon' | 'local'; deleted: boolean }> {
  const databaseUrl = getDatabaseUrl(settingsEnv)
  if (!databaseUrl) {
    const before = readLocalMemories()
    const after = before.filter(memory => memory.id !== id)
    writeLocalMemories(after)
    return { backend: 'local', deleted: before.length !== after.length }
  }

  await ensureSchema(databaseUrl)
  const sql = neon(databaseUrl)
  const userId = getActiveUserId()
  if (userId) {
    await sql`DELETE FROM aura_memories WHERE id = ${id} AND (user_id = ${userId} OR user_id IS NULL)`
  } else {
    await sql`DELETE FROM aura_memories WHERE id = ${id} AND user_id IS NULL`
  }
  return { backend: 'neon', deleted: true }
}

function tokenize(input: string): Set<string> {
  return new Set(
    input
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length >= 3)
  )
}

function scoreMemory(memory: AuraMemory, query: string): number {
  const queryTokens = tokenize(query)
  if (queryTokens.size === 0) return memory.relevance

  const memoryTokens = tokenize(`${memory.type} ${memory.content} ${memory.context}`)
  let overlap = 0
  for (const token of queryTokens) {
    if (memoryTokens.has(token)) overlap += 1
  }

  const recencyBoost = Math.max(0, 1 - (Date.now() - memory.createdAt) / (1000 * 60 * 60 * 24 * 90)) * 0.2
  return memory.relevance + overlap / queryTokens.size + recencyBoost
}

export async function getRelevantMemories(settingsEnv: SettingsEnv, query: string, limit = 8): Promise<AuraMemory[]> {
  const { memories } = await listMemories(settingsEnv)
  return memories
    .map(memory => ({ memory, score: scoreMemory(memory, query) }))
    .filter(item => item.score > 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.memory)
}

export async function buildMemoryContext(settingsEnv: SettingsEnv, query: string): Promise<string> {
  const relevant = await getRelevantMemories(settingsEnv, query)
  if (relevant.length === 0) return ''

  return [
    'Relevant Aura memory. Use naturally when helpful; do not mention memory unless it matters:',
    ...relevant.map(memory => `- [${memory.type}] ${memory.content}${memory.context ? ` (${memory.context})` : ''}`),
  ].join('\n')
}

export async function maybeCaptureUserMemory(settingsEnv: SettingsEnv, text: string): Promise<AuraMemory | null> {
  const trimmed = text.trim()
  const rememberMatch = trimmed.match(/^(?:remember(?: that)?|please remember(?: that)?|note(?: that)?|save this(?: as memory)?):?\s+(.+)/i)
  if (!rememberMatch) return null

  const content = rememberMatch[1].trim()
  if (!content) return null

  let type: AuraMemory['type'] = 'long_term'
  const lower = content.toLowerCase()
  if (lower.includes('prefer') || lower.includes('i like') || lower.includes('my style')) type = 'preference'
  if (lower.includes('project') || lower.includes('aura')) type = 'project'
  if (lower.includes('code') || lower.includes('typescript') || lower.includes('react') || lower.includes('electron')) type = 'coding'
  if (lower.includes('goal') || lower.includes('want to') || lower.includes('trying to')) type = 'goal'

  const { memory } = await createMemory(settingsEnv, {
    type,
    content,
    context: 'Captured from an explicit user memory request.',
    relevance: 0.9,
  })
  return memory
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTOMATIC MEMORY CAPTURE
// ─────────────────────────────────────────────────────────────────────────────
//
// The explicit "remember that …" path above only fires when the user asks. Aura
// also captures durable facts on its own from ordinary conversation (identity,
// location, work, tech stack, preferences, goals) so it remembers people and
// projects without being told to. Capture is deliberately conservative:
//   - only short, declarative, personal statements
//   - questions and app-commands are skipped
//   - deduplicated against existing memories
//   - max 2 facts per message

const DURABLE_FACT_PATTERNS: Array<{
  re: RegExp
  type: AuraMemory['type']
  make: (match: RegExpMatchArray) => string
}> = [
  {
    re: /\bmy name is\s+([A-Za-z][A-Za-z .'-]{1,40}?)(?=\s+(?:and|but|my|i)\b|,|\.|$)/i,
    type: 'preference',
    make: match => `User's name is ${match[1].trim()}.`,
  },
  {
    re: /\bi (?:live|am based|am located|stay) (?:in|at)\s+([A-Za-z][A-Za-z ,.'-]{2,40})\.?$/i,
    type: 'long_term',
    make: match => `User lives in ${match[1].trim()}.`,
  },
  {
    re: /\bi(?:'m| am) (?:from|based in)\s+([A-Za-z][A-Za-z ,.'-]{2,40})\.?$/i,
    type: 'long_term',
    make: match => `User is from ${match[1].trim()}.`,
  },
  {
    re: /\bi (?:work|am working) (?:as|at|for)\s+([A-Za-z][A-Za-z .&'-]{2,40})\.?$/i,
    type: 'long_term',
    make: match => `User works as/at ${match[1].trim()}.`,
  },
  {
    re: /\bi (?:use|code in|work in|write in|am using)\s+([A-Za-z][A-Za-z0-9 +.#\-]{2,40})\.?$/i,
    type: 'coding',
    make: match => `User works with ${match[1].trim()}.`,
  },
  {
    re: /\bi (?:prefer|like|love|enjoy)\s+([A-Za-z][A-Za-z0-9 ,.'#+\-]{3,50})\.?$/i,
    type: 'preference',
    make: match => `User prefers ${match[1].trim()}.`,
  },
  {
    re: /\bmy (?:favorite|favourite)\s+(.{2,30}?)\s+is\s+(.{2,40})\.?$/i,
    type: 'preference',
    make: match => `User's favorite ${match[1].trim()} is ${match[2].trim()}.`,
  },
  {
    re: /\bi (?:want to learn|am learning|am trying to learn|would like to learn)\s+(.{3,60})\.?$/i,
    type: 'learning',
    make: match => `User is learning ${match[1].trim()}.`,
  },
  {
    re: /\bmy goal is\s+(.{3,60})\.?$/i,
    type: 'goal',
    make: match => `User's goal: ${match[1].trim()}.`,
  },
]

function looksLikeAQuestion(text: string): boolean {
  if (text.includes('?')) return true
  return /^(what|how|who|when|where|why|can|could|is|are|do|does|should|which)\b/i.test(text)
}

function looksLikeAnAppCommand(text: string): boolean {
  return /^(remember|note|save|search|look up|find|make|create|build|write|fix|review|refactor|design|plan|summari[sz]e|explain|translate)\b/i.test(text)
}

/** Capture durable user facts automatically. Returns the newly created memories. */
export async function autoCaptureMemories(settingsEnv: SettingsEnv, text: string): Promise<AuraMemory[]> {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return []
  // Only short, declarative personal statements qualify.
  if (trimmed.length > 240) return []
  if (looksLikeAQuestion(trimmed) || looksLikeAnAppCommand(trimmed)) return []

  const created: AuraMemory[] = []
  const seen = new Set<string>()
  let existing = new Set<string>()
  try {
    existing = new Set((await listMemories(settingsEnv)).memories.map(memory => memory.content.toLowerCase()))
  } catch { /* dedupe best-effort */ }

  for (const pattern of DURABLE_FACT_PATTERNS) {
    const match = pattern.re.exec(trimmed)
    if (!match) continue
    const content = pattern.make(match)
    if (content.length < 8 || seen.has(content.toLowerCase()) || existing.has(content.toLowerCase())) continue
    seen.add(content.toLowerCase())
    if (created.length >= 2) break // never flood memory from one message
    try {
      const { memory } = await createMemory(settingsEnv, {
        type: pattern.type,
        content,
        context: 'Automatically captured from conversation.',
        relevance: 0.55,
      })
      created.push(memory)
    } catch { /* best-effort */ }
  }
  return created
}
