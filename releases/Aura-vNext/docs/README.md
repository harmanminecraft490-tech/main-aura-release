# Aura vNext

**Premium AI desktop assistant.** One API key → every model, with a branded virtual-model layer (Aura Models), automatic model discovery, smart routing, and bulletproof streaming.

## Quick start

```bash
npm install
npm run dev        # Vite dev server + Electron (port 5174)
```

First run: open **Settings → Providers → Add provider**, enter a name, base URL (e.g. `https://your-api.com/v1`), and API key. Aura fetches every model the endpoint serves and maps the nine Aura Models to the best ones automatically. Then just chat.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev loop: Vite + tsc watch + Electron |
| `npm run typecheck` | Typecheck renderer + electron configs |
| `npm run build:renderer` | Bundle the UI to `dist/renderer` |
| `npm run build:electron` | Compile main/preload to `dist/electron` |
| `npm run build` | Full production build + installers (`out/`) |

## Key concepts

- **Provider** — any OpenAI-compatible or Anthropic-protocol endpoint. Only name/baseURL/key (+ optional headers/org/timeout) are stored; models are never hardcoded.
- **Aura Models** — 9 virtual aliases (Auto 🤖, Flash ⚡, Smart 🧠, Pro 💎, Coding 👨‍💻, Vision 👁️, Creative 🎨, Research 🔍, Max 🚀). Users chat with these; each resolves to a real backend model. Remap in Settings → Aura Models.
- **Aura Auto** — routes each message to the best alias using modular scored rules (code → Coding, images → Vision, big documents → Research, short questions → Flash, …).
- **Developer Mode** — Settings → Developer. Reveals backend model ids, providers, latency, TTFT, and token usage. Off by default: users see only Aura branding.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the module map and [MODEL_SYSTEM.md](MODEL_SYSTEM.md) for discovery/mapping/routing details.

## Requirements

- Node 18+ (Electron 33 bundles its own runtime)
- No environment variables needed — everything is configured in-app
