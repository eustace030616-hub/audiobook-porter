import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/__auth': 'http://127.0.0.1:13379',
      '/api': 'http://127.0.0.1:13379',
      '/audio': 'http://127.0.0.1:13378',
      '/hls': 'http://127.0.0.1:13378',
      '/cover': 'http://127.0.0.1:13378',
      '/subtitle': 'http://127.0.0.1:13378',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
