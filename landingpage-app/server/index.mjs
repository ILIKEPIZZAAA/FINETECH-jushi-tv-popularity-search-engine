import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleDramaApi } from './drama-api.mjs'
import { createJobSubscriptions } from './job-subscriptions.mjs'
import { createAnalyticsService } from './analytics.mjs'
import { createRankingsService } from './rankings.mjs'
import { createPosterImages } from './poster-images.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const distRoot = join(projectRoot, 'dist')
const posterImages = createPosterImages({ directory: process.env.POSTER_CACHE_DIR || join(process.env.STATE_DIRECTORY || join(projectRoot, '.runtime'), 'posters') })
const analytics = createAnalyticsService({ directory: process.env.ANALYTICS_DATA_DIR || join(projectRoot, '.runtime/analytics'), production: process.env.NODE_ENV === 'production' })
const rankings = createRankingsService({ directory: process.env.RANKINGS_DATA_DIR || join(projectRoot, '.runtime/rankings') })
if (process.env.RANKINGS_SCHEDULE !== 'off') rankings.start()
const port = Number(process.env.PORT || 3001)
const host = process.env.HOST?.trim() || '127.0.0.1'
const collectorBase = process.env.DRAMA_COLLECTOR_URL?.trim() || 'http://127.0.0.1:8890'
const kyCollectorBase = process.env.DRAMA_KY_COLLECTOR_URL?.trim() || collectorBase
const collectionJobs = new Map()
const runningCollectionKeys = new Map()
const jobSubscriptions = createJobSubscriptions()
setInterval(() => {
  jobSubscriptions.expire()
  pruneCollectionJobs()
}, 30_000).unref()
const clientId = (request) => /^[a-f0-9-]{36}$/i.test(request.headers['x-collection-client'] || '') ? request.headers['x-collection-client'] : ''
const collectionJobTtlMs = 10 * 60 * 1000
const maxCollectionJobs = 64
const asyncCollectionPaths = new Set([
  '/api/collect/cross',
  '/api/collect/guduo-history',
  '/api/collect/maoyan-history',
  '/api/collect/maoyan-metric',
  '/api/collect/ky-history',
  '/api/collect/ky',
  '/api/collect/tv-ratings',
])

const siteConfig = {
  brand: 'FINETECH',
  hero: {
    title: 'Show Popularity\nTracking',
    searchPlaceholder: '输入剧名',
  },
  footer: {
    statement: 'Creative Thinking Inspires Ideas. Ideas Inspire Change.',
    copyright: '@FINETECH 2026',
    disclaimer: '免责声明',
  },
}

const features = [
  { title: 'Rich Data Dimensions', subtitle: 'No Manual Entry Required' },
  { title: 'Compare Multiple Shows', subtitle: 'Automatic Competitor Tracking' },
  { title: 'One-Click Data Export', subtitle: 'Free & Open Source' },
  { title: 'Multi-Dimensional Show Insights', subtitle: 'Enter a Show Title to Search' },
  { title: 'Save Results Directly', subtitle: 'View Multiple Shows Side by Side' },
  { title: 'Auto-Fetch Competitor Data', subtitle: 'Open to Everyone' },
]

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(payload))
}

function pruneCollectionJobs() {
  const now = Date.now()
  for (const [id, job] of collectionJobs) {
    if (job.finishedAt && now - job.finishedAt > collectionJobTtlMs) collectionJobs.delete(id)
  }
  if (collectionJobs.size < maxCollectionJobs) return
  const finished = [...collectionJobs].filter(([, job]) => job.finishedAt).sort((a, b) => a[1].finishedAt - b[1].finishedAt)
  for (const [id] of finished) {
    if (collectionJobs.size < maxCollectionJobs) break
    collectionJobs.delete(id)
  }
}

function startCollectionJob(request, requestUrl) {
  pruneCollectionJobs()
  const key = request.method === 'GET' ? `${request.method} ${requestUrl.pathname}${requestUrl.search}` : null
  const existingId = key ? runningCollectionKeys.get(key) : null
  if (existingId && collectionJobs.has(existingId) && !collectionJobs.get(existingId).controller.signal.aborted) {
    jobSubscriptions.join(clientId(request), existingId, collectionJobs.get(existingId).controller)
    return existingId
  }
  if (collectionJobs.size >= maxCollectionJobs) return null

  const id = randomUUID()
  const progressKey = requestUrl.pathname === '/api/collect/ky-history'
    ? `ky:history:${requestUrl.searchParams.get('title') || ''}:${requestUrl.searchParams.get('from') || ''}:${requestUrl.searchParams.get('to') || ''}`
    : null
  const job = { result: null, finishedAt: null, startedAt: Date.now(), progressKey, controller: new AbortController() }
  collectionJobs.set(id, job)
  if (key) runningCollectionKeys.set(key, id)
  jobSubscriptions.join(clientId(request), id, job.controller)
  Promise.resolve(handleDramaApi(request, requestUrl, { signal: job.controller.signal })).then(
    (result) => { job.result = result || { status: 500, payload: { error: '采集任务没有返回结果' } } },
    (cause) => { job.result = { status: 500, payload: { error: cause?.message || '采集任务失败' } } },
  ).finally(() => {
    job.finishedAt = Date.now()
    jobSubscriptions.finish(id)
    if (key && runningCollectionKeys.get(key) === id) runningCollectionKeys.delete(key)
  })
  return id
}

