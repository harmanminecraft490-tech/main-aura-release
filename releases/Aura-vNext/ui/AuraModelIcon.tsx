import { AURA_MODELS_BY_ID, type AuraModelId } from '@models/aura-models/definitions'
import { cn } from './cn'

/** Renders an Aura model's emoji icon inside a tinted rounded chip. */
export function AuraModelIcon({ id, size = 'md' }: { id: AuraModelId; size?: 'sm' | 'md' | 'lg' }) {
  const definition = AURA_MODELS_BY_ID.get(id)
  const dimensions = size === 'sm' ? 'h-6 w-6 text-sm' : size === 'lg' ? 'h-11 w-11 text-2xl' : 'h-8 w-8 text-lg'
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center rounded-xl', dimensions)}
      style={{
        background: `${definition?.accent ?? '#8f74ff'}22`,
        boxShadow: `inset 0 0 0 1px ${definition?.accent ?? '#8f74ff'}33`,
      }}
    >
      {definition?.icon ?? '✨'}
    </span>
  )
}
