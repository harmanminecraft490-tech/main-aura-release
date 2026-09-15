import { useStore } from '@services/store'
import { TabHeader, SettingRow, Toggle } from '../shared'

export function AppearanceTab() {
  const settings = useStore(state => state.appSettings)

  return (
    <div>
      <TabHeader title="Appearance" description="Visual behavior. Aura vNext ships with the signature dark glass theme." />
      <div className="space-y-3">
        <SettingRow label="Reduce motion" hint="Disables entrance animations and smooth scrolling.">
          <Toggle
            checked={settings.reduceMotion}
            onChange={next => void window.aura.settings.set({ reduceMotion: next })}
          />
        </SettingRow>
      </div>
    </div>
  )
}
