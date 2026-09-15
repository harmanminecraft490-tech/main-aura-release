/** Pull a readable message out of Electron IPC / invoke rejections. */
export function ipcErrorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  let raw = ''
  if (error instanceof Error) raw = error.message
  else if (typeof error === 'string') raw = error
  else if (error && typeof error === 'object' && 'message' in error) {
    raw = String((error as { message?: unknown }).message ?? '')
  }

  if (!raw.trim()) return fallback

  // Electron wraps invoke failures: Error invoking remote method 'x': Error: real message
  const invokeMatch = raw.match(/Error invoking remote method '[^']+':\s*(?:Error:\s*)?(.*)$/is)
  if (invokeMatch?.[1]?.trim()) raw = invokeMatch[1].trim()

  // Nested "Error: …"
  raw = raw.replace(/^(?:Error:\s*)+/i, '').trim()
  return raw || fallback
}
