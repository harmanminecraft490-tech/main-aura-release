import { FormEvent, useEffect, useState } from 'react'
import { Check, Cloud, Crown, KeyRound, Loader2, LogOut, Shield, UserRound, Zap } from 'lucide-react'
import type { AccountStatus, AccountTier } from '@/types'
import { useAuraStore } from '@/store'
import { ipcErrorMessage } from '@/utils/ipcError'
import { SettingsGroup, SettingsPageHeader, SettingsRow } from './shared'

function TierBadge({ tier, label }: { tier: AccountTier; label: string }) {
  const styles =
    tier === 'dev'
      ? 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-400/25'
      : tier === 'premium'
        ? 'bg-amber-500/15 text-amber-300 border-amber-400/25'
        : 'bg-sky-500/15 text-sky-300 border-sky-400/25'
  const Icon = tier === 'dev' ? Shield : tier === 'premium' ? Crown : Zap
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${styles}`}>
      <Icon size={11} /> {label}
    </span>
  )
}

function tierDescription(tier: AccountTier): string {
  if (tier === 'dev') return 'Dev — owner account with no limits.'
  if (tier === 'premium') return 'Premium — higher limits for premium users.'
  return 'Basic — normal user plan with free trial on signup.'
}

/**
 * Our Account — login / logout, plan tier (Dev / Basic / Premium), free trial.
 */
export function AccountTab({ onStatusChange }: { onStatusChange?: (status: AccountStatus) => void }) {
  const setAccount = useAuraStore(state => state.setAccount)
  const [status, setStatus] = useState<AccountStatus | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const applyStatus = (next: AccountStatus | null) => {
    setStatus(next)
    setAccount(next)
    if (next) onStatusChange?.(next)
  }

  const refresh = () => {
    window.aura?.account.status().then(applyStatus).catch(() => applyStatus(null))
  }

  useEffect(() => { refresh() }, [])

  async function submit(mode: 'signup' | 'login', event: FormEvent) {
    event.preventDefault()
    if (!email.trim() || !password || busy) return
    setBusy(true)
    setMessage(null)
    try {
      const next = mode === 'signup'
        ? await window.aura!.account.signup(email, password)
        : await window.aura!.account.login(email, password)
      applyStatus(next)
      setPassword('')
      setMessage({
        kind: 'ok',
        text: mode === 'signup'
          ? next.tier === 'dev'
            ? 'Dev account ready — unlimited access.'
            : 'Account created — free trial unlocked.'
          : 'Signed in.',
      })
    } catch (error) {
      setMessage({ kind: 'err', text: ipcErrorMessage(error, mode === 'login' ? 'Incorrect email or password.' : 'Sign up failed.') })
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    setBusy(true)
    try {
      const next = await window.aura!.account.logout()
      applyStatus(next)
      setMessage(null)
    } catch (error) {
      setMessage({ kind: 'err', text: error instanceof Error ? error.message : 'Sign out failed.' })
    } finally {
      setBusy(false)
    }
  }

  const trialDaysLeft = status?.trialEndsAt
    ? Math.max(0, Math.ceil((status.trialEndsAt - Date.now()) / (24 * 60 * 60 * 1000)))
    : null

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <SettingsPageHeader
        title="Our Account"
        description="Sign in to sync memory, unlock your free trial, and manage your Aura plan."
      />

      <SettingsGroup title="Cloud memory & sync">
        <div className="flex items-start gap-3 px-4 py-3.5 text-[13px] leading-relaxed text-white/55">
          <Cloud size={16} className="mt-0.5 shrink-0 text-aura-300" />
          <p>
            Signing in saves memories to your account
            {status?.backend === 'neon' ? ' (Neon)' : ' on this device'}
            . Create an account on first launch to unlock your free trial.
          </p>
        </div>
      </SettingsGroup>

      {status?.loggedIn ? (
        <SettingsGroup title="Signed in">
          <div className="px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                <UserRound size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-white/90">{status.email}</p>
                  <TierBadge tier={status.tier} label={status.tierLabel} />
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-emerald-400">
                  <Check size={12} />
                  {status.unlimited
                    ? 'Dev · unlimited access · no limits'
                    : status.tier === 'premium'
                      ? 'Premium user · higher limits'
                      : status.trialActive
                        ? `Basic (normal user) · free trial · ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left`
                        : 'Basic (normal user) · cloud memory'}
                </p>
              </div>
              <button
                className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-white/65 transition hover:text-white"
                disabled={busy}
                onClick={() => void logout()}
                type="button"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />} Sign out
              </button>
            </div>
          </div>

          <SettingsRow
            label="Plan"
            description={tierDescription(status.tier)}
          >
            <TierBadge tier={status.tier} label={status.tierLabel} />
          </SettingsRow>
        </SettingsGroup>
      ) : (
        <SettingsGroup title="Create account or log in">
          <form className="space-y-3 px-4 py-4" onSubmit={event => void submit('signup', event)}>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-white/50" htmlFor="account-email">Email</label>
              <input
                autoComplete="email"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-aura-400/50"
                id="account-email"
                onChange={event => setEmail(event.target.value)}
                placeholder="you@example.com"
                type="email"
                value={email}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-white/50" htmlFor="account-password">Password</label>
              <input
                autoComplete="current-password"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-aura-400/50"
                id="account-password"
                onChange={event => setPassword(event.target.value)}
                placeholder="At least 6 characters"
                type="password"
                value={password}
              />
            </div>

            {message && (
              <p className={`text-xs ${message.kind === 'ok' ? 'text-emerald-400' : 'text-red-300'}`}>{message.text}</p>
            )}

            <div className="flex gap-2">
              <button
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/12 px-4 py-2.5 text-sm font-semibold text-white/75 transition enabled:hover:bg-white/6 disabled:opacity-40"
                disabled={busy || !email.trim() || password.length < 6}
                onClick={event => { event.preventDefault(); void submit('login', event) }}
                type="button"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} Log in
              </button>
              <button
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-surface-0 transition enabled:hover:scale-[1.01] disabled:opacity-40"
                disabled={busy || !email.trim() || password.length < 6}
                onClick={event => { event.preventDefault(); void submit('signup', event) }}
                type="button"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <UserRound size={15} />} Create account
              </button>
            </div>
          </form>
        </SettingsGroup>
      )}
    </div>
  )
}
