/**
 * Chat orchestrator: the single entry point from IPC into the model system.
 *
 * Per request it:
 *   1. Resolves the chosen Aura model (running the smart router for Aura Auto)
 *   2. Builds a fallback chain of concrete backend models
 *   3. Streams, failing over only if no output has been produced yet
 *   4. Tracks the AbortController so 'chat:abort' stops everything instantly
 *
 * Emits renderer events through the injected `emit` function; every event
 * carries the streamId so stale streams can never touch newer UI state.
 */

import type { ChatMessage, ChatUsage, ProviderConfig } from '../providers/types'
import { streamCompletion } from '../providers/stream'
import type { RegistryModel, RegistrySnapshot } from '../models/registry/registry'
import type { AuraMappings, AuraModelId } from '../models/aura-models/definitions'
import { AURA_AUTO_ID, AURA_MODELS_BY_ID, isAuraModelId } from '../models/aura-models/definitions'
import { resolveAuraModel } from '../models/aura-models/mapping'
import { route } from '../models/smart-router/router'

export interface ChatStartInput {
  streamId: string
  messages: ChatMessage[]
  /** Aura model chosen in the UI; defaults to settings' default model. */
  auraModelId?: string
  temperature?: number
  /** Extra context (e.g. project instructions) appended to the system prompt. */
  context?: string
}

export interface ChatEmitter {
  (channel: 'chat:routed', payload: { streamId: string; auraModelId: AuraModelId; reason: string; modelKey: string; modelName: string; providerName: string }): void
  (channel: 'chat:delta', payload: { streamId: string; delta: string }): void
  (channel: 'chat:thinking', payload: { streamId: string; delta: string }): void
  (channel: 'chat:done', payload: { streamId: string; text: string; auraModelId: AuraModelId; modelKey: string; model?: string; usage?: ChatUsage; latencyMs: number }): void
  (channel: 'chat:error', payload: { streamId: string; message: string }): void
  (channel: 'chat:aborted', payload: { streamId: string }): void
}

export interface OrchestratorDeps {
  getSnapshot: () => RegistrySnapshot
  getProviders: () => ProviderConfig[]
  getMappings: () => AuraMappings
  getDefaultAuraModel: () => string
  emit: ChatEmitter
  /** Developer-mode request log sink. */
  log: (entry: RequestLogEntry) => void
}

export interface RequestLogEntry {
  id: string
  timestamp: number
  auraModelId: string
  modelKey: string
  providerName: string
  status: 'success' | 'error' | 'aborted'
  latencyMs: number
  firstTokenMs?: number
  usage?: ChatUsage
  error?: string
}

const SYSTEM_PROMPT = `You are Aura, a premium AI desktop assistant. Be direct, warm, and genuinely useful. Format answers with Markdown when it helps readability: headings for structure, fenced code blocks with language tags, and tables for comparisons. Keep answers as short as they can be while fully solving the problem.`

export class ChatOrchestrator {
  private readonly active = new Map<string, AbortController>()

  constructor(private readonly deps: OrchestratorDeps) {}

  abort(streamId: string): void {
    this.active.get(streamId)?.abort()
    this.active.delete(streamId)
  }

  abortAll(): void {
    for (const controller of this.active.values()) controller.abort()
    this.active.clear()
  }

  /** Number of in-flight streams (used to guard duplicate requests). */
  get inFlight(): number {
    return this.active.size
  }

