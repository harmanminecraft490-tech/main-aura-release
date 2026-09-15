# PROJECT_STATUS — Aura AI

**Snapshot date:** 2026-07-15
**Repositories in this snapshot:** root app (v2.0.0) + `releases/Aura-vNext` rewrite (v3.0.0, in progress)
**Git:** not a git repository — no commit hash/branch available

---

## ✅ Completed Features

### Original app (root)
- Electron 33 desktop shell — frameless, mica (Win) / vibrancy (macOS), custom title bar
- Multi-provider chat: Anthropic SDK, OpenAI SDK + OpenAI-compatible (Moonshot, Z.ai, Groq, OpenRouter, NVIDIA, Gemini-OpenAI, Ollama, LM Studio, LocalAI, vLLM), raw custom/company endpoints
- API profiles: create/duplicate/enable/set-default/test-connection/import/export/backup/restore
- Streaming chat with abort (per-stream AbortController map in main process)
- Provider failover chain (fails over before first token)
- Smart routing by task type + keyword detection; explicit picker choice wins
- Aura virtual model aliases (legacy implementation in `src/services/auraModels.ts`)
- Memory system: Neon Postgres backed, context injection, auto-capture heuristics
- Pipeline visualization (intent → context → memory → planning → tools → execution → review → response)
- Settings: API dashboard, model manager, Aura models, modes, smart routing, voice, appearance
- Markdown + KaTeX + syntax highlighting; command palette (Ctrl+K); dev logs & stats

### Aura-vNext (releases/Aura-vNext) — new architecture
- **Build scaffold:** package.json, dual tsconfig (renderer/electron), Vite 6, Tailwind, CSP-hardened index.html, electron-builder config
- **providers/types.ts:** runtime-agnostic protocol types (`openai-compat` | `anthropic`), ModelRef/modelKey, stream handler contract with exactly-one-terminal-event semantics
- **providers/discovery.ts:** dynamic `/models` fetching for both protocols, tolerant payload parsing (`data`/`models`/array), error summarization, connection test — **no hardcoded model lists**
- **models/capabilities/infer.ts:** pattern-based capability inference (vision/reasoning/tools/streaming), context-length + pricing normalization, chat-model filtering, display-name prettifier
- **models/registry/registry.ts:** merged cross-provider registry with per-model user state (favorite/pin/hide), fuzzy pattern matching for default targets
- **models/aura-models/definitions.ts:** 9 built-in aliases with default target patterns per spec (Flash→gpt-5.6-terra, Smart→gpt-5.6-sol, Pro→claude-sonnet-5, Coding→claude-sonnet-5-thinking, Vision→gpt-4o, Creative→claude-opus-4.8, Research/Max→claude-opus-4.8-thinking)
- **models/aura-models/mapping.ts:** override → default-pattern → capability-scored resolution; cross-provider-first fallback chains
- **models/aura-models/suggestions.ts:** better-mapping recommendations; never auto-applies; respects dismissals and user-set timestamps
- **models/smart-router:** modular scored rule engine for Aura Auto (vision, explicit-max, coding, large-document, research, creative, long-conversation, quick-question, short-chat)
- **providers/streaming/sse.ts:** strict SSE boundary parsing, first-byte + idle watchdogs, instant reader cancellation on abort
- **providers/streaming/openai-compat.ts + anthropic.ts:** adapters with `finished` latch (no post-done tokens, no duplicate terminal events), multimodal image parts, usage capture, reasoning/thinking deltas
- **providers/stream.ts:** unified entry with pre-token-only retry (backoff + jitter, max 2)
- **backend/persistence.ts:** atomic temp-file+rename JSON stores (providers, model cache, model user state, mappings, suggestion dismissals, settings)
- **backend/chat-orchestrator.ts:** alias resolution (router for Auto) → fallback chain → stream; per-stream abort registry; duplicate-start guard; request log
- **backend/ipc.ts + main.ts + preload.ts:** full typed IPC surface, state push channels, sandboxed context-isolated preload, startup model discovery
- **services/store.ts:** Zustand store; conversations/folders (unlimited nesting)/projects persisted to localStorage (debounced); backend state mirrored, never persisted
- **services/chat-client.ts:** streamId-filtered event wiring; terminal events always clear streaming state and unsubscribe
- **ui/:** TitleBar, Sidebar (projects/pinned/folders/recent/search), ChatView (empty state, auto-scroll, stream release watcher), MessageBubble (copy/edit/regenerate hooks/fork hooks/delete, dev-mode badges: backend model, provider, latency, tokens), ThinkingBlock (spinner strictly bound to isStreaming), Markdown (GFM tables, copyable highlighted code), Composer (attach, drag-drop, paste-image, stop button), ModelPicker (**Aura models only**; backend names shown only in Developer Mode), ProjectsView (context, pinned prompts, notes)

