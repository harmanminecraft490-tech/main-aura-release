import { FormEvent, useState } from 'react'
import { Loader2, Sparkles, UserRound } from 'lucide-react'
import type { AccountStatus } from '@/types'
import { ipcErrorMessage } from '@/utils/ipcError'

/**
 * First-launch gate: create an account (or log in) before using Aura.
 * Signup unlocks the Basic free trial. Dev email gets unlimited Dev tier.
 */
export function AuthGate({ onAuthenticated }: { onAuthenticated: (status: AccountStatus) => void }) {
  const [mode, setMode] = useState<'signup' | 'login'>('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!email.trim() || busy) return
    if (mode === 'signup' && password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (!password) {
      setError('Enter your password.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const next = mode === 'signup'
        ? await window.aura!.account.signup(email.trim(), password)
        : await window.aura!.account.login(email.trim(), password)
      if (!next?.loggedIn) {
        setError(mode === 'signup' ? 'Account could not be created.' : 'Incorrect email or password.')
        return
      }
      onAuthenticated(next)
    } catch (err) {
      setError(ipcErrorMessage(err, mode === 'login' ? 'Incorrect email or password.' : 'Sign up failed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#07070a]/95 p-6 backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-aura-600/25 blur-3xl" />
        <div className="absolute -bottom-28 -right-16 h-96 w-96 rounded-full bg-fuchsia-500/20 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#121218] p-7 shadow-2xl shadow-black/50">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-aura-500 to-fuchsia-500 text-white">
            <Sparkles size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">Welcome to Aura</h1>
            <p className="text-[13px] text-white/45">Create an account to unlock your free trial.</p>
          </div>
        </div>

        <div className="mb-5 flex rounded-xl border border-white/8 bg-black/25 p-1">
          <button
            className={`flex-1 rounded-lg py-2 text-[13px] font-medium transition ${mode === 'signup' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'}`}
            onClick={() => setMode('signup')}
            type="button"
          >
            Create account
          </button>
          <button
            className={`flex-1 rounded-lg py-2 text-[13px] font-medium transition ${mode === 'login' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'}`}
            onClick={() => setMode('login')}
            type="button"
          >
            Log in
          </button>
        </div>

        <form className="space-y-3" onSubmit={event => void submit(event)}>
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/35" htmlFor="auth-email">
              Email
            </label>
            <input
              autoComplete="email"
              autoFocus
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/25 focus:border-aura-400/40"
              id="auth-email"
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              type="email"
              value={email}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/35" htmlFor="auth-password">
              Password
            </label>
            <input
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/25 focus:border-aura-400/40"
              id="auth-password"
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              type="password"
              value={password}
            />
          </div>

          {error && <p className="text-[12px] text-red-300">{error}</p>}

          <button
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-2.5 text-sm font-semibold text-[#0b0b0b] transition enabled:hover:scale-[1.01] disabled:opacity-40"
            disabled={busy || !email.trim() || (mode === 'signup' ? password.length < 6 : !password)}
            type="submit"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <UserRound size={15} />}
            {mode === 'signup' ? 'Create account & unlock trial' : 'Log in'}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-white/30">
          New accounts start as <span className="text-white/50">Basic</span> (normal user) with a free trial.
          <span className="text-white/50"> Premium</span> raises limits. <span className="text-white/50">Dev</span> has no limits.
        </p>
      </div>
    </div>
  )
}
