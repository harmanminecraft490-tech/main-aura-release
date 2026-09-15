import { useEffect, useRef, useState } from 'react'
import { Terminal as TerminalIcon, X, Plus, ChevronDown } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/utils/cn'
import { useAuraStore } from '@/store'

interface TerminalSession {
  id: string
  title: string
  output: string
  running: boolean
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function XtermInstance({ session, active }: { session: TerminalSession; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<unknown>(null)
  const fitAddonRef = useRef<unknown>(null)

  useEffect(() => {
    if (!containerRef.current || xtermRef.current) return

    // Dynamic import to avoid SSR issues and keep startup fast
    void (async () => {
      try {
        const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
          import('@xterm/addon-web-links'),
        ])

        const term = new Terminal({
          theme: {
            background: '#050508',
            foreground: '#e2e8f0',
            cursor: '#a78bfa',
            cursorAccent: '#0a0a0f',
            selectionBackground: '#4c1d9540',
            black: '#1e293b',
            red: '#f87171',
            green: '#4ade80',
            yellow: '#fbbf24',
            blue: '#60a5fa',
            magenta: '#c084fc',
            cyan: '#67e8f9',
            white: '#e2e8f0',
            brightBlack: '#475569',
            brightRed: '#fca5a5',
            brightGreen: '#86efac',
            brightYellow: '#fde68a',
            brightBlue: '#93c5fd',
            brightMagenta: '#d8b4fe',
            brightCyan: '#a5f3fc',
            brightWhite: '#f8fafc',
          },
          fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
          fontSize: 13,
          lineHeight: 1.5,
          cursorBlink: true,
          cursorStyle: 'bar',
          scrollback: 5000,
          allowTransparency: true,
        })

        const fitAddon = new FitAddon()
        const webLinksAddon = new WebLinksAddon()
        term.loadAddon(fitAddon)
        term.loadAddon(webLinksAddon)

        if (containerRef.current) {
          term.open(containerRef.current)
          fitAddon.fit()
          xtermRef.current = term
          fitAddonRef.current = fitAddon

          // Welcome message
          term.writeln('\x1b[35m✦ Aura Terminal\x1b[0m — type a command and press Enter')
          term.writeln('\x1b[2mCommands run in the active workspace directory.\x1b[0m')
          term.write('\x1b[32m$\x1b[0m ')

          // Input handling
          let currentLine = ''
          term.onData((data: string) => {
            switch (data) {
              case '\r': {
                // Enter
                const cmd = currentLine.trim()
                currentLine = ''
                term.writeln('')
                if (cmd) {
                  void runCommand(cmd, term)
                } else {
                  term.write('\x1b[32m$\x1b[0m ')
                }
                break
              }
              case '\x7f': {
                // Backspace
                if (currentLine.length > 0) {
                  currentLine = currentLine.slice(0, -1)
                  term.write('\b \b')
                }
                break
              }
              case '\x03': {
                // Ctrl+C
                term.writeln('^C')
                currentLine = ''
                term.write('\x1b[32m$\x1b[0m ')
                break
              }
              default: {
                if (data >= ' ') {
                  currentLine += data
                  term.write(data)
                }
              }
            }
          })
        }
      } catch (err) {
        if (containerRef.current) {
          containerRef.current.innerHTML = `<pre style="color: #f87171; padding: 12px; font-size: 12px;">Terminal initialization failed: ${err instanceof Error ? err.message : String(err)}</pre>`
        }
      }
    })()

    return () => {
      if (xtermRef.current) {
        try { (xtermRef.current as { dispose: () => void }).dispose() } catch { /* ignore */ }
        xtermRef.current = null
      }
    }
  }, [session.id])

