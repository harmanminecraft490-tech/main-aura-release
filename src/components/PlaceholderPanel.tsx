import type { LucideIcon } from 'lucide-react'
import { Sparkles } from 'lucide-react'
import { useAuraStore } from '@/store'

function PanelCard({ icon: Icon, title, subtitle, bullets }: { icon: LucideIcon; title: string; subtitle: string; bullets: string[] }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center px-8 text-center">
      <div className="mb-7 flex h-20 w-20 items-center justify-center rounded-3xl border border-white/12 bg-white/8 text-aura-200 shadow-2xl shadow-aura-950/40">
        <Icon size={34} />
      </div>
      <h1 className="text-4xl font-semibold tracking-tight text-white">{title}</h1>
      <p className="mt-4 max-w-2xl text-balance text-lg leading-8 text-white/52">{subtitle}</p>
      <div className="mt-8 grid w-full gap-3 sm:grid-cols-3">
        {bullets.map(bullet => (
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4 text-sm leading-6 text-white/55" key={bullet}>
            {bullet}
          </div>
        ))}
      </div>
      <button
        className="mt-9 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-surface-0 transition hover:scale-[1.02]"
        onClick={() => useAuraStore.getState().setViewMode('chat')}
        type="button"
      >
        Return to chat
      </button>
    </div>
  )
}

export function PlaceholderPanel() {
  return (
    <PanelCard
      bullets={['Natural conversation', 'Streaming intelligence', 'Task completion']}
      icon={Sparkles}
      subtitle="Start a conversation and Aura will adapt to your goal, language, and working style."
      title="Aura"
    />
  )
}
