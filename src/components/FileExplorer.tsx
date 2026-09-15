import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronRight, File, FilePlus, Folder, FolderOpen, FolderPlus,
  Loader2, MoreHorizontal, RefreshCw, Trash2, X
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { useAuraStore } from '@/store'

interface FsEntry {
  name: string
  isDir: boolean
  sizeBytes?: number
}

interface TreeNode {
  name: string
  path: string // relative to workspace root
  isDir: boolean
  sizeBytes?: number
  children?: TreeNode[]
  expanded: boolean
  loading: boolean
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const iconMap: Record<string, string> = {
    ts: '🔷', tsx: '🔷', js: '🟨', jsx: '🟨',
    py: '🐍', rs: '🦀', go: '🔵', java: '☕',
    html: '🌐', css: '🎨', scss: '🎨',
    json: '📋', yaml: '📋', yml: '📋', toml: '📋',
    md: '📝', txt: '📄',
    sh: '⚡', bash: '⚡',
    sql: '🗄️', db: '🗄️',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', ico: '🖼️', webp: '🖼️',
    pdf: '📕',
    zip: '📦', tar: '📦', gz: '📦',
    env: '🔑', gitignore: '⚫',
  }
  const fullMap: Record<string, string> = {
    '.env': '🔑', '.gitignore': '⚫', 'dockerfile': '🐳',
    'package.json': '📦', 'tsconfig.json': '⚙️', 'vite.config.ts': '⚡',
  }
  const fullName = name.toLowerCase()
  return fullMap[fullName] ?? iconMap[ext] ?? '📄'
}

function formatSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

interface ContextMenuState {
  x: number
  y: number
  node: TreeNode
}

function ContextMenu({
  menu,
  onClose,
  onNewFile,
  onNewFolder,
  onDelete,
  onRename,
}: {
  menu: ContextMenuState
  onClose: () => void
  onNewFile: (parent: string) => void
  onNewFolder: (parent: string) => void
  onDelete: (node: TreeNode) => void
  onRename: (node: TreeNode) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  const parentPath = menu.node.isDir ? menu.node.path : menu.node.path.split('/').slice(0, -1).join('/')

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[160px] rounded-xl border border-white/12 bg-surface-1/95 py-1 shadow-2xl shadow-black/60 backdrop-blur-3xl"
      style={{ left: menu.x, top: menu.y }}
    >
      {menu.node.isDir && (
        <>
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-white/70 transition hover:bg-white/8 hover:text-white"
            onClick={() => { onNewFile(menu.node.path); onClose() }}
          >
            <FilePlus size={13} /> New File
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-white/70 transition hover:bg-white/8 hover:text-white"
            onClick={() => { onNewFolder(menu.node.path); onClose() }}
          >
            <FolderPlus size={13} /> New Folder
          </button>
          <div className="my-1 border-t border-white/8" />
        </>
      )}
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-white/70 transition hover:bg-white/8 hover:text-white"
        onClick={() => { onRename(menu.node); onClose() }}
      >
        <MoreHorizontal size={13} /> Rename
      </button>
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400/80 transition hover:bg-red-500/10 hover:text-red-300"
        onClick={() => { onDelete(menu.node); onClose() }}
      >
        <Trash2 size={13} /> Delete
      </button>
    </div>
  )
}

interface TreeRowProps {
  node: TreeNode
  depth: number
  onToggle: (path: string) => void
  onOpen: (node: TreeNode) => void
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void
  activeFilePath: string | null
}

