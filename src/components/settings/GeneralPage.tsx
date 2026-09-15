import { FormEvent, useEffect, useState } from 'react'
import { ExternalLink, Loader2, LogIn, LogOut } from 'lucide-react'
import type { AccountStatus } from '@/types'
import { useAuraStore } from '@/store'
import { ipcErrorMessage } from '@/utils/ipcError'
import { GhostButton, SettingsGroup, SettingsPageHeader, SettingsRow, Toggle } from './shared'

export function GeneralPage({ onNavigate }: { onNavigate: (id: string) => void }) {
  const { preferences, updatePreferences, setAccount } = useAuraStore()
  const [status, setStatus] = useState<AccountStatus | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.aura?.account.status().then(next => {
      setStatus(next)
      setAccount(next)
    }).catch(() => setStatus(null))
  }, [setAccount])

  async function login(event: FormEvent) {
    event.preventDefault()
    if (!email.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      const next = await window.aura!.account.login(email.trim(), password)
      setStatus(next)
      setAccount(next)
      setPassword('')
    } catch (err) {
      setError(ipcErrorMessage(err, 'Incorrect email or password.'))
    } finally {
      setBusy(false)
    }
  }

  async function signup() {
    if (!email.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      const next = await window.aura!.account.signup(email.trim(), password)
      setStatus(next)
      setAccount(next)
      setPassword('')
    } catch (err) {
      setError(ipcErrorMessage(err, 'Sign up failed.'))
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    setBusy(true)
    try {
      const next = await window.aura!.account.logout()
      setStatus(next)
      setAccount(next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <SettingsPageHeader title="General" description="Account, preferences, and quick access to Aura settings." />

      <SettingsGroup title="Our Account">
        {status?.loggedIn ? (
          <SettingsRow
            label={status.email ?? 'Signed in'}
            description={`${
              status.tier === 'dev'
                ? 'Dev · unlimited'
                : status.tier === 'premium'
                  ? 'Premium user'
                  : status.trialActive
                    ? 'Basic (normal user) · free trial'
                    : 'Basic (normal user)'
            } · backend ${status.backend}`}
          >
            <div className="flex items-center gap-2">
              <GhostButton onClick={() => onNavigate('account')}>Manage</GhostButton>
              <GhostButton disabled={busy} onClick={() => void logout()} variant="danger">
                {busy ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                Log out
              </GhostButton>
            </div>
          </SettingsRow>
        ) : (
          <div className="space-y-3 px-4 py-4">
            <p className="text-[12px] text-white/40">
              Create an account on first launch to unlock your free trial. Plans: Dev, Basic (normal user), Premium.
            </p>
            <GhostButton onClick={() => onNavigate('account')}>
              Open Our Account
            </GhostButton>
            <form className="space-y-2" onSubmit={event => void login(event)}>
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
                onChange={e => setEmail(e.target.value)}
                placeholder="Email"
                type="email"
                value={email}
              />
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
                onChange={e => setPassword(e.target.value)}
                placeholder="Password"
                type="password"
                value={password}
              />
              {error && <p className="text-[12px] text-red-300">{error}</p>}
              <div className="flex gap-2 pt-1">
                <GhostButton disabled={busy} variant="primary">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />}
                  Log in
                </GhostButton>
                <GhostButton disabled={busy} onClick={() => void signup()}>
                  Create account
                </GhostButton>
              </div>
            </form>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title="Preferences">
        <SettingsRow label="Appearance" description="Theme, density, developer mode, and chat behavior.">
          <GhostButton onClick={() => onNavigate('appearance')}>Open</GhostButton>
        </SettingsRow>
        <SettingsRow label="Voice" description="Speech recognition, TTS, wake word, and barge-in.">
          <GhostButton onClick={() => onNavigate('voice')}>Open</GhostButton>
        </SettingsRow>
        <SettingsRow label="AI Modes" description="Fast, Think, Plan, Max, and Bypass execution modes.">
          <GhostButton onClick={() => onNavigate('modes')}>Open</GhostButton>
        </SettingsRow>
        <SettingsRow
          label="Developer mode"
          description="Show provider profiles in the model picker and extra diagnostics."
        >
          <Toggle
            checked={preferences.developerMode}
            onChange={v => updatePreferences({ developerMode: v })}
          />
        </SettingsRow>
        <SettingsRow label="Enable memory" description="Remember durable facts across conversations.">
          <Toggle
            checked={preferences.enableMemory ?? true}
            onChange={v => updatePreferences({ enableMemory: v })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Workspace & tools">
        <SettingsRow
          label="Permissions"
          description="Grant delete, rename, and run for workspace_file tools."
        >
          <GhostButton onClick={() => onNavigate('permissions')}>Open</GhostButton>
        </SettingsRow>
        <SettingsRow label="Capabilities" description="See what Aura can use right now.">
          <GhostButton onClick={() => onNavigate('capabilities')}>Open</GhostButton>
        </SettingsRow>
        <SettingsRow label="MCP & integrations" description="Connect MCP servers, Figma, GitHub, and search.">
          <GhostButton onClick={() => onNavigate('mcp')}>Open</GhostButton>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Help">
        <SettingsRow label="Documentation" description="Guides for Aura settings, tools, and permissions.">
          <GhostButton onClick={() => onNavigate('docs')}>
            Open <ExternalLink size={11} />
          </GhostButton>
        </SettingsRow>
      </SettingsGroup>
    </div>
  )
}
