import { useEffect, useRef, useState, useCallback } from 'react'
// Bundles Monaco locally (no CDN) and wires the loader + workers — fixes the
// black editor caused by the CSP blocking the CDN. Side-effect import.
import '../monacoSetup'
import Editor, { type Monaco } from '@monaco-editor/react'
import { Check, ChevronRight, FileCode2, FolderOpen, Loader2, Save, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils/cn'
import { useAuraStore } from '@/store'

/** Map file extension to Monaco language ID. */
function detectLanguage(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c', h: 'c',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
    cs: 'csharp',
    rb: 'ruby',
    php: 'php',
    html: 'html', htm: 'html',
    css: 'css',
    scss: 'scss',
    json: 'json',
    yaml: 'yaml', yml: 'yaml',
    xml: 'xml',
    md: 'markdown',
    sh: 'shell', bash: 'shell',
    sql: 'sql',
    r: 'r',
    dart: 'dart',
    lua: 'lua',
    vim: 'vim',
    dockerfile: 'dockerfile',
    toml: 'ini',
    env: 'ini',
    tf: 'hcl',
    graphql: 'graphql', gql: 'graphql',
  }
  // Handle filenames like Dockerfile, .env
  const fullName = fileName.toLowerCase()
  if (fullName === 'dockerfile' || fullName.startsWith('dockerfile.')) return 'dockerfile'
  if (fullName.startsWith('.env')) return 'ini'
  if (fullName === 'makefile') return 'makefile'
  return map[ext] ?? 'plaintext'
}

function SaveIndicator({ status }: { status: { ok: boolean; text: string } | null }) {
  if (!status) return null
  return (
    <AnimatePresence>
      <motion.span
        animate={{ opacity: 1, x: 0 }}
        className={cn(
          'mr-2 flex items-center gap-1 text-[10px]',
          status.ok ? 'text-emerald-400' : 'text-red-400'
        )}
        exit={{ opacity: 0 }}
        initial={{ opacity: 0, x: 4 }}
      >
        {status.ok ? <Check size={10} /> : null}
        {status.text}
      </motion.span>
    </AnimatePresence>
  )
}

/**
 * Premier Monaco-powered live file editor.
 *
 * - Backed by the REAL workspace file on disk.
 * - When the AI writes a file, it opens here immediately with full syntax highlighting.
 * - Save: Ctrl+S or Save button → persists with verification.
 * - Shows "Writing…" / "Saved ✓" / unsaved dot indicators.
 */
