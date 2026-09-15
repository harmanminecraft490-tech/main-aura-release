import { FormEvent, useState } from 'react'
import { Globe2, Search, Sparkles } from 'lucide-react'
import { streamChat } from '@/services/ai'
import { MarkdownRenderer } from './MarkdownRenderer'
import type { Message } from '@/types'

function id() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

export function SearchPanel() {
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = query.trim()
    if (!trimmed || loading) return

    setAnswer('')
    setError(null)
    setLoading(true)

    const messages: Message[] = [
      {
        id: id(),
        role: 'user',
        timestamp: Date.now(),
        content: `Research this for me and produce a cited, practical answer. If live web access is unavailable in this environment, say what would need verification instead of pretending. Query: ${trimmed}`,
      },
    ]

    try {
      await streamChat(messages, {
        onToken: token => setAnswer(current => current + token),
        onDone: response => {
          setAnswer(response)
          setLoading(false)
        },
        onError: err => {
          setError(err.message)
          setLoading(false)
        },
        onAbort: () => setLoading(false),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
      setLoading(false)
    }
  }

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-white/6 px-7 py-6">
        <div className="flex items-center gap-3 text-aura-200">
          <Globe2 size={18} />
          Research Engine
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Search, synthesize, verify</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/42">
          Ask Aura for current information, documentation research, comparisons, market scans, or source-backed summaries.
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col p-6">
        <form className="rounded-3xl border border-white/10 bg-white/[0.055] p-3 backdrop-blur-2xl" onSubmit={submit}>
          <div className="flex items-center gap-3">
            <Search className="ml-2 text-white/35" size={20} />
            <input
              className="min-w-0 flex-1 bg-transparent px-2 py-3 text-[15px] text-white outline-none placeholder:text-white/28"
              onChange={event => setQuery(event.target.value)}
              placeholder="Search anything: latest docs, market research, product comparisons…"
              value={query}
            />
            <button className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-surface-0 transition hover:scale-[1.02]" disabled={!query.trim() || loading} type="submit">
              {loading ? 'Researching…' : 'Search'}
            </button>
          </div>
        </form>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto rounded-3xl border border-white/10 bg-black/12 p-6 backdrop-blur-2xl">
          {error ? (
            <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-100">{error}</div>
          ) : answer ? (
            <MarkdownRenderer content={answer} />
          ) : (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center">
              <div className="rounded-3xl bg-white/8 p-5 text-aura-200"><Sparkles size={34} /></div>
              <h2 className="mt-5 text-xl font-semibold text-white">Ask a research question</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-white/42">Aura will produce a structured answer and call out anything that needs live verification.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
