import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Development-only synthetic fixtures never enter production public assets.
const dashboardFixture = {
  name: 'dev-only-dashboard-fixture',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== '/__dashboard-demo.html') return next()
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      const fixture = readFileSync(new URL('./test/fixtures/dashboard-demo.html', import.meta.url), 'utf8')
        .replace("poster: '/hero-posters/drama-2024-11.jpg'", "poster: '/hero-posters/drama-2024-01.jpg'")
        .replace("{ projectId: id, view:", "{ backgroundPaused: true, projectId: id, view:")
      res.end(fixture)
    })
  },
}

export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, process.cwd(), '').VITE_API_PROXY_TARGET?.trim()
  if (target && !/^https?:\/\//.test(target)) throw new Error('VITE_API_PROXY_TARGET 必须为 http(s) 地址')
  const offlineApi = {
    name: 'frontend-only-offline-api',
    apply: 'serve',
    configureServer(server) {
      if (target) return
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0]
        if (!path?.startsWith('/api/')) return next()
        const responses = {
          '/api/rankings': { boards: [] },
          '/api/analytics/events': { ok: true },
          '/api/analytics/session': { authenticated: false, configured: false },
          '/api/collect/release': { ok: true },
        }
        const body = responses[path]
        res.statusCode = body ? 200 : 503
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify(body || { error: '当前仅运行前端；真实查询和采集需要你配置兼容的后端 API。' }))
      })
    },
  }
  return {
    plugins: [react(), dashboardFixture, offlineApi],
    worker: { format: 'es' },
    server: { port: 5173, proxy: target ? { '/api': { target, changeOrigin: true } } : {} },
  }
})
