/**
 * CONTEXT BUDGET MANAGER
 *
 * Single place where every token in a provider request is accounted for and
 * bounded. Before any request is assembled it runs:
 *
 *   User Prompt
 *     → Minimal System Prompt
 *     → Relevant Memory (top-K, budgeted)
 *     → Relevant Workspace Context (budgeted)
 *     → Conversation Summary (older messages compressed)
 *     → Recent Messages (bounded)
 *     → Token Budget Check (compress/reduce/retry)
 *     → Provider
 *
 * Every section reports { tokens, chars, percent } so the exact origin of each
 * token is visible (see logTokenInspector / the inspector output of
 * assemblePrompt).
 *
 * This module is PURE — it imports nothing from electron or the app runtime so
 * it can be unit-tested with plain node.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Token estimation
// ─────────────────────────────────────────────────────────────────────────────

/** Rough token estimate. ~4 ASCII chars/token, ~1 token per CJK char. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let units = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    units += code > 0x2e7f ? 1 : 0.25
  }
  return Math.max(1, Math.ceil(units))
}

export function estimateChars(text: string): number {
  return text.length
}

// ─────────────────────────────────────────────────────────────────────────────
// Budgets
// ─────────────────────────────────────────────────────────────────────────────

export interface ContextBudget {
  /** Minimal system prompt (identity + behavior). */
  system: number
  /** Developer prompt (mode-specific addendum). */
  developer: number
  /** Retrieved memories (top-K, relevance-ranked). */
  memory: number
  /** Relevant workspace/project context. */
  workspace: number
  /** Compressed summary of older conversation turns. */
  conversationSummary: number
  /** Recent messages kept verbatim. */
  recentMessages: number
  /** Retrieved documents / file chunks. */
  retrievedDocuments: number
  /** Tool / MCP definitions (cached, only when tools are actually used). */
  tools: number
  /** Hard ceiling for the whole payload (guards against provider TPM limits). */
  total: number
}