async function readCollectionProgress(key) {
  if (!key) return null
  try {
    const url = new URL('/progress', key.startsWith('ky:') ? kyCollectorBase : collectorBase)
    url.searchParams.set('key', key)
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return null
    return (await response.json()).progress || null
  } catch {
    return null
  }
}

function serveStatic(response, requestPath) {
  const safePath = normalize(requestPath).replace(/^([.][.][/\\])+/, '')
  const filePath = join(distRoot, safePath === '/' ? 'index.html' : safePath)
  if (!filePath.startsWith(distRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    const fallback = join(distRoot, 'index.html')
    if (!existsSync(fallback)) return false
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(readFileSync(fallback))
    return true
  }

  const mime = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
  }[extname(filePath)] || 'application/octet-stream'
  const cacheControl = requestPath.startsWith('/assets/') || requestPath.startsWith('/hero-posters/selected/')
    ? 'public, max-age=31536000, immutable'
    : mime.startsWith('text/html') ? 'no-cache' : 'public, max-age=86400'
  response.writeHead(200, { 'content-type': mime, 'cache-control': cacheControl })
  response.end(readFileSync(filePath))
  return true
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

    if (requestUrl.pathname === '/api/poster') return await posterImages.handle(request, response, requestUrl)

    if (requestUrl.pathname.startsWith('/api/analytics/')) return await analytics.handle(request, response, requestUrl)

    if (request.method === 'POST' && requestUrl.pathname === '/api/collect/release') {
      // An unguessable per-page token releases only that page's subscriptions.
      const client = requestUrl.searchParams.get('client') || ''
      if (!/^[a-f0-9-]{36}$/i.test(client)) return sendJson(response, { error: '无效的页面会话' }, 400)
      jobSubscriptions.release(client, requestUrl.searchParams.get('job') || undefined)
      return sendJson(response, { ok: true })
    }

    const jobMatch = request.method === 'GET' && requestUrl.pathname.match(/^\/api\/collect\/jobs\/([a-f0-9-]{36})$/i)
    if (jobMatch) {
      pruneCollectionJobs()
      const job = collectionJobs.get(jobMatch[1])
      if (!job) return sendJson(response, { error: '采集任务已过期或不存在，请重新请求' }, 404)
      if (!job.result) jobSubscriptions.join(clientId(request), jobMatch[1], job.controller)
      if (!job.result) return sendJson(response, {
        jobId: jobMatch[1], status: 'running', startedAt: job.startedAt,
        progress: await readCollectionProgress(job.progressKey),
      }, 202)
      // Keep source failures in JSON so the browser can show their real cause.
      if (job.result.status >= 400) return sendJson(response, {
        jobId: jobMatch[1], status: 'failed', sourceStatus: job.result.status,
        error: job.result.payload?.error || `采集任务失败（HTTP ${job.result.status}）`,
      })
      return sendJson(response, job.result.payload, job.result.status)
    }
    if (asyncCollectionPaths.has(requestUrl.pathname) && /(?:^|,)\s*respond-async\s*(?:,|$)/i.test(request.headers.prefer || '')) {
      const jobId = startCollectionJob(request, requestUrl)
      if (!jobId) return sendJson(response, { error: '采集任务过多，请稍后重试' }, 503)
      return sendJson(response, { jobId, status: 'running' }, 202)
    }

    if (requestUrl.pathname === '/api/health') return sendJson(response, { ok: true, service: 'finetech-landingpage' })
    if (request.method === 'GET' && requestUrl.pathname === '/api/rankings') return sendJson(response, await rankings.read())
    if (requestUrl.pathname === '/api/site-config') return sendJson(response, siteConfig)
    if (requestUrl.pathname === '/api/features') return sendJson(response, { features })

    const dramaApiResponse = await handleDramaApi(request, requestUrl)
    if (dramaApiResponse) return sendJson(response, dramaApiResponse.payload, dramaApiResponse.status)

    if (serveStatic(response, requestUrl.pathname)) return
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  } catch (cause) {
    if (response.headersSent) {
      response.destroy(cause)
      return
    }
    sendJson(response, { error: cause?.message || '服务暂时不可用' }, 500)
  }
})

server.listen(port, host, () => {
  console.log(`FINETECH backend listening on http://${host}:${port}`)
})
