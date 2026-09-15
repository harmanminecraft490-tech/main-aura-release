# CHANGELOG — Aura AI

All notable changes to this project, organized by area. (No git history available; reconstructed from project docs and source.)

## [Unreleased — Aura-vNext 3.0.0] — 2026-07-15

### Architecture
- Started ground-up rewrite in `releases/Aura-vNext/` as a self-contained package; original app untouched
- Split codebase into `providers/`, `models/` (registry, capabilities, aura-models, smart-router), `backend/`, `services/`, `ui/`, `settings/`
- Replaced SDK-based provider clients with two thin protocol adapters (OpenAI-compatible, Anthropic) over raw fetch/SSE

### Model System
- Added Universal Provider: any endpoint with name/baseURL/key/headers/org/timeout
- Added dynamic model discovery from `/models` — removed every hardcoded model list
- Added capability inference (vision/reasoning/tools/streaming), context length, pricing normalization
- Added cross-provider model registry with favorite/pin/hide user state that survives re-discovery
- Added 9 Aura virtual models (Auto, Flash, Smart, Pro, Coding, Vision, Creative, Research, Max) with default mappings, user overrides, and restore-defaults
- Added capability-scored mapping resolution with cross-provider fallback chains
- Added smart mapping suggestions ("A newer coding model is available…") — opt-in, dismissal-aware, never auto-applied
- Added Aura Auto smart router with modular scored rules (vision, coding, research, creative, document-size, conversation-length, quick-question, explicit-max)

### Streaming & Reliability
- New SSE reader with strict event boundaries, first-byte watchdog, idle watchdog
- Exactly-one-terminal-event guarantee (done/error/abort) via finished-latch in every adapter
- Instant abort: reader cancelled the moment the signal fires; no post-abort tokens
- Pre-token-only retry with exponential backoff + jitter (prevents duplicated output)
- Pre-token cross-provider failover in the chat orchestrator
- Duplicate-request guard (same streamId can never start twice)
- Fixed by design: endless "Thinking…", never-ending streams, duplicate chunks, hanging loading states

### Backend (Electron)
- New main process with sandboxed, context-isolated preload; CSP added to index.html
- Typed IPC surface: providers, models, aura mappings, suggestions, settings, chat, dev log
- Push-based state channels (`state:*`) so the renderer mirrors backend state live
- Atomic JSON persistence (temp file + rename) for providers, model cache, mappings, user state, settings
- Request log with latency, first-token time, token usage, status (capped at 200)

### UI
- New premium dark glassmorphism design: blurred surfaces, rounded corners, ambient glows, streaming caret
- Sidebar: projects, pinned chats, unlimited-nesting folders, recent, full-text search
- Chat: markdown with GFM tables + copyable highlighted code blocks, thinking disclosure bound strictly to streaming state, message actions (copy/edit/delete; regenerate/fork hooks)
- Composer: attach files, drag & drop, paste images, stop button, Enter/Ctrl+Enter modes
- Model picker shows only Aura models; backend model/provider/latency/tokens badges appear only in Developer Mode
- Projects view: per-project context, pinned prompts, notes

## [2.0.0 — original app] — 2026-07-12 → 2026-07-14

### Added
- Multi-provider AI chat via API profiles (Anthropic, OpenAI, Moonshot, Z.ai, Groq, OpenRouter, NVIDIA, Gemini, Ollama, LM Studio, LocalAI, vLLM, custom/company endpoints)
- Provider failover chain; smart task routing (chat/coding/planning/vision) with keyword detection
- Legacy Aura virtual model aliases mapping to profiles
- Memory system on Neon Postgres with context injection and auto-capture
- Pipeline visualization for generation stages
- Settings suite: API dashboard, model manager, Aura models, modes, smart routing, voice, appearance
- Command palette (Ctrl+K), global shortcut
- Markdown + KaTeX + syntax highlighting renderer
- Dev logs and usage stats; plugins scaffolding; voice settings scaffolding
- Windows NSIS / macOS DMG packaging via electron-builder

### Known regressions (motivating vNext)
- Stuck "Thinking…" indicator, hanging streams, duplicate requests, growing memory usage, UI freezes on long generations, weak provider abstraction, no dynamic model discovery
