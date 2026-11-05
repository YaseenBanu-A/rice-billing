import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // API server (npm run dev:api) handles /api in development
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
})
