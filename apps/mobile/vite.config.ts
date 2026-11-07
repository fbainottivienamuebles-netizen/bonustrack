import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { serviceWorker } from './sw-plugin.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serviceWorker()],
})
