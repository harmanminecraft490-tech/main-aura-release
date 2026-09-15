import { cn } from '@/utils/cn'
import { ChevronDown } from 'lucide-react'
import { ReactNode, useState } from 'react'

// ─── Provider metadata ────────────────────────────────────────────────────────

import type { AIProvider, AIMode } from '@/types'

export const PROVIDER_META: Record<AIProvider, { label: string; color: string; defaultBaseURL: string }> = {
  anthropic: { label: 'Anthropic', color: 'from-orange-500 to-amber-500', defaultBaseURL: 'https://api.anthropic.com' },
  openai: { label: 'OpenAI', color: 'from-emerald-500 to-teal-500', defaultBaseURL: 'https://api.openai.com/v1' },
  moonshot: { label: 'Moonshot Kimi', color: 'from-sky-500 to-blue-500', defaultBaseURL: 'https://api.moonshot.ai/v1' },
  zai: { label: 'Z.AI / GLM', color: 'from-cyan-500 to-indigo-500', defaultBaseURL: 'https://api.z.ai/api/paas/v4/' },
  groq: { label: 'Groq', color: 'from-red-500 to-rose-500', defaultBaseURL: 'https://api.groq.com/openai/v1' },
  cerebras: { label: 'Cerebras', color: 'from-violet-500 to-indigo-500', defaultBaseURL: 'https://api.cerebras.ai/v1' },
  aura: { label: 'Aura', color: 'from-aura-400 to-aura-600', defaultBaseURL: '' },
  openrouter: { label: 'OpenRouter', color: 'from-purple-500 to-violet-500', defaultBaseURL: 'https://openrouter.ai/api/v1' },
  nvidia: { label: 'NVIDIA NIM', color: 'from-green-500 to-lime-500', defaultBaseURL: 'https://integrate.api.nvidia.com/v1' },
  gemini: { label: 'Gemini', color: 'from-blue-500 to-cyan-500', defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
  ollama: { label: 'Ollama', color: 'from-slate-400 to-zinc-400', defaultBaseURL: 'http://localhost:11434/v1' },
  lmstudio: { label: 'LM Studio', color: 'from-indigo-400 to-blue-400', defaultBaseURL: 'http://localhost:1234/v1' },
  localai: { label: 'LocalAI', color: 'from-teal-400 to-cyan-400', defaultBaseURL: 'http://localhost:8080/v1' },
  vllm: { label: 'vLLM', color: 'from-rose-400 to-pink-400', defaultBaseURL: 'http://localhost:8000/v1' },
  deepseek: { label: 'DeepSeek', color: 'from-cyan-400 to-blue-400', defaultBaseURL: 'https://api.deepseek.com/v1' },
  custom: { label: 'Custom Endpoint', color: 'from-fuchsia-500 to-pink-500', defaultBaseURL: '' },
}

export const PROVIDERS = (Object.keys(PROVIDER_META) as AIProvider[]).filter(provider => provider !== 'aura')

export const MODE_META: Record<AIMode, {
  label: string
  desc: string
  params: string
  color: string
  emoji: string
}> = {
  auto: { label: 'Auto', desc: 'Picks Fast / Think / Plan / Max from the task — big work plans then implements', params: 'smart route · adaptive', color: 'from-aura-500 to-fuchsia-500', emoji: '✨' },
  fast: { label: 'Fast', desc: 'Lowest latency, quick answers', params: 'temp 0.25 · 2k tokens', color: 'from-yellow-500 to-amber-500', emoji: '⚡' },
  balanced: { label: 'Balanced', desc: 'Speed and quality equilibrium', params: 'temp 0.5 · 4k tokens', color: 'from-emerald-500 to-teal-500', emoji: '⚖️' },
  think: { label: 'Think', desc: 'Deeper reasoning & analysis', params: 'temp 0.65 · 8k tokens', color: 'from-blue-500 to-indigo-500', emoji: '🧠' },
  plan: { label: 'Plan', desc: 'Plan first, then implement with tools', params: 'temp 0.55 · plan→build', color: 'from-teal-500 to-cyan-500', emoji: '📋' },
  max: { label: 'Max', desc: 'Maximum quality & depth', params: 'temp 0.7 · 16k tokens', color: 'from-purple-500 to-fuchsia-500', emoji: '🚀' },
  bypass: { label: 'Bypass', desc: 'Direct execution, skip permission prompts', params: 'temp 0.85 · no prompts', color: 'from-red-500 to-orange-500', emoji: '🔥' },
}

/** Cursor-style page title for a settings section. */
export function SettingsPageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-[28px] font-semibold tracking-tight text-white">{title}</h1>
      {description && <p className="mt-1.5 text-sm text-white/40">{description}</p>}
    </div>
  )
}

