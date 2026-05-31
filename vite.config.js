import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    assetsDir: 'static',
  },
  server: {
    port: 6300,
    proxy: {
      '/api': {
        target: 'http://localhost:6301',
        changeOrigin: true,
      },
      '/outputs': {
        target: 'http://localhost:6301',
        changeOrigin: true,
      },
      '/assets': {
        target: 'http://localhost:6301',
        changeOrigin: true,
      },
    },
  },
})
