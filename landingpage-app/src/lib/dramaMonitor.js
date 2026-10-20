import { DASHBOARD_SESSION_KEY } from './dashboardSession.js'

export const STORAGE_KEY = 'drama-signal-web-projects-v1'

export function resetBusinessStorage() {
  // Never clear the entire origin: stats authentication and visitor IDs survive.
  for (const name of ['localStorage', 'sessionStorage']) {
    for (const key of [STORAGE_KEY, DASHBOARD_SESSION_KEY]) {
      try { window[name]?.removeItem(key) } catch { /* In-memory reset remains available. */ }
    }
  }
}

export function isConfirmedNoDataDate(verification, date, metric, platform = '', field = '') {
  if (!verification || (verification.failedDates || []).some((item) => (typeof item === 'string' ? item : item?.date) === date)) return false
  return (verification.noDataDates || []).includes(date)
    || (verification.noDataByMetric?.[platform ? `${metric}:${platform}` : metric] || []).includes(date)
    || Boolean(field && (verification.noDataFields || []).some((item) => item.date === date && item.field === field && platformDisplayName(item.platform || '') === platform))
}

export function kyHistoryWindow(premiere, to) {
  const date = new Date(`${to}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 29)
  const cutoff = date.toISOString().slice(0, 10)
  return { from: premiere > cutoff ? premiere : cutoff, to }
}
export const MAX_COMPARABLE_COMPETITORS = 4
export const DAILY_HISTORY_VERIFICATION_VERSION = 1

const REVIEWED_DISTRIBUTIONS = {
  甄嬛传: {
    firstRelease: 'tv-first',
    primaryDimension: 'tv',
    platformAvailability: 'not-applicable',
    maoyanCoverage: 'unavailable',
    note: '按台端首播项目管理。后续出现的平台节目页不改变首播端口径。',
    sourceName: '已确认的首播端业务口径',
    sourceUrl: null,
  },
  伪装者: {
    firstRelease: 'tv-first',
    primaryDimension: 'tv',
    platformAvailability: 'multi-platform',
    maoyanCoverage: 'unavailable',
    note: '台端首播，当前存在多平台节目页热度。平台热度只表示当前表现。',
    sourceName: 'TVmaze 首播电视台字段 + 当前平台节目页',
    sourceUrl: 'https://www.tvmaze.com/shows/12616/the-disguiser',
  },
}

export function normalizeTitle(value = '') {
  return String(value).normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, '')
}

export function todayInShanghai(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const byType = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${byType.year}-${byType.month}-${byType.day}`
}

function addIsoDays(value, days) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function isCalendarIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function guduoHistoryResumeFrom(premiere, historyEnd, previous, needsRankBackfill = false) {
  if (previous?.complete === true && previous.scannedFrom === premiere && previous.scannedThrough >= historyEnd && !needsRankBackfill) return null
  if (previous?.scannedFrom === premiere && /^\d{4}-\d{2}-\d{2}$/.test(previous?.resumeFrom || '') && previous.resumeFrom >= premiere && previous.resumeFrom <= historyEnd) return previous.resumeFrom
  if (!needsRankBackfill && previous?.complete === true && previous.scannedFrom === premiere && previous.scannedThrough >= premiere && previous.scannedThrough < historyEnd) {
    return addIsoDays(previous.scannedThrough, 1)
  }
  return premiere
}

export function sourceHistoryRefreshNeeds({ premiere, historyEnd, today, guduoSync, kySync, hasGuduoData, hasGuduoRank, force = false }) {
  const firstDay = premiere || guduoSync?.scannedFrom || ''
  const needsRankBackfill = hasGuduoData && !hasGuduoRank && guduoSync?.rankAvailable !== false
  return {
    guduo: force || guduoSync?.verification?.version !== DAILY_HISTORY_VERIFICATION_VERSION
      || guduoHistoryResumeFrom(firstDay, historyEnd, guduoSync, needsRankBackfill) !== null,
    ky: force || kySync?.verification?.version !== DAILY_HISTORY_VERIFICATION_VERSION
      || kySync?.verification?.from !== premiere
      || kySync?.verification?.to !== historyEnd
      || kySync?.state === 'error' || !kySync?.fetchedAt || shanghaiDate(kySync.fetchedAt) !== today,
  }
}

export function guduoHistoryPageRanges(from, to, pageDays = 7) {
  if (!isCalendarIsoDate(from) || !isCalendarIsoDate(to) || from > to || !Number.isInteger(pageDays) || pageDays < 1) return []
  const pages = []
  let cursor = from
  while (cursor <= to) {
    const lastInPage = addIsoDays(cursor, pageDays - 1)
    const end = lastInPage < to ? lastInPage : to
    pages.push({ from: cursor, to: end })
    cursor = addIsoDays(end, 1)
  }
  return pages
}

function shanghaiDate(value) {
  if (!value) return ''
  try {
    return todayInShanghai(new Date(value))
  } catch {
    return ''
  }
}

export function distributionProfile(title, platforms = [], sourceUrl = null) {
  const exactTitle = Object.keys(REVIEWED_DISTRIBUTIONS).find((name) => normalizeTitle(title).includes(normalizeTitle(name)))
  if (exactTitle) return { ...REVIEWED_DISTRIBUTIONS[exactTitle] }

  const hasWeb = platforms.some((platform) => platform?.dimension === 'web')
  const hasTv = platforms.some((platform) => platform?.dimension === 'tv')
  if (hasWeb && hasTv) {
    return {
      firstRelease: 'simulcast',
      primaryDimension: null,
      platformAvailability: 'unknown',
      maoyanCoverage: 'unknown',
      note: '目录同时记录台端和网端，可分别查看两类指标。',
      sourceName: '目录播出端字段',
      sourceUrl,
    }
  }
  if (hasTv) {
    return {
      firstRelease: 'tv-first',
      primaryDimension: 'tv',
      platformAvailability: 'unknown',
      maoyanCoverage: 'unknown',
      note: '目录仅确认台端播出，网端声量是否适用需有对应公开节目页。',
      sourceName: '目录播出端字段',
      sourceUrl,
    }
  }
  if (hasWeb) {
    return {
      firstRelease: 'web-first',
      primaryDimension: 'web',
      platformAvailability: platforms.filter((platform) => platform?.dimension === 'web').length > 1 ? 'multi-platform' : 'single-platform',
      maoyanCoverage: 'unknown',
      note: '目录确认网端播出，公开页面确有展示值时才采集平台热度。',
      sourceName: '目录播出端字段',
      sourceUrl,
    }
  }
  return {
    firstRelease: 'unknown',
    primaryDimension: null,
    platformAvailability: 'unknown',
    maoyanCoverage: 'unknown',
    note: '首播端尚未得到可复核来源，确认前不自动加入竞品横向对比。',
    sourceName: '目录数据待补充',
    sourceUrl,
  }
}

export function hasDimension(project, dimension) {
  if (!project) return false
  if (dimension === 'tv' && (project.platforms || []).some((platform) => platform?.dimension === 'tv' && platform?.verified === true)) return true
  const profile = project.distribution
  if (profile?.firstRelease === 'tv-first') return dimension === 'tv'
  if (profile?.firstRelease === 'web-first') return dimension === 'web'
  return (project.platforms || []).some((platform) => platform?.dimension === dimension)
}

export function withVerifiedTvAvailability(project, evidence = []) {
  if (!project || !Array.isArray(evidence) || evidence.length === 0) return project
  const platforms = Array.isArray(project.platforms) ? project.platforms : []
  if (platforms.some((platform) => platform?.dimension === 'tv' && platform?.verified === true)) return project
  return { ...project, platforms: [...platforms, { name: '台端', dimension: 'tv', verified: true }] }
}

export function sharedDimensions(a, b) {
  return ['web', 'tv'].filter((dimension) => hasDimension(a, dimension) && hasDimension(b, dimension))
}

export function sameDramaIdentity(a, b) {
  if (!a || !b) return false
  const providerA = a.provider && a.providerId !== null && a.providerId !== undefined ? `${a.provider}:${a.providerId}` : ''
  const providerB = b.provider && b.providerId !== null && b.providerId !== undefined ? `${b.provider}:${b.providerId}` : ''
  if (providerA && providerB && providerA === providerB) return true
  const maoyanIdA = Number(a.maoyanSeriesId || 0)
  const maoyanIdB = Number(b.maoyanSeriesId || 0)
  if (maoyanIdA > 0 && maoyanIdB > 0) return maoyanIdA === maoyanIdB
  if (!normalizeTitle(a.title) || normalizeTitle(a.title) !== normalizeTitle(b.title)) return false
  if (a.premiered && b.premiered) return a.premiered === b.premiered
  const yearA = a.year || (a.premiered ? Number(String(a.premiered).slice(0, 4)) : null)
  const yearB = b.year || (b.premiered ? Number(String(b.premiered).slice(0, 4)) : null)
  return yearA !== null && yearA !== undefined && yearB !== null && yearB !== undefined && Number(yearA) === Number(yearB)
}

export function shouldRefreshMaoyanHistory(existingExposureDays, historyFetchedAt, today = todayInShanghai(), force = false) {
  if (force) return true
  if (!existingExposureDays || !historyFetchedAt) return true
  return shanghaiDate(historyFetchedAt) !== today
}

export function shouldAutoCollectTvRatings(existingRows, fetchedAt, today = todayInShanghai(), isCollecting = false, attemptedToday = false, syncState) {
  if (isCollecting || attemptedToday) return false
  const fetchedToday = fetchedAt ? shanghaiDate(fetchedAt) === today : false
  return !fetchedToday || syncState === 'error' || syncState === 'loading' || syncState === 'partial'
}

export function mergeMetricHistory(existing = [], incoming = []) {
  const byDate = new Map(existing.filter((record) => record?.date).map((record) => [record.date, record]))
  for (const next of incoming) {
    if (!next?.date) continue
    const previous = byDate.get(next.date)
    const values = { ...(previous?.values || {}) }
    const metricSources = { ...(previous?.metricSources || {}) }
    for (const [metric, value] of Object.entries(next.values || {})) {
      if (value !== null && value !== undefined && Number.isFinite(Number(value))) {
        values[metric] = Number(value)
        const sourceUrl = next.metricSources?.[metric] || next.sourceUrl || metricSources[metric]
        if (sourceUrl) metricSources[metric] = sourceUrl
      }
    }
    byDate.set(next.date, { ...previous, ...next, values, metricSources })
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function isoDatesInRange(from, to) {
  if (!isCalendarIsoDate(from) || !isCalendarIsoDate(to) || from > to) return []
  const dates = []
  const cursor = new Date(`${from}T12:00:00Z`)
  const end = new Date(`${to}T12:00:00Z`)
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

export function replaceVerifiedSourceHistory(existing = [], incoming = [], { from, to, metrics = [], unresolvedDates = [] } = {}) {
  const byDate = new Map((existing || []).filter((record) => record?.date).map((record) => [record.date, record]))
  const metricSet = new Set(metrics)
  const unresolved = new Set(unresolvedDates)
  for (const date of isoDatesInRange(from, to)) {
    if (unresolved.has(date)) continue
    const previous = byDate.get(date) || { date, values: {} }
    const values = { ...(previous.values || {}) }
    const metricSources = { ...(previous.metricSources || {}) }
    for (const metric of metricSet) {
      delete values[metric]
      delete metricSources[metric]
    }
    byDate.set(date, { ...previous, values, metricSources })
  }
  for (const next of incoming || []) {
    if (!next?.date) continue
    const previous = byDate.get(next.date) || { date: next.date, values: {} }
    const values = { ...(previous.values || {}) }
    const metricSources = { ...(previous.metricSources || {}) }
    for (const [metric, value] of Object.entries(next.values || {})) {
      if (!metricSet.has(metric) || value === null || value === undefined || !Number.isFinite(Number(value))) continue
      values[metric] = Number(value)
      const sourceUrl = next.metricSources?.[metric] || next.sourceUrl || metricSources[metric]
      if (sourceUrl) metricSources[metric] = sourceUrl
    }
    byDate.set(next.date, { ...previous, ...next, values, metricSources })
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function parseChineseCount(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (raw === null || raw === undefined) return null
  const value = String(raw).replace(/,/g, '').trim()
  if (!value || value === '--' || value === '暂无' || value === '-') return null
  const match = value.match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const number = Number(match[0])
  if (!Number.isFinite(number)) return null
  if (/亿/.test(value)) return number * 100000000
  if (/万/.test(value)) return number * 10000
  return number
}

export function platformDisplayName(value = '') {
  const key = String(value).toLowerCase()
  if (/youku|优酷/.test(key)) return '优酷'
  if (/iqiyi|爱奇艺/.test(key)) return '爱奇艺'
  if (/tencent|腾讯/.test(key)) return '腾讯视频'
  if (/mango|芒果/.test(key)) return '芒果TV'
  return String(value || '')
}

export function tvCollectionStatus(rowCount, skippedChannels = []) {
  const skipped = [...new Set((Array.isArray(skippedChannels) ? skippedChannels : []).filter(Boolean))]
  const count = Math.max(0, Number(rowCount) || 0)
  const warning = skipped.length ? `；${skipped.length} 个频道读取失败：${skipped.join('、')}` : ''
  if (!count && !skipped.length) return { state: 'empty', message: '猫眼 tvinfo 当前未公布该剧的频道逐日收视记录', skippedChannels: [] }
  return {
    state: skipped.length ? 'partial' : 'success',
    message: `${count ? `已读取 ${count} 条分频道收视明细` : '没有拿到可用频道数据'}${warning}`,
    skippedChannels: skipped,
  }
}

export function dedupeTvRecords(rows = []) {
  const byIdentity = new Map()
  for (const row of rows) {
    if (!row?.date || !row?.channel) continue
    const channel = row.platform || row.channel
    const key = [row.date, channel, row.slot || '', row.episodes || ''].join('|')
    const previous = byIdentity.get(key)
    byIdentity.set(key, previous ? {
      ...previous,
      ...row,
      csmCityRating: row.csmCityRating ?? previous.csmCityRating ?? null,
      csmCityShare: row.csmCityShare ?? previous.csmCityShare ?? null,
      csmCityRank: row.csmCityRank ?? previous.csmCityRank ?? null,
      nationalRating: row.nationalRating ?? previous.nationalRating ?? null,
      nationalShare: row.nationalShare ?? previous.nationalShare ?? null,
      nationalRank: row.nationalRank ?? previous.nationalRank ?? null,
    } : {
      ...row,
      csmCityRating: row.csmCityRating ?? null,
      csmCityShare: row.csmCityShare ?? null,
      csmCityRank: row.csmCityRank ?? null,
      nationalRating: row.nationalRating ?? null,
      nationalShare: row.nationalShare ?? null,
      nationalRank: row.nationalRank ?? null,
    })
  }
  return [...byIdentity.values()].sort((a, b) => a.date.localeCompare(b.date) || String(a.platform || a.channel).localeCompare(String(b.platform || b.channel)) || String(a.slot || '').localeCompare(String(b.slot || '')))
}

export function createEmptyState() {
  return {
    version: 1,
    projects: [],
    selectedId: null,
    competitors: {},
    liveHeat: {},
    collection: {},
    tvRatings: {},
    sourceSync: {},
    logs: [],
  }
}

export function normalizeProject(project) {
  if (!project?.id || !project?.title) return null
  const platforms = Array.isArray(project.platforms) ? project.platforms.filter(Boolean) : []
  const sourceUrl = project.sourceUrl || project.primaryIdentitySource?.url || ''
  return {
    ...project,
    platforms,
    cast: Array.isArray(project.cast) ? project.cast : [],
    directors: Array.isArray(project.directors) ? project.directors : [],
    creators: Array.isArray(project.creators) ? project.creators : [],
    genres: Array.isArray(project.genres) ? project.genres : [],
    distribution: project.distribution || distributionProfile(project.title, platforms, sourceUrl),
    createdAt: project.createdAt || new Date().toISOString(),
    fetchedAt: project.fetchedAt || new Date().toISOString(),
  }
}

export function safeReadState() {
  try {
    try { window.localStorage?.removeItem(STORAGE_KEY) } catch { /* Session storage remains usable. */ }
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return createEmptyState()
    const saved = JSON.parse(raw)
    if (!saved || !Array.isArray(saved.projects)) return createEmptyState()
    const enrich = (project) => withVerifiedTvAvailability(normalizeProject(project), saved.tvRatings?.[project?.id])
    const projects = saved.projects.map(enrich).filter(Boolean)
    const competitors = saved.competitors && typeof saved.competitors === 'object'
      ? Object.fromEntries(Object.entries(saved.competitors).map(([ownerId, pool]) => [ownerId, Array.isArray(pool) ? pool.map(enrich).filter(Boolean) : []]))
      : {}
    const selectedId = projects.some((project) => project.id === saved.selectedId) ? saved.selectedId : projects[0]?.id || null
    return {
      ...createEmptyState(),
      ...saved,
      projects,
      selectedId,
      competitors,
      liveHeat: saved.liveHeat && typeof saved.liveHeat === 'object' ? saved.liveHeat : {},
      collection: saved.collection && typeof saved.collection === 'object' ? saved.collection : {},
      tvRatings: saved.tvRatings && typeof saved.tvRatings === 'object' ? saved.tvRatings : {},
      sourceSync: saved.sourceSync && typeof saved.sourceSync === 'object' ? saved.sourceSync : {},
      logs: Array.isArray(saved.logs) ? saved.logs.slice(0, 80) : [],
    }
  } catch {
    return createEmptyState()
  }
}

export function writeState(state) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: 1 }))
    return true
  } catch {
    return false
  }
}

export function makeProject(details) {
  const sourceUrl = details?.sourceUrl || details?.primaryIdentitySource?.url || ''
  const platforms = Array.isArray(details?.platforms) ? details.platforms : []
  return normalizeProject({
    ...details,
    id: details?.id || `${details?.provider || 'catalog'}-${details?.providerId || normalizeTitle(details?.title)}`,
    createdAt: details?.createdAt || new Date().toISOString(),
    fetchedAt: details?.fetchedAt || new Date().toISOString(),
    distribution: details?.distribution || distributionProfile(details?.title, platforms, sourceUrl),
  })
}

export function appendLog(state, source, message, level = 'info') {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    source,
    message,
    level,
  }
  return { ...state, logs: [entry, ...(state.logs || [])].slice(0, 80) }
}

