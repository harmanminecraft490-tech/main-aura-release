/**
 * PROVIDER MESSAGE ADAPTER
 *
 * Central serializer between Aura's INTERNAL message representation and the
 * WIRE format each provider/model actually accepts.
 *
 * Aura internal messages are always:
 *   { role: 'user'|'assistant'|'system', content: string }
 * Image attachments travel OUTSIDE content (path + mimeType), so text-only
 * turns keep the exact plain-string shape and nothing is turned into
 * `[object Object]`.
 *
 * When the selected model supports vision, the adapter converts the LAST user
 * message into the provider's multimodal format:
 *
 *   OpenAI-compatible:  content = [{ type:'text', text }, { type:'image_url', image_url:{url:'data:...'} }]
 *   Anthropic:          content = [{ type:'text', text }, { type:'image', source:{ type:'base64', media_type, data } }]
 *
 * When the model does NOT support vision, the images are NOT embedded — the
 * caller surfaces a clean capability message instead of a malformed request.
 *
 * Rules enforced here (never in UI components):
 *   - text-only requests stay `content: "..."` — no unnecessary array wrapping
 *   - supported image types: PNG / JPEG / WEBP (validated by MIME)
 *   - oversized images are dropped with a reason, never sent as giant base64
 *   - File / Blob / FileList / React event objects are NEVER serialized —
 *     only real filesystem bytes become base64
 *   - conversation history containing old image messages stays valid text
 */

import * as fs from 'fs'
import type { AIProvider } from '../types'
import type { ModelCapabilities } from './modelCapabilities'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface InternalMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ImageAttachment {
  path: string
  mimeType: string
  size?: number
}

export type WireMessage =
  | { role: 'user' | 'assistant'; content: string }
  | { role: 'user'; content: Array<Record<string, unknown>> }

export type ProviderFormat = 'openai' | 'anthropic'

export interface SerializeRequest {
  provider: AIProvider | string
  model: string
  format: ProviderFormat
  capabilities: ModelCapabilities
  messages: InternalMessage[]
  images?: ImageAttachment[]
}

export interface DroppedImage {
  name: string
  mimeType: string
  size: number
  reason: 'no_vision' | 'unsupported_type' | 'too_large' | 'unreadable'
}

export interface SerializeResult {
  /** Provider-ready messages (multimodal parts only when vision is supported). */
  messages: WireMessage[]
  /** Number of images actually embedded into the payload. */
  embeddedImages: number
  /** Images that could not be sent, with the reason for each. */
  droppedImages: DroppedImage[]
  /** True when images were attached but the model cannot see them. */
  visionBlocked: boolean
  /** True when the payload is plain text (no multimodal wrapping). */
  textOnly: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Limits & validation
// ─────────────────────────────────────────────────────────────────────────────

/** Supported vision MIME types. PNG / JPEG / WEBP (per spec). */
const SUPPORTED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])

/** Per-image ceiling. Base64 inflates by ~33%; 20MB keeps payloads sane. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/** User-facing message shown when the selected model cannot see images. */
export const VISION_NOT_SUPPORTED_MESSAGE =
  "This model doesn't support image understanding. Switch to a vision-capable model to analyze this image."

/** Coerce a message's content to a safe plain string (history safety). */
function coerceContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    // Historical multimodal message → extract the text part only.
    const textParts = content
      .filter((part): part is Record<string, unknown> => typeof part === 'object' && part !== null)
      .filter(part => part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text as string)
    if (textParts.length > 0) return textParts.join(' ')
    return '[image]'
  }
  return ''
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

// ─────────────────────────────────────────────────────────────────────────────
// Serializer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert Aura internal messages + image attachments into the provider wire
 * format. Pure function of its inputs (fs reads happen here, once).
 */
export function serializeProviderMessages(request: SerializeRequest): SerializeResult {
  const { capabilities, images = [] } = request
  const droppedImages: DroppedImage[] = []

  // 1. Normalize every message to plain string content. This preserves
  //    text-only history exactly and keeps old image messages valid.
  const messages: WireMessage[] = request.messages.map(message => ({
    role: message.role === 'system' ? 'user' : message.role,
    content: coerceContent(message.content),
  }))

  // 2. No images → plain-text payload, nothing else to do.
  if (images.length === 0) {
    return { messages, embeddedImages: 0, droppedImages: [], visionBlocked: false, textOnly: true }
  }

  // 3. Text-only model → NEVER embed images. Report so the caller can show a
  //    clean capability message instead of a malformed request.
  if (!capabilities.vision) {
    for (const image of images) {
      droppedImages.push({ name: basename(image.path), mimeType: image.mimeType, size: image.size ?? 0, reason: 'no_vision' })
    }
    return { messages, embeddedImages: 0, droppedImages, visionBlocked: true, textOnly: true }
  }

  // 4. Vision model: attach the images to the LAST user message so the model
  //    receives text + image as one coherent user turn.
  let lastUserIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      lastUserIndex = index
      break
    }
  }
  if (lastUserIndex === -1) {
    // No user turn to attach to (shouldn't happen); keep text-only.
    return { messages, embeddedImages: 0, droppedImages: [], visionBlocked: false, textOnly: true }
  }

  const text = typeof messages[lastUserIndex].content === 'string'
    ? messages[lastUserIndex].content as string
    : ''

  const parts: Array<Record<string, unknown>> = []
  if (text.trim() || images.length > 0) {
    parts.push({ type: 'text', text })
  }

  let embedded = 0
  for (const image of images) {
    const name = basename(image.path)
    const mime = (image.mimeType || '').toLowerCase()

    if (!SUPPORTED_IMAGE_MIME.has(mime)) {
      droppedImages.push({ name, mimeType: image.mimeType, size: image.size ?? 0, reason: 'unsupported_type' })
      continue
    }
    if (typeof image.size === 'number' && image.size > MAX_IMAGE_BYTES) {
      droppedImages.push({ name, mimeType: image.mimeType, size: image.size, reason: 'too_large' })
      continue
    }

    let base64: string
    try {
      const data = fs.readFileSync(image.path)
      if (data.length > MAX_IMAGE_BYTES) {
        droppedImages.push({ name, mimeType: image.mimeType, size: data.length, reason: 'too_large' })
        continue
      }
      base64 = data.toString('base64')
    } catch {
      droppedImages.push({ name, mimeType: image.mimeType, size: image.size ?? 0, reason: 'unreadable' })
      continue
    }

    if (request.format === 'anthropic') {
      parts.push({
        type: 'image',
        source: { type: 'base64', media_type: mime, data: base64 },
      })
    } else {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${base64}` },
      })
    }
    embedded += 1
  }

  const result = messages.slice()
  // Only array-wrap the user turn when at least one image was ACTUALLY embedded.
  // If every image was dropped (unreadable / unsupported / too large), keep the
  // plain string content — a strict provider must never see a bare
  // [{type:'text'}] array where it expects a string.
  if (embedded > 0) {
    result[lastUserIndex] = { role: 'user', content: parts }
  }

  return {
    messages: result,
    embeddedImages: embedded,
    droppedImages,
    visionBlocked: false,
    textOnly: embedded === 0,
  }
}
