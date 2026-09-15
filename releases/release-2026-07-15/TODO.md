# TODO — Aura AI (prioritized)

## 🔴 Critical

- [ ] **Build Aura-vNext Settings UI** — without the Providers tab the app cannot be configured
  - [ ] `settings/SettingsView.tsx` shell with tab navigation
  - [ ] Providers tab: add/edit/delete provider, Test Connection, Refresh Models, discovery status/errors
  - [ ] Aura Models tab: mapping cards (icon, description, current backend model, provider badge, capability badges), change-mapping dialog with model search + favorites, suggestion banners (accept/dismiss), Restore Defaults
  - [ ] Model Manager tab: search, sort, group by provider; favorite/pin/hide; context length, vision/reasoning/tools/streaming badges; pricing when available
  - [ ] General tab: default Aura model, send-on-Enter
  - [ ] Appearance tab: reduce motion
  - [ ] Developer tab: Developer Mode toggle, request log viewer (latency, first-token, tokens, status), clear log
- [ ] **Install dependencies & typecheck Aura-vNext** — `cd releases/Aura-vNext && npm install && npm run typecheck`; fix all errors (never compiled yet)
- [ ] **Smoke test end-to-end** — add provider → models discovered → chat via Aura Auto → stop button aborts instantly → thinking indicator clears

## 🟠 High

- [ ] Wire edit → resubmit, regenerate, and fork-chat handlers into ChatView (buttons/props already exist on MessageBubble)
- [ ] Make the send lock per-conversation instead of global so switching chats mid-stream allows sending in the other chat
- [ ] Inject project context (`project.context`) into chats created inside a project
- [ ] Write `releases/Aura-vNext/docs/` — README, ARCHITECTURE.md, MODEL_SYSTEM.md
- [ ] Adversarial review pass on streaming edge cases (empty SSE bodies, mid-stream provider errors, abort during retry backoff)

## 🟡 Medium

- [ ] Extract text from non-image attachments (PDF, Word, Excel, CSV, ZIP listings) before sending to models
- [ ] Conversation export/import (JSON + Markdown)
- [ ] Virtualize long message lists (react-virtuoso) for chats with hundreds of messages
- [ ] Keyboard shortcuts: Ctrl+K command palette, Ctrl+N new chat, Ctrl+, settings
- [ ] Drag-and-drop chats into folders in the sidebar
- [ ] Persist request log to disk (currently in-memory, lost on restart)
- [ ] Show fallback events in the UI ("Fell back to X") beyond the routed badge

## 🟢 Low

- [ ] Voice input/output (STT/TTS) — deferred from original app
- [ ] Light theme variant
- [ ] Cost estimation per conversation using discovered pricing
- [ ] Auto-title conversations via a Flash-model summary call
- [ ] Backport vNext streaming fixes to the original app (optional; vNext replaces it)
- [ ] Publish signed installers (Windows code signing, macOS notarization)
