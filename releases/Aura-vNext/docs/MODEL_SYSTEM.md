# The Aura Model System

## 1. Universal Provider → dynamic discovery

Adding a provider stores only connection details (name, base URL, API key, optional headers/organization, timeout, protocol). Immediately after save — and on every app start and manual refresh — Aura calls the provider's models endpoint:

- OpenAI-compatible: `GET {base}/models`
- Anthropic: `GET {base}/v1/models`

The response is parsed tolerantly (`data` array, `models` array, or bare array; `id` or `name` fields; Gemini-style `models/` prefixes stripped). Non-chat models (embeddings, TTS, moderation, …) are filtered by pattern. **There is no hardcoded model list anywhere** — a brand-new model appears the moment the backend serves it.

For each model we store: id, display name, provider, context length, max output, capabilities (vision / reasoning / function-calling / streaming), pricing when reported, and first/last-seen timestamps. Capabilities come from provider metadata when present, otherwise pattern heuristics (`models/capabilities/infer.ts`) that work for unseen future models.

Per-model **user state** (favorite / pin / hide / rename) is stored separately from the discovery cache, so refreshes never lose it.

## 2. Aura Models (virtual aliases)

Users interact with nine branded aliases. Raw backend names appear only in Developer Mode.

| Alias | Focus | Default target patterns (first match wins) |
|---|---|---|
| Aura Auto 🤖 | routing | — (delegates to the smart router) |
| Aura Flash ⚡ | speed | `gpt-5.6-terra`, `gemini-2.5-flash`, `claude-haiku-4-5` |
| Aura Smart 🧠 | balanced | `gpt-5.6-sol`, `claude-sonnet-5`, `gemini-2.5-pro` |
| Aura Pro 💎 | quality | `claude-sonnet-5`, `gpt-5.6-sol`, `claude-opus-4.8` |
| Aura Coding 👨‍💻 | coding | `claude-sonnet-5-thinking`, `claude-sonnet-5`, `qwen3-coder` |
| Aura Vision 👁️ | vision | `gpt-4o`, `gemini-2.5-pro`, `claude-sonnet-5` |
| Aura Creative 🎨 | creative | `claude-opus-4.8`, `gpt-5.6-sol`, `claude-sonnet-5` |
| Aura Research 🔍 | research | `claude-opus-4.8-thinking`, `claude-opus-4.8`, `gemini-2.5-pro` |
| Aura Max 🚀 | max | `claude-opus-4.8-thinking`, `claude-opus-4.8`, `o3` |

These are **defaults, not requirements**: patterns are fuzzy (a default of `claude-sonnet-5` also matches `claude-sonnet-5-20260101`), and resolution falls through three levels:

1. **User override** — set in Settings → Aura Models; wins if the model still exists
2. **Default patterns** — the table above, matched against whatever discovery found
3. **Capability scoring** — every visible model scored for the alias's focus (`scoreForFocus`); best score wins

So the system works with *any* backend: if none of the default ids exist, each alias still resolves to the most suitable discovered model. Changing a mapping takes effect on the next message — no restart.

Each resolution also produces a **fallback chain** (top capability-ranked alternates, other providers first). If the primary dies before emitting a token, the orchestrator fails over transparently and tells the UI via a `chat:routed` event.

## 3. Aura Auto (smart router)

`models/smart-router/rules.ts` defines independent scored rules over extracted signals (text, images attached, message size, conversation length):

| Rule | Signal | Target |
|---|---|---|
| vision | images attached | Aura Vision |
| explicit-max | "highest quality", "think deeply", … | Aura Max |
| coding | code keywords or syntax (``` , `=>`, `def `, …) | Aura Coding |
| large-document | message > 12 000 chars | Aura Research |
| research | analyze/summarize/compare/… | Aura Research |
| creative | story/poem/lyrics/… | Aura Creative |
| long-conversation | > 12 messages or > 24 000 chars | Aura Smart |
| quick-question | short factual question | Aura Flash |
| short-chat | < 120 chars | Aura Flash |
| *(fallback)* | nothing scored | Aura Smart |

Highest score wins. Adding a rule = appending one object to `DEFAULT_RULES` — the router, orchestrator, and UI need no changes. The winning rule's `reason` is surfaced to the renderer (shown as the route badge in Developer Mode).

## 4. Smart mapping suggestions

After every discovery refresh, `computeSuggestions` compares each alias's current resolution with the best capability-scored candidate. A suggestion is raised only when **all** hold:

- the candidate beats the current model by ≥ 8 focus-score points
- the candidate appeared *after* the user last set that mapping (never nag about models they already chose against)
- the user hasn't dismissed this exact (alias, model) pair before

Suggestions render as banners in Settings → Aura Models ("A newer, better-at-coding model is available. Switch Aura Coding to …?") with **Switch** / dismiss. Nothing is ever applied automatically.

## 5. Request lifecycle

```
send → chat:start {streamId, messages, auraModelId}
  → orchestrator: Auto? route(messages) → alias
  → resolveAuraModel(alias) → primary + fallbacks
  → chat:routed {model, provider, reason}
  → streamCompletion (adapter, watchdogs, retry-before-first-token)
      ├─ chat:thinking* → chat:delta* → chat:done {usage, latency}
      ├─ pre-token failure → next candidate + chat:routed (fallback)
      └─ abort → chat:aborted
  → request log entry (latency, TTFT, tokens, status)
```
