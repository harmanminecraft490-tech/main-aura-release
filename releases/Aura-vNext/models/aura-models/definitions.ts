/**
 * Aura virtual models — the branded aliases users actually interact with.
 * Each maps internally to a real backend model; users can remap at any time.
 *
 * Default targets are *patterns*, not registry entries: they resolve against
 * whatever models discovery finds, so nothing here depends on a provider
 * actually offering these ids.
 */

import type { ModelRef } from '../../providers/types'

export type AuraModelId =
  | 'aura-auto'
  | 'aura-flash'
  | 'aura-smart'
  | 'aura-pro'
  | 'aura-coding'
  | 'aura-vision'
  | 'aura-creative'
  | 'aura-research'
  | 'aura-max'

export type CapabilityFocus = 'speed' | 'balanced' | 'quality' | 'coding' | 'vision' | 'creative' | 'research' | 'max'

export interface AuraModelDefinition {
  id: AuraModelId
  name: string
  icon: string
  tagline: string
  description: string
  /**
   * Default backend model id patterns, in preference order. The first pattern
   * with a match in the registry wins. Matching is fuzzy (see matchModels) so
   * dated/suffixed variants resolve too.
   */
  defaultTargets: string[]
  /** Drives the capability-based fallback when no default target exists. */
  focus: CapabilityFocus
  /** Sampling defaults applied when the user hasn't overridden them. */
  temperature: number
  accent: string
}

export const AURA_AUTO_ID: AuraModelId = 'aura-auto'

export const AURA_MODELS: AuraModelDefinition[] = [
  {
    id: 'aura-auto',
    name: 'Aura Auto',
    icon: '🤖',
    tagline: 'Best model for every message',
    description: 'Analyzes each prompt and routes it to the ideal Aura model automatically.',
    defaultTargets: [],
    focus: 'balanced',
    temperature: 0.6,
    accent: '#8f74ff',
  },
  {
    id: 'aura-flash',
    name: 'Aura Flash',
    icon: '⚡',
    tagline: 'Instant answers',
    description: 'Fastest responses for quick questions and simple chat.',
    defaultTargets: ['gpt-5.6-terra', 'gemini-2.5-flash', 'claude-haiku-4-5'],
    focus: 'speed',
    temperature: 0.4,
    accent: '#facc15',
  },
  {
    id: 'aura-smart',
    name: 'Aura Smart',
    icon: '🧠',
    tagline: 'Everyday intelligence',
    description: 'Balanced quality and speed for long conversations and general work.',
    defaultTargets: ['gpt-5.6-sol', 'claude-sonnet-5', 'gemini-2.5-pro'],
    focus: 'balanced',
    temperature: 0.6,
    accent: '#60a5fa',
  },
  {
    id: 'aura-pro',
    name: 'Aura Pro',
    icon: '💎',
    tagline: 'Professional grade',
    description: 'High-quality reasoning for demanding professional tasks.',
    defaultTargets: ['claude-sonnet-5', 'gpt-5.6-sol', 'claude-opus-4.8'],
    focus: 'quality',
    temperature: 0.5,
    accent: '#22d3ee',
  },
  {
    id: 'aura-coding',
    name: 'Aura Coding',
    icon: '👨‍💻',
    tagline: 'Built for code',
    description: 'Optimized for writing, debugging, and architecting software.',
    defaultTargets: ['claude-sonnet-5-thinking', 'claude-sonnet-5', 'qwen3-coder'],
    focus: 'coding',
    temperature: 0.3,
    accent: '#34d399',
  },
  {
    id: 'aura-vision',
    name: 'Aura Vision',
    icon: '👁️',
    tagline: 'Sees what you see',
    description: 'Understands images, screenshots, diagrams, and documents.',
    defaultTargets: ['gpt-4o', 'gemini-2.5-pro', 'claude-sonnet-5'],
    focus: 'vision',
    temperature: 0.5,
    accent: '#f472b6',
  },
  {
    id: 'aura-creative',
    name: 'Aura Creative',
    icon: '🎨',
    tagline: 'Imagination unleashed',
    description: 'Expressive writing, storytelling, and creative ideation.',
    defaultTargets: ['claude-opus-4.8', 'gpt-5.6-sol', 'claude-sonnet-5'],
    focus: 'creative',
    temperature: 0.9,
    accent: '#fb923c',
  },
  {
    id: 'aura-research',
    name: 'Aura Research',
    icon: '🔍',
    tagline: 'Deep analysis',
    description: 'Long-document analysis and thorough multi-step research.',
    defaultTargets: ['claude-opus-4.8-thinking', 'claude-opus-4.8', 'gemini-2.5-pro'],
    focus: 'research',
    temperature: 0.5,
    accent: '#a78bfa',
  },
  {
    id: 'aura-max',
    name: 'Aura Max',
    icon: '🚀',
    tagline: 'Maximum capability',
    description: 'The most powerful configuration for the hardest problems.',
    defaultTargets: ['claude-opus-4.8-thinking', 'claude-opus-4.8', 'o3'],
    focus: 'max',
    temperature: 0.7,
    accent: '#f87171',
  },
]

export const AURA_MODELS_BY_ID: ReadonlyMap<AuraModelId, AuraModelDefinition> = new Map(
  AURA_MODELS.map(model => [model.id, model])
)

export function isAuraModelId(value: string): value is AuraModelId {
  return AURA_MODELS_BY_ID.has(value as AuraModelId)
}

/** A user-set mapping override for one Aura model. */
export interface AuraMappingOverride {
  auraId: AuraModelId
  target: ModelRef
  /** When the user set it — used to avoid re-suggesting older models. */
  setAt: number
}

/** Persisted mapping state: only overrides are stored; defaults are code. */
export type AuraMappings = Partial<Record<AuraModelId, AuraMappingOverride>>