  // Fit on resize
  useEffect(() => {
    if (!fitAddonRef.current || !active) return
    const obs = new ResizeObserver(() => {
      try { (fitAddonRef.current as { fit: () => void }).fit() } catch { /* ignore */ }
    })
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [active])

  async function runCommand(cmd: string, term: unknown) {
    const t = term as { write: (s: string) => void; writeln: (s: string) => void }
    const result = await window.aura?.workspace.execute({ action: 'run', path: '', content: cmd })
    if (!result) {
      t.writeln('\x1b[31mNo workspace active. Open a project first.\x1b[0m')
    } else if (result.success) {
      const data = result.data as { stdout: string; stderr: string; exitCode: number } | undefined
      if (data?.stdout) {
        for (const line of data.stdout.split('\n')) {
          if (line) t.writeln(line)
        }
      }
      if (data?.stderr) {
        for (const line of data.stderr.split('\n')) {
          if (line) t.writeln(`\x1b[33m${line}\x1b[0m`)
        }
      }
    } else {
      if (result.error) t.writeln(`\x1b[31m${result.error}\x1b[0m`)
      const data = result.data as { stdout?: string; stderr?: string } | undefined
      if (data?.stdout) t.writeln(data.stdout)
      if (data?.stderr) t.writeln(`\x1b[31m${data.stderr}\x1b[0m`)
    }
    t.write('\x1b[32m$\x1b[0m ')
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ display: active ? 'block' : 'none' }}
    />
  )
}

/**
 * Real integrated terminal panel.
 * Supports multiple terminal sessions.
 * Commands execute in the active workspace directory via workspace_file run action.
 */
export function TerminalPanel({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<TerminalSession[]>([
    { id: generateId(), title: 'Terminal 1', output: '', running: false }
  ])
  const [activeId, setActiveId] = useState(sessions[0].id)

  function addSession() {
    const id = generateId()
    const newSession: TerminalSession = {
      id,
      title: `Terminal ${sessions.length + 1}`,
      output: '',
      running: false,
    }
    setSessions(prev => [...prev, newSession])
    setActiveId(id)
  }

  function removeSession(id: string) {
    setSessions(prev => {
      const remaining = prev.filter(s => s.id !== id)
      if (remaining.length === 0) {
        onClose()
        return prev
      }
      if (activeId === id) setActiveId(remaining[remaining.length - 1].id)
      return remaining
    })
  }

  return (
    <motion.div
      animate={{ height: '100%' }}
      className="flex h-full flex-col"
      initial={{ height: 0 }}
      style={{ background: '#050508' }}
    >
      {/* Tab bar */}
      <div className="flex shrink-0 items-center border-b border-white/8 bg-black/30">
        <div className="flex items-center gap-1 px-2 py-1">
          <TerminalIcon size={13} className="text-white/30" />
          <span className="text-[11px] uppercase tracking-wider text-white/25">Terminal</span>
        </div>

        <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
          {sessions.map(session => (
            <button
              key={session.id}
              className={cn(
                'group flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-1.5 text-[11px] transition',
                session.id === activeId
                  ? 'border-aura-400 text-white'
                  : 'border-transparent text-white/35 hover:text-white/65'
              )}
              onClick={() => setActiveId(session.id)}
            >
              {session.title}
              {sessions.length > 1 && (
                <span
                  className="rounded p-0.5 text-white/20 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                  onClick={e => { e.stopPropagation(); removeSession(session.id) }}
                  role="button"
                >
                  <X size={9} />
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 px-2">
          <button
            className="rounded-lg p-1 text-white/25 transition hover:bg-white/8 hover:text-white/60"
            onClick={addSession}
            title="New Terminal"
          >
            <Plus size={13} />
          </button>
          <button
            className="rounded-lg p-1 text-white/25 transition hover:bg-white/8 hover:text-white/60"
            onClick={onClose}
            title="Close Terminal"
          >
            <ChevronDown size={13} />
          </button>
        </div>
      </div>

      {/* Terminal instances */}
      <div className="min-h-0 flex-1 overflow-hidden p-1">
        {sessions.map(session => (
          <XtermInstance
            key={session.id}
            session={session}
            active={session.id === activeId}
          />
        ))}
      </div>
    </motion.div>
  )
}
