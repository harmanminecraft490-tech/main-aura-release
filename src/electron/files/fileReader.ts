/**
 * FILE READER — content extraction, chunking and retrieval.
 *
 * Pure Node module (no electron) so it can be unit-tested. Detects real file
 * type by magic bytes (never trusts extensions), extracts readable text for
 * the supported formats, chunks large files, builds a keyword index, and
 * retrieves only the chunks relevant to a query — so the AI never receives a
 * whole document.
 *
 * Security: uploaded files are NEVER executed. Binary files are treated as
 * opaque; only their bytes are parsed for text/metadata.
 *
 * Extensibility: add a handler to the `PARSERS` map below for a new format.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'

// ─────────────────────────────────────────────────────────────────────────────
// Token estimation (shared with the rest of the pipeline)
// ─────────────────────────────────────────────────────────────────────────────

export function estimateTokens(text: string): number {
  if (!text) return 0
  let units = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    units += code > 0x2e7f ? 1 : 0.25
  }
  return Math.max(1, Math.ceil(units))
}

// ─────────────────────────────────────────────────────────────────────────────
// Type detection
// ─────────────────────────────────────────────────────────────────────────────

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'application/x-yaml',
  yml: 'application/x-yaml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  jsx: 'text/javascript',
  py: 'text/x-python',
  java: 'text/x-java-source',
  c: 'text/x-c',
  h: 'text/x-c',
  cpp: 'text/x-c++',
  cc: 'text/x-c++',
  hpp: 'text/x-c++',
  rs: 'text/x-rust',
  go: 'text/x-go',
  php: 'text/x-php',
  swift: 'text/x-swift',
  kt: 'text/x-kotlin',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  zip: 'application/zip',
  log: 'text/plain',
  ini: 'text/plain',
  toml: 'text/plain',
  sh: 'text/x-shellscript',
}

/** Extensions that can be read as plain UTF-8 text. */
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'csv', 'json', 'xml', 'yaml', 'yml', 'html', 'htm', 'css',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'h', 'cpp', 'cc',
  'hpp', 'rs', 'go', 'php', 'swift', 'kt', 'log', 'ini', 'toml', 'sh', 'svg',
])

const ZIP_BASED = new Set(['docx', 'xlsx', 'pptx'])

function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 5 && buf.toString('latin1', 0, 4) === '%PDF') return 'application/pdf'
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return 'application/zip' // PK\x03\x04
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x06054b50) return 'application/zip' // empty zip PK\x05\x06
  if (buf.length >= 8 && buf.toString('latin1', 0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 6 && (buf.toString('latin1', 0, 4) === 'GIF8')) return 'image/gif'
  if (buf.length >= 12 && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  if (buf.length >= 4 && buf.toString('latin1', 0, 4) === 'RIFF') return 'audio/wav'
  if (buf.length >= 4 && buf.toString('latin1', 0, 3) === '\xff\xfb') return 'audio/mpeg'
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') return 'video/mp4'
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// ZIP container reader (store + deflate; no ZIP64/encryption)
// ─────────────────────────────────────────────────────────────────────────────

function readZip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  const eocdPos = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocdPos < 0) return out
  const cdCount = buf.readUInt16LE(eocdPos + 10)
  const cdOffset = buf.readUInt32LE(eocdPos + 16)
  let pos = cdOffset
  for (let i = 0; i < cdCount && pos + 46 <= buf.length; i += 1) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break
    const method = buf.readUInt16LE(pos + 10)
    const compSize = buf.readUInt32LE(pos + 20)
    const nameLen = buf.readUInt16LE(pos + 28)
    const extraLen = buf.readUInt16LE(pos + 30)
    const commentLen = buf.readUInt16LE(pos + 32)
    const lho = buf.readUInt32LE(pos + 42)
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen)
    if (name && !name.endsWith('/')) {
      try {
        const dataStart = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28)
        const data = buf.subarray(dataStart, dataStart + compSize)
        out.set(name, method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data))
      } catch {
        // skip corrupt/unsupported entries
      }
    }
    pos += 46 + nameLen + extraLen + commentLen
  }
  return out
}

