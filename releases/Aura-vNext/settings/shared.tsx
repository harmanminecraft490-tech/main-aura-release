/** Shared building blocks for settings tabs. */

export function TabHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
      <p className="mt-1 text-sm text-white/45">{description}</p>
    </header>
  )
}

export function SettingRow({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-white/85">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-white/40">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-aura-500' : 'bg-white/15'}`}
      onClick={() => onChange(!checked)}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`}
      />
    </button>
  )
}
