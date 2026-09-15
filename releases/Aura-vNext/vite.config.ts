import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5174, strictPort: true },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@ui': path.resolve(__dirname, 'ui'),
      '@services': path.resolve(__dirname, 'services'),
      '@settings': path.resolve(__dirname, 'settings'),
      '@providers': path.resolve(__dirname, 'providers'),
      '@models': path.resolve(__dirname, 'models'),
    },
  },
})
