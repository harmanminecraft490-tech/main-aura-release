# Aura AI — Development Snapshot Release

**Release:** release-2026-07-15
**Date:** July 15, 2026
**Project version (main app):** 2.0.0
**Project version (Aura-vNext rewrite):** 3.0.0 (in progress)
**Type:** Development snapshot — NOT a production release

This release captures the full state of the Aura AI desktop assistant as of today, including both the original working application (root project) and the in-progress **Aura-vNext** rewrite (`releases/Aura-vNext/`). It exists so today's progress can be restored at any time.

---

## Current Completion

**Overall: ~75%**

| Area | Status |
|---|---|
| Original desktop app (root) | ✅ ~100% — builds and runs |
| Aura-vNext: build scaffold | ✅ 100% |
| Aura-vNext: model system core (registry, discovery, capabilities) | ✅ 100% |
| Aura-vNext: Aura virtual models (definitions, mapping, suggestions) | ✅ 100% |
| Aura-vNext: Aura Auto smart router | ✅ 100% |
| Aura-vNext: streaming engine (SSE, adapters, retry) | ✅ 100% |
| Aura-vNext: Electron backend (main, preload, IPC, orchestrator, persistence) | ✅ 100% |
| Aura-vNext: renderer services (store, chat client, bridge) | ✅ 100% |
| Aura-vNext: chat UI (sidebar, chat view, composer, model picker) | ✅ 100% |
| Aura-vNext: Settings UI (Providers, Aura Models, Model Manager, Developer) | 🚧 0% — next task |
| Aura-vNext: docs + typecheck/build verification | 🚧 0% |

## Features Completed

### Original app (root project)
- Electron + Vite + React 19 + Tailwind desktop app, frameless with mica/vibrancy
- Multi-provider AI chat (Anthropic, OpenAI, Moonshot, Z.ai, Groq, OpenRouter, NVIDIA, Gemini, Ollama, LM Studio, LocalAI, vLLM, custom)
- API profiles with failover chain, smart task routing, model presets
- Streaming with abort, thinking display, pipeline visualization
- Memory system (Neon Postgres backed with local fallback)
- Settings panels: API dashboard, Aura models, model manager, modes, smart routing, voice, appearance
- Command palette, markdown rendering with KaTeX, code highlighting

### Aura-vNext rewrite (releases/Aura-vNext)
- **Universal Provider system** — add any OpenAI-compatible or Anthropic endpoint with name/baseURL/key/headers/org/timeout; models discovered dynamically from `/models`; zero hardcoded model lists
- **Aura Models virtual layer** — 9 built-in aliases (Auto 🤖, Flash ⚡, Smart 🧠, Pro 💎, Coding 👨‍💻, Vision 👁, Creative 🎨, Research 🔍, Max 🚀) mapping to real backend models with user-editable overrides, capability-scored fallbacks, and restore-defaults
- **Aura Auto smart router** — modular rule engine (vision/coding/research/creative/long-context/fast-chat/max-quality) picking the best alias per message
- **Smart mapping suggestions** — recommends better mappings when newer models appear; never auto-applies; remembers dismissals
- **Robust streaming engine** — strict SSE parsing, first-byte + idle watchdogs, exactly-one-terminal-event guarantee, instant abort, pre-token retry with backoff, cross-provider failover
- **Chat orchestrator** — resolve alias → fallback chain → stream, with per-stream AbortController registry and duplicate-start guard
- **Premium glassmorphism UI** — dark, blurred, rounded; sidebar with unlimited-nesting folders, projects, pinned, search, recent; streaming caret; thinking blocks that always terminate; drag-drop/paste-image composer; Aura-only model picker (backend names visible only in Developer Mode)

## Features In Progress
- Aura-vNext Settings UI (Providers tab, Aura Models mapping page, Model Manager, General/Appearance/Developer tabs)

## Remaining Roadmap
1. Settings UI (see TODO.md — Critical)
2. `npm install` + typecheck + fix errors in Aura-vNext
3. Docs (ARCHITECTURE.md, MODEL_SYSTEM.md) inside Aura-vNext
4. Adversarial review pass on streaming/orchestrator edge cases
5. Optional: voice mode, file-type extraction (PDF/Word/Excel), export/import

## How to Install

```bash
# Original app
cd <project-root>
npm install

# Aura-vNext (separate package)
cd releases/Aura-vNext
npm install
```

## Environment Variables
See [ENVIRONMENT.md](ENVIRONMENT.md). The original app reads optional `ANTHROPIC_*` and `NEON_DATABASE_URL` values; Aura-vNext needs none (providers are configured in-app).

## Build Instructions

```bash
# Original app — dev
npm run dev
# Original app — production installers
npm run build          # or build:win / build:mac / build:linux

# Aura-vNext — dev (once dependencies are installed)
cd releases/Aura-vNext
npm run dev
# Aura-vNext — typecheck / production
npm run typecheck
npm run build
```

## Deployment Instructions
Desktop app only — no server deployment. `electron-builder` produces installers into `release/` (original) or `out/` (vNext). See the root `DEPLOYMENT_GUIDE.md` for signing/notarization notes.

## Known Issues
See PROJECT_STATUS.md → 🐛 Known Bugs. Highlights:
- Aura-vNext has **not been typechecked or run yet** (dependencies not installed)
- Aura-vNext Settings UI does not exist yet, so providers cannot be added from the UI
- Original app: "Thinking…" spinner can persist and streams can hang (root causes fixed in vNext architecture, not backported)

## Credits
- Built by the Aura AI project with Claude (Anthropic)
- Stack: Electron, Vite, React 19, TypeScript, Tailwind CSS, Zustand, Framer Motion
