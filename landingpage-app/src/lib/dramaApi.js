let collectionClientId
let collectionPageClosed = false
function collectionClient() {
  if (!collectionClientId) {
    collectionClientId = globalThis.crypto.randomUUID()
    window.addEventListener?.('pagehide', () => {
      collectionPageClosed = true
      const url = `/api/collect/release?client=${collectionClientId}`
      if (!globalThis.navigator?.sendBeacon?.(url, '')) void fetch(url, { method: 'POST', keepalive: true }).catch(() => undefined)
    })
    window.addEventListener?.('pageshow', () => { collectionPageClosed = false })
  }
  return collectionClientId
}

async function request(path, options = {}) {
  const isCollection = path.startsWith('/api/collect/')
  if (isCollection && collectionPageClosed) throw new Error('采集页面已关闭')
  const { timeoutMs = 12000, signal: externalSignal, clientId, onProgress, ...fetchOptions } = options
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  externalSignal?.addEventListener('abort', onAbort, { once: true })
  if (externalSignal?.aborted) controller.abort()
  const client = isCollection ? clientId || collectionClient() : ''
  let jobId = null
  const headers = { Accept: 'application/json', ...(fetchOptions.headers || {}), ...(isCollection ? { Prefer: 'respond-async', 'X-Collection-Client': client } : {}) }
  try {
    let currentPath = path
    let restarted = false
    while (true) {
      if (controller.signal.aborted) throw new DOMException('请求已取消', 'AbortError')
      if (isCollection && collectionPageClosed) throw new Error('采集页面已关闭')
      const polling = currentPath !== path
      const response = await fetch(currentPath, {
        cache: 'no-store',
        ...(polling ? { method: 'GET' } : fetchOptions),
        signal: controller.signal,
        headers: polling ? { Accept: 'application/json', 'X-Collection-Client': client } : headers,
      })
      const text = await response.text()
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) throw new Error(`接口返回非 JSON（HTTP ${response.status}）`)
      let payload
      try {
        payload = JSON.parse(text)
      } catch {
        throw new Error('接口返回的 JSON 无法解析')
      }
      if (response.status === 202 && payload?.jobId) {
        jobId = payload.jobId
        if (payload.progress) onProgress?.(payload.progress)
        currentPath = `/api/collect/jobs/${encodeURIComponent(payload.jobId)}`
        await new Promise((resolve) => window.setTimeout(resolve, 1200))
        continue
      }
      if (polling && response.status === 404 && !restarted) {
        // A server restart discards in-memory jobs; retry the original request once.
        restarted = true
        currentPath = path
        continue
      }
      if (polling && payload?.status === 'failed') throw new Error(payload.error || `采集任务失败（HTTP ${payload.sourceStatus || 500}）`)
      if (!response.ok) throw new Error(payload?.error || `请求失败（HTTP ${response.status}）`)
      jobId = null
      return payload
    }
  } catch (error) {
    if (externalSignal?.aborted) throw new DOMException('本次会话已结束', 'AbortError')
    if (controller.signal.aborted || error?.name === 'AbortError') throw new Error(`接口响应超过 ${Math.round(timeoutMs / 1000)} 秒，请稍后重试`)
    throw error
  } finally {
    if (jobId) void fetch(`/api/collect/release?${new URLSearchParams({ client, job: jobId })}`, { method: 'POST', keepalive: true }).catch(() => undefined)
    window.clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', onAbort)
  }
}

export function searchDramas(query, options = {}) {
  return request(`/api/dramas/search?q=${encodeURIComponent(query)}`, { timeoutMs: 45000, ...options })
}

export function getDramaDetails(result, { timeoutMs = 12000, signal } = {}) {
  const params = new URLSearchParams({ provider: result.provider || 'catalog' })
  if (result.provider === 'catalog') params.set('title', result.title)
  return request(`/api/dramas/${result.providerId}?${params}`, { timeoutMs, signal })
}

export function recommendDramas(project, options = {}) {
  const params = new URLSearchParams({
    premiere: project.premiered || '',
    excludeTitle: project.title || '',
    excludePremiered: project.premiered || '',
    excludeYear: project.year ? String(project.year) : '',
  })
  if (project.provider === 'tvmaze') params.set('excludeId', String(project.providerId))
  return request(`/api/dramas/recommend?${params}`, { timeoutMs: 60000, ...options })
}

export function collectCross(project, { skipMaoyan = false, skipGuduo = false, signal, clientId } = {}) {
  return request('/api/collect/cross', {
    // 跨来源采集会等待浏览器队列；12 秒只覆盖 HTTP 直连源，无法覆盖猫眼/骨朵页面解析。
    timeoutMs: 600_000,
    signal,
    clientId,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: project.title,
      officialSite: project.officialSite,
      sourceUrl: project.sourceUrl,
      seriesId: project.maoyanSeriesId,
      skipMaoyan,
      skipGuduo,
    }),
  })
}

export function collectGuduoHistory(project, from, to, { hadData = false, emptyStreak = 0, signal, clientId } = {}) {
  return request(`/api/collect/guduo-history?${new URLSearchParams({ title: project.title, from, to, hadData: hadData ? '1' : '0', emptyStreak: String(emptyStreak) })}`, { timeoutMs: 600_000, signal, clientId })
}

