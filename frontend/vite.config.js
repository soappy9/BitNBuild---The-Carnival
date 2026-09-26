import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const dashboardPath = fileURLToPath(new URL('../logic-and-dashboard/index.html', import.meta.url))

const logicDashboardPlugin = {
  name: 'logic-dashboard-page',
  configureServer(server) {
    server.middlewares.use('/logic-and-dashboard', async (request, response, next) => {
      if (request.method !== 'GET') {
        next()
        return
      }
      try {
        const page = await readFile(dashboardPath)
        response.statusCode = 200
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.end(page)
      } catch (error) {
        next(error)
      }
    })
  },
  configurePreviewServer(server) {
    const builtDashboardPath = fileURLToPath(new URL('./dist/logic-and-dashboard/index.html', import.meta.url))
    server.middlewares.use('/logic-and-dashboard', async (request, response, next) => {
      if (request.method !== 'GET') {
        next()
        return
      }
      try {
        const page = await readFile(builtDashboardPath)
        response.statusCode = 200
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.end(page)
      } catch (error) {
        next(error)
      }
    })
  },
  async generateBundle() {
    const page = await readFile(dashboardPath, 'utf-8')
    this.emitFile({ type: 'asset', fileName: 'logic-and-dashboard/index.html', source: page })
  },
}

// https://vite.dev/config/
export default defineConfig({
  base: './',  // <-- ADD THIS EXACT LINE
  plugins: [react(), logicDashboardPlugin],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/alertness": "http://127.0.0.1:8000",
      "/queue": "http://127.0.0.1:8000",
      "/review": "http://127.0.0.1:8000",
      "/trust": "http://127.0.0.1:8000",
      "/stats": "http://127.0.0.1:8000",
    },
  },
})
