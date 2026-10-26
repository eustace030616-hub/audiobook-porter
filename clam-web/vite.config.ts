import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:13378',
      '/audio': 'http://127.0.0.1:13378',
      '/cover': 'http://127.0.0.1:13378',
      '/static': 'http://127.0.0.1:13378',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
