/// <reference types="vite/client" />

// monaco-editor's `exports` map hides its deep ESM entries from TS, but the
// Vite alias in vite.config.ts resolves them to the real files at build time.
declare module 'monaco-editor/esm/vs/editor/editor.main'
