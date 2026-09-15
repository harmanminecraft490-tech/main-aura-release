import { useStore } from '@services/store'
import { AURA_MODELS } from '@models/aura-models/definitions'
import { TabHeader, SettingRow, Toggle } from '../shared'

export function GeneralTab() {
  const settings = useStore(state => state.appSettings)

  const update = (updates: Partial<typeof settings>) => {
    void window.aura.settings.set(updates)
  }

  return (
    <div>
      <TabHeader title="General" description="Core behavior for chats and input." />
      <div className="space-y-3">
        <SettingRow label="Default Aura model" hint="Used for every new chat.">
          <select
            className="field !w-52"
            value={settings.defaultAuraModel}
            onChange={event => update({ defaultAuraModel: event.target.value })}
          >
            {AURA_MODELS.map(model => (
              <option key={model.id} value={model.id}>
                {model.icon} {model.name}
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow label="Send on Enter" hint="Off: Enter inserts a newline, Ctrl+Enter sends.">
          <Toggle checked={settings.sendOnEnter} onChange={next => update({ sendOnEnter: next })} />
        </SettingRow>
      </div>
    </div>
  )
}
