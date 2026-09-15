/**
 * CONVERSATION & PANEL-SESSION PERSISTENCE
 *
 * Chats used to live only in the renderer's in-memory Zustand store — closing
 * Aura (or switching tabs) destroyed them. This module gives the main process a
 * single durable JSON store (userData/aura-chats.json) for:
 *
 *   - chat conversations (ChatView + sidebar)
 *   - panel sessions (Agent / Code / Design threads)
 *
 * Writes are atomic (temp file + rename) so a crash mid-write never corrupts
 * the file. This is a LOCAL store; per-account cloud sync lives in accounts.ts.
 */

import { app } from 'electron'
import * as fs from 'fs'
import { promises as fsp } from 'fs'
import * as path from 'path'
import type { PersistedChats } from '../types'

const STATE_VERSION = 1

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'aura-chats.json')
}

function readJson(filePath: string): unknown {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

/** Load the persisted chat state. Always returns a valid shape. */
export function loadChats(): PersistedChats {
  const raw = readJson(getStorePath()) as Partial<PersistedChats> | null
  return {
    conversations: Array.isArray(raw?.conversations) ? raw.conversations : [],
    panelSessions: raw?.panelSessions && typeof raw.panelSessions === 'object' ? raw.panelSessions : {},
  }
}

/** Persist the chat state atomically (temp file + rename). Async so the main
 *  process is never blocked on disk I/O. */
export async function saveChats(state: PersistedChats): Promise<void> {
  const filePath = getStorePath()
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  const temp = `${filePath}.tmp`
  await fsp.writeFile(temp, JSON.stringify({ version: STATE_VERSION, ...state }), 'utf8')
  await fsp.rename(temp, filePath)
}
