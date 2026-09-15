/**
 * Atomic JSON persistence for the Electron main process.
 *
 * Each store is one file under userData/aura-vnext/. Writes go through a
 * temp-file + rename so a crash never corrupts state. All stores are
 * versioned for future migrations.
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { DiscoveredModel, ModelUserState, ProviderConfig } from '../providers/types'
import type { AuraMappings } from '../models/aura-models/definitions'
import type { SuggestionState } from '../models/aura-models/suggestions'

const STORE_VERSION = 1

interface StoreFile<T> {
  version: number
  data: T
}

function storageDir(): string {
  const dir = path.join(app.getPath('userData'), 'aura-vnext')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function storePath(name: string): string {
  return path.join(storageDir(), `${name}.json`)
}

function readStore<T>(name: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(storePath(name), 'utf8')
    const parsed = JSON.parse(raw) as StoreFile<T>
    return parsed.data ?? fallback
  } catch {
    return fallback
  }
}

function writeStore<T>(name: string, data: T): void {
  const file: StoreFile<T> = { version: STORE_VERSION, data }
  const target = storePath(name)
  const temp = `${target}.tmp`
  fs.writeFileSync(temp, JSON.stringify(file, null, 2), 'utf8')
  fs.renameSync(temp, target)
}

// ─── Providers ───────────────────────────────────────────────────────────────

export function loadProviders(): ProviderConfig[] {
  return readStore<ProviderConfig[]>('providers', [])
}

export function saveProviders(providers: ProviderConfig[]): void {
  writeStore('providers', providers)
}

// ─── Discovered model cache (per provider) ───────────────────────────────────

export type ModelCache = Record<string, DiscoveredModel[]>

export function loadModelCache(): ModelCache {
  return readStore<ModelCache>('model-cache', {})
}

export function saveModelCache(cache: ModelCache): void {
  writeStore('model-cache', cache)
}

// ─── Per-model user state (favorite / pin / hide) ────────────────────────────

export function loadModelUserState(): Record<string, ModelUserState> {
  return readStore<Record<string, ModelUserState>>('model-user-state', {})
}

export function saveModelUserState(state: Record<string, ModelUserState>): void {
  writeStore('model-user-state', state)
}

// ─── Aura mappings ───────────────────────────────────────────────────────────

export function loadMappings(): AuraMappings {
  return readStore<AuraMappings>('aura-mappings', {})
}

export function saveMappings(mappings: AuraMappings): void {
  writeStore('aura-mappings', mappings)
}

// ─── Mapping suggestions (dismissed set) ─────────────────────────────────────

export function loadSuggestionState(): SuggestionState {
  return readStore<SuggestionState>('suggestion-state', { dismissed: [] })
}

export function saveSuggestionState(state: SuggestionState): void {
  writeStore('suggestion-state', state)
}

// ─── App settings ────────────────────────────────────────────────────────────

export interface AppSettings {
  developerMode: boolean
  /** Default Aura model for new chats. */
  defaultAuraModel: string
  sendOnEnter: boolean
  reduceMotion: boolean
}

const DEFAULT_SETTINGS: AppSettings = {
  developerMode: false,
  defaultAuraModel: 'aura-auto',
  sendOnEnter: true,
  reduceMotion: false,
}

export function loadSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...readStore<Partial<AppSettings>>('settings', {}) }
}

export function saveSettings(settings: AppSettings): void {
  writeStore('settings', settings)
}