export function FileEditor() {
  const openFiles = useAuraStore(state => state.openFiles)
  const activeFileId = useAuraStore(state => state.activeFileId)
  const setActiveFile = useAuraStore(state => state.setActiveFile)
  const closeFile = useAuraStore(state => state.closeFile)
  const setFileContent = useAuraStore(state => state.setFileContent)
  const markFileSaved = useAuraStore(state => state.markFileSaved)
  const editorStatus = useAuraStore(state => state.editorStatus)
  const [saveStatus, setSaveStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const editorRef = useRef<unknown>(null)

  const active = openFiles.find(f => f.id === activeFileId) ?? openFiles[openFiles.length - 1]
  if (!active) return null

  const language = detectLanguage(active.name)

  const save = useCallback(async () => {
    if (!active || !active.dirty) return
    setSaveStatus(null)
    try {
      const result = await window.aura?.workspace.execute({
        action: 'write',
        path: active.path,
        content: active.content,
        overwrite: true,
      })
      if (result?.success) {
        setSaveStatus({ ok: true, text: 'Saved ✓' })
        markFileSaved(active.id)
        setTimeout(() => setSaveStatus(null), 2500)
      } else {
        setSaveStatus({ ok: false, text: `Save failed: ${result?.error ?? 'unknown error'}` })
      }
    } catch (error) {
      setSaveStatus({ ok: false, text: `Save failed: ${error instanceof Error ? error.message : 'error'}` })
    }
  }, [active, markFileSaved])

  // Ctrl+S / Cmd+S save
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save])

  function handleEditorDidMount(editor: unknown, monaco: Monaco) {
    editorRef.current = editor
    monacoRef.current = monaco

    // Re-layout on container resize via ResizeObserver. automaticLayout() polls
    // on a timer (~10×/s) which is a steady CPU cost — the observer only fires
    // when the panel actually changes size.
    try {
      const domNode = (editor as { getDomNode: () => HTMLElement }).getDomNode()
      const container = domNode?.parentElement
      if (container) {
        const observer = new ResizeObserver(() => {
          ;(editor as { layout: () => void }).layout()
        })
        observer.observe(container)
      }
    } catch {
      // non-fatal — Monaco still works, it just won't auto-resize.
    }

    // Configure Monaco theme
    monaco.editor.defineTheme('aura-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'c084fc' },
        { token: 'string', foreground: '86efac' },
        { token: 'number', foreground: 'fb923c' },
        { token: 'type', foreground: '93c5fd' },
        { token: 'class', foreground: 'fbbf24' },
        { token: 'function', foreground: '67e8f9' },
        { token: 'variable', foreground: 'f1f5f9' },
        { token: 'operator', foreground: 'e2e8f0' },
        { token: 'delimiter', foreground: '94a3b8' },
      ],
      colors: {
        'editor.background': '#0a0a0f',
        'editor.foreground': '#e2e8f0',
        'editorLineNumber.foreground': '#334155',
        'editorLineNumber.activeForeground': '#7c3aed',
        'editorCursor.foreground': '#a78bfa',
        'editor.selectionBackground': '#4c1d9540',
        'editor.lineHighlightBackground': '#ffffff08',
        'editorWhitespace.foreground': '#1e293b',
        'editorIndentGuide.background': '#1e293b',
        'editorIndentGuide.activeBackground': '#334155',
        'editor.findMatchBackground': '#7c3aed40',
        'editor.findMatchHighlightBackground': '#7c3aed20',
        'scrollbarSlider.background': '#ffffff14',
        'scrollbarSlider.hoverBackground': '#ffffff22',
        'scrollbarSlider.activeBackground': '#ffffff33',
        'minimap.background': '#050508',
        'editorGutter.background': '#0a0a0f',
      },
    })
    monaco.editor.setTheme('aura-dark')
  }

  // Build breadcrumb segments from the path
  const pathParts = active.path.replace(/\\/g, '/').split('/')
  const breadcrumb = pathParts.slice(-3) // show last 3 segments

  const isWriting = editorStatus?.state === 'writing'

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: '#0a0a0f' }}>
      {/* Tab bar */}
      <div className="flex shrink-0 items-center border-b border-white/8 bg-black/30 px-2 pt-1">
        <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
          {openFiles.map(file => (
            <button
              key={file.id}
              className={cn(
                'group flex shrink-0 items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-1.5 text-xs transition',
                file.id === active.id
                  ? 'border-aura-400 bg-white/[0.08] text-white'
                  : 'border-transparent text-white/40 hover:text-white/70'
              )}
              onClick={() => setActiveFile(file.id)}
              type="button"
            >
              <FileCode2 size={11} />
              <span className="max-w-[140px] truncate">{file.name}</span>
              {file.dirty && (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Unsaved changes" />
              )}
              <span
                className="rounded p-0.5 text-white/25 opacity-0 transition hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100"
                onClick={e => { e.stopPropagation(); closeFile(file.id) }}
                role="button"
                title="Close"
              >
                <X size={10} />
              </span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 pb-1 pl-2">
          {/* Live coding status */}
          {isWriting && editorStatus?.fileName && (
            <motion.span
              animate={{ opacity: 1 }}
              className="flex items-center gap-1 rounded-lg border border-aura-500/20 bg-aura-500/8 px-2 py-0.5 text-[10px] text-aura-300"
              initial={{ opacity: 0 }}
            >
              <Loader2 size={9} className="animate-spin" />
              Writing…
            </motion.span>
          )}
          <SaveIndicator status={saveStatus} />
          <button
            className={cn(
              'flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition',
              active.dirty
                ? 'bg-aura-500/90 text-white hover:bg-aura-500'
                : 'bg-white/8 text-white/35'
            )}
            disabled={!active.dirty}
            onClick={() => void save()}
            title="Save file (Ctrl+S)"
            type="button"
          >
            <Save size={11} />
            {active.dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="flex shrink-0 items-center gap-1 border-b border-white/6 bg-black/20 px-3 py-1.5 font-mono text-[10px] text-white/30">
        <FolderOpen size={10} className="text-white/20" />
        {breadcrumb.map((part, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={9} className="text-white/15" />}
            <span className={i === breadcrumb.length - 1 ? 'text-white/55' : ''}>{part}</span>
          </span>
        ))}
        {active.dirty && <span className="ml-2 text-amber-400/70">· unsaved</span>}
      </div>

      {/* Monaco Editor */}
      <div className="min-h-0 flex-1">
        <Editor
          defaultLanguage={language}
          language={language}
          loading={
            <div className="flex h-full items-center justify-center">
              <Loader2 size={20} className="animate-spin text-aura-400/50" />
            </div>
          }
          onChange={value => {
            if (value !== undefined) setFileContent(active.id, value)
          }}
          onMount={handleEditorDidMount}
          options={{
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
            fontLigatures: true,
            lineHeight: 20,
            minimap: { enabled: true, scale: 1 },
            scrollBeyondLastLine: false,
            wordWrap: 'off',
            tabSize: 2,
            insertSpaces: true,
            renderWhitespace: 'selection',
            smoothScrolling: true,
            cursorSmoothCaretAnimation: 'on',
            cursorBlinking: 'smooth',
            padding: { top: 16, bottom: 16 },
            glyphMargin: false,
            folding: true,
            renderLineHighlight: 'line',
            scrollbar: {
              verticalScrollbarSize: 6,
              horizontalScrollbarSize: 6,
            },
            suggest: {
              showIcons: true,
              showStatusBar: false,
            },
            bracketPairColorization: { enabled: true },
            guides: {
              indentation: true,
              bracketPairs: true,
            },
            stickyScroll: { enabled: true },
            lineNumbers: 'on',
            lineNumbersMinChars: 3,
          }}
          theme="aura-dark"
          value={active.content}
        />
      </div>
    </div>
  )
}
