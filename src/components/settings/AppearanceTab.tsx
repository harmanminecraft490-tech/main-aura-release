import { cn } from '@/utils/cn'
import { useAuraStore } from '@/store'
import { Card, Toggle, SelectField } from './shared'

export function AppearanceTab() {
  const { preferences, updatePreferences } = useAuraStore()

  return (
    <div className="max-w-xl space-y-5">
      <Card title="Theme">
        <div className="flex gap-2">
          {(['dark', 'light', 'system'] as const).map(t => (
            <button
              key={t}
              className={cn(
                'flex-1 rounded-2xl border py-2.5 text-sm font-medium capitalize transition',
                preferences.theme === t ? 'border-white/25 bg-white/12 text-white' : 'border-white/6 text-white/40 hover:border-white/14 hover:text-white/70'
              )}
              onClick={() => updatePreferences({ theme: t })}
              type="button"
            >
              {t}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Font Size">
        <div className="flex items-center gap-4">
          <input
            className="flex-1 accent-white/70"
            type="range"
            min={11}
            max={20}
            value={preferences.fontSize}
            onChange={e => updatePreferences({ fontSize: Number(e.target.value) })}
          />
          <span className="w-10 text-right text-sm text-white/60">{preferences.fontSize}px</span>
        </div>
      </Card>

      <Card title="Message density">
        <div className="flex gap-2">
          {(['compact', 'normal', 'relaxed'] as const).map(spacing => (
            <button
              key={spacing}
              className={cn(
                'flex-1 rounded-2xl border py-2.5 text-sm font-medium capitalize transition',
                preferences.messageSpacing === spacing ? 'border-white/25 bg-white/12 text-white' : 'border-white/6 text-white/40 hover:border-white/14 hover:text-white/70'
              )}
              onClick={() => updatePreferences({ messageSpacing: spacing })}
              type="button"
            >
              {spacing}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Response Length">
        <div className="flex gap-2">
          {(['concise', 'balanced', 'detailed'] as const).map(r => (
            <button
              key={r}
              className={cn(
                'flex-1 rounded-2xl border py-2.5 text-sm font-medium capitalize transition',
                preferences.responseLength === r ? 'border-white/25 bg-white/12 text-white' : 'border-white/6 text-white/40 hover:border-white/14 hover:text-white/70'
              )}
              onClick={() => updatePreferences({ responseLength: r })}
              type="button"
            >
              {r}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Chat behavior">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-white/60">Send on Enter</span>
              <p className="text-xs text-white/30">Shift+Enter inserts a new line</p>
            </div>
            <Toggle checked={preferences.sendOnEnter ?? true} onChange={v => updatePreferences({ sendOnEnter: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-white/60">Show timestamps</span>
              <p className="text-xs text-white/30">Display time on chat messages</p>
            </div>
            <Toggle checked={preferences.showTimestamps ?? true} onChange={v => updatePreferences({ showTimestamps: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-white/60">Show model in messages</span>
              <p className="text-xs text-white/30">Label responses with the active model name</p>
            </div>
            <Toggle checked={preferences.showModelInMessages ?? true} onChange={v => updatePreferences({ showModelInMessages: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-white/60">Spell check</span>
              <p className="text-xs text-white/30">Browser spellcheck in the composer</p>
            </div>
            <Toggle checked={preferences.spellCheck ?? true} onChange={v => updatePreferences({ spellCheck: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-white/60">Sound effects</span>
              <p className="text-xs text-white/30">Play subtle UI sounds</p>
            </div>
            <Toggle checked={preferences.soundEffects ?? true} onChange={v => updatePreferences({ soundEffects: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-white/60">Notifications</span>
              <p className="text-xs text-white/30">Desktop notifications when Aura finishes</p>
            </div>
            <Toggle checked={preferences.notifications ?? true} onChange={v => updatePreferences({ notifications: v })} />
          </div>
        </div>
      </Card>

      <Card title="Pipeline & Memory">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-white/60">Show reasoning pipeline</span>
              <p className="text-xs text-white/30">Display the reasoning steps before responses</p>
            </div>
            <Toggle checked={preferences.showPipeline ?? false} onChange={v => updatePreferences({ showPipeline: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-white/60">Enable memory</span>
              <p className="text-xs text-white/30">Remember context across conversations</p>
            </div>
            <Toggle checked={preferences.enableMemory ?? true} onChange={v => updatePreferences({ enableMemory: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-white/60">Auto-save</span>
              <p className="text-xs text-white/30">Automatically save settings changes</p>
            </div>
            <Toggle checked={preferences.autoSave ?? true} onChange={v => updatePreferences({ autoSave: v })} />
          </div>
        </div>
      </Card>

      <Card title="Developer">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-white/60">Developer mode</span>
              <p className="text-xs text-white/30">
                Show provider profiles in the model picker and extra diagnostics. Locked Aura Model identity stays branded.
              </p>
            </div>
            <Toggle checked={preferences.developerMode ?? false} onChange={v => updatePreferences({ developerMode: v })} />
          </div>
          <SelectField
            label="UI language"
            value={preferences.language ?? 'en'}
            onChange={v => updatePreferences({ language: v })}
            options={[
              { value: 'en', label: 'English' },
              { value: 'es', label: 'Spanish' },
              { value: 'fr', label: 'French' },
              { value: 'de', label: 'German' },
              { value: 'hi', label: 'Hindi' },
            ]}
          />
        </div>
      </Card>
    </div>
  )
}
