import { Brain, Plus, Trash2 } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import type { Memory } from '@/types'

type MemoryResponse = { backend: 'neon' | 'local'; memories: Memory[] }

export function MemoryPanel() {
  const [memories, setMemories] = useState<Memory[]>([])
  const [backend, setBackend] = useState<'neon' | 'local'>('local')
  const [content, setContent] = useState('')
  const [type, setType] = useState<Memory['type']>('long_term')
  const [loading, setLoading] = useState(true)

  async function loadMemories() {
    setLoading(true)
    try {
      const result = (await window.aura?.memory.list()) as MemoryResponse | undefined
      setMemories(result?.memories ?? [])
      setBackend(result?.backend ?? 'local')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMemories()
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = content.trim()
    if (!trimmed) return
    await window.aura?.memory.create({
      type,
      content: trimmed,
      context: 'Added manually from Aura memory center.',
      relevance: 0.8,
      importance: 50,
      lastAccessed: Date.now(),
    })
    setContent('')
    await loadMemories()
  }

  async function remove(id: string) {
    await window.aura?.memory.delete(id)
    await loadMemories()
  }

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-white/6 px-7 py-6">
        <div className="flex items-center gap-3 text-aura-200">
          <Brain size={18} />
          Memory Center
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">What Aura remembers</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/42">
          Long-term preferences, project context, coding style, learning notes, and goals. Storage backend:{' '}
          <span className="text-white/70">{backend === 'neon' ? 'Neon Postgres' : 'local app storage'}</span>.
        </p>
      </header>

      <div className="grid min-h-0 flex-1 gap-5 overflow-hidden p-6 lg:grid-cols-[380px_1fr]">
        <form className="h-fit rounded-3xl border border-white/10 bg-white/[0.055] p-5 backdrop-blur-2xl" onSubmit={submit}>
          <div className="text-sm font-semibold text-white">Add memory</div>
          <p className="mt-1 text-sm leading-6 text-white/38">Save facts that should shape future Aura responses.</p>
          <select
            className="mt-4 w-full rounded-2xl border border-white/10 bg-surface-2 px-4 py-3 text-sm text-white outline-none"
            onChange={event => setType(event.target.value as Memory['type'])}
            value={type}
          >
            <option value="long_term">Long-term</option>
            <option value="preference">Preference</option>
            <option value="project">Project</option>
            <option value="coding">Coding</option>
            <option value="learning">Learning</option>
            <option value="goal">Goal</option>
            <option value="short_term">Short-term</option>
          </select>
          <textarea
            className="mt-3 min-h-32 w-full resize-none rounded-2xl border border-white/10 bg-surface-2 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/25"
            onChange={event => setContent(event.target.value)}
            placeholder="Example: Mayra prefers concise implementation updates with clear verification results."
            value={content}
          />
          <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-surface-0 transition hover:scale-[1.01]" type="submit">
            <Plus size={17} />
            Save memory
          </button>
        </form>

        <div className="min-h-0 overflow-y-auto rounded-3xl border border-white/10 bg-black/12 p-3 backdrop-blur-2xl">
          {loading ? (
            <div className="p-6 text-sm text-white/38">Loading memory…</div>
          ) : memories.length === 0 ? (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center px-8 text-center">
              <div className="rounded-3xl bg-white/8 p-5 text-aura-200">
                <Brain size={34} />
              </div>
              <h2 className="mt-5 text-xl font-semibold text-white">No memories yet</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-white/42">Tell Aura “remember that …” in chat, or add a memory manually here.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {memories.map(memory => (
                <div className="group rounded-2xl border border-white/8 bg-white/[0.045] p-4" key={memory.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-2 inline-flex rounded-full border border-aura-300/20 bg-aura-500/10 px-2.5 py-1 text-xs uppercase tracking-[0.16em] text-aura-100">
                        {memory.type.replace('_', ' ')}
                      </div>
                      <div className="text-sm leading-6 text-white/78">{memory.content}</div>
                      {memory.context && <div className="mt-2 text-xs leading-5 text-white/35">{memory.context}</div>}
                    </div>
                    <button
                      className="rounded-xl p-2 text-white/28 transition hover:bg-red-500/12 hover:text-red-200"
                      onClick={() => remove(memory.id)}
                      type="button"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
