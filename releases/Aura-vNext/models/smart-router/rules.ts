/**
 * Smart router rules for Aura Auto.
 *
 * Each rule is independent and returns a score for a routing signal set;
 * the highest-scoring rule's target wins. Add new rules by appending to
 * DEFAULT_RULES — no other code changes needed.
 */

import type { AuraModelId } from '../aura-models/definitions'

/** Signals extracted from the outgoing message + conversation context. */
export interface RoutingSignals {
  text: string
  /** Lowercased text, precomputed once. */
  lower: string
  hasImages: boolean
  /** Total chars across the whole conversation (proxy for context size). */
  conversationChars: number
  messageCount: number
  /** Chars in the current message (large paste → document analysis). */
  messageChars: number
}

export interface RoutingDecision {
  target: Exclude<AuraModelId, 'aura-auto'>
  ruleId: string
  reason: string
}

export interface RoutingRule {
  id: string
  /** Human-readable description shown in Developer Mode. */
  description: string
  target: Exclude<AuraModelId, 'aura-auto'>
  /** Return 0 to pass; higher scores beat lower ones. */
  score: (signals: RoutingSignals) => number
  reason: string
}

const CODE_KEYWORDS =
  /\b(code|coding|debug|debugg|bug|fix|error|exception|stack ?trace|refactor|function|class|method|compile|typescript|javascript|python|rust|java\b|c\+\+|sql|api|endpoint|regex|unit test|architecture|microservice|schema|algorithm|implement)\b/
const CODE_SYNTAX = /```|=>|::|\bdef |\bconst |\blet |\bvar |\bimport |{ *}|\(\) *=>|<\/?[a-z]+>/
const RESEARCH_KEYWORDS =
  /\b(research|analyz|analys|summariz|summar|compare|literature|study|studies|report|deep dive|investigate|comprehensive|in-depth|whitepaper|survey)\b/
const CREATIVE_KEYWORDS =
  /\b(story|poem|poetry|fiction|novel|creative|lyrics|song|screenplay|script|character|plot|imagine|brainstorm|slogan|tagline|essay)\b/
const MAX_KEYWORDS =
  /\b(best possible|highest quality|maximum|most powerful|hardest|extremely (hard|complex)|no matter the cost|think (very )?deeply|take your time)\b/
const QUICK_PATTERNS =
  /^(what|who|when|where|how much|how many|is|are|was|does|do|can|convert|translate|define)\b/

export const DEFAULT_RULES: RoutingRule[] = [
  {
    id: 'vision',
    description: 'Images attached → vision model',
    target: 'aura-vision',
    score: signals => (signals.hasImages ? 100 : 0),
    reason: 'Message contains images',
  },
  {
    id: 'explicit-max',
    description: 'User asks for maximum quality → Aura Max',
    target: 'aura-max',
    score: signals => (MAX_KEYWORDS.test(signals.lower) ? 90 : 0),
    reason: 'Highest quality requested',
  },
  {
    id: 'coding',
    description: 'Code keywords or syntax → coding model',
    target: 'aura-coding',
    score: signals => {
      let score = 0
      if (CODE_SYNTAX.test(signals.text)) score += 50
      if (CODE_KEYWORDS.test(signals.lower)) score += 35
      return score
    },
    reason: 'Coding task detected',
  },
  {
    id: 'large-document',
    description: 'Very large message → research model',
    target: 'aura-research',
    score: signals => (signals.messageChars > 12_000 ? 70 : 0),
    reason: 'Large document analysis',
  },
  {
    id: 'research',
    description: 'Research/analysis keywords → research model',
    target: 'aura-research',
    score: signals => (RESEARCH_KEYWORDS.test(signals.lower) ? 40 : 0),
    reason: 'Research task detected',
  },
  {
    id: 'creative',
    description: 'Creative writing keywords → creative model',
    target: 'aura-creative',
    score: signals => (CREATIVE_KEYWORDS.test(signals.lower) ? 40 : 0),
    reason: 'Creative writing detected',
  },
  {
    id: 'long-conversation',
    description: 'Long conversation → smart model',
    target: 'aura-smart',
    score: signals =>
      signals.messageCount > 12 || signals.conversationChars > 24_000 ? 25 : 0,
    reason: 'Long conversation context',
  },
  {
    id: 'quick-question',
    description: 'Short factual question → flash model',
    target: 'aura-flash',
    score: signals =>
      signals.messageChars < 220 && QUICK_PATTERNS.test(signals.lower) ? 20 : 0,
    reason: 'Fast question',
  },
  {
    id: 'short-chat',
    description: 'Short casual message → flash model',
    target: 'aura-flash',
    score: signals => (signals.messageChars < 120 ? 10 : 0),
    reason: 'Simple chat',
  },
]

/** Default when nothing scores: balanced everyday model. */
export const FALLBACK_DECISION: RoutingDecision = {
  target: 'aura-smart',
  ruleId: 'default',
  reason: 'General conversation',
}