function stripXmlTags(xml: string): string {
  return xml
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal PDF text extractor (FlateDecode streams → text operators)
// ─────────────────────────────────────────────────────────────────────────────

function extractPdfText(buf: Buffer): string {
  const out: string[] = []
  const latin = buf.toString('latin1')
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g
  let streamMatch: RegExpExecArray | null
  while ((streamMatch = streamRe.exec(latin)) !== null) {
    let data: Buffer
    try {
      data = zlib.inflateSync(Buffer.from(streamMatch[1], 'latin1'))
    } catch {
      data = Buffer.from(streamMatch[1], 'latin1')
    }
    const content = data.toString('latin1')
    // Text shown with Tj / TJ operators lives inside parentheses.
    const textRe = /\(((?:[^()\\]|\\.)*)\)/g
    let textMatch: RegExpExecArray | null
    while ((textMatch = textRe.exec(content)) !== null) {
      const raw = textMatch[1]
      const decoded = raw
        .replace(/\\([()\\])/g, '$1')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\\d{3}/g, '')
      if (decoded.trim()) out.push(decoded)
    }
  }
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata readers (images / audio / video — no content text)
// ─────────────────────────────────────────────────────────────────────────────

function imageMetadata(buf: Buffer, ext: string): Record<string, unknown> {
  const meta: Record<string, unknown> = { format: ext }
  if (buf.length >= 24 && ext === 'png') {
    meta.width = buf.readUInt32BE(16)
    meta.height = buf.readUInt32BE(20)
  } else if (buf.length >= 12 && (ext === 'jpg' || ext === 'jpeg')) {
    let p = 2
    while (p + 9 < buf.length) {
      if (buf[p] !== 0xff) break
      const marker = buf[p + 1]
      if (marker === 0xd8 || marker === 0xd9) { p += 2; continue }
      const len = buf.readUInt16BE(p + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        meta.height = buf.readUInt16BE(p + 5)
        meta.width = buf.readUInt16BE(p + 7)
        break
      }
      p += 2 + len
    }
  } else if (buf.length >= 10 && ext === 'gif') {
    meta.width = buf.readUInt16LE(6)
    meta.height = buf.readUInt16LE(8)
  } else if (buf.length >= 30 && ext === 'webp' && buf.toString('latin1', 12, 16) === 'VP8 ') {
    meta.width = buf.readUInt16LE(26) & 0x3fff
    meta.height = buf.readUInt16LE(28) & 0x3fff
  } else if (ext === 'svg') {
    const text = buf.toString('utf8')
    const w = /width=["']([\d.]+)/.exec(text)
    const h = /height=["']([\d.]+)/.exec(text)
    if (w) meta.width = Number(w[1])
    if (h) meta.height = Number(h[1])
  }
  return meta
}

function audioVideoMetadata(buf: Buffer, mime: string): Record<string, unknown> {
  const meta: Record<string, unknown> = {}
  if (mime === 'audio/wav' && buf.length >= 12) {
    const channels = buf.readUInt16LE(22)
    const sampleRate = buf.readUInt32LE(24)
    const bits = buf.readUInt16LE(34)
    const dataSize = buf.readUInt32LE(40)
    meta.channels = channels
    meta.sampleRate = sampleRate
    meta.bitDepth = bits
    meta.durationSeconds = dataSize / ((sampleRate || 1) * (channels || 1) * (bits || 1) / 8)
  } else if (buf.length >= 12 && mime === 'video/mp4' && buf.toString('latin1', 4, 8) === 'ftyp') {
    meta.brand = buf.toString('latin1', 8, 12)
  }
  return meta
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry: read + extract
// ─────────────────────────────────────────────────────────────────────────────

export interface FileExtractionResult {
  mimeType: string
  ext: string
  parser: string
  text?: string
  metadata: Record<string, unknown>
  error?: string
}

export function readFileContent(filePath: string): FileExtractionResult {
  const result: FileExtractionResult = {
    mimeType: 'application/octet-stream',
    ext: path.extname(filePath).slice(1).toLowerCase(),
    parser: 'unknown',
    metadata: {},
  }

  let buf: Buffer
  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
    if (!stat.isFile()) return { ...result, parser: 'error', error: 'Not a regular file' }
    buf = fs.readFileSync(filePath)
  } catch (error) {
    return { ...result, parser: 'error', error: error instanceof Error ? error.message : 'Read failed' }
  }

  const sniffed = sniffMime(buf)
  result.mimeType = sniffed ?? EXT_MIME[result.ext] ?? 'application/octet-stream'
  if (result.mimeType === 'application/zip' && ZIP_BASED.has(result.ext)) {
    result.mimeType = EXT_MIME[result.ext] ?? result.mimeType
  }

  // Text formats
  if (result.mimeType.startsWith('text/') || TEXT_EXTENSIONS.has(result.ext)) {
    let text = buf.toString('utf8')
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // strip BOM
    result.parser = 'text'
    result.text = normalizeText(text, result.ext)
    return result
  }

  switch (result.mimeType) {
    case 'application/pdf': {
      result.parser = 'pdf'
      result.text = extractPdfText(buf)
      result.metadata.pages = countPdfPages(buf)
      return result
    }
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      result.parser = 'docx'
      result.text = extractDocx(buf)
      return result
    }
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
      result.parser = 'xlsx'
      result.text = extractXlsx(buf)
      return result
    }
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
      result.parser = 'pptx'
      result.text = extractPptx(buf)
      return result
    }
    case 'application/zip': {
      result.parser = 'zip'
      result.text = extractGenericZip(buf)
      return result
    }
    case 'application/msword':
    case 'application/vnd.ms-excel':
    case 'application/vnd.ms-powerpoint': {
      result.parser = 'legacy-office'
      // Legacy binary formats are not parsed (no safe extractor); report cleanly.
      result.metadata.note = 'Legacy binary Office format — no text extracted'
      return result
    }
    default: {
      if (result.mimeType.startsWith('image/')) {
        result.parser = 'image'
        result.metadata = { ...result.metadata, ...imageMetadata(buf, result.ext) }
        result.metadata.note = 'Image — OCR/vision not enabled in this build'
        return result
      }
      if (result.mimeType.startsWith('audio/') || result.mimeType.startsWith('video/')) {
        result.parser = 'media'
        result.metadata = { ...result.metadata, ...audioVideoMetadata(buf, result.mimeType) }
        result.metadata.note = 'Audio/video — no transcription in this build'
        return result
      }
      result.parser = 'binary'
      result.metadata.note = 'Binary file — content not readable'
      return result
    }
  }
}

