import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { privacyRouting } from './privacyRouting'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), privacyRouting()],
})