## ⚙️ Features Currently Being Built
- **Aura-vNext Settings UI** (task #9): SettingsView shell + tabs — Providers (add/test/refresh/delete with auto-discovery), Aura Models mapping page (mapping cards, change-mapping search, suggestion banners, restore defaults), Model Manager (search/sort/group, capability badges, favorite/pin/hide), General, Appearance, Developer (dev-mode toggle, request log)

## 🚧 Pending Features
- Aura-vNext: `npm install` + full typecheck + fixes (never compiled yet)
- Aura-vNext internal docs (ARCHITECTURE.md, MODEL_SYSTEM.md)
- Message editing → resubmit wiring, regenerate, fork-chat actions in ChatView (buttons exist; handlers not passed)
- File-content extraction for non-image attachments (PDF/Word/Excel/CSV → text)
- Voice input/output (deferred)
- Export/import conversations
- Virtualized message list for very long chats (react-virtuoso available in root app)

## 🐛 Known Bugs
- **Original app:** "Thinking…" indicator can persist after completion; streams occasionally never terminate; duplicate requests possible on rapid sends; memory usage grows over long sessions; UI freezes during long generations. (These motivated the vNext architecture; fixed there by design, not backported.)
- **Aura-vNext:** not yet compiled/run — expect typecheck issues on first `tsc` pass (e.g., unused-parameter strictness, React import modes). No runtime testing performed.
- **Aura-vNext:** ChatView releases the streaming lock via a store subscription watching the *active* conversation — switching conversations mid-stream leaves the previous stream running (by design) but the send lock is global, not per-conversation.

## 🎯 Next Tasks (ordered)
1. Build Settings UI (Critical — app is unusable without the Providers tab)
2. `npm install` in releases/Aura-vNext, run `npm run typecheck`, fix all errors
3. Smoke-test: add provider → discovery → chat via Aura Auto → abort mid-stream
4. Write vNext docs; adversarial review of streaming/orchestrator edge cases
5. Wire edit/regenerate/fork handlers in ChatView

## 📦 APIs Connected
- **Original app:** Anthropic Messages API, OpenAI Chat Completions (+ all OpenAI-compatible endpoints listed above), Neon serverless Postgres (memory)
- **Aura-vNext:** provider-agnostic — any OpenAI-compatible or Anthropic-protocol endpoint configured at runtime; no keys or endpoints baked in

## 🗂 Folder Structure
See PROJECT_TREE.txt. Summary:

```
root/
├── src/                  # original app (renderer + electron)
├── build/, dist/         # original app build artifacts
├── releases/
│   ├── Aura-vNext/       # new architecture (self-contained package)
│   │   ├── backend/      # electron main, preload, ipc, orchestrator, persistence
│   │   ├── providers/    # types, discovery, streaming adapters, retry
│   │   ├── models/       # registry, capabilities, aura-models, smart-router
│   │   ├── services/     # zustand store, chat client, bridge sync
│   │   ├── ui/           # chat + projects + shell components
│   │   ├── settings/     # (pending) settings UI
│   │   └── src/          # entry, styles, domain types
│   └── release-2026-07-15/  # this snapshot's docs
└── *.md                  # historical docs
```

## Database Status
- Neon Postgres used only by the original app's memory feature; optional (falls back to local storage). Aura-vNext has no database — all state is local JSON (userData) + localStorage.

## Authentication Status
- No user authentication (local single-user desktop app). Provider API keys stored in Electron userData JSON (vNext) / config store (original). **Not applicable / N/A for auth flows.**

## Payment Status
- N/A — no payments, no billing integration.

## Admin Status
- N/A — no admin surface; Developer Mode toggle (vNext) exposes diagnostics only.

## Performance Optimizations Completed
- vNext: debounced localStorage persistence (250 ms), memoized Markdown/MessageBubble components, streaming caret via CSS (no re-render timers), abort-first stream teardown, background model discovery on startup, capped request log (200 entries), pre-token-only retries (no duplicate output), fallback chains capped at 3, atomic writes avoid full-store rewrites on crash recovery
- Original: react-virtuoso available for lists, lazy panels, stream chunk batching in store updates
