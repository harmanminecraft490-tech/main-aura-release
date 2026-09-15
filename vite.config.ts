import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // monaco-editor ships an `exports` map that mis-resolves its deep ESM
      // subpaths (e.g. the `?worker` entries) and CSS. Aliasing to the real
      // directory lets Vite resolve those files directly and bundle Monaco
      // locally instead of loading it from a CDN.
      'monaco-editor': path.resolve(__dirname, 'node_modules/monaco-editor'),
    },
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        // Code-split vendor libs so cold start loads less + they cache separately.
        manualChunks: {
          react: ['react', 'react-dom'],
          state: ['zustand', 'class-variance-authority', 'clsx', 'tailwind-merge'],
          markdown: ['react-markdown', 'remark-gfm', 'remark-math', 'rehype-katex', 'katex', 'marked', 'react-syntax-highlighter', 'highlight.js'],
          motion: ['framer-motion'],
          virt: ['react-virtuoso'],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
  optimizeDeps: {
    include: ['@/services/auraModels'],
  },
})
