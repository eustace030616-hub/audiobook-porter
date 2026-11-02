import { defineConfig } from 'vite'

const devOrigin = process.env.CLAM_DEV_ORIGIN || 'https://clam.flowwing.uk'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/__auth': devOrigin,
      '/api': devOrigin,
      '/audio': devOrigin,
      '/hls': devOrigin,
      '/cover': devOrigin,
      '/subtitle': devOrigin,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
