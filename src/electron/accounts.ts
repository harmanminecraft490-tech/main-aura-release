/**
 * PER-ACCOUNT LOGIN, TIERS & FREE TRIAL
 *
 * Tiers:
 *   - dev     → harmanminecraft490@gmail.com — unlimited (no limits)
 *   - basic   → normal users (free trial unlocked on signup)
 *   - premium → premium users (higher limits)
 *
 * Auth prefers Neon when NEON_DATABASE_URL is set; otherwise uses a local
 * encrypted user store so first-launch account creation always works.
 */

import { neon } from '@neondatabase/serverless'
import { app } from 'electron'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { ensureEnvLoaded } from './aiConfig'

export type AccountTier = 'dev' | 'basic' | 'premium'

export interface AccountStatus {
  loggedIn: boolean
  email: string | null
  userId: string | null
  backend: 'neon' | 'local' | 'none'
  tier: AccountTier
  tierLabel: 'Dev' | 'Basic' | 'Premium'
  unlimited: boolean
  trialActive: boolean
  trialEndsAt: number | null
}

interface SessionRecord {
  email: string
  userId: string
  token: string
  createdAt: number
  plan?: AccountTier
  trialEndsAt?: number | null
}

interface LocalUserRecord {
  id: string
  email: string
  passwordHash: string
  plan: AccountTier
  trialEndsAt: number | null
  createdAt: number
}

type SettingsEnv = Record<string, string | undefined>

/** Owner / developer — no limits. */
export const DEV_EMAIL = 'harmanminecraft490@gmail.com'

const FREE_TRIAL_MS = 14 * 24 * 60 * 60 * 1000

let schemaReadyForUrl: string | null = null

function getDatabaseUrl(settingsEnv: SettingsEnv): string | undefined {
  ensureEnvLoaded()
  return process.env.NEON_DATABASE_URL || settingsEnv.NEON_DATABASE_URL
}

function getSessionPath(): string {
  return path.join(app.getPath('userData'), 'aura-account.json')
}

