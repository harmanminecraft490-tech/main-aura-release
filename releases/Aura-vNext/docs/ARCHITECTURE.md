# Architecture

## Process model

```
┌────────────────────────── Electron main ──────────────────────────┐
│ backend/main.ts        window lifecycle, dark theme, ext. links   │
│ backend/ipc.ts         AuraBackend: state owner + IPC surface     │
│ backend/chat-orchestrator.ts   alias → chain → stream + aborts    │
│ backend/persistence.ts atomic JSON stores (userData/aura-vnext)   │
│ providers/*            discovery + streaming (runs here only)     │
│ models/*               registry, mapping, router (shared, pure)   │
└──────────────┬────────────────────────────────────────────────────┘
               │ contextBridge (backend/preload.ts) — sandboxed,
               │ invoke/on only, no Node in the renderer
┌──────────────┴──────────── Renderer ──────────────────────────────┐
│ services/bridge.ts     initial pull + live `state:*` mirror       │
│ services/store.ts      Zustand: workspace (persisted) + mirror    │
│ services/chat-client.ts stream wiring with streamId guards        │
│ ui/*, settings/*       React 19 + Tailwind glass UI               │
│ models/* (types+defs)  imported for display only — pure modules   │
└───────────────────────────────────────────────────────────────────┘
```

**Rule:** API keys and network calls live exclusively in the main process. The renderer receives already-serialized view state.

## Folder map

| Path | Role |
|---|---|
| `providers/types.ts` | Wire types: ProviderConfig, DiscoveredModel, ModelRef, StreamHandler contract |
| `providers/discovery.ts` | Dynamic `/models` fetch for both protocols; connection test |
| `providers/streaming/sse.ts` | SSE reader: strict boundaries, first-byte + idle watchdogs |
| `providers/streaming/openai-compat.ts` | Adapter: chat/completions, image parts, reasoning deltas, usage |
| `providers/streaming/anthropic.ts` | Adapter: v1/messages, thinking deltas, usage |
| `providers/stream.ts` | Dispatch + pre-token-only retry (backoff, max 2) |
| `models/capabilities/infer.ts` | Heuristic capability/context/pricing inference from raw entries |
| `models/registry/registry.ts` | Cross-provider snapshot + user state + fuzzy matching |
| `models/aura-models/definitions.ts` | The 9 aliases, default target patterns, focus, temperature |
| `models/aura-models/mapping.ts` | override → default → capability resolution; fallback chains |
| `models/aura-models/suggestions.ts` | Better-mapping proposals; dismissal-aware; never auto-apply |
| `models/smart-router/rules.ts` | Modular scored routing rules for Aura Auto |
| `models/smart-router/router.ts` | Signal extraction + best-rule selection |
| `backend/*` | Electron main process (see diagram) |
| `services/*` | Renderer: store, bridge sync, chat client |
| `ui/*` | Shell (TitleBar, Sidebar), chat, projects |
| `settings/*` | SettingsView + 6 tabs |
| `src/` | Entry (`main.tsx`), styles, renderer types (`types.ts`), domain (`domain.ts`) |

## Streaming invariants

Every adapter guarantees, via a `finished` latch:

1. **Exactly one terminal callback** — `onDone` | `onError` | `onAbort`, never two.
2. **No tokens after terminal** — late SSE frames are dropped.
3. **Abort is instant** — the reader is cancelled the moment the signal fires.
4. **No hangs** — first-byte watchdog (provider `timeoutMs`) and 60–90 s idle watchdog convert stalls into errors.
5. **No duplicated output** — retries and failovers occur only before the first token.

The orchestrator layers cross-provider failover on top (chain of up to 1 + 3 models, other-provider candidates first) and registers one `AbortController` per `streamId`; `chat:abort` and window close abort everything.

The renderer's chat client filters every event by `streamId` and has a single `finish()` latch that clears `isStreaming`, so a stale or superseded stream can never mutate newer UI state — this is what makes stuck "Thinking…" impossible by construction.

## State ownership

| State | Owner | Persistence |
|---|---|---|
| Providers, model cache, model user state, mappings, dismissed suggestions, app settings | Main process | `userData/aura-vnext/*.json` (temp-file + rename) |
| Conversations, folders, projects | Renderer | `localStorage` (debounced 250 ms) |
| Request log | Main process | In-memory, capped 200 |

Backend state flows to the renderer via `state:*` push channels; the store mirror is read-only from the UI's perspective (mutations go through `window.aura.*` invokes).

## Security

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- CSP in `index.html` restricts scripts to self
- `setWindowOpenHandler` denies in-app navigation; https links open externally
- API keys never cross into the renderer process
