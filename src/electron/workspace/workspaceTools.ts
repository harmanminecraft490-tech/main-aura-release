/**
 * WORKSPACE TOOL — the only way the AI touches the filesystem.
 *
 * The model emits a workspace_file tool call; Aura executes the REAL operation
 * through the WorkspaceFs (with verification) and returns the verified result.
 * The model can therefore only ever claim what the filesystem confirmed.
 */

import { workspaceManager, type WorkspaceAction } from './workspaceManager'

export const WORKSPACE_FILE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'workspace_file',
    description:
      'Perform a REAL filesystem operation inside the current workspace (create, write, append, read, list, mkdir, delete, rename, move, copy, open, or run a command). ' +
      'The operation is executed on disk and VERIFIED before it returns. Only tell the user an operation succeeded if this returns success:true. ' +
      'Paths are relative to the workspace root. Never fabricate a file — always call this tool.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['write', 'read', 'append', 'mkdir', 'list', 'stat', 'delete', 'rename', 'move', 'copy', 'open', 'run'],
          description: 'Operation to perform.',
        },
        path: { type: 'string', description: 'Path relative to the workspace root, e.g. "src/calc.py".' },
        content: { type: 'string', description: 'Full file content for write/append, or the shell command for run.' },
        newPath: { type: 'string', description: 'Destination path for rename/move/copy.' },
        overwrite: { type: 'boolean', description: 'For write: allow overwriting an existing file (default true).' },
      },
      required: ['action', 'path'],
    },
  },
}

/** Execute a workspace_file tool call; returns a truthful JSON result string. */
export async function executeWorkspaceTool(args: Record<string, unknown>): Promise<string> {
  const action = String(args.action ?? '')
  const filePath = String(args.path ?? '')
  const content = typeof args.content === 'string' ? args.content : undefined
  const newPath = typeof args.newPath === 'string' ? args.newPath : undefined
  const overwrite = args.overwrite === false ? false : true

  const result = await workspaceManager.execute({
    action: action as WorkspaceAction['action'],
    path: filePath,
    content,
    newPath,
    overwrite,
  })

  return JSON.stringify({
    success: result.success,
    operation: result.operation,
    path: result.path,
    exists: result.exists,
    bytesWritten: result.bytesWritten ?? undefined,
    size: result.size ?? undefined,
    modifiedTime: result.modifiedTime ?? undefined,
    checksum: result.checksum ?? undefined,
    error: result.error ?? undefined,
    data: result.data ?? undefined,
  })
}
