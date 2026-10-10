import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// `base: './'` makes the production build relocatable: it works from the
// root of a domain, from a sub-folder (e.g. laikku.com/games/) and on
// GitHub Pages without any changes. Routing uses a HashRouter for the same reason.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: true,
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'matter-js'],
  },
})
