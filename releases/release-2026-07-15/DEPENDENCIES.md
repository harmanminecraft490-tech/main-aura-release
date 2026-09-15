# DEPENDENCIES — Aura AI

**Snapshot date:** 2026-07-15
**Node (local machine):** v24.18.0
**Framework note:** This is an **Electron + Vite + React** project. Next.js and Prisma are **not used**.

---

## Original app (root `package.json`, v2.0.0)

### Core framework versions
| Package | Version |
|---|---|
| Node.js (installed) | 24.18.0 |
| Electron | ^33.2.1 |
| React / React DOM | ^19.0.0 |
| TypeScript | ^5.7.2 |
| Vite | ^6.0.5 |
| Tailwind CSS | ^3.4.17 |
| Zustand | ^5.0.3 |

### Dependencies
- @anthropic-ai/sdk ^0.92.0
- @google/generative-ai ^0.21.0
- @neondatabase/serverless ^0.10.4
- @radix-ui/react-dialog ^1.1.4
- @radix-ui/react-dropdown-menu ^2.1.4
- @radix-ui/react-scroll-area ^1.2.2
- @radix-ui/react-select ^2.1.4
- @radix-ui/react-separator ^1.1.1
- @radix-ui/react-slider ^1.2.2
- @radix-ui/react-slot ^1.1.1
- @radix-ui/react-switch ^1.1.2
- @radix-ui/react-tabs ^1.1.2
- @radix-ui/react-toast ^1.2.4
- @radix-ui/react-tooltip ^1.1.6
- class-variance-authority ^0.7.1
- clsx ^2.1.1
- cmdk ^1.0.4
- electron-updater ^6.3.9
- framer-motion ^11.15.0
- groq-sdk ^0.7.0
- highlight.js ^11.11.1
- katex ^0.16.15
- lucide-react ^0.468.0
- marked ^15.0.4
- openai ^6.46.0
- react ^19.0.0
- react-dom ^19.0.0
- react-markdown ^9.0.3
- react-syntax-highlighter ^15.6.1
- react-virtuoso ^4.10.4
- rehype-katex ^7.0.1
- remark-gfm ^4.0.0
- remark-math ^6.0.0
- tailwind-merge ^2.6.0
- zustand ^5.0.3

### Dev dependencies
- @types/node ^22.10.2
- @types/react ^19.0.0
- @types/react-dom ^19.0.0
- @types/react-syntax-highlighter ^15.5.13
- @vitejs/plugin-react ^4.3.4
- autoprefixer ^10.4.20
- concurrently ^9.1.2
- electron ^33.2.1
- electron-builder ^25.1.8
- playwright ^1.61.1
- postcss ^8.4.49
- tailwindcss ^3.4.17
- typescript ^5.7.2
- vite ^6.0.5
- wait-on ^8.0.2

---

## Aura-vNext (`releases/Aura-vNext/package.json`, v3.0.0)

> Dependencies **not yet installed** (`npm install` pending).

### Dependencies
- clsx ^2.1.1
- framer-motion ^11.15.0
- lucide-react ^0.468.0
- react ^19.0.0
- react-dom ^19.0.0
- react-markdown ^9.0.3
- react-syntax-highlighter ^15.6.1
- remark-gfm ^4.0.0
- tailwind-merge ^2.6.0
- zustand ^5.0.3

### Dev dependencies
- @types/node ^22.10.2
- @types/react ^19.0.0
- @types/react-dom ^19.0.0
- @types/react-syntax-highlighter ^15.5.13
- @vitejs/plugin-react ^4.3.4
- autoprefixer ^10.4.20
- concurrently ^9.1.2
- electron ^33.2.1
- electron-builder ^25.1.8
- postcss ^8.4.49
- rimraf ^6.0.1
- tailwindcss ^3.4.17
- typescript ^5.7.2
- vite ^6.0.5
- wait-on ^8.0.2

### Notable difference
Aura-vNext intentionally drops the provider SDKs (`@anthropic-ai/sdk`, `openai`, `groq-sdk`, `@google/generative-ai`) — all providers are reached through two raw-fetch protocol adapters, keeping the bundle small and behavior uniform.