/** Grouped card of settings rows (matches reference “Preferences / Layout” cards). */
export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#141414]">
      {title && (
        <div className="border-b border-white/[0.06] px-4 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-white/35">{title}</p>
        </div>
      )}
      <div className="divide-y divide-white/[0.06]">{children}</div>
    </section>
  )
}

/** Single settings row: label + description left, control right. */
export function SettingsRow({
  label,
  description,
  children,
  danger,
}: {
  label: string
  description?: string
  children: ReactNode
  danger?: boolean
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className={cn('text-[13px] font-medium', danger ? 'text-red-300' : 'text-white/90')}>{label}</p>
        {description && <p className="mt-0.5 text-[12px] leading-relaxed text-white/40">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

export function GhostButton({
  children,
  onClick,
  disabled,
  variant = 'default',
  title,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'default' | 'primary' | 'danger'
  title?: string
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition disabled:opacity-40',
        variant === 'primary' && 'border-sky-400/30 bg-sky-400 text-[#0b0b0b] hover:bg-sky-300',
        variant === 'danger' && 'border-red-500/25 bg-red-500/10 text-red-300 hover:bg-red-500/15',
        variant === 'default' && 'border-white/12 bg-transparent text-white/70 hover:bg-white/[0.06] hover:text-white'
      )}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  )
}

// ─── Card ───────────────────────────────────────────────────────────────────

export function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-3xl border border-white/8 bg-white/[0.04] p-5 backdrop-blur-2xl">
      {title && (
        <div className="mb-3.5 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/35">{title}</p>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

// ─── Accordion ────────────────────────────────────────────────────────────────

export function Accordion({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-3xl border border-white/8 bg-white/[0.04] backdrop-blur-2xl">
      <button
        className="flex w-full items-center justify-between px-5 py-4 text-xs font-semibold uppercase tracking-wider text-white/35 transition hover:text-white/55"
        onClick={() => setOpen(v => !v)}
        type="button"
      >
        {title}
        <ChevronDown size={15} className={cn('transition-transform', open ? 'rotate-180' : '')} />
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  )
}

// ─── Toggle ────────────────────────────────────────────────────────────────────

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={cn('relative h-6 w-11 rounded-full transition-colors', checked ? 'bg-aura-500' : 'bg-white/15')}
      onClick={() => onChange(!checked)}
      type="button"
    >
      <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  )
}

// ─── Slider Field ────────────────────────────────────────────────────────────

export function SliderField({ label, min, max, step, value, onChange, display }: {
  label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; display: string
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-xs font-medium text-white/50">{label}</label>
        <span className="font-mono text-xs text-white/60">{display}</span>
      </div>
      <input className="w-full accent-white/70" type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    </div>
  )
}

// ─── Number Field ────────────────────────────────────────────────────────────

export function NumberField({ label, value, onChange, min, max, placeholder }: {
  label: string; value: number | string; onChange: (v: number) => void; min?: number; max?: number; placeholder?: string
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-white/50">{label}</label>
      <input
        className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 px-3 text-sm text-white outline-none focus:border-white/20"
        type="number"
        min={min}
        max={max}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  )
}

// ─── Text Field ────────────────────────────────────────────────────────────────

export function TextField({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-white/50">{label}</label>
      <input
        className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20 focus:bg-white/7"
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}

// ─── Select Field ─────────────────────────────────────────────────────────────

export function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-white/50">{label}</label>
      <select
        className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 px-3 text-sm text-white outline-none focus:border-white/20"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value} className="bg-surface-1">{opt.label}</option>
        ))}
      </select>
    </div>
  )
}

// ─── Icon Button ──────────────────────────────────────────────────────────────

export function IconBtn({ icon: Icon, onClick, title, active, danger }: {
  icon: React.ElementType; onClick: () => void; title?: string; active?: boolean; danger?: boolean
}) {
  return (
    <button
      className={cn(
        'rounded-xl p-2 transition',
        danger ? 'text-white/30 hover:text-red-400' : active ? 'text-amber-400' : 'text-white/35 hover:bg-white/8 hover:text-white/75'
      )}
      onClick={onClick}
      title={title}
      type="button"
    >
      <Icon size={15} />
    </button>
  )
}
