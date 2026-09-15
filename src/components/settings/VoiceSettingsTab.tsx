import { useEffect, useState } from 'react'
import { Mic, Volume2, Gauge, Languages, Sparkles, Zap } from 'lucide-react'
import { useAuraStore } from '@/store'
import type { VoiceSettings } from '@/types'
import { Card, Toggle, SliderField, SelectField } from './shared'

export function VoiceSettingsTab() {
  const { voiceSettings, setVoiceSettings } = useAuraStore()
  const [local, setLocal] = useState<VoiceSettings | null>(voiceSettings)

  useEffect(() => {
    if (!voiceSettings) {
      window.aura?.voice.getSettings().then(setLocal).catch(() => {})
    } else {
      setLocal(voiceSettings)
    }
  }, [voiceSettings])

  if (!local) return <div className="text-white/40">Loading voice settings…</div>

  async function update(updates: Partial<VoiceSettings>) {
    if (!local) return
    const updated = { ...local, ...updates } as VoiceSettings
    setLocal(updated)
    setVoiceSettings(updated)
    await window.aura?.voice.setSettings(updates)
  }

  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-sm text-white/40">
        Configure voice interaction with streaming speech recognition, text-to-speech, wake word, and barge-in support.
      </p>

      {/* Voice enable */}
      <Card title="Voice Assistant">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 text-aura-200"><Mic size={18} /></div>
              <div>
                <span className="text-sm text-white/70">Enable voice</span>
                <p className="text-xs text-white/30">Turn on voice input and output</p>
              </div>
            </div>
            <Toggle checked={local.enabled} onChange={v => update({ enabled: v })} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-white/70">Continuous conversation mode</span>
              <p className="text-xs text-white/30">Keep listening after each response</p>
            </div>
            <Toggle checked={local.continuousMode} onChange={v => update({ continuousMode: v })} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-white/70">Barge-in</span>
              <p className="text-xs text-white/30">Interrupt TTS when user starts speaking</p>
            </div>
            <Toggle checked={local.bargeIn} onChange={v => update({ bargeIn: v })} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-white/70">Emotion-aware speech</span>
              <p className="text-xs text-white/30">Adjust tone based on conversation context</p>
            </div>
            <Toggle checked={local.emotionAware} onChange={v => update({ emotionAware: v })} />
          </div>
        </div>
      </Card>

      {/* Wake word */}
      <Card title="Wake Word">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-white/70">Enable wake word</span>
              <p className="text-xs text-white/30">Activate voice by saying the wake word</p>
            </div>
            <Toggle checked={local.wakeWordEnabled} onChange={v => update({ wakeWordEnabled: v })} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-white/50">Wake word</label>
            <input
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 px-3 text-sm text-white outline-none focus:border-white/20"
              onChange={e => update({ wakeWord: e.target.value })}
              placeholder="Aura"
              value={local.wakeWord}
            />
          </div>
        </div>
      </Card>

      {/* Engines */}
      <Card title="Engines">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Speech Recognition (STT)"
            value={local.sttEngine}
            onChange={v => update({ sttEngine: v as VoiceSettings['sttEngine'] })}
            options={[
              { value: 'web', label: 'Web Speech API (built-in)' },
              { value: 'whisper-local', label: 'Whisper Local (advanced)' },
            ]}
          />
          <SelectField
            label="Speech Synthesis (TTS)"
            value={local.ttsEngine}
            onChange={v => update({ ttsEngine: v as VoiceSettings['ttsEngine'] })}
            options={[
              { value: 'web', label: 'Web Speech API (built-in)' },
              { value: 'api', label: 'API-based (premium voices)' },
            ]}
          />
        </div>
      </Card>

      {/* Voice parameters */}
      <Card title="Voice Parameters">
        <div className="space-y-5">
          <SelectField
            label="Language"
            value={local.language}
            onChange={v => update({ language: v })}
            options={[
              { value: 'en-US', label: 'English (US)' },
              { value: 'en-GB', label: 'English (UK)' },
              { value: 'hi-IN', label: 'Hindi (India)' },
              { value: 'es-ES', label: 'Spanish (Spain)' },
              { value: 'fr-FR', label: 'French (France)' },
              { value: 'de-DE', label: 'German (Germany)' },
              { value: 'ja-JP', label: 'Japanese (Japan)' },
              { value: 'zh-CN', label: 'Chinese (Simplified)' },
              { value: 'ko-KR', label: 'Korean (Korea)' },
              { value: 'pt-BR', label: 'Portuguese (Brazil)' },
            ]}
          />
          <SliderField label="Speaking Speed" min={0.5} max={2} step={0.1} value={local.speed} onChange={v => update({ speed: v })} display={`${local.speed.toFixed(1)}x`} />
          <SliderField label="Pitch" min={0} max={2} step={0.1} value={local.pitch} onChange={v => update({ pitch: v })} display={local.pitch.toFixed(1)} />
          <SliderField label="Volume" min={0} max={1} step={0.05} value={local.volume} onChange={v => update({ volume: v })} display={`${Math.round(local.volume * 100)}%`} />
          <SliderField label="Voice Activity Detection (VAD) Sensitivity" min={0} max={1} step={0.05} value={local.vadSensitivity} onChange={v => update({ vadSensitivity: v })} display={local.vadSensitivity.toFixed(2)} />
        </div>
      </Card>

      {/* Info */}
      <div className="flex items-start gap-3 rounded-2xl border border-aura-400/20 bg-aura-500/8 p-4">
        <Sparkles size={16} className="mt-0.5 text-aura-300" />
        <p className="text-xs leading-5 text-white/50">
          Voice features use the Web Speech API built into Electron. For premium voices and lower latency, configure an API-based TTS provider in your API profiles and set the TTS engine to "API-based".
        </p>
      </div>
    </div>
  )
}