export const CONTEXT_BUDGET: ContextBudget = {
  system: 500,
  developer: 100,
  memory: 400,
  workspace: 800,
  conversationSummary: 500,
  recentMessages: 1500,
  retrievedDocuments: 800,
  tools: 300,
  total: 6000,
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BudgetMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface BudgetMemory {
  id?: string
  type?: string
  content: string
  context?: string
  relevance?: number
}

export interface ContextSection {
  name: string
  content: string
  tokens: number
  chars: number
  percent: number // of total payload tokens, 0-100
}

export interface BudgetActions {
  /** Human-readable list of what the manager trimmed/compressed. */
  steps: string[]
  droppedMessages: number
  droppedMemoryCount: number
  compressedConversation: boolean
}

export interface AssembleInput {
  /** The (already minimal) identity/behavior system prompt. */
  systemPrompt: string
  /** Mode-specific developer addendum (may be empty). */
  developerPrompt?: string
  /** Full conversation history from the renderer, oldest → newest. */
  messages: BudgetMessage[]
  /** Relevant memories, already ranked best → worst. */
  memories?: BudgetMemory[]
  /** Pre-built workspace context string (may be empty). */
  workspaceText?: string
  /** Pre-built retrieved-document text (may be empty). */
  documentsText?: string
  /** Cached tool definitions (may be empty). */
  toolsText?: string
  /** Overrides for the default budget. */
  budget?: Partial<ContextBudget>
}

export interface AssembleOutput {
  /** Final bounded system prompt (all context sections folded in). */
  system: string
  /** Final bounded message list (recent turns only). */
  messages: BudgetMessage[]
  /** Per-section accounting, every token's origin. */
  sections: ContextSection[]
  /** Total estimated payload tokens (system + messages). */
  totalTokens: number
  /** What the manager had to drop/compress. */
  actions: BudgetActions
  /** Serialized provider payload size in bytes (JSON). */
  payloadBytes: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function capText(text: string, maxTokens: number): { text: string; truncated: boolean } {
  if (estimateTokens(text) <= maxTokens) return { text, truncated: false }
  let result = text
  while (estimateTokens(result) > maxTokens && result.length > 0) {
    // Drop ~10% of the tail each pass; fast and deterministic.
    const cut = Math.max(1, Math.ceil(result.length * 0.1))
    result = result.slice(0, -cut)
  }
  return { text: result, truncated: true }
}

function dedupe(lines: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    const key = line.trim()
    if (!key) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation compression
// ─────────────────────────────────────────────────────────────────────────────

function summarizeOldMessages(
  old: BudgetMessage[],
  maxTokens: number,
  actions: BudgetActions
): { summary: string; tokens: number } {
  if (old.length === 0) return { summary: '', tokens: 0 }

  const lines: string[] = []

  // Keep the first user message intact (it carries the conversation's intent).
  const firstUser = old.find(message => message.role === 'user')
  if (firstUser) {
    const intent = firstUser.content.trim()
    lines.push(`INTENT: ${intent.length > 200 ? `${intent.slice(0, 200)}…` : intent}`)
  }

  // Fold the remaining older turns into compact role-prefixed lines.
  for (const message of old) {
    if (message === firstUser) continue
    const body = message.content.replace(/\s+/g, ' ').trim()
    if (!body) continue
    lines.push(`${message.role === 'user' ? 'U' : 'A'}: ${body.length > 120 ? `${body.slice(0, 120)}…` : body}`)
  }

  let joined = lines.join('\n')
  const capped = capText(joined, maxTokens)
  if (capped.truncated) actions.steps.push(`Conversation summary truncated to ${maxTokens} tokens`)
  joined = capped.text
  actions.compressedConversation = true
  actions.droppedMessages = old.length

  return { summary: joined, tokens: estimateTokens(joined) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory
// ─────────────────────────────────────────────────────────────────────────────

function buildMemoryText(memories: BudgetMemory[], maxTokens: number, actions: BudgetActions): string {
  if (!memories.length) return ''

  let used = 0
  const lines: string[] = []
  const seen = new Set<string>()

  for (const memory of memories) {
    const body = memory.content.trim()
    if (!body || seen.has(body)) continue
    seen.add(body)
    const label = memory.type ? `[${memory.type}] ` : ''
    const line = `- ${label}${body}${memory.context ? ` (${memory.context})` : ''}`
    const lineTokens = estimateTokens(line)
    if (used + lineTokens > maxTokens) {
      // If one oversized memory is the most relevant, keep a truncated prefix
      // of it rather than dropping every memory entirely.
      const room = maxTokens - used
      if (room > 10) {
        const truncated = capText(line, room).text
        lines.push(truncated)
        used = maxTokens
        actions.steps.push('Top memory truncated to fit budget')
      }
      break
    }
    lines.push(line)
    used += lineTokens
  }

  actions.droppedMemoryCount = memories.length - lines.length
  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace / documents / tools
// ─────────────────────────────────────────────────────────────────────────────

function buildBlock(text: string, maxTokens: number, label: string, actions: BudgetActions): string {
  if (!text.trim()) return ''
  const capped = capText(text, maxTokens)
  if (capped.truncated) actions.steps.push(`${label} truncated to ${maxTokens} tokens`)
  return capped.text
}

// ─────────────────────────────────────────────────────────────────────────────
// Assembly
// ─────────────────────────────────────────────────────────────────────────────

export function assemblePrompt(input: AssembleInput): AssembleOutput {
  const budget: ContextBudget = { ...CONTEXT_BUDGET, ...input.budget }
  const actions: BudgetActions = {
    steps: [],
    droppedMessages: 0,
    droppedMemoryCount: 0,
    compressedConversation: false,
  }

  // System-role messages belong to the system section, never the history.
  const messages = input.messages.filter(message => message.content.trim() !== '' && message.role !== 'system')
  const currentUserPrompt = [...messages].reverse().find(message => message.role === 'user')?.content ?? ''

  // ── 1. Split conversation into recent + old ────────────────────────────────
  let recent: BudgetMessage[] = []
  let old: BudgetMessage[] = []
  {
    let recentTokens = 0
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      const tokens = estimateTokens(message.content) + 4 // role + framing overhead
      if (recentTokens + tokens > budget.recentMessages) {
        old = messages.slice(0, index + 1)
        recent = messages.slice(index + 1)
        break
      }
      recentTokens += tokens
    }
    if (recent.length === 0) {
      recent = messages
      old = []
    }
  }

  // ── 2. Compress older turns into a summary ─────────────────────────────────
  const summary = summarizeOldMessages(old, budget.conversationSummary, actions)

  // ── 3. Budget memory / workspace / docs / tools ─────────────────────────────
  let memoryText = buildMemoryText(input.memories ?? [], budget.memory, actions)
  let workspaceText = buildBlock(input.workspaceText ?? '', budget.workspace, 'Workspace context', actions)
  let documentsText = buildBlock(input.documentsText ?? '', budget.retrievedDocuments, 'Retrieved documents', actions)
  let toolsText = buildBlock(input.toolsText ?? '', budget.tools, 'Tool definitions', actions)
  let systemText = input.systemPrompt.trim()
  let developerText = (input.developerPrompt ?? '').trim()

  // ── 4. Dedupe across sections (identical blocks are sent once) ──────────────
  const seenBlocks = new Set<string>()
  const uniqueSection = (label: string, body: string): string => {
    if (!body) return ''
    if (seenBlocks.has(body)) {
      actions.steps.push(`${label} dropped: duplicate of another section`)
      return ''
    }
    seenBlocks.add(body)
    return body
  }
  memoryText = uniqueSection('Memory', memoryText)
  workspaceText = uniqueSection('Workspace context', workspaceText)
  documentsText = uniqueSection('Retrieved documents', documentsText)
  toolsText = uniqueSection('Tool definitions', toolsText)

  // ── 5. Budget enforcement loop ─────────────────────────────────────────────
  // Deterministic "retry": each pass trims whatever is actually over-budget
  // (in priority order) until the per-section caps AND the hard total ceiling
  // are both satisfied. Text sections are truncated in place; recent messages
  // are folded into the summary only when the conversation is genuinely over.
  let passes = 0
  while (passes < 10) {
    passes += 1

    const systemBlock = [
      systemText,
      developerText ? `Developer note: ${developerText}` : '',
      memoryText ? `## Relevant memory\n${memoryText}` : '',
      workspaceText ? `## Workspace context\n${workspaceText}` : '',
      documentsText ? `## Retrieved documents\n${documentsText}` : '',
      toolsText ? `## Available tools\n${toolsText}` : '',
      summary.summary ? `## Conversation summary\n${summary.summary}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')

    const sections: ContextSection[] = [
      { name: 'System Prompt', content: systemText, tokens: estimateTokens(systemText), chars: systemText.length, percent: 0 },
      { name: 'Developer Prompt', content: developerText, tokens: estimateTokens(developerText), chars: developerText.length, percent: 0 },
      { name: 'Memory Injection', content: memoryText, tokens: estimateTokens(memoryText), chars: memoryText.length, percent: 0 },
      { name: 'Workspace Context', content: workspaceText, tokens: estimateTokens(workspaceText), chars: workspaceText.length, percent: 0 },
      { name: 'Retrieved Documents', content: documentsText, tokens: estimateTokens(documentsText), chars: documentsText.length, percent: 0 },
      { name: 'Tool Definitions', content: toolsText, tokens: estimateTokens(toolsText), chars: toolsText.length, percent: 0 },
      { name: 'Conversation Summary', content: summary.summary, tokens: summary.tokens, chars: summary.summary.length, percent: 0 },
      {
        name: 'Recent Messages',
        content: recent.map(message => `${message.role}: ${message.content}`).join('\n'),
        tokens: recent.reduce((sum, message) => sum + estimateTokens(message.content) + 4, 0),
        chars: recent.reduce((sum, message) => sum + message.content.length, 0),
        percent: 0,
      },
      { name: 'User Prompt', content: currentUserPrompt, tokens: estimateTokens(currentUserPrompt), chars: currentUserPrompt.length, percent: 0 },
    ]

    // The User Prompt section is a sub-component of Recent Messages (it is the
    // final message), so it must not be double-counted in the payload total.
    const totalTokens = sections
      .filter(section => section.name !== 'User Prompt')
      .reduce((sum, section) => sum + section.tokens, 0)

    // Per-section caps.
    let overSection = false
    const capOf = (name: string): number => {
      switch (name) {
        case 'System Prompt': return budget.system
        case 'Developer Prompt': return budget.developer
        case 'Memory Injection': return budget.memory
        case 'Workspace Context': return budget.workspace
        case 'Retrieved Documents': return budget.retrievedDocuments
        case 'Tool Definitions': return budget.tools
        case 'Conversation Summary': return budget.conversationSummary
        case 'Recent Messages': return budget.recentMessages
        default: return Number.POSITIVE_INFINITY
      }
    }

    for (const section of sections) {
      const cap = capOf(section.name)
      if (section.tokens > cap) overSection = true
    }

    if (totalTokens <= budget.total && !overSection) {
      // Finalize percentages and payload size.
      for (const section of sections) {
        section.percent = totalTokens === 0 ? 0 : Math.round((section.tokens / totalTokens) * 1000) / 10
      }
      const payloadBytes = JSON.stringify({
        system: systemBlock,
        messages: recent.map(message => ({ role: message.role, content: message.content })),
      }).length

      return {
        system: systemBlock,
        messages: recent,
        sections,
        totalTokens,
        actions,
        payloadBytes,
      }
    }

    const recentSection = sections.find(section => section.name === 'Recent Messages')
    const recentOver = (recentSection?.tokens ?? 0) > budget.recentMessages

    // 1. Truncate text sections that are over their own cap, in place.
    if (estimateTokens(systemText) > budget.system) {
      systemText = capText(systemText, budget.system).text
      actions.steps.push('System prompt truncated to fit budget')
      continue
    }
    if (estimateTokens(developerText) > budget.developer) {
      developerText = capText(developerText, budget.developer).text
      continue
    }
    if (estimateTokens(memoryText) > budget.memory) {
      memoryText = capText(memoryText, budget.memory).text
      actions.steps.push('Memory compressed to fit budget')
      continue
    }
    if (estimateTokens(workspaceText) > budget.workspace) {
      workspaceText = capText(workspaceText, budget.workspace).text
      continue
    }
    if (estimateTokens(documentsText) > budget.retrievedDocuments) {
      documentsText = capText(documentsText, budget.retrievedDocuments).text
      continue
    }
    if (estimateTokens(toolsText) > budget.tools) {
      toolsText = capText(toolsText, budget.tools).text
      continue
    }
    if (summary.tokens > budget.conversationSummary) {
      summary.summary = capText(summary.summary, budget.conversationSummary).text
      summary.tokens = estimateTokens(summary.summary)
      continue
    }

    // 2. Conversation over the total ceiling or the recent cap: fold one more
    //    recent turn into the summary. The final user message is never moved.
    if ((totalTokens > budget.total || recentOver) && recent.length > 1) {
      const moved = recent.shift()!
      old.push(moved)
      const resummarized = summarizeOldMessages(old, budget.conversationSummary, actions)
      summary.summary = resummarized.summary
      summary.tokens = resummarized.tokens
      actions.steps.push('Conversation reduced: one turn folded into summary')
      continue
    }

    // 3. Last resort: hard-truncate the summary so the total ceiling holds.
    if (totalTokens > budget.total) {
      const room = Math.max(0, budget.total - (totalTokens - summary.tokens))
      summary.summary = capText(summary.summary, room).text
      summary.tokens = estimateTokens(summary.summary)
      actions.steps.push('Conversation summary truncated to fit total budget')
      continue
    }

    // Safety net: make progress by shrinking recent even when the budget state
    // is inconsistent; guarantees the loop terminates.
    if (recent.length > 1) {
      const moved = recent.shift()!
      old.push(moved)
      continue
    }
  }

  // Should be unreachable, but never send an unbounded payload.
  throw new Error('Context budget manager could not assemble a payload within budget')
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Inspector
// ─────────────────────────────────────────────────────────────────────────────

/** Pretty-print the per-section token accounting to the main-process console. */
export function logTokenInspector(output: AssembleOutput, provider: string, model: string): void {
  const line = '─'.repeat(64)
  const rows = output.sections.map(section => {
    const pct = section.percent > 0 ? `${section.percent}%` : section.tokens > 0 ? '<0.1%' : '–'
    return `  ${section.name.padEnd(24)} ${String(section.tokens).padStart(6)} tok ${String(section.chars).padStart(7)} ch  ${pct.padStart(5)}`
  })

  const log: string[] = [
    `\n${line}`,
    `AURA TOKEN INSPECTOR  ·  ${provider} / ${model}`,
    line,
    ...rows,
    line,
    `  ${'TOTAL'.padEnd(24)} ${String(output.totalTokens).padStart(6)} tok${' '.repeat(7)} payload ${output.payloadBytes} bytes`,
    ...output.actions.steps.map(step => `  › ${step}`),
    line,
  ]
  // eslint-disable-next-line no-console
  console.log(log.join('\n'))
}
