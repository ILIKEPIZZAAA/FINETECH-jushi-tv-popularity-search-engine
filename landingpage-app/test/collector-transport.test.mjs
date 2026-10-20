import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { performance } from 'node:perf_hooks'
import { collectKyHistory } from '../src/lib/dramaApi.js'

const appRoot = new URL('..', import.meta.url)

test('two browser sessions share a job and only the last release aborts the source HTTP request', async () => {
  let sourceClosed = false
  let began
  const started = new Promise((resolve) => { began = resolve })
  const collector = createServer((request, response) => {
    began()
    response.once('close', () => { sourceClosed = true })
  })
  collector.listen(0, '127.0.0.1')
  await once(collector, 'listening')
  const appPort = await freePort()
  const app = spawn(process.execPath, ['server/index.mjs'], {
    cwd: new URL('.', appRoot), env: { ...process.env, PORT: String(appPort), DRAMA_KY_COLLECTOR_URL: `http://127.0.0.1:${collector.address().port}` }, stdio: 'ignore',
  })
  try {
    const base = `http://127.0.0.1:${appPort}`
    await waitForHealth(`${base}/api/health`)
    const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    const path = `${base}/api/collect/ky-history?title=test&from=2026-10-12&to=2026-10-13`
    const start = async (client) => (await fetch(path, { headers: { Prefer: 'respond-async', 'X-Collection-Client': client } })).json()
    const first = await start(a)
    await started
    const second = await start(b)
    assert.equal(second.jobId, first.jobId)
    await fetch(`${base}/api/collect/release?client=${a}`, { method: 'POST' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(sourceClosed, false)
    await fetch(`${base}/api/collect/release?client=${b}`, { method: 'POST' })
    for (let i = 0; i < 40 && !sourceClosed; i++) await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(sourceClosed, true)
  } finally {
    app.kill('SIGTERM'); await once(app, 'exit')
    collector.closeAllConnections()
    await new Promise((resolve) => collector.close(resolve))
  }
})

async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch { /* The child server is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`App server did not become healthy: ${url}`)
}

test('long collector requests return a job promptly and polling preserves the final payload', async () => {
  let historyCalls = 0
  const collector = createServer((request, response) => {
    if (request.url === '/ping') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, service: 'main-test' }))
      return
    }
    if (request.url.startsWith('/progress?')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, progress: {
        source: '酷云历史', state: 'scanning', pass: 1, metric: '酷云全端热度',
        checkedDays: 2, totalDays: 3, currentDate: '2026-09-28',
        hitDays: 1, noDataDays: 1, updatedAt: '2026-09-29T00:00:00.000Z',
      } }))
      return
    }
    if (request.url.startsWith('/collect/all?')) {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: true, results: {
          maoyan: { ok: true, data: { heat: 100, date: '2026-09-29' } },
          guduo: { ok: true, data: { heat: 50, date: '2026-09-29' } },
        } }))
      }, 450)
      return
    }
    if (!request.url.startsWith('/ky/history?')) {
      response.writeHead(404).end()
      return
    }
    historyCalls += 1
    setTimeout(() => {
      const title = new URL(request.url, 'http://collector.test').searchParams.get('title')
      const failing = title === '失败剧'
      response.writeHead(failing ? 502 : 200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(failing
        ? { ok: false, error: 'source failure' }
        : { ok: true, series: [], complete: true, verification: { state: 'verified' } }))
    }, new URL(request.url, 'http://collector.test').searchParams.get('title') === '进度剧' ? 1500 : 450)
  })
  collector.listen(0, '127.0.0.1')
  await once(collector, 'listening')
  let kyHistoryCalls = 0
  const kyCollector = createServer((request, response) => {
    if (request.url === '/ping') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, service: 'ky-test' }))
      return
    }
    if (request.url.startsWith('/progress?')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, progress: {
        source: '酷云历史', state: 'scanning', pass: 1, metric: '酷云全端热度',
        checkedDays: 2, totalDays: 3, currentDate: '2026-09-28',
        hitDays: 1, noDataDays: 1, updatedAt: '2026-09-29T00:00:00.000Z',
      } }))
      return
    }
    if (!request.url.startsWith('/ky/history?')) {
      response.writeHead(404).end()
      return
    }
    kyHistoryCalls += 1
    setTimeout(() => {
      const title = new URL(request.url, 'http://collector.test').searchParams.get('title')
      response.writeHead(title === '失败剧' ? 502 : 200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(title === '失败剧'
        ? { ok: false, error: 'source failure' }
        : { ok: true, series: [], complete: true, verification: { state: 'verified' } }))
    }, new URL(request.url, 'http://collector.test').searchParams.get('title') === '进度剧' ? 1500 : 450)
  })
  kyCollector.listen(0, '127.0.0.1')
  await once(kyCollector, 'listening')
  const appPort = await freePort()
  const app = spawn(process.execPath, ['server/index.mjs'], {
    cwd: new URL('.', appRoot),
    env: { ...process.env, PORT: String(appPort), DRAMA_COLLECTOR_URL: `http://127.0.0.1:${collector.address().port}`, DRAMA_KY_COLLECTOR_URL: `http://127.0.0.1:${kyCollector.address().port}` },
    stdio: 'ignore',
  })

  try {
    const base = `http://127.0.0.1:${appPort}`
    await waitForHealth(`${base}/api/health`)
    const health = await fetch(`${base}/api/collector/health`)
    assert.equal(health.status, 200)
    const healthPayload = await health.json()
    assert.equal(healthPayload.collectors.main.ok, true)
    assert.equal(healthPayload.collectors.ky.service, 'ky-test')
    const startedAt = performance.now()
    const started = await fetch(`${base}/api/collect/ky-history?title=%E9%80%90%E7%8E%89&from=2026-09-27&to=2026-09-29`, {
      headers: { Prefer: 'respond-async' },
    })
    const initialElapsedMs = performance.now() - startedAt
    assert.equal(started.status, 202)
    assert.ok(initialElapsedMs < 250, `job creation took ${Math.round(initialElapsedMs)}ms`)
    const { jobId } = await started.json()
    assert.match(jobId, /^[a-f0-9-]{36}$/i)
    const progressResponse = await fetch(`${base}/api/collect/jobs/${jobId}`)
    assert.equal(progressResponse.status, 202)
    assert.deepEqual((await progressResponse.json()).progress, {
      source: '酷云历史', state: 'scanning', pass: 1, metric: '酷云全端热度',
      checkedDays: 2, totalDays: 3, currentDate: '2026-09-28',
      hitDays: 1, noDataDays: 1, updatedAt: '2026-09-29T00:00:00.000Z',
    })
    const duplicate = await fetch(`${base}/api/collect/ky-history?title=%E9%80%90%E7%8E%89&from=2026-09-27&to=2026-09-29`, {
      headers: { Prefer: 'respond-async' },
    })
    assert.equal((await duplicate.json()).jobId, jobId)

    let finished
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      const response = await fetch(`${base}/api/collect/jobs/${jobId}`)
      if (response.status === 202) continue
      finished = response
      break
    }
    assert.ok(finished, 'job did not finish')
    assert.equal(finished.status, 200)
    assert.deepEqual(await finished.json(), {
      series: [], complete: true, attemptedDates: 0, checkedDates: [], noDataDates: [], noDataByMetric: {},
      failedDates: [], sourceLatestDate: null, coverageNote: '', verification: { state: 'verified' },
    })
    assert.equal(kyHistoryCalls, 1, 'matching in-flight history requests should share one KY collection')

    const cross = await fetch(`${base}/api/collect/cross`, {
      method: 'POST',
      headers: { Prefer: 'respond-async', 'content-type': 'application/json' },
      body: JSON.stringify({ title: '逐玉' }),
    })
    assert.equal(cross.status, 202)
    const crossId = (await cross.json()).jobId
    let crossResult
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      crossResult = await fetch(`${base}/api/collect/jobs/${crossId}`)
      if (crossResult.status !== 202) break
    }
    assert.equal(crossResult.status, 200)
    assert.equal((await crossResult.json()).outcome.metrics.length, 2)

    const originalFetch = globalThis.fetch
    const originalWindow = globalThis.window
    globalThis.window = { setTimeout, clearTimeout }
    globalThis.fetch = (url, options) => originalFetch(new URL(url, base), options)
    try {
      const fromBrowser = await collectKyHistory({ title: '逐玉' }, '2026-09-27', '2026-09-29')
      assert.deepEqual(fromBrowser.series, [])
      const seenProgress = []
      await collectKyHistory({ title: '进度剧' }, '2026-09-27', '2026-09-29', (progress) => seenProgress.push(progress))
      assert.ok(seenProgress.some((progress) => progress.checkedDays === 2 && progress.currentDate === '2026-09-28'))
      await assert.rejects(
        collectKyHistory({ title: '失败剧' }, '2026-09-27', '2026-09-29'),
        /source failure/,
      )
    } finally {
      globalThis.fetch = originalFetch
      globalThis.window = originalWindow
    }

    const failed = await fetch(`${base}/api/collect/ky-history?title=%E5%A4%B1%E8%B4%A5%E5%89%A7&from=2026-09-27&to=2026-09-29`, {
      headers: { Prefer: 'respond-async' },
    })
    const failureId = (await failed.json()).jobId
    let failure
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      failure = await fetch(`${base}/api/collect/jobs/${failureId}`)
      if (failure.status !== 202) break
    }
    assert.equal(failure.status, 200)
    const failurePayload = await failure.json()
    assert.equal(failurePayload.status, 'failed')
    assert.equal(failurePayload.sourceStatus, 502)
    assert.match(failurePayload.error, /source failure/)
  } finally {
    app.kill('SIGTERM')
    await once(app, 'exit')
    await new Promise((resolve) => collector.close(resolve))
    await new Promise((resolve) => kyCollector.close(resolve))
  }
})
