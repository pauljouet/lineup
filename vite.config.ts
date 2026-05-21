import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the build works at any path — including a GitHub Pages
  // project subpath like https://<user>.github.io/<repo>/ — without hardcoding
  // the repo name. (Safe here: single page, no client-side router.)
  base: './',
  plugins: [react()],
})
