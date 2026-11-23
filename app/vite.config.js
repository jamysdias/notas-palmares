import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' para funcionar no GitHub Pages (https://<usuario>.github.io/notas-palmares/)
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    // só para testes locais: PostgREST local atendendo em /rest/v1
    proxy: process.env.LOCAL_PGRST ? {
      '/rest/v1': { target: process.env.LOCAL_PGRST, changeOrigin: true, rewrite: (p) => p.replace(/^\/rest\/v1/, '') }
    } : undefined
  }
})
