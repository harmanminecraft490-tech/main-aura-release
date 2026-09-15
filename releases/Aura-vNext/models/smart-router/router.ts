/**
 * Aura Auto router: extracts signals from the outgoing message and picks the
 * best Aura model via the modular rule set.
 */

import type { ChatMessage } from '../../providers/types'
import type { RoutingDecision, RoutingRule, RoutingSignals } from './rules'
import { DEFAULT_RULES, FALLBACK_DECISION } from './rules'

export function extractSignals(messages: ChatMessage[]): RoutingSignals {
  const lastUser = [...messages].reverse().find(message => message.role === 'user')
  const text = lastUser?.content ?? ''
  const hasImages = Boolean(lastUser?.parts?.some(part => part.kind === 'image'))
  const conversationChars = messages.reduce((total, message) => total + message.content.length, 0)

  return {
    text,
    lower: text.toLowerCase(),
    hasImages,
    conversationChars,
    messageCount: messages.length,
    messageChars: text.length,
  }
}

export function route(messages: ChatMessage[], rules: RoutingRule[] = DEFAULT_RULES): RoutingDecision {
  const signals = extractSignals(messages)

  let best: { rule: RoutingRule; score: number } | null = null
  for (const rule of rules) {
    const score = rule.score(signals)
    if (score > 0 && (!best || score > best.score)) {
      best = { rule, score }
    }
  }

  if (!best) return FALLBACK_DECISION
  return { target: best.rule.target, ruleId: best.rule.id, reason: best.rule.reason }
}
