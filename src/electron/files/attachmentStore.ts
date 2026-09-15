/**
 * ATTACHMENT STORE — in-memory registry of uploaded files.
 *
 * Each attachment is validated, parsed, chunked and keyword-indexed when it is
 * added. `retrieveContext` returns ONLY the chunks relevant to a query, capped
 * by a token budget, so the AI never receives a whole document.
 *
 * Processing is async and non-blocking; the renderer polls/awaits each add.
 */

import * as fs from 'fs'
import * as crypto from 'crypto'
import { readFileContent, chunkText, buildIndex, retrieveRelevant, estimateTokens, type TokenIndex, type FileChunk } from './fileReader'

const MAX_FILE_BYTES = 200 * 1024 * 1024 // 200 MB guard
const DEFAULT_RETRIEVE_BUDGET_TOKENS = 2000

export type AttachmentStatus = 'processing' | 'ready' | 'error'

export interface AttachmentRecord {
  id: string
  name: string
  path: string
  mimeType: string
  ext: string
  size: number
  status: AttachmentStatus
  parser: string
  pages?: number
  lines?: number
  words?: number
  chunksCount: number
  indexed: boolean
  metadata: Record<string, unknown>
  processingMs?: number
  error?: string
  createdAt: number
}

export interface AttachmentSummary {
  id: string
  name: string
  type: string
  ext: string
  size: number
  status: AttachmentStatus
  parser: string
  pages?: number
  lines?: number
  words?: number
  chunks: number
  indexed: boolean
  error?: string
  processingMs?: number
  createdAt: number
}

interface StoredAttachment {
  record: AttachmentRecord
  text: string
  chunks: FileChunk[]
  index: TokenIndex
}

export class AttachmentStore {
  private store = new Map<string, StoredAttachment>()

  /** Process one or more file paths. Never throws for a single bad file. */
  async add(paths: string[]): Promise<AttachmentSummary[]> {
    const summaries: AttachmentSummary[] = []
    for (const filePath of paths) {
      summaries.push(this.addOne(filePath))
    }
    return summaries
  }

  private addOne(filePath: string): AttachmentSummary {
    const id = crypto.randomUUID()
    const name = filePath.split(/[\\/]/).pop() ?? filePath
    const started = Date.now()

    const placeholder: StoredAttachment = {
      record: {
        id,
        name,
        path: filePath,
        mimeType: 'application/octet-stream',
        ext: filePath.split('.').pop()?.toLowerCase() ?? '',
        size: 0,
        status: 'processing',
        parser: '…',
        chunksCount: 0,
        indexed: false,
        metadata: {},
        createdAt: Date.now(),
      },
      text: '',
      chunks: [],
      index: new Map(),
    }
    this.store.set(id, placeholder)

    // Process synchronously inside the IPC call (reads are local + fast); the
    // renderer shows an optimistic "processing" state for large files.
    try {
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) throw new Error('Not a regular file')
      if (stat.size > MAX_FILE_BYTES) throw new Error(`File exceeds ${MAX_FILE_BYTES / (1024 * 1024)} MB limit`)

      const extracted = readFileContent(filePath)
      const text = extracted.text ?? ''
      const chunks: FileChunk[] = chunkText(text).map((chunk, chunkIndex) => ({ id: chunkIndex, text: chunk }))
      const index = buildIndex(chunks)
      const words = text ? text.split(/\s+/).filter(Boolean).length : 0
      const lines = text ? text.split('\n').length : 0

      placeholder.record = {
        ...placeholder.record,
        mimeType: extracted.mimeType,
        ext: extracted.ext,
        size: stat.size,
        status: 'ready',
        parser: extracted.parser,
        pages: typeof extracted.metadata.pages === 'number' ? extracted.metadata.pages : undefined,
        lines: text ? lines : undefined,
        words: text ? words : undefined,
        chunksCount: chunks.length,
        indexed: chunks.length > 0,
        metadata: extracted.metadata,
        processingMs: Date.now() - started,
        error: extracted.error,
      }
      placeholder.text = text
      placeholder.chunks = chunks
      placeholder.index = index
      return this.toSummary(placeholder.record)
    } catch (error) {
      placeholder.record = {
        ...placeholder.record,
        status: 'error',
        error: error instanceof Error ? error.message : 'Processing failed',
        processingMs: Date.now() - started,
      }
      return this.toSummary(placeholder.record)
    }
  }

  list(): AttachmentSummary[] {
    return [...this.store.values()].map(item => this.toSummary(item.record))
  }

  get(id: string): StoredAttachment | undefined {
    return this.store.get(id)
  }

  remove(id: string): boolean {
    return this.store.delete(id)
  }

  clear(): void {
    this.store.clear()
  }

  /**
   * Token-efficient context retrieval across all ready attachments. Returns a
   * labelled block of the most relevant chunks, truncated to maxTokens.
   */
  retrieveContext(query: string, maxTokens = DEFAULT_RETRIEVE_BUDGET_TOKENS): string {
    const relevant: Array<{ fileName: string; chunk: FileChunk }> = []
    for (const item of this.store.values()) {
      if (item.record.status !== 'ready') continue
      for (const chunk of retrieveRelevant(item.index, item.chunks, query, 3)) {
        relevant.push({ fileName: item.record.name, chunk })
      }
    }
    if (relevant.length === 0) return ''

    const sections: string[] = []
    let used = 0
    for (const { fileName, chunk } of relevant) {
      const block = `### ${fileName}\n${chunk.text}`
      const tokens = estimateTokens(block)
      if (used + tokens > maxTokens) break
      sections.push(block)
      used += tokens
    }
    return sections.length ? `## Attached files\n${sections.join('\n\n')}` : ''
  }

  private toSummary(record: AttachmentRecord): AttachmentSummary {
    return {
      id: record.id,
      name: record.name,
      type: record.mimeType,
      ext: record.ext,
      size: record.size,
      status: record.status,
      parser: record.parser,
      pages: record.pages,
      lines: record.lines,
      words: record.words,
      chunks: record.chunksCount,
      indexed: record.indexed,
      error: record.error,
      processingMs: record.processingMs,
      createdAt: record.createdAt,
    }
  }
}

export const attachmentStore = new AttachmentStore()
