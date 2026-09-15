# ENVIRONMENT — Aura AI

Every environment variable used across the project. **No secret values are included** — copy `.env.example` to `.env` and fill in your own.

---

## Original app (root)

Defined in `.env.example`:

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Optional | API key for the Anthropic provider used by the Electron main process. If blank, the app falls back to reading `~/.claude/settings.json` env block. |
| `ANTHROPIC_BASE_URL` | Optional | Override base URL for Anthropic-compatible endpoints (e.g. a local proxy/gateway). Defaults to the public API when unset. |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Optional | Model id used when the app requests the "opus-tier" default (e.g. a gateway alias). |
| `NEON_DATABASE_URL` | Optional | Neon Postgres connection string for the memory system. When unset, Aura falls back to local app storage for memories. Treat as a secret. |

Additional runtime flags (not in `.env.example`):

| Variable | Purpose |
|---|---|
| `AURA_LOAD_BUILT=1` | Makes the Electron main process load the built renderer from `dist/renderer` instead of the Vite dev server at `http://localhost:5173`. Used for testing production bundles in dev. |

Note: the main process also reads the `env` block of `~/.claude/settings.json` as a fallback source for the values above (see `readSettingsEnv()` in `src/electron/main.ts`); `process.env` always wins.

---

## Aura-vNext (`releases/Aura-vNext`)

**No environment variables are required.** Providers (base URL, API key, headers, organization, timeout) are configured entirely in-app via Settings → Providers and persisted to Electron `userData/aura-vnext/*.json`.

| Variable | Purpose |
|---|---|
| `AURA_LOAD_BUILT=1` | Same as the root app but for the vNext dev server port (5174): load the built renderer instead of the dev server. Development convenience only. |

---

## Security notes

- API keys are stored in plain JSON under the OS user profile (Electron `userData`). Do not commit or share that directory.
- `.gitignore` already excludes `.env`; never commit a filled `.env`.
- The vNext renderer runs sandboxed with context isolation; keys never enter the renderer process — all provider calls happen in the Electron main process.
