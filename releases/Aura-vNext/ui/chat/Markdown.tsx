import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/** Markdown renderer with syntax-highlighted, copyable code blocks + GFM tables. */
export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="selectable text-[15px] leading-7 text-white/85">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className ?? '')
            const text = String(children).replace(/\n$/, '')
            const isInline = !className && !text.includes('\n')
            if (isInline) {
              return (
                <code className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[0.85em] text-aura-100" {...props}>
                  {children}
                </code>
              )
            }
            return <CodeBlock language={match?.[1] ?? 'text'} code={text} />
          },
          p: ({ children }) => <p className="mb-3.5 last:mb-0">{children}</p>,
          h1: ({ children }) => <h1 className="mb-3 mt-5 text-2xl font-semibold text-white">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2.5 mt-5 text-xl font-semibold text-white">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-4 text-lg font-semibold text-white">{children}</h3>,
          ul: ({ children }) => <ul className="mb-3.5 ml-5 list-disc space-y-1.5 marker:text-aura-300/60">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3.5 ml-5 list-decimal space-y-1.5 marker:text-white/40">{children}</ol>,
          a: ({ children, href }) => (
            <a href={href} className="text-aura-200 underline decoration-aura-300/40 underline-offset-4 hover:text-aura-100">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3.5 border-l-2 border-aura-400/50 pl-4 italic text-white/65">{children}</blockquote>
          ),
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b border-white/10 bg-white/[0.06] px-3 py-2 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="border-b border-white/[0.06] px-3 py-2">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="group relative my-4 overflow-hidden rounded-xl border border-white/10 bg-[#0b0b12]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3.5 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-white/40">{language}</span>
        <button className="flex items-center gap-1 text-[11px] text-white/45 transition hover:text-white" onClick={copy}>
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{ margin: 0, background: 'transparent', padding: '14px 16px', fontSize: 13.5 }}
        codeTagProps={{ style: { fontFamily: 'JetBrains Mono, Consolas, monospace' } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}