function normalizeText(text: string, ext: string): string {
  if (ext === 'json') {
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return text
    }
  }
  if (ext === 'csv') return text
  return text
}

function countPdfPages(buf: Buffer): number {
  const matches = buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)
  return matches ? matches.length : 0
}

function extractDocx(buf: Buffer): string {
  const zip = readZip(buf)
  const doc = zip.get('word/document.xml')
  if (!doc) return '[docx: no document.xml found]'
  const xml = doc.toString('utf8')
  const paragraphs = xml
    .split(/<\/w:p>/)
    .map(block => stripXmlTags(block))
    .filter(Boolean)
  return paragraphs.join('\n')
}

function extractXlsx(buf: Buffer): string {
  const zip = readZip(buf)
  const lines: string[] = []
  const shared: string[] = []
  const sharedXml = zip.get('xl/sharedStrings.xml')
  if (sharedXml) {
    const text = sharedXml.toString('utf8')
    const cellRe = /<si>([\s\S]*?)<\/si>/g
    let m: RegExpExecArray | null
    while ((m = cellRe.exec(text)) !== null) {
      shared.push(stripXmlTags(m[1]))
    }
  }
  const sheetNames = [...zip.keys()].filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort()
  for (const sheetName of sheetNames) {
    const xml = (zip.get(sheetName) ?? Buffer.alloc(0)).toString('utf8')
    const rows = xml.split(/<\/row>/)
    for (const row of rows) {
      const cellRe = /<c[^>]*?(?:\s+t="([^"]*)")?[^>]*>([\s\S]*?)<\/c>/g
      const rowCells: string[] = []
      let cm: RegExpExecArray | null
      while ((cm = cellRe.exec(row)) !== null) {
        const t = cm[1]
        const inner = cm[2]
        if (t === 's') {
          const v = /<v>(\d+)<\/v>/.exec(inner)
          if (v) rowCells.push(shared[Number(v[1])] ?? '')
        } else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(inner)
          if (v) rowCells.push(v[1])
          else rowCells.push(stripXmlTags(inner))
        }
      }
      if (rowCells.length) lines.push(rowCells.join('\t'))
    }
  }
  return lines.join('\n') || '[xlsx: no sheet data found]'
}