  async start(input: ChatStartInput): Promise<void> {
    const { streamId, messages } = input
    // Duplicate-start guard: the same streamId can never run twice.
    if (this.active.has(streamId)) return

    const controller = new AbortController()
    this.active.set(streamId, controller)
    const { emit } = this.deps

    try {
      const snapshot = this.deps.getSnapshot()
      const mappings = this.deps.getMappings()

      // 1. Resolve the Aura model (router for Auto, requested id otherwise).
      const requested = input.auraModelId && isAuraModelId(input.auraModelId)
        ? input.auraModelId
        : (this.deps.getDefaultAuraModel() as AuraModelId)
      let auraModelId: AuraModelId = isAuraModelId(requested) ? requested : AURA_AUTO_ID
      let routeReason = 'Selected by user'

      if (auraModelId === AURA_AUTO_ID) {
        const decision = route(messages)
        auraModelId = decision.target
        routeReason = decision.reason
      }

      // 2. Resolve backend model + fallbacks.
      const resolved = resolveAuraModel(auraModelId, snapshot, mappings)
      if (!resolved.model) {
        emit('chat:error', {
          streamId,
          message: 'No models available. Add a provider in Settings → Providers to get started.',
        })
        return
      }

      emit('chat:routed', {
        streamId,
        auraModelId,
        reason: routeReason,
        modelKey: resolved.model.key,
        modelName: resolved.model.displayName,
        providerName: resolved.model.providerName,
      })

      // 3. Stream with pre-token failover.
      const chain: RegistryModel[] = [resolved.model, ...resolved.fallbacks]
      const providers = new Map(this.deps.getProviders().map(provider => [provider.id, provider]))
      const definition = AURA_MODELS_BY_ID.get(auraModelId)!
      const temperature = input.temperature ?? definition.temperature
      const system = input.context?.trim()
        ? `${SYSTEM_PROMPT}\n\n## Project context\n${input.context.trim()}`
        : SYSTEM_PROMPT

      for (let index = 0; index < chain.length; index += 1) {
        const candidate = chain[index]
        const provider = providers.get(candidate.providerId)
        if (!provider || !provider.enabled) continue
        const isLast = index === chain.length - 1

        const outcome = await this.streamOne({
          streamId,
          provider,
          model: candidate,
          auraModelId,
          messages,
          temperature,
          system,
          signal: controller.signal,
          allowFailover: !isLast,
        })

        if (outcome !== 'failover') return
        // Tell the renderer which model we fell back to.
        const next = chain[index + 1]
        if (next) {
          emit('chat:routed', {
            streamId,
            auraModelId,
            reason: `Fallback: ${candidate.displayName} unavailable`,
            modelKey: next.key,
            modelName: next.displayName,
            providerName: next.providerName,
          })
        }
      }

      // Chain exhausted without a terminal event.
      if (!controller.signal.aborted) {
        emit('chat:error', { streamId, message: 'All configured models failed. Check Settings → Providers.' })
      } else {
        emit('chat:aborted', { streamId })
      }
    } catch (error) {
      if (controller.signal.aborted) {
        emit('chat:aborted', { streamId })
      } else {
        emit('chat:error', {
          streamId,
          message: error instanceof Error ? error.message : 'Unexpected error while starting the chat.',
        })
      }
    } finally {
      this.active.delete(streamId)
    }
  }

  private streamOne(args: {
    streamId: string
    provider: ProviderConfig
    model: RegistryModel
    auraModelId: AuraModelId
    messages: ChatMessage[]
    temperature: number
    system: string
    signal: AbortSignal
    allowFailover: boolean
  }): Promise<'done' | 'failover'> {
    const { streamId, provider, model, auraModelId, messages, temperature, system, signal, allowFailover } = args
    const { emit, log } = this.deps
    const startedAt = Date.now()
    let firstTokenAt: number | undefined
    let produced = false

    return new Promise(resolve => {
      void streamCompletion(
        provider,
        {
          model: model.id,
          messages,
          system,
          temperature,
          maxTokens: Math.min(model.maxOutputTokens ?? 8192, 16384),
        },
        {
          onToken: delta => {
            if (!produced) {
              produced = true
              firstTokenAt = Date.now()
            }
            emit('chat:delta', { streamId, delta })
          },
          onThinking: delta => {
            if (!produced) {
              produced = true
              firstTokenAt = Date.now()
            }
            emit('chat:thinking', { streamId, delta })
          },
          onDone: (text, meta) => {
            const latencyMs = Date.now() - startedAt
            emit('chat:done', {
              streamId,
              text,
              auraModelId,
              modelKey: model.key,
              model: meta.model ?? model.id,
              usage: meta.usage,
              latencyMs,
            })
            log({
              id: streamId,
              timestamp: startedAt,
              auraModelId,
              modelKey: model.key,
              providerName: provider.name,
              status: 'success',
              latencyMs,
              firstTokenMs: firstTokenAt ? firstTokenAt - startedAt : undefined,
              usage: meta.usage,
            })
            resolve('done')
          },
          onError: error => {
            const latencyMs = Date.now() - startedAt
            log({
              id: streamId,
              timestamp: startedAt,
              auraModelId,
              modelKey: model.key,
              providerName: provider.name,
              status: 'error',
              latencyMs,
              error: error.message,
            })
            if (!produced && allowFailover && !signal.aborted) {
              resolve('failover')
              return
            }
            emit('chat:error', { streamId, message: error.message })
            resolve('done')
          },
          onAbort: () => {
            emit('chat:aborted', { streamId })
            log({
              id: streamId,
              timestamp: startedAt,
              auraModelId,
              modelKey: model.key,
              providerName: provider.name,
              status: 'aborted',
              latencyMs: Date.now() - startedAt,
            })
            resolve('done')
          },
        },
        { signal, firstByteTimeoutMs: provider.timeoutMs, idleTimeoutMs: 90_000 }
      )
    })
  }
}