export function metricValue(record, metric) {
  if (!record?.values) return null
  const aliases = metric === '猫眼热度'
    ? ['猫眼热度', '猫眼实时热度', '当前热度值', '猫眼网播热度']
    : metric === '骨朵热度排名'
      ? ['骨朵热度排名', '骨朵排名', '骨朵榜内排名']
      : [metric]
  for (const key of aliases) {
    const value = parseChineseCount(record.values[key])
    if (value !== null) return value
  }
  return null
}

export function formatMetric(value, digits = 1) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  const compact = (divisor, suffix) => `${(number / divisor).toLocaleString('zh-CN', { maximumFractionDigits: digits })}${suffix}`
  if (Math.abs(number) >= 100000000) return compact(100000000, '亿')
  if (Math.abs(number) >= 10000) return compact(10000, '万')
  return number.toLocaleString('zh-CN', { maximumFractionDigits: digits })
}

export function formatSourceMetric(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  const truncated = Math.trunc(number * 100) / 100
  return truncated.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function sourceStatusClass(sourceSync) {
  if (sourceSync?.state === 'error') return 'is-error'
  if (sourceSync?.state === 'loading') return 'is-loading'
  if (sourceSync?.state === 'partial') return 'is-partial'
  return 'is-ready'
}

export function combinedSourceStatus(metrics = [], problems = [], notices = [], informationalNotices = []) {
  if (metrics.length && (problems.length || notices.length)) return 'partial'
  if (metrics.length) return 'success'
  if (problems.length) return 'error'
  if (notices.length) return 'empty'
  if (informationalNotices.length) return 'success'
  return 'error'
}
