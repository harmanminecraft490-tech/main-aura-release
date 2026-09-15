import { useEffect, useState } from 'react'
import { Cpu, Database, ShieldCheck, Wifi } from 'lucide-react'
import { useAuraStore } from '@/store'
import { resolveSelection } from '@/services/auraModels'
import type { AIStatus, APIProfile, AuraVirtualModel } from '@/types'

export function StatusStrip() {
  const [status, setStatus] = useState<AIStatus | null>(null)
  const defaultModelSelection = useAuraStore(state => state.defaultModelSelection)
  const virtualModels = useAuraStore(state => state.virtualModels)
  const profiles = useAuraStore(state => state.profiles)

  useEffect(() => {
    window.aura?.ai.getStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  // Aura-branded label only — the raw provider model id is never surfaced here.
  let profile: APIProfile | undefined
  let virtualModel: AuraVirtualModel | undefined

  if (defaultModelSelection.kind === 'aura') {
    virtualModel = virtualModels.find(m => m.id === defaultModelSelection.id)
  } else {
    profile = profiles.find(p => p.id === defaultModelSelection.id)
  }
  const modelLabel = virtualModel?.name ?? profile?.displayName ?? 'Aura'
  const connected = status?.hasApiKey ?? false

  return (
    <div className="flex items-center gap-2 text-xs text-white/35">
      <div className="flex items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5">
        <span className={connected ? 'h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.8)]' : 'h-1.5 w-1.5 rounded-full bg-amber-400'} />
        <Wifi size={13} />
        {connected ? 'AI connected' : 'API key missing'}
      </div>
      <div className="hidden items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 md:flex">
        <Cpu size={13} />
        <span className="max-w-[260px] truncate">{modelLabel}</span>
      </div>
      <div className="hidden items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 lg:flex">
        <Database size={13} />
        Neon-ready memory
      </div>
      <div className="hidden items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 xl:flex">
        <ShieldCheck size={13} />
        Key isolated in main process
      </div>
    </div>
  )
}
