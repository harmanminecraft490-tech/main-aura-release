import { useEffect, useState } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'

export function TitleBar() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.aura.window.isMaximized().then(setMaximized)
  }, [])

  return (
    <div className="drag-region flex h-11 shrink-0 items-center justify-between border-b border-white/[0.06] bg-surface-1/80 px-4 backdrop-blur-xl">
      <div className="flex items-center gap-2.5">
        <div className="aura-orb h-4 w-4 rounded-full" />
        <span className="text-[13px] font-semibold tracking-tight text-white/85">Aura</span>
      </div>

      <div className="no-drag flex items-center gap-1">
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white"
          onClick={() => void window.aura.window.minimize()}
          title="Minimize"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white"
          onClick={async () => {
            await window.aura.window.maximize()
            setMaximized(await window.aura.window.isMaximized())
          }}
          title={maximized ? 'Restore' : 'Maximize'}
        >
          {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </button>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 transition hover:bg-red-500/80 hover:text-white"
          onClick={() => void window.aura.window.close()}
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