function addIsoDays(isoDate, amount) {
  const date = new Date(`${isoDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function isoDates(from, to) {
  const dates = []
  const isCalendarDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
    const parsed = new Date(`${value}T12:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }
  if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) return dates
  for (let date = from; date <= to; date = addIsoDays(date, 1)) dates.push(date)
  return dates
}

export function kyHistoryTimeoutMs(from, to) {
  const expectedDays = isoDates(from, to).length
  if (!expectedDays) return 600_000
  return Math.min(43_200_000, 600_000 + expectedDays * 5_000)
}

export function collectKyHistory(project, from, to, onProgress, options = {}) {
  const timeoutMs = kyHistoryTimeoutMs(from, to)
  return request(`/api/collect/ky-history?${new URLSearchParams({ title: project.title, from, to })}`, { timeoutMs, onProgress, ...options })
}

export function collectMaoyanHistory(project, options = {}) {
  const params = new URLSearchParams({ title: project.title })
  if (project.premiered && /^\d{4}-\d{2}-\d{2}$/.test(project.premiered)) params.set('from', project.premiered)
  // 每次请求都明确要求读取到今天；源站若已停止更新，响应会保留实际最新日期供页面说明。
  params.set('to', new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()))
  if (project.sourceUrl) params.set('sourceUrl', project.sourceUrl)
  if (project.maoyanSeriesId) params.set('seriesId', String(project.maoyanSeriesId))
  // 猫眼历史会触发浏览器型采集，允许后端完成排队和页面解析。
  return request(`/api/collect/maoyan-history?${params}`, { timeoutMs: 600_000, ...options })
}

export function collectMaoyanMetric(project, metric, options = {}) {
  const params = new URLSearchParams({ metric, title: project.title })
  if (project.premiered && /^\d{4}-\d{2}-\d{2}$/.test(project.premiered)) params.set('from', project.premiered)
  params.set('to', new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()))
  if (project.sourceUrl) params.set('sourceUrl', project.sourceUrl)
  if (project.maoyanSeriesId) params.set('seriesId', String(project.maoyanSeriesId))
  // 平台表现/有效播放需要逐一切换猫眼平台页签，响应时间明显高于普通接口。
  return request(`/api/collect/maoyan-metric?${params}`, { timeoutMs: 600_000, ...options })
}

export function collectKy(project) {
  return request(`/api/collect/ky?${new URLSearchParams({ title: project.title })}`, { timeoutMs: 180_000 })
}

export function collectTvRatings(project, options = {}) {
  const params = new URLSearchParams({ title: project.title })
  if (project.maoyanSeriesId) params.set('seriesId', String(project.maoyanSeriesId))
  if (project.primaryIdentitySource?.url) params.set('sourceUrl', project.primaryIdentitySource.url)
  if (project.premiered && /^\d{4}-\d{2}-\d{2}$/.test(project.premiered)) params.set('from', project.premiered)
  params.set('to', new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()))
  // 猫眼 tvinfo 需要等待独立采集器连续读取并核验公开页面，耗时可能超过普通接口的 12 秒。
  // 超时会让有效的逐日记录无法写入 tvRatings，页面和 Rawdata 都会表现为空。
  return request(`/api/collect/tv-ratings?${params}`, { timeoutMs: 600_000, ...options })
}

// Each mounted comparison owns its HTTP subscriptions. Aborting it releases only
// its requests/jobs; another tab's subscriber keeps the shared source job alive.
export function createDramaApiSession() {
  const controller = new AbortController()
  const { signal } = controller
  const clientId = globalThis.crypto.randomUUID()
  let hasCollection = false
  const release = () => {
    if (!hasCollection) return
    const url = `/api/collect/release?client=${clientId}`
    if (!globalThis.navigator?.sendBeacon?.(url, '')) void fetch(url, { method: 'POST', keepalive: true }).catch(() => undefined)
  }
  const close = () => {
    if (signal.aborted) return
    controller.abort()
    release()
    window.removeEventListener?.('pagehide', close)
  }
  window.addEventListener?.('pagehide', close)
  const collection = (run) => {
    if (signal.aborted) return Promise.reject(new DOMException('本次会话已结束', 'AbortError'))
    hasCollection = true
    return run({ signal, clientId })
  }
  return {
    abort: close,
    get aborted() { return signal.aborted },
    searchDramas: (query) => searchDramas(query, { signal }),
    getDramaDetails: (item, options) => getDramaDetails(item, { ...options, signal }),
    recommendDramas: (item) => recommendDramas(item, { signal }),
    collectCross: (item, options) => collection((scope) => collectCross(item, { ...options, ...scope })),
    collectGuduoHistory: (item, from, to, options) => collection((scope) => collectGuduoHistory(item, from, to, { ...options, ...scope })),
    collectKyHistory: (item, from, to, progress) => collection((scope) => collectKyHistory(item, from, to, progress, scope)),
    collectMaoyanHistory: (item) => collection((scope) => collectMaoyanHistory(item, scope)),
    collectMaoyanMetric: (item, metric) => collection((scope) => collectMaoyanMetric(item, metric, scope)),
    readTvRatings: (item) => collection((scope) => collectTvRatings(item, scope)),
  }
}

export function collectorHealth() {
  return request('/api/collector/health')
}
