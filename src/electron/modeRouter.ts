/**
 * Mode router — resolves Auto to a concrete mode and supplies plan/implement prompts.
 */

export type AIMode = 'auto' | 'fast' | 'balanced' | 'think' | 'plan' | 'max' | 'bypass'
export type EffectiveAIMode = Exclude<AIMode, 'auto'>

/** Pick the best concrete mode for this user turn when Auto is selected. */
export function resolveEffectiveMode(userMessage: string, selected: AIMode | string | undefined): EffectiveAIMode {
  const mode = (selected ?? 'auto') as AIMode
  if (mode !== 'auto') {
    if (mode === 'fast' || mode === 'balanced' || mode === 'think' || mode === 'plan' || mode === 'max' || mode === 'bypass') return mode
    return 'think'
  }

  const text = userMessage.trim()
  const lower = text.toLowerCase()
  const len = text.length
  const lines = text.split(/\r?\n/).length

  if (/\b(bypass|just do it|no confirm|don'?t ask)\b/i.test(lower)) return 'bypass'
  if (/\b(max(?:imum)? quality|go deep|thorough analysis|exhaustive)\b/i.test(lower)) return 'max'
  if (/\b(quick|briefly|tl;dr|short answer|just tell me)\b/i.test(lower)) return 'fast'
  if (/\b(plan only|make a plan|architecture|roadmap|step[- ]by[- ]step plan)\b/i.test(lower)) return 'plan'

  const isBigBuild =
    len > 400 ||
    lines > 12 ||
    /\b(build|create|implement|develop|scaffold|rewrite|migrate|refactor entire|from scratch|multi[- ]?file|full(?:[- ]|\s)?stack|end[- ]to[- ]end)\b/i.test(lower) ||
    /\b(app|application|system|feature|module|service|api|dashboard|website|cli)\b/i.test(lower) &&
      /\b(add|build|create|implement|make|write|design)\b/i.test(lower)

  // Large autonomous work belongs in the execution path. Explicit Plan mode is
  // still handled above and remains plan-only.
  if (isBigBuild) return 'think'

  const isCoding =
    /\b(code|function|class|bug|fix|implement|refactor|endpoint|typescript|javascript|python|react|error|stack trace)\b/i.test(lower) ||
    /```/.test(text) ||
    /\b(src\/|\.tsx?|\.jsx?|\.py)\b/i.test(text)

  if (isCoding) {
    if (len > 220 || /\b(why|explain|analyze|compare|trade-?off)\b/i.test(lower)) return 'think'
    return 'balanced'
  }

  if (len < 120 && lines <= 3) return 'fast'
  if (/\b(why|how does|explain|analyze|compare|reason)\b/i.test(lower) || len > 280) return 'think'
  return 'balanced'
}

export function planPhaseSystemAddendum(): string {
  return [
    '',
    '═══ PLAN MODE — PHASE 1 (PLAN ONLY) ═══',
    'You are in PLANNING phase. Do NOT implement yet.',
    '1. Restate the goal in one sentence.',
    '2. List assumptions / constraints.',
    '3. Produce a numbered implementation plan (concrete files, steps, risks).',
    '4. Call out what you will change vs leave alone.',
    'You may READ the workspace (list/read/stat) to ground the plan.',
    'Do NOT write, append, delete, rename, move, copy, mkdir, or run commands in this phase.',
    'End with: "Ready to implement — say continue or I will proceed."',
  ].join('\n')
}

export function implementPhaseSystemAddendum(planText: string): string {
  const clipped = planText.trim().slice(0, 12000)
  return [
    '',
    '═══ PLAN MODE — PHASE 2 (IMPLEMENT) ═══',
    'Execute the approved plan below. Prefer tools over prose.',
    'Do not re-plan unless the plan is impossible; if blocked, say why and adapt minimally.',
    'After tools finish, summarize what changed.',
    '',
    'APPROVED PLAN:',
    clipped || '(plan was empty — infer a sensible minimal plan and implement carefully)',
  ].join('\n')
}

export function isMutatingWorkspaceAction(action: string): boolean {
  return ['write', 'append', 'delete', 'rename', 'move', 'copy', 'mkdir', 'run'].includes(action)
}
