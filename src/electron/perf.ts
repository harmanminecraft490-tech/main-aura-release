/**
 * PERF — lightweight startup/phase instrumentation.
 *
 * Logs `[perf] phase: Nms` to the main-process console so cold-start and
 * per-request costs are measurable. Cheap to call (a few Date.now() ops).
 */

const marks = new Map<string, number>()

export function perfMark(name: string): void {
  marks.set(name, Date.now())
}

export function perfSince(name: string): number {
  const start = marks.get(name)
  return start === undefined ? 0 : Date.now() - start
}

export function perfLog(tag: string, ms: number): void {
  // eslint-disable-next-line no-console
  console.log(`[perf] ${tag}: ${ms}ms`)
}

export function perfPhase(name: string, phase: string): void {
  perfMark(name)
  perfLog(`startup:${phase}`, perfSince(name))
}