function getLocalUsersPath(): string {
  return path.join(app.getPath('userData'), 'aura-users-local.json')
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function resolveTier(email: string | null | undefined, storedPlan?: AccountTier | null): AccountTier {
  const normalized = normalizeEmail(email ?? '')
  if (normalized === DEV_EMAIL) return 'dev'
  if (storedPlan === 'premium' || storedPlan === 'dev') return storedPlan
  return 'basic'
}

/** UI labels: Dev / Basic (normal user) / Premium. */
export function tierLabel(tier: AccountTier): 'Dev' | 'Basic' | 'Premium' {
  if (tier === 'dev') return 'Dev'
  if (tier === 'premium') return 'Premium'
  return 'Basic'
}

/** Only the Dev owner account has no limits. */
export function isUnlimitedTier(tier: AccountTier): boolean {
  return tier === 'dev'
}

function buildStatus(session: SessionRecord | null, backend: AccountStatus['backend']): AccountStatus {
  if (!session) {
    return {
      loggedIn: false,
      email: null,
      userId: null,
      backend,
      tier: 'basic',
      tierLabel: 'Basic',
      unlimited: false,
      trialActive: false,
      trialEndsAt: null,
    }
  }

  const tier = resolveTier(session.email, session.plan)
  const trialEndsAt = session.trialEndsAt ?? null
  const trialActive = tier === 'basic' && typeof trialEndsAt === 'number' && trialEndsAt > Date.now()

  return {
    loggedIn: true,
    email: session.email,
    userId: session.userId,
    backend,
    tier,
    tierLabel: tierLabel(tier),
    unlimited: isUnlimitedTier(tier),
    trialActive,
    trialEndsAt,
  }
}

function readSession(): SessionRecord | null {
  try {
    const filePath = getSessionPath()
    if (!fs.existsSync(filePath)) return null
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SessionRecord
    if (!parsed.userId || !parsed.token) return null
    return parsed
  } catch {
    return null
  }
}

function writeSession(session: SessionRecord | null): void {
  const filePath = getSessionPath()
  if (!session) {
    try { fs.rmSync(filePath, { force: true }) } catch { /* ignore */ }
    return
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temp = `${filePath}.tmp`
  fs.writeFileSync(temp, JSON.stringify(session, null, 2), 'utf8')
  fs.renameSync(temp, filePath)
}

function readLocalUsers(): LocalUserRecord[] {
  try {
    if (!fs.existsSync(getLocalUsersPath())) return []
    return JSON.parse(fs.readFileSync(getLocalUsersPath(), 'utf8')) as LocalUserRecord[]
  } catch {
    return []
  }
}

function writeLocalUsers(users: LocalUserRecord[]): void {
  fs.mkdirSync(path.dirname(getLocalUsersPath()), { recursive: true })
  const temp = `${getLocalUsersPath()}.tmp`
  fs.writeFileSync(temp, JSON.stringify(users, null, 2), 'utf8')
  fs.renameSync(temp, getLocalUsersPath())
}

async function ensureSchema(databaseUrl: string): Promise<void> {
  if (schemaReadyForUrl === databaseUrl) return
  const sql = neon(databaseUrl)
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS aura_users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        plan TEXT,
        trial_ends_at BIGINT
      )
    `
    await sql`ALTER TABLE aura_users ADD COLUMN IF NOT EXISTS plan TEXT`
    await sql`ALTER TABLE aura_users ADD COLUMN IF NOT EXISTS trial_ends_at BIGINT`
    await sql`
      CREATE TABLE IF NOT EXISTS aura_sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at BIGINT NOT NULL
      )
    `
    schemaReadyForUrl = databaseUrl
  } catch (error) {
    schemaReadyForUrl = null
    throw new Error(formatAuthDbError(error, 'Could not connect to the account database.'))
  }
}

function formatAuthDbError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const lower = raw.toLowerCase()
  if (lower.includes('fetch failed') || lower.includes('network') || lower.includes('enotfound')) {
    return 'Could not reach Neon. Check NEON_DATABASE_URL and your internet connection.'
  }
  if (lower.includes('password') && lower.includes('authentication')) {
    return 'Neon rejected the database credentials. Check NEON_DATABASE_URL.'
  }
  if (raw.trim()) return raw.trim().slice(0, 240)
  return fallback
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = crypto.scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)
}

function planForNewUser(email: string): { plan: AccountTier; trialEndsAt: number | null } {
  const tier = resolveTier(email)
  if (tier === 'dev') return { plan: 'dev', trialEndsAt: null }
  // New accounts unlock a free trial on Basic.
  return { plan: 'basic', trialEndsAt: Date.now() + FREE_TRIAL_MS }
}

/** Current user id for memory scoping (null when not logged in). */
export function getActiveUserId(): string | null {
  return readSession()?.userId ?? null
}

export function getAccountStatus(settingsEnv: SettingsEnv = {}): AccountStatus {
  const session = readSession()
  const backend = getDatabaseUrl(settingsEnv) ? 'neon' : (session ? 'local' : 'local')
  return buildStatus(session, backend === 'neon' ? 'neon' : 'local')
}

/** Soft usage gate — Dev/Premium never limited; Basic may be trial-gated later. */
export function getAccountLimits(settingsEnv: SettingsEnv = {}): {
  unlimited: boolean
  tier: AccountTier
  maxRequestsPerDay: number | null
  allowed: boolean
  reason?: string
} {
  const status = getAccountStatus(settingsEnv)
  if (!status.loggedIn) {
    return {
      unlimited: false,
      tier: 'basic',
      maxRequestsPerDay: 0,
      allowed: false,
      reason: 'Create an Aura account to unlock your free trial.',
    }
  }
  if (status.unlimited || status.tier === 'dev') {
    return { unlimited: true, tier: status.tier, maxRequestsPerDay: null, allowed: true }
  }
  if (status.tier === 'premium') {
    return { unlimited: false, tier: status.tier, maxRequestsPerDay: 2000, allowed: true }
  }
  // Normal user · Basic (includes free trial)
  return { unlimited: false, tier: status.tier, maxRequestsPerDay: 200, allowed: true }
}

export async function signup(settingsEnv: SettingsEnv, email: string, password: string): Promise<AccountStatus> {
  const trimmed = normalizeEmail(email)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) throw new Error('Enter a valid email address.')
  if (password.length < 6) throw new Error('Password must be at least 6 characters.')

  const { plan, trialEndsAt } = planForNewUser(trimmed)
  const databaseUrl = getDatabaseUrl(settingsEnv)

  if (databaseUrl) {
    try {
      await ensureSchema(databaseUrl)
      const sql = neon(databaseUrl)
      const existing = await sql`SELECT id FROM aura_users WHERE email = ${trimmed}`
      if (existing.length > 0) throw new Error('An account with that email already exists.')

      const userId = crypto.randomUUID()
      const passwordHash = hashPassword(password)
      await sql`
        INSERT INTO aura_users (id, email, password_hash, created_at, plan, trial_ends_at)
        VALUES (${userId}, ${trimmed}, ${passwordHash}, ${Date.now()}, ${plan}, ${trialEndsAt})
      `
      return await login(settingsEnv, trimmed, password)
    } catch (error) {
      if (error instanceof Error && isAuthUserError(error.message)) throw error
      throw new Error(formatAuthDbError(error, 'Sign up failed. Check your connection and try again.'))
    }
  }

  // Local fallback — first-launch signup still works without Neon.
  const users = readLocalUsers()
  if (users.some(user => user.email === trimmed)) throw new Error('An account with that email already exists.')
  const userId = crypto.randomUUID()
  users.push({
    id: userId,
    email: trimmed,
    passwordHash: hashPassword(password),
    plan,
    trialEndsAt,
    createdAt: Date.now(),
  })
  writeLocalUsers(users)
  writeSession({
    email: trimmed,
    userId,
    token: crypto.randomBytes(32).toString('hex'),
    createdAt: Date.now(),
    plan,
    trialEndsAt,
  })
  return getAccountStatus(settingsEnv)
}

function isAuthUserError(message: string): boolean {
  return [
    'Enter a valid email address.',
    'Password must be at least 6 characters.',
    'An account with that email already exists.',
    'No account found with that email.',
    'Incorrect password.',
    'Incorrect email or password.',
  ].some(item => message.includes(item))
    || message.startsWith('Could not reach Neon')
    || message.startsWith('Neon rejected')
    || message.startsWith('Could not connect to the account database')
}

export async function login(settingsEnv: SettingsEnv, email: string, password: string): Promise<AccountStatus> {
  const trimmed = normalizeEmail(email)
  if (!trimmed) throw new Error('Enter a valid email address.')
  if (!password) throw new Error('Enter your password.')

  const databaseUrl = getDatabaseUrl(settingsEnv)

  if (databaseUrl) {
    try {
      await ensureSchema(databaseUrl)
      const sql = neon(databaseUrl)
      const rows = await sql`SELECT id, password_hash, plan, trial_ends_at FROM aura_users WHERE email = ${trimmed}`
      if (rows.length === 0) throw new Error('No account found with that email.')
      if (!verifyPassword(password, String(rows[0].password_hash))) throw new Error('Incorrect password.')

      const userId = String(rows[0].id)
      const storedPlan = (rows[0].plan as AccountTier | null) ?? null
      const plan = resolveTier(trimmed, storedPlan)
      const trialEndsAt = rows[0].trial_ends_at != null ? Number(rows[0].trial_ends_at) : null
      // Persist resolved plan (promotes Dev email even if row said basic).
      if (plan !== storedPlan) {
        await sql`UPDATE aura_users SET plan = ${plan} WHERE id = ${userId}`
      }

      const token = crypto.randomBytes(32).toString('hex')
      await sql`INSERT INTO aura_sessions (token, user_id, created_at) VALUES (${token}, ${userId}, ${Date.now()})`
      writeSession({
        email: trimmed,
        userId,
        token,
        createdAt: Date.now(),
        plan,
        trialEndsAt: plan === 'basic' ? trialEndsAt : null,
      })
      return getAccountStatus(settingsEnv)
    } catch (error) {
      if (error instanceof Error && isAuthUserError(error.message)) throw error
      throw new Error(formatAuthDbError(error, 'Login failed. Check your connection and try again.'))
    }
  }

  const users = readLocalUsers()
  const user = users.find(item => item.email === trimmed)
  if (!user) throw new Error('No account found with that email.')
  if (!verifyPassword(password, user.passwordHash)) throw new Error('Incorrect password.')

  const plan = resolveTier(trimmed, user.plan)
  if (plan !== user.plan) {
    user.plan = plan
    writeLocalUsers(users)
  }

  writeSession({
    email: trimmed,
    userId: user.id,
    token: crypto.randomBytes(32).toString('hex'),
    createdAt: Date.now(),
    plan,
    trialEndsAt: plan === 'basic' ? user.trialEndsAt : null,
  })
  return getAccountStatus(settingsEnv)
}

export async function logout(): Promise<AccountStatus> {
  const session = readSession()
  if (session) {
    const databaseUrl = getDatabaseUrl({})
    if (databaseUrl) {
      try {
        const sql = neon(databaseUrl)
        await sql`DELETE FROM aura_sessions WHERE token = ${session.token}`
      } catch { /* best-effort */ }
    }
  }
  writeSession(null)
  return getAccountStatus({})
}
