import { Minus, Square, X } from 'lucide-react'

export function TitleBar() {
  return (
    <div className="drag-region flex h-11 shrink-0 items-center justify-between border-b border-white/5 bg-black/10 px-4 backdrop-blur-2xl">
      <div className="flex items-center gap-3 pl-1">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-aura-400 to-fuchsia-500 shadow-lg shadow-aura-500/20">
          <div className="h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.9)]" />
        </div>
        <div className="text-sm font-medium tracking-wide text-white/80">Aura</div>
        <div className="hidden text-xs text-white/30 sm:block">Your Intelligence, Amplified</div>
      </div>

      <div className="no-drag flex items-center gap-1">
        <button
          aria-label="Minimize"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/45 transition hover:bg-white/10 hover:text-white"
          onClick={() => window.aura?.window.minimize()}
          type="button"
        >
          <Minus size={15} />
        </button>
        <button
          aria-label="Maximize"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/45 transition hover:bg-white/10 hover:text-white"
          onClick={() => window.aura?.window.maximize()}
          type="button"
        >
          <Square size={13} />
        </button>
        <button
          aria-label="Close"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/45 transition hover:bg-red-500/80 hover:text-white"
          onClick={() => window.aura?.window.close()}
          type="button"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
