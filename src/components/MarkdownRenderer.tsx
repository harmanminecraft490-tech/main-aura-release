import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      className="aura-markdown"
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          const text = String(children).replace(/\n$/, '')

          if (match) {
            return (
              <SyntaxHighlighter
                PreTag="div"
                language={match[1]}
                style={oneDark}
                customStyle={{
                  background: 'rgba(0,0,0,0.32)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '16px',
                  margin: '14px 0',
                  padding: '16px',
                }}
              >
                {text}
              </SyntaxHighlighter>
            )
          }

          return (
            <code className="rounded-md border border-white/10 bg-white/8 px-1.5 py-0.5 font-mono text-[0.88em] text-aura-100" {...props}>
              {children}
            </code>
          )
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