function TreeRow({ node, depth, onToggle, onOpen, onContextMenu, activeFilePath }: TreeRowProps) {
  const isActive = !node.isDir && node.path === activeFilePath
  return (
    <div>
      <button
        className={cn(
          'flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[12.5px] transition hover:bg-white/6',
          isActive ? 'bg-aura-500/12 text-white' : 'text-white/60 hover:text-white/90'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => node.isDir ? onToggle(node.path) : onOpen(node)}
        onContextMenu={e => { e.preventDefault(); onContextMenu(e, node) }}
        type="button"
      >
        {node.isDir ? (
          <>
            <ChevronRight
              size={11}
              className={cn('shrink-0 text-white/30 transition-transform', node.expanded && 'rotate-90')}
            />
            {node.loading
              ? <Loader2 size={13} className="shrink-0 animate-spin text-white/30" />
              : node.expanded
              ? <FolderOpen size={13} className="shrink-0 text-yellow-400/70" />
              : <Folder size={13} className="shrink-0 text-yellow-300/50" />
            }
          </>
        ) : (
          <>
            <span className="w-[11px] shrink-0" />
            <span className="shrink-0 text-[11px]">{getFileIcon(node.name)}</span>
          </>
        )}
        <span className="min-w-0 truncate">{node.name}</span>
        {!node.isDir && node.sizeBytes !== undefined && (
          <span className="ml-auto shrink-0 text-[10px] text-white/20">{formatSize(node.sizeBytes)}</span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {node.isDir && node.expanded && node.children && (
          <motion.div
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {node.children.length === 0 ? (
              <div
                style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
                className="py-1 text-[11px] text-white/20 italic"
              >
                empty
              </div>
            ) : (
              node.children.map(child => (
                <TreeRow
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  onToggle={onToggle}
                  onOpen={onOpen}
                  onContextMenu={onContextMenu}
                  activeFilePath={activeFilePath}
                />
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Ignored directories in the tree
const IGNORED = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build',
  'coverage', '.cache', 'target', 'vendor', 'bin', 'obj',
  'out', 'release', 'logs', '__pycache__', '.venv', 'venv',
  '.pytest_cache', '.mypy_cache', 'htmlcov',
])

async function listDir(path: string): Promise<FsEntry[]> {
  const result = await window.aura?.workspace.execute({ action: 'list', path })
  if (!result?.success || !Array.isArray(result.data)) return []
  return (result.data as FsEntry[]).filter(entry => !IGNORED.has(entry.name))
}

/**
 * Real workspace file explorer.
 * Uses workspace:execute {action: 'list'} to read the real filesystem.
 * Lazy-loads children on expand. Context menu for New File / New Folder / Rename / Delete.
 */
export function FileExplorer() {
  const openFiles = useAuraStore(state => state.openFiles)
  const activeFileId = useAuraStore(state => state.activeFileId)
  const openFile = useAuraStore(state => state.openFile)
  const setIsLiveCoding = useAuraStore(state => state.setIsLiveCoding)
  const setExplorerOpen = useAuraStore(state => state.setExplorerOpen)

  const [root, setRoot] = useState<string | null>(null)
  const [rootName, setRootName] = useState<string>('')
  const [tree, setTree] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [newItemState, setNewItemState] = useState<{ parentPath: string; type: 'file' | 'folder'; name: string } | null>(null)

  const activeFile = openFiles.find(f => f.id === activeFileId)

  const loadRoot = useCallback(async () => {
    const state = await window.aura?.workspace.state()
    if (!state?.root) { setRoot(null); setTree([]); return }

    setRoot(state.root)
    setRootName(state.root.replace(/\\/g, '/').split('/').pop() ?? state.root)
    setLoading(true)

    const entries = await listDir('')
    const nodes: TreeNode[] = entries.map(e => ({
      name: e.name,
      path: e.name,
      isDir: e.isDir,
      sizeBytes: e.sizeBytes,
      expanded: false,
      loading: false,
      children: e.isDir ? undefined : [],
    }))

    // Sort: dirs first, then files, both alphabetical
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    setTree(nodes)
    setLoading(false)
  }, [])

  useEffect(() => { void loadRoot() }, [loadRoot])

  async function toggleNode(nodePath: string) {
    setTree(prev => updateTree(prev, nodePath, node => ({ ...node, loading: !node.expanded, expanded: !node.expanded })))

    // Load children if expanding
    setTree(prev => {
      const node = findNode(prev, nodePath)
      if (!node || !node.expanded || node.children) return prev
      return prev
    })

    const node = findNode(tree, nodePath)
    if (!node || !node.isDir) return

    if (!node.expanded) {
      // About to expand — load children
      const entries = await listDir(nodePath)
      const children: TreeNode[] = entries.map(e => ({
        name: e.name,
        path: `${nodePath}/${e.name}`,
        isDir: e.isDir,
        sizeBytes: e.sizeBytes,
        expanded: false,
        loading: false,
        children: e.isDir ? undefined : [],
      }))
      children.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      setTree(prev => updateTree(prev, nodePath, n => ({ ...n, children, loading: false })))
    }
  }

  async function openFileNode(node: TreeNode) {
    // Read the actual file content first
    const result = await window.aura?.workspace.execute({ action: 'read', path: node.path })
    const content = typeof result?.data === 'string' ? result.data : ''
    const state = await window.aura?.workspace.state()
    const absPath = state?.root ? `${state.root}/${node.path}`.replace(/\\/g, '/') : node.path
    openFile({ name: node.name, path: absPath, content })
    setIsLiveCoding(true)
  }

  async function handleNewFile(parentPath: string) {
    setNewItemState({ parentPath, type: 'file', name: '' })
  }

  async function handleNewFolder(parentPath: string) {
    setNewItemState({ parentPath, type: 'folder', name: '' })
  }

  async function commitNewItem() {
    if (!newItemState || !newItemState.name.trim()) { setNewItemState(null); return }
    const fullPath = newItemState.parentPath
      ? `${newItemState.parentPath}/${newItemState.name.trim()}`
      : newItemState.name.trim()

    if (newItemState.type === 'file') {
      await window.aura?.workspace.execute({ action: 'write', path: fullPath, content: '', overwrite: false })
    } else {
      await window.aura?.workspace.execute({ action: 'mkdir', path: fullPath })
    }
    setNewItemState(null)
    await loadRoot() // refresh
  }

  async function handleDelete(node: TreeNode) {
    const confirmed = window.confirm(`Delete ${node.isDir ? 'folder' : 'file'} "${node.name}"? This cannot be undone.`)
    if (!confirmed) return
    await window.aura?.workspace.execute({ action: 'delete', path: node.path })
    await loadRoot()
  }

  async function handleRename(node: TreeNode) {
    const newName = window.prompt(`Rename "${node.name}" to:`, node.name)
    if (!newName || newName === node.name) return
    const parentPath = node.path.split('/').slice(0, -1).join('/')
    const newPath = parentPath ? `${parentPath}/${newName}` : newName
    await window.aura?.workspace.execute({ action: 'rename', path: node.path, newPath })
    await loadRoot()
  }

  if (!root) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <FolderOpen size={28} className="text-white/15" />
        <p className="text-xs text-white/30">No workspace open</p>
        <p className="text-[11px] text-white/20">Open a folder to see files here</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-3 py-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <FolderOpen size={13} className="shrink-0 text-yellow-400/60" />
          <span className="truncate text-[12px] font-medium text-white/70">{rootName}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            className="rounded-lg p-1 text-white/30 transition hover:bg-white/8 hover:text-white/70"
            onClick={() => void loadRoot()}
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
          <button
            className="rounded-lg p-1 text-white/30 transition hover:bg-white/8 hover:text-white/70"
            onClick={() => void handleNewFile('')}
            title="New File"
          >
            <FilePlus size={12} />
          </button>
          <button
            className="rounded-lg p-1 text-white/30 transition hover:bg-white/8 hover:text-white/70"
            onClick={() => void handleNewFolder('')}
            title="New Folder"
          >
            <FolderPlus size={12} />
          </button>
          <button
            className="rounded-lg p-1 text-white/30 transition hover:bg-white/8 hover:text-white/70"
            onClick={() => setExplorerOpen(false)}
            title="Close"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* New item input */}
      {newItemState && (
        <div className="border-b border-white/8 px-3 py-2">
          <div className="flex items-center gap-2">
            {newItemState.type === 'file' ? <File size={12} className="shrink-0 text-white/40" /> : <Folder size={12} className="shrink-0 text-yellow-400/60" />}
            <input
              autoFocus
              className="flex-1 rounded-lg bg-white/8 px-2 py-1 text-[12px] text-white outline-none focus:ring-1 focus:ring-aura-500/40"
              onBlur={() => void commitNewItem()}
              onChange={e => setNewItemState(prev => prev ? { ...prev, name: e.target.value } : null)}
              onKeyDown={e => {
                if (e.key === 'Enter') void commitNewItem()
                if (e.key === 'Escape') setNewItemState(null)
              }}
              placeholder={newItemState.type === 'file' ? 'filename.ts' : 'folder-name'}
              value={newItemState.name}
            />
          </div>
        </div>
      )}

      {/* Tree */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1 px-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="animate-spin text-white/25" />
          </div>
        ) : (
          tree.map(node => (
            <TreeRow
              key={node.path}
              node={node}
              depth={0}
              onToggle={path => void toggleNode(path)}
              onOpen={n => void openFileNode(n)}
              onContextMenu={(e, n) => setContextMenu({ x: e.clientX, y: e.clientY, node: n })}
              activeFilePath={activeFile ? activeFile.path.replace(/\\/g, '/').split('/').slice(-1)[0] : null}
            />
          ))
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onNewFile={p => void handleNewFile(p)}
          onNewFolder={p => void handleNewFolder(p)}
          onDelete={n => void handleDelete(n)}
          onRename={n => void handleRename(n)}
        />
      )}
    </div>
  )
}

// ─── Tree helpers ─────────────────────────────────────────────────────────────

function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node
    if (node.children) {
      const found = findNode(node.children, path)
      if (found) return found
    }
  }
  return null
}

function updateTree(nodes: TreeNode[], path: string, updater: (node: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map(node => {
    if (node.path === path) return updater(node)
    if (node.children) return { ...node, children: updateTree(node.children, path, updater) }
    return node
  })
}