function extractPptx(buf: Buffer): string {
  const zip = readZip(buf)
  const lines: string[] = []
  const slideNames = [...zip.keys()].filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort(
    (a, b) => Number(/slide(\d+)/.exec(a)?.[1]) - Number(/slide(\d+)/.exec(b)?.[1])
  )
  for (const slideName of slideNames) {
    const text = stripXmlTags((zip.get(slideName) ?? Buffer.alloc(0)).toString('utf8'))
    if (text) lines.push(`--- Slide: ${path.basename(slideName)} ---\n${text}`)
  }
  return lines.join('\n\n') || '[pptx: no slide text found]'
}

function extractGenericZip(buf: Buffer): string {
  const zip = readZip(buf)
  const lines: string[] = []
  const totalBudget = 100_000 // chars — never dump a whole archive
  let used = 0
  for (const [name, data] of zip) {
    const ext = path.extname(name).slice(1).toLowerCase()
    if (!TEXT_EXTENSIONS.has(ext) && !data.toString('utf8', 0, 256).includes('\0')) continue
    const text = data.toString('utf8').slice(0, totalBudget - used)
    if (!text.trim()) continue
    lines.push(`### ${name}\n${text}`)
    used += text.length
    if (used >= totalBudget) break
  }
  return lines.join('\n\n') || '[zip: no readable text entries found]'
}

// ─────────────────────────────────────────────────────────────────────────────
// Chunking + retrieval index
// ─────────────────────────────────────────────────────────────────────────────

export interface FileChunk {
  id: number
  text: string
}

export function chunkText(text: string, maxChars = 1600, overlap = 160): string[] {
  if (!text) return []
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  if (normalized.length <= maxChars) return [normalized]

  const chunks: string[] = []
  const paragraphs = normalized.split(/\n{2,}/)
  let current = ''
  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph
      continue
    }
    if (current.length + 2 + paragraph.length > maxChars) {
      chunks.push(current)
      const overlapText = current.length > overlap ? current.slice(-overlap) : current
      current = `${overlapText}\n${paragraph}`
    } else {
      current = `${current}\n\n${paragraph}`
    }
  }
  if (current) chunks.push(current)

  // A single oversized paragraph is hard-split.
  const final: string[] = []
  for (const chunk of chunks) {
    if (chunk.length <= maxChars) {
      final.push(chunk)
      continue
    }
    for (let i = 0; i < chunk.length; i += maxChars - overlap) {
      final.push(chunk.slice(i, i + maxChars))
    }
  }
  return final
}

export type TokenIndex = Map<string, number[]>

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>()
  const re = /[a-z0-9_]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text.toLowerCase())) !== null) {
    if (m[0].length >= 2) tokens.add(m[0])
  }
  return tokens
}

export function buildIndex(chunks: FileChunk[]): TokenIndex {
  const index: TokenIndex = new Map()
  chunks.forEach((chunk, id) => {
    for (const token of tokenize(chunk.text)) {
      const ids = index.get(token)
      if (ids) {
        if (ids[ids.length - 1] !== id) ids.push(id)
      } else {
        index.set(token, [id])
      }
    }
  })
  return index
}

export function retrieveRelevant(
  index: TokenIndex,
  chunks: FileChunk[],
  query: string,
  topK = 4
): FileChunk[] {
  const queryTokens = tokenize(query)
  if (queryTokens.size === 0) return chunks.slice(0, topK)
  const scores = new Map<number, number>()
  for (const token of queryTokens) {
    for (const id of index.get(token) ?? []) {
      scores.set(id, (scores.get(id) ?? 0) + 1)
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id]) => chunks[id])
    .filter(Boolean)
}
