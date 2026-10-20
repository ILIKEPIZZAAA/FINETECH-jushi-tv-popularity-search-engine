import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { AsyncLocalStorage } from 'node:async_hooks'
import { consolidateSearchResults } from '../src/lib/searchResults.js'
const requestContext = new AsyncLocalStorage()

const COLLECTOR = process.env.DRAMA_COLLECTOR_URL?.trim() || 'http://127.0.0.1:8890'
const KY_COLLECTOR = process.env.DRAMA_KY_COLLECTOR_URL?.trim() || COLLECTOR
const TVMAZE = 'https://api.tvmaze.com'
const DOUBAN_SEARCH = 'https://m.douban.com/rexxar/api/v2/search'
const USER_AGENT = 'FINETECH Drama Monitor/1.0 (local research tool)'

const DOMESTIC_ENTRIES = [{
  provider: 'domestic',
  providerId: 20260816,
  title: '我们的少年时代2',
  originalTitle: '我们的少年时代第二部',
  aliases: ['我们的少年时代2', '我们的少年时代第二部', '我们的少年时代'],
  year: 2026,
  premiered: '2026-08-16',
  ended: null,
  status: 'Running',
  language: 'Chinese',
  country: '中国大陆',
  platforms: [{ name: 'Mango TV', dimension: 'web' }, { name: 'Hunan TV', dimension: 'tv' }],
  poster: null,
  score: 1,
  sourceUrl: 'https://weibo.com/2/detail/5332483212314809',
  officialSite: null,
  cast: [],
  directors: ['李南'],
  creators: [],
  finaleDate: null,
  episodeCount: 0,
  genres: ['剧情'],
  summary: '',
  primaryIdentitySource: { name: '湖南卫视官方微博', url: 'https://weibo.com/2/detail/5332483212314809', note: '用于区分 2026 年续作与 2017 年前作。' },
}]

const REVIEWED_DISTRIBUTIONS = {
  甄嬛传: {
    firstRelease: 'tv-first', primaryDimension: 'tv', platformAvailability: 'not-applicable', maoyanCoverage: 'unavailable',
    note: '按台端首播项目管理。后续出现的平台节目页不改变首播端口径。', sourceName: '已确认的首播端业务口径', sourceUrl: null,
  },
  伪装者: {
    firstRelease: 'tv-first', primaryDimension: 'tv', platformAvailability: 'multi-platform', maoyanCoverage: 'unavailable',
    note: '台端首播，当前存在多平台节目页热度。平台热度只表示当前表现。', sourceName: 'TVmaze 首播电视台字段 + 当前平台节目页', sourceUrl: 'https://www.tvmaze.com/shows/12616/the-disguiser',
  },
}

const REVIEWED_IDENTITY_SOURCES = {
  逐玉: [
    { id: 'baidu-zhuyu', name: '百度百科', url: 'https://baike.baidu.com/item/%E9%80%90%E7%8E%89/64922142', status: 'matched', cast: ['张凌赫', '田曦薇', '孔雪儿', '邓凯', '李卿', '喻钟黎', '任豪', '刘琳', '严屹宽', '岳旸'], directors: ['曾庆杰'], note: '已核对剧集条目中的导演、主演与首播信息；作为国内剧身份辅助来源。' },
    { id: 'iqiyi-zhuyu', name: '爱奇艺官方节目页', url: 'https://www.iq.com/play/%E9%80%90%E7%8E%89-1av9svywo6w?lang=zh_cn', status: 'matched', cast: ['张凌赫', '田曦薇', '孔雪儿', '邓凯', '李卿', '喻钟黎', '任豪', '刘琳'], directors: [], note: '官方节目页用于交叉核对主要演员。' },
  ],
  藏锋: [
    { id: 'maoyan-zangfeng', name: '猫眼专业版', url: 'https://piaofang.maoyan.com/i/tv-datainfo/1525943/maoyan?barTheme=592828', status: 'matched', cast: [], directors: [], note: '用户提供的猫眼剧集详情页，作为热度与身份辅助来源。' },
  ],
  早春晴朗: [
    { id: 'cnsa-early-spring', name: '中国网络视听节目服务协会', url: 'https://www.cnsa.cn/art/2026/8/27/art_1989_49244.html', status: 'matched', cast: ['井柏然', '孙千'], directors: ['蒋继正'], note: '行业协会定档文章列明导演和领衔主演。' },
    { id: 'official-weibo-early-spring', name: '《早春晴朗》官方微博', url: 'https://weibo.com/8019620761/Q37WYjloG', status: 'matched', cast: [], directors: ['蒋继正'], note: '剧集官方微博官宣信息列明导演。' },
    { id: 'netflix-early-spring', name: 'Netflix 官方节目页', url: 'https://www.netflix.com/sg-zh/title/83067197', status: 'matched', cast: ['井柏然', '孙千'], directors: [], note: '官方发行节目页列明主演。' },
  ],
}

function json(status, payload) {
  return { status, payload }
}

function error(status, message) {
  return json(status, { error: message })
}

function normalize(value = '') {
  return String(value).normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, '')
}

function todayInShanghai(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value)
  const fields = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${fields.year}-${fields.month}-${fields.day}`
}

function dateOffset(value, offset) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))]
}

function stripHtml(value = '') {
  return String(value).replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function parseChineseCount(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (raw === null || raw === undefined) return null
  const value = String(raw).replace(/,/g, '').trim()
  const matched = value.match(/-?\d+(?:\.\d+)?/)
  if (!matched) return null
  const number = Number(matched[0])
  if (!Number.isFinite(number)) return null
  if (/亿/.test(value)) return number * 100000000
  if (/万/.test(value)) return number * 10000
  return number
}

function distributionProfile(title, platforms = [], sourceUrl = null) {
  const reviewed = Object.keys(REVIEWED_DISTRIBUTIONS).find((name) => normalize(title).includes(normalize(name)))
  if (reviewed) return { ...REVIEWED_DISTRIBUTIONS[reviewed] }
  const hasWeb = platforms.some((platform) => platform?.dimension === 'web')
  const hasTv = platforms.some((platform) => platform?.dimension === 'tv')
  if (hasWeb && hasTv) return { firstRelease: 'simulcast', primaryDimension: null, platformAvailability: 'unknown', maoyanCoverage: 'unknown', note: '目录同时记录台端和网端，可分别查看两类指标。', sourceName: '目录播出端字段', sourceUrl }
  if (hasTv) return { firstRelease: 'tv-first', primaryDimension: 'tv', platformAvailability: 'unknown', maoyanCoverage: 'unknown', note: '目录仅确认台端播出，网端声量是否适用需有对应公开节目页。', sourceName: '目录播出端字段', sourceUrl }
  if (hasWeb) return { firstRelease: 'web-first', primaryDimension: 'web', platformAvailability: platforms.filter((platform) => platform?.dimension === 'web').length > 1 ? 'multi-platform' : 'single-platform', maoyanCoverage: 'unknown', note: '目录确认网端播出，公开页面确有展示值时才采集平台热度。', sourceName: '目录播出端字段', sourceUrl }
  return { firstRelease: 'unknown', primaryDimension: null, platformAvailability: 'unknown', maoyanCoverage: 'unknown', note: '首播端尚未得到可复核来源，确认前不自动加入竞品横向对比。', sourceName: '目录数据待补充', sourceUrl }
}

function sameDramaIdentity(a, b) {
  if (!a || !b) return false
  const providerA = a.provider && a.providerId !== null && a.providerId !== undefined ? `${a.provider}:${a.providerId}` : ''
  const providerB = b.provider && b.providerId !== null && b.providerId !== undefined ? `${b.provider}:${b.providerId}` : ''
  if (providerA && providerB && providerA === providerB) return true
  const maoyanIdA = Number(a.maoyanSeriesId || 0)
  const maoyanIdB = Number(b.maoyanSeriesId || 0)
  if (maoyanIdA > 0 && maoyanIdB > 0) return maoyanIdA === maoyanIdB
  if (!normalize(a.title) || normalize(a.title) !== normalize(b.title)) return false
  if (a.premiered && b.premiered) return a.premiered === b.premiered
  const yearA = a.year || (a.premiered ? Number(String(a.premiered).slice(0, 4)) : null)
  const yearB = b.year || (b.premiered ? Number(String(b.premiered).slice(0, 4)) : null)
  return yearA !== null && yearA !== undefined && yearB !== null && yearB !== undefined && Number(yearA) === Number(yearB)
}

async function readRequestBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('请求 JSON 无法解析')
  }
}

async function fetchJson(url, { timeout = 10000, headers = {}, failure = '数据源请求失败' } = {}) {
  let response
  try {
    const parent = requestContext.getStore()?.signal
    response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers }, signal: parent ? AbortSignal.any([parent, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) })
  } catch (cause) {
    if (cause?.name === 'TimeoutError') throw new Error(`${failure}：请求超时`)
    throw new Error(`${failure}：${cause?.message || '网络不可用'}`)
  }
  const text = await response.text()
  const contentType = response.headers.get('content-type') || ''
  if (!response.ok || !contentType.includes('application/json')) {
    if (!response.ok && contentType.includes('application/json')) {
      try {
        const error = JSON.parse(text)?.error
        if (error) throw new Error(`${failure}：HTTP ${response.status} ${error}`)
      } catch (cause) {
        if (cause instanceof Error && cause.message.startsWith(`${failure}：HTTP`)) throw cause
      }
    }
    const preview = text.replace(/\s+/g, ' ').slice(0, 120)
    throw new Error(`${failure}：HTTP ${response.status}${preview ? ` ${preview}` : ''}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${failure}：JSON 无法解析`)
  }
}

async function collectorJson(path, { timeout = 60000, collector } = {}) {
  const base = collector || (/^\/(?:ky\/|progress\?key=ky:)/.test(path) ? KY_COLLECTOR : COLLECTOR)
  const url = new URL(path, base)
  const requestWithProtocol = url.protocol === 'https:' ? httpsRequest : httpRequest
  const parent = requestContext.getStore()?.signal
  const signal = parent ? AbortSignal.any([parent, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
  try {
    // Node's built-in fetch has a separate response-header deadline, which can
    // end a long browser scrape before our explicit collection timeout does.
    return await new Promise((resolve, reject) => {
      const request = requestWithProtocol(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal,
      }, (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('error', reject)
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const contentType = response.headers['content-type'] || ''
          let payload
          try { payload = JSON.parse(text) } catch { /* Preserve a useful HTTP error below. */ }
          if (response.statusCode !== 200) {
            reject(new Error(`独立采集服务不可用：HTTP ${response.statusCode}${payload?.error ? ` ${payload.error}` : ''}`))
            return
          }
          if (!contentType.includes('application/json') || payload === undefined) {
            reject(new Error('独立采集服务不可用：JSON 无法解析'))
            return
          }
          resolve(payload)
        })
      })
      request.on('error', reject)
      request.end()
    })
  } catch (cause) {
    const message = signal.aborted
      ? '独立采集服务不可用：请求超时'
      : cause?.message || '独立采集服务不可用'
    if (/：HTTP \d{3}/.test(message)) throw new Error(message.replace(/^独立采集服务不可用：/, '采集器返回错误：'))
    const detail = cause?.cause?.code || cause?.code
    throw new Error(`${message}${detail ? `（${detail}）` : ''}；请先启动 drama-heat-collector（默认 http://127.0.0.1:8890）`)
  }
}

function tvmazePlatforms(show) {
  const platforms = []
  if (show?.webChannel) platforms.push({ name: show.webChannel.name, dimension: 'web' })
  if (show?.network) platforms.push({ name: show.network.name, dimension: 'tv' })
  return platforms
}

function countryOf(show) {
  return show?.network?.country?.name || show?.webChannel?.country?.name || null
}

function trustworthyEnded(show) {
  if (!show?.ended) return null
  const startYear = show.premiered ? Number(show.premiered.slice(0, 4)) : null
  const endYear = Number(show.ended.slice(0, 4))
  return startYear && endYear - startYear > 2 ? null : show.ended
}

async function tvmazeJson(path, timeout = 12000) {
  return fetchJson(`${TVMAZE}${path}`, { timeout, failure: 'TVmaze 请求失败' })
}

async function tvmazeAkas(id) {
  try {
    return await tvmazeJson(`/shows/${id}/akas`, 10000)
  } catch {
    return []
  }
}

function pickTitle(show, akas = []) {
  const chinese = akas.find((aka) => aka?.country?.code === 'CN' || /[\u3400-\u9fff]/.test(aka?.name || ''))
  return chinese?.name || show?.name || ''
}

function toTvmazeSearchResult(show, score = 1, akas = []) {
  const title = pickTitle(show, akas)
  const platforms = tvmazePlatforms(show)
  const sourceUrl = show?.url || `https://www.tvmaze.com/shows/${show?.id || ''}`
  return {
    provider: 'tvmaze',
    providerId: show.id,
    title,
    originalTitle: show.name,
    year: show.premiered ? Number(show.premiered.slice(0, 4)) : null,
    premiered: show.premiered || null,
    ended: trustworthyEnded(show),
    status: trustworthyEnded(show) ? show.status : 'Ended',
    language: show.language || null,
    country: countryOf(show),
    platforms,
    poster: show.image?.medium || null,
    score: Number(score) || 0,
    sourceUrl,
    officialSite: show.officialSite || null,
    distribution: distributionProfile(title, platforms, sourceUrl),
  }
}

async function searchTvmaze(query) {
  const rows = await tvmazeJson(`/search/shows?q=${encodeURIComponent(query)}`)
  const top = Array.isArray(rows) ? rows.slice(0, 8) : []
  const akaLists = await Promise.all(top.map((item) => tvmazeAkas(item?.show?.id)))
  return top.filter((item) => item?.show?.id).map((item, index) => toTvmazeSearchResult(item.show, item.score, akaLists[index]))
}

async function getTvmazeDetails(id) {
  const [show, cast, crew, episodes, akas] = await Promise.all([
    tvmazeJson(`/shows/${id}`),
    tvmazeJson(`/shows/${id}/cast`).catch(() => []),
    tvmazeJson(`/shows/${id}/crew`).catch(() => []),
    tvmazeJson(`/shows/${id}/episodes`).catch(() => []),
    tvmazeAkas(id),
  ])
  const base = toTvmazeSearchResult(show, 1, akas)
  const episodeDates = (Array.isArray(episodes) ? episodes : []).map((episode) => episode?.airdate).filter(Boolean).sort()
  const directors = unique((Array.isArray(crew) ? crew : []).filter((credit) => /director/i.test(credit?.type || '')).map((credit) => credit.person?.name))
  const creators = unique((Array.isArray(crew) ? crew : []).filter((credit) => /creator|showrunner|executive producer/i.test(credit?.type || '')).map((credit) => credit.person?.name))
  const result = {
    ...base,
    poster: show.image?.original || show.image?.medium || null,
    cast: unique((Array.isArray(cast) ? cast : []).map((credit) => credit.person?.name)).slice(0, 8),
    directors,
    creators,
    finaleDate: show.ended || episodeDates.at(-1) || null,
    episodeCount: Array.isArray(episodes) ? episodes.length : 0,
    genres: Array.isArray(show.genres) ? show.genres : [],
    summary: stripHtml(show.summary),
    fetchedAt: new Date().toISOString(),
    primaryIdentitySource: { name: 'TVmaze', url: base.sourceUrl, note: '目录主字段来自 TVmaze；可用辅助来源只补充和核验字段。' },
  }
  result.identityVerification = await crossVerifyIdentity(result)
  return result
}

async function doubanJson(url) {
  return fetchJson(url, { timeout: 8000, failure: '豆瓣目录请求失败', headers: { Referer: 'https://m.douban.com/' } })
}

function doubanSearchTargets(payload) {
  return [
    ...(payload?.smart_box || []).filter((slot) => slot?.layout === 'subject' && slot?.target?.id != null).map((slot) => slot.target),
    ...(payload?.subjects?.items || []).filter((slot) => slot?.layout === 'subject' && slot?.target?.id != null).map((slot) => slot.target),
  ]
}

function toDoubanSearchResult(subject, query) {
  const id = Number(subject?.id)
  if (!Number.isInteger(id) || id <= 0) return null
  const title = String(subject?.title || '').trim()
  if (!title) return null
  const sourceUrl = subject?.url || `https://movie.douban.com/subject/${id}/`
  const subtitle = String(subject?.card_subtitle || subject?.abstract || '')
  const year = Number(subtitle.match(/(?:^|\s|\/)\(?((?:19|20)\d{2})\)?(?:\s|\/|$)/)?.[1] || '') || null
  const platforms = []
  return {
    provider: 'douban', providerId: id, title, originalTitle: title, year, premiered: null, ended: null,
    status: 'Unknown', language: null, country: subtitle.split('/').map((part) => part.trim()).find((part) => /中国|大陆|香港|台湾/.test(part)) || null,
    platforms, poster: subject?.cover_url || null, score: normalize(title) === normalize(query) ? 1 : 0.6, sourceUrl, officialSite: null,
    distribution: distributionProfile(title, platforms, sourceUrl),
  }
}

async function searchDouban(query) {
  const payload = await doubanJson(`${DOUBAN_SEARCH}?${new URLSearchParams({ q: query, count: '10' })}`)
  const seen = new Set()
  return doubanSearchTargets(payload).map((subject) => toDoubanSearchResult(subject, query)).filter((item) => {
    if (!item || seen.has(item.providerId)) return false
    seen.add(item.providerId)
    return true
  })
}

async function doubanDetailsPayload(id) {
  const endpoints = [`https://m.douban.com/rexxar/api/v2/tv/${id}`, `https://m.douban.com/rexxar/api/v2/movie/${id}`]
  let lastError
  for (const endpoint of endpoints) {
    try { return await doubanJson(endpoint) } catch (cause) { lastError = cause }
  }
  throw lastError || new Error('豆瓣详情不可用')
}

async function getDoubanDetails(id) {
  const detail = await doubanDetailsPayload(id)
  const title = detail?.title || ''
  const sourceUrl = detail?.url || `https://movie.douban.com/subject/${id}/`
  const platforms = Array.isArray(detail?.vendors) ? detail.vendors.filter((vendor) => vendor?.title).map((vendor) => ({ name: vendor.title, dimension: 'web' })) : []
  const premiered = Array.isArray(detail?.pubdate) ? detail.pubdate.find((date) => /^\d{4}-\d{2}-\d{2}/.test(date))?.slice(0, 10) || null : null
  const result = {
    provider: 'douban', providerId: id, title, originalTitle: title, year: Number(detail?.year) || (premiered ? Number(premiered.slice(0, 4)) : null),
    premiered, ended: null, status: 'Unknown', language: Array.isArray(detail?.languages) ? detail.languages[0] || null : null,
    country: Array.isArray(detail?.countries) ? detail.countries[0] || null : null, platforms,
    poster: detail?.cover_url || null, score: 1, sourceUrl, officialSite: null,
    cast: unique((detail?.actors || []).map((person) => person?.name)).slice(0, 8),
    directors: unique((detail?.directors || []).map((person) => person?.name)), creators: [], finaleDate: null,
    episodeCount: Number(detail?.episodes_count) || 0, genres: Array.isArray(detail?.genres) ? detail.genres : [], summary: detail?.intro || '',
    fetchedAt: new Date().toISOString(), distribution: distributionProfile(title, platforms, sourceUrl),
    primaryIdentitySource: { name: '豆瓣剧集目录', url: sourceUrl, note: '用于补足目录字段；网络可用时会保留来源记录。' },
  }
  result.identityVerification = await crossVerifyIdentity(result)
  return result
}

function searchDomestic(query) {
  const key = normalize(query)
  return DOMESTIC_ENTRIES.filter((entry) => entry.aliases.some((alias) => normalize(alias).includes(key) || key.includes(normalize(alias)))).map((entry) => {
    const { aliases, ...result } = entry
    return { ...result, distribution: distributionProfile(result.title, result.platforms, result.sourceUrl) }
  })
}

async function getDomesticDetails(id) {
  const entry = DOMESTIC_ENTRIES.find((item) => Number(item.providerId) === Number(id))
  if (!entry) throw new Error('本地多源目录未找到该剧')
  const { aliases, ...result } = entry
  const hydrated = { ...result, fetchedAt: new Date().toISOString(), distribution: distributionProfile(result.title, result.platforms, result.sourceUrl) }
  hydrated.identityVerification = await crossVerifyIdentity(hydrated)
  return hydrated
}

async function resolveCatalog(title) {
  const payload = await collectorJson(`/maoyan/resolve?title=${encodeURIComponent(title)}`, { timeout: 30000 })
  if (!payload?.resolved || !Number.isInteger(Number(payload.seriesId)) || Number(payload.seriesId) <= 0) return null
  const details = payload.details || {}
  const seriesId = Number(payload.seriesId)
  const resolvedTitle = details.title || payload.name || title
  const sourceUrl = details.detailUrl || payload.sourceUrl || `https://piaofang.maoyan.com/i/tv-datainfo/${seriesId}/maoyan?barTheme=424242`
  const platforms = Array.isArray(details.platforms) ? details.platforms : []
  return {
    provider: 'catalog', providerId: seriesId, maoyanSeriesId: seriesId, title: resolvedTitle, originalTitle: resolvedTitle,
    year: details.premiered ? Number(String(details.premiered).slice(0, 4)) : null, premiered: details.premiered || null, ended: null,
    status: 'Unknown', language: 'Chinese', country: '中国大陆', platforms, poster: details.poster || null, score: 0.7,
    sourceUrl, officialSite: sourceUrl, cast: Array.isArray(details.cast) ? details.cast : [], directors: Array.isArray(details.directors) ? details.directors : [],
    genres: Array.isArray(details.genres) ? details.genres : ['电视剧'], summary: details.summary || '来自猫眼官方 MDB 搜索与详情链接的身份记录',
    distribution: { ...distributionProfile(resolvedTitle, platforms, sourceUrl), maoyanCoverage: 'available' },
    primaryIdentitySource: { name: '猫眼官方 MDB 搜索', url: sourceUrl, note: `项目身份和猫眼 seriesId ${seriesId} 来自猫眼官方 MDB 搜索结果。` },
  }
}

async function getCatalogDetails(id, title) {
  if (!title) throw new Error('猫眼详情需要 title 参数，用于核验 seriesId')
  const result = await resolveCatalog(title)
  if (!result || Number(result.providerId) !== Number(id)) throw new Error('猫眼 ID 身份校验失败，当前项目不会写入不匹配数据')
  const hydrated = {
    ...result, creators: [], finaleDate: null, episodeCount: 0, fetchedAt: new Date().toISOString(),
  }
  try {
    const doubanMatches = await searchDouban(result.title)
    const match = doubanMatches.find((candidate) => normalize(candidate.title) === normalize(result.title) && (!result.year || candidate.year === result.year)) || doubanMatches[0]
    if (match) {
      const supplement = await getDoubanDetails(match.providerId)
      hydrated.cast = hydrated.cast.length ? hydrated.cast : supplement.cast
      hydrated.directors = hydrated.directors.length ? hydrated.directors : supplement.directors
      hydrated.premiered = hydrated.premiered || supplement.premiered
      hydrated.year = hydrated.year || supplement.year
      hydrated.episodeCount = supplement.episodeCount || 0
      hydrated.genres = hydrated.genres.length ? hydrated.genres : supplement.genres
      hydrated.summary = hydrated.summary || supplement.summary
      hydrated.poster = hydrated.poster || supplement.poster
      hydrated.platforms = hydrated.platforms.length ? hydrated.platforms : supplement.platforms
      hydrated.distribution = { ...hydrated.distribution, platformAvailability: hydrated.platforms.length > 1 ? 'multi-platform' : hydrated.platforms.length ? 'single-platform' : 'unknown' }
    }
  } catch {
    // Auxiliary enrichment does not invalidate the verified catalog identity.
  }
  hydrated.identityVerification = await crossVerifyIdentity(hydrated)
  return hydrated
}

function cleanWikiValue(value = '') {
  return String(value)
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<br\s*\/?>/gi, '、')
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/'{2,}/g, '')
    .trim()
}

function splitPeople(value = '') {
  return unique(cleanWikiValue(value)
    .split(/[、,，/／|｜;；]/)
    .map((item) => item.replace(/（[^）]*）|\([^)]*\)|领衔主演|特别主演|主演/g, '').trim())
    .filter((item) => item.length >= 2 && item.length <= 30))
}

function plainHtml(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
}

async function fetchText(url, { timeout = 10000, failure = '页面读取失败' } = {}) {
  let response
  try {
    response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: AbortSignal.timeout(timeout) })
  } catch (cause) {
    throw new Error(`${failure}：${cause?.name === 'TimeoutError' ? '请求超时' : cause?.message || '网络不可用'}`)
  }
  if (!response.ok) throw new Error(`${failure}：HTTP ${response.status}`)
  return response.text()
}

function fieldValuesFromPlainText(plain) {
  const cast = splitPeople(plain.match(/(?:领衔主演|主演)[：:\s]*([^。；;]{2,120})/)?.[1] || '')
  const directors = splitPeople(plain.match(/(?:导演|执导)[：:\s]*([^。；;]{2,80})/)?.[1] || '')
  return { cast, directors }
}

function verifyField(sources, field) {
  const occurrences = new Map()
  for (const source of sources) {
    const sourceId = source.id || source.name || 'unknown'
    for (const person of source[field] || []) {
      const name = String(person).trim()
      if (!name) continue
      const key = normalize(name)
      if (!occurrences.has(key)) occurrences.set(key, { name, sourceIds: new Set() })
      occurrences.get(key).sourceIds.add(sourceId)
    }
  }
  const requiredAgreement = 5
  const candidates = [...occurrences.values()].sort((a, b) => b.sourceIds.size - a.sourceIds.size || a.name.localeCompare(b.name, 'zh-CN'))
  return {
    candidates: candidates.map((item) => item.name),
    confirmed: candidates.filter((item) => item.sourceIds.size >= requiredAgreement).map((item) => item.name),
    maxAgreement: Math.min(requiredAgreement, candidates[0]?.sourceIds.size || 0),
    requiredAgreement,
  }
}

function primaryIdentitySource(input) {
  return {
    id: input?.sourceId || input?.provider || 'primary',
    name: input?.sourceName || input?.primaryIdentitySource?.name || '目录主来源',
    url: input?.primaryIdentitySource?.url || input?.sourceUrl || null,
    status: input?.cast?.length || input?.directors?.length ? 'matched' : 'missing',
    cast: input?.cast || [],
    directors: input?.directors || [],
    note: input?.primaryIdentitySource?.note || '主目录字段',
  }
}

async function wikipediaEvidence(title) {
  const searchUrl = `https://zh.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', list: 'search', srsearch: title, format: 'json', formatversion: '2', utf8: '1', origin: '*' })}`
  try {
    const search = await fetchJson(searchUrl, { timeout: 7000, failure: '维基百科请求失败' })
    const page = search?.query?.search?.find((item) => normalize(item?.title) === normalize(title))
    if (!page?.title) return { id: 'wikipedia', name: '中文维基百科', url: searchUrl, status: 'missing', cast: [], directors: [], note: '未找到同名条目' }
    const parseUrl = `https://zh.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'parse', page: page.title, prop: 'wikitext', format: 'json', formatversion: '2', origin: '*' })}`
    const parsed = await fetchJson(parseUrl, { timeout: 7000, failure: '维基百科条目读取失败' })
    const wikitext = parsed?.parse?.wikitext || ''
    const directors = splitPeople(wikitext.match(/^\|\s*导演\s*=\s*(.+)$/m)?.[1] || '')
    const cast = splitPeople(wikitext.match(/^\|\s*主演\s*=\s*(.+)$/m)?.[1] || '')
    return { id: 'wikipedia', name: '中文维基百科', url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(page.title)}`, status: cast.length || directors.length ? 'matched' : 'missing', cast, directors, note: cast.length || directors.length ? '已读取条目主创字段' : '条目没有结构化主创字段' }
  } catch (cause) {
    return { id: 'wikipedia', name: '中文维基百科', url: searchUrl, status: 'blocked', cast: [], directors: [], note: cause?.message || '读取失败' }
  }
}

async function wikidataEvidence(title) {
  const searchUrl = `https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbsearchentities', search: title, language: 'zh', format: 'json', origin: '*' })}`
  try {
    const search = await fetchJson(searchUrl, { timeout: 7000, failure: 'Wikidata 请求失败' })
    const entity = search?.search?.find((item) => [item?.match?.text, ...(item?.aliases || [])].some((value) => value && normalize(value) === normalize(title))) || search?.search?.[0]
    if (!entity?.id) return { id: 'wikidata', name: 'Wikidata', url: searchUrl, status: 'missing', cast: [], directors: [], note: '未找到匹配实体' }
    const data = await fetchJson(`https://www.wikidata.org/wiki/Special:EntityData/${entity.id}.json`, { timeout: 7000, failure: 'Wikidata 实体读取失败' })
    const claims = data?.entities?.[entity.id]?.claims || {}
    const idsFor = (property) => (claims[property] || []).map((item) => item?.mainsnak?.datavalue?.value?.id).filter(Boolean)
    const directorIds = idsFor('P57')
    const castIds = idsFor('P161')
    const ids = unique([...directorIds, ...castIds])
    const labels = ids.length ? await fetchJson(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels', languages: 'zh|en', format: 'json', origin: '*' })}`, { timeout: 7000, failure: 'Wikidata 标签读取失败' }) : { entities: {} }
    const labelOf = (id) => labels?.entities?.[id]?.labels?.zh?.value || labels?.entities?.[id]?.labels?.en?.value || id
    const cast = castIds.map(labelOf)
    const directors = directorIds.map(labelOf)
    return { id: 'wikidata', name: 'Wikidata', url: `https://www.wikidata.org/wiki/${entity.id}`, status: cast.length || directors.length ? 'matched' : 'missing', cast, directors, note: cast.length || directors.length ? '已读取结构化主创声明' : '实体没有主创声明' }
  } catch (cause) {
    return { id: 'wikidata', name: 'Wikidata', url: searchUrl, status: 'blocked', cast: [], directors: [], note: cause?.message || '读取失败' }
  }
}

async function officialEvidence(title, officialSite) {
  if (!officialSite) return { id: 'official', name: '官方播出页', url: null, status: 'missing', cast: [], directors: [], note: '目录未提供官方节目页' }
  try {
    const html = await fetchText(officialSite, { timeout: 10000, failure: '官方播出页读取失败' })
    if (/_____tmd_____|action["']?:["']captcha|x5secdata|bxpunish/i.test(html)) throw new Error('平台访问验证阻止读取')
    const { cast, directors } = fieldValuesFromPlainText(plainHtml(html))
    return { id: 'official', name: '官方播出页', url: officialSite, status: cast.length || directors.length ? 'matched' : 'missing', cast, directors, note: cast.length || directors.length ? `已从《${title}》官方页读取` : '页面可访问，但没有稳定的主创字段' }
  } catch (cause) {
    return { id: 'official', name: '官方播出页', url: officialSite, status: 'blocked', cast: [], directors: [], note: cause?.message || '读取失败' }
  }
}

async function domesticBaikeEvidence(title, kind) {
  const isBaidu = kind === 'baidu'
  const name = isBaidu ? '百度百科' : '360百科'
  const url = `https://${isBaidu ? 'baike.baidu.com' : 'baike.so.com'}/item/${encodeURIComponent(title)}`
  try {
    const html = await fetchText(url, { timeout: 10000, failure: `${name}读取失败` })
    const { cast, directors } = fieldValuesFromPlainText(plainHtml(html))
    return { id: kind, name, url, status: cast.length || directors.length ? 'matched' : 'missing', cast, directors, note: cast.length || directors.length ? `已从${name}公开页读取主创字段` : `${name}页面可访问，但没有稳定的主创字段` }
  } catch (cause) {
    return { id: kind, name, url, status: 'blocked', cast: [], directors: [], note: cause?.message || '读取失败' }
  }
}

async function baiduSearchEvidence(title) {
  const url = `https://www.baidu.com/s?${new URLSearchParams({ wd: `${title} 电视剧 导演 主演` })}`
  try {
    const plain = plainHtml(await fetchText(url, { timeout: 10000, failure: '百度搜索读取失败' }))
    if (!plain.includes(title)) return { id: 'baidu-search', name: '百度搜索', url, status: 'missing', cast: [], directors: [], note: '未找到可确认的同名剧集结果' }
    const { cast, directors } = fieldValuesFromPlainText(plain)
    return { id: 'baidu-search', name: '百度搜索', url, status: cast.length || directors.length ? 'matched' : 'missing', cast, directors, note: cast.length || directors.length ? '检索结果中出现同名剧集主创字段' : '已建立同名剧集检索入口，未提取到稳定主创字段' }
  } catch (cause) {
    return { id: 'baidu-search', name: '百度搜索', url, status: 'blocked', cast: [], directors: [], note: cause?.message || '读取失败' }
  }
}

function domesticDirectoryEvidence(title) {
  return { id: 'cn-directory', name: '中国网络视听节目服务协会', url: `https://www.cnsa.cn/search.html?${new URLSearchParams({ keyword: title })}`, status: 'missing', cast: [], directors: [], note: '保留国内行业目录入口，待命中对应条目后补充主创字段' }
}

async function crossVerifyIdentity(input, supplemental = []) {
  const primary = primaryIdentitySource(input)
  const [wikipedia, wikidata, official, baidu, baiduSearch, so360] = await Promise.all([
    wikipediaEvidence(input?.title || ''),
    wikidataEvidence(input?.title || ''),
    officialEvidence(input?.title || '', input?.officialSite),
    domesticBaikeEvidence(input?.title || '', 'baidu'),
    baiduSearchEvidence(input?.title || ''),
    domesticBaikeEvidence(input?.title || '', '360'),
  ])
  const reviewed = REVIEWED_IDENTITY_SOURCES[input?.title] || []
  const sources = [primary, ...supplemental, baidu, baiduSearch, so360, domesticDirectoryEvidence(input?.title || ''), official, ...reviewed, wikipedia, wikidata]
  return { cast: verifyField(sources, 'cast'), directors: verifyField(sources, 'directors'), sources, checkedAt: new Date().toISOString() }
}

async function runCrossCollection(input) {
  const date = todayInShanghai()
  const params = new URLSearchParams({ title: input.title })
  if (input.sourceUrl) params.set('sourceUrl', input.sourceUrl)
  if (Number.isInteger(Number(input.seriesId)) && Number(input.seriesId) > 0) params.set('seriesId', String(input.seriesId))
  const skipped = [input.skipMaoyan ? 'maoyan' : '', input.skipGuduo ? 'guduo' : ''].filter(Boolean)
  if (skipped.length) params.set('skip', skipped.join(','))
  const fallback = {
    date, fetchedAt: new Date().toISOString(), metrics: [], problems: [], manualSourceUrl: 'https://piaofang.maoyan.com/mdb/search', combined: [], notices: [], informationalNotices: [],
  }
  let payload
  try {
    // collect/all 可能同时补齐骨朵全历史、猫眼历史和平台明细；浏览器采集串行执行，30 秒会把正常排队误报成服务不可用。
    payload = await collectorJson(`/collect/all?${params}`, { timeout: 600000 })
  } catch (cause) {
    const message = cause?.message || '独立采集服务不可用'
    return { ...fallback, problems: [{ source: '采集服务', message }, { source: '骨朵', message }, ...(input.skipMaoyan ? [] : [{ source: '猫眼', message }])], combined: [message] }
  }
  const metrics = []
  const problems = []
  const combined = []
  const notices = []
  const informationalNotices = []
  const results = payload?.results || {}
  const labels = [{ key: 'maoyan', name: '猫眼热度', label: '猫眼' }, { key: 'guduo', name: '骨朵热度', label: '骨朵' }]
  if (input.skipMaoyan) informationalNotices.push('猫眼：该项目已标记为暂无历史覆盖，按项目口径跳过。')
  if (input.skipGuduo) informationalNotices.push('骨朵：今日已有快照，跳过重复抓取。')
  for (const item of labels) {
    if ((item.key === 'maoyan' && input.skipMaoyan) || (item.key === 'guduo' && input.skipGuduo)) continue
    const row = results[item.key]
    if (row?.ok && row?.data?.verification?.verified === false) {
      problems.push({ source: item.label, message: row.data.verification.message || '连续抓取结果不一致，未通过双轮验证' })
      combined.push(`${item.label}：${row.data.verification.message || '连续抓取结果不一致，待复核'}`)
      continue
    }
    if (row?.ok && row?.data?.availability === 'not-published') {
      const message = row.data.notice || `${item.label}近期没有公开榜单数据`
      notices.push(`${item.label}：${message}`)
    } else if (row?.ok && row?.data && typeof row.data.heat === 'number') {
      const rank = typeof row.data.rank === 'number' ? `${item.label === '猫眼' ? '榜内' : '全网'}第${row.data.rank}` : ''
      metrics.push({ name: item.name, value: Number(row.data.heat), rank: typeof row.data.rank === 'number' ? row.data.rank : undefined, sourceUrl: String(row.data.sourceUrl || fallback.manualSourceUrl), date: /^\d{4}-\d{2}-\d{2}$/.test(row.data.date || '') ? row.data.date : undefined, note: rank || undefined })
      combined.push(`${item.label}热度 ${Number(row.data.heat).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${rank ? ` · ${rank}` : ''}`)
      for (const warning of Array.isArray(row.data.coverageWarnings) ? row.data.coverageWarnings : []) {
        notices.push(`${item.label}：${warning}`)
      }
    } else {
      const message = row?.error || `${item.label}没有返回数值`
      problems.push({ source: item.label, message })
      combined.push(`${item.label}：${message}`)
    }
  }
  return { ...fallback, ...(Number.isInteger(Number(results?.maoyan?.data?.seriesId)) && Number(results.maoyan.data.seriesId) > 0 ? { seriesId: Number(results.maoyan.data.seriesId) } : {}), metrics, problems, combined: [...combined, ...notices, ...informationalNotices], notices, informationalNotices }
}

async function collectorHistory(path, timeout) {
  return collectorJson(path, { timeout })
}

function kyHistoryTimeoutMs(from, to) {
  const start = new Date(`${from}T12:00:00Z`)
  const end = new Date(`${to}T12:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
    || start.toISOString().slice(0, 10) !== from
    || end.toISOString().slice(0, 10) !== to
    || from > to) return 600_000
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
  return Math.min(43_200_000, 600_000 + days * 5_000)
}

async function collectTvRatings(searchParams) {
  const title = searchParams.get('title')?.trim()
  if (!title) throw new Error('缺少剧名')
  const params = new URLSearchParams({ title })
  const from = searchParams.get('from')?.trim()
  const to = searchParams.get('to')?.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(from || '')) params.set('from', from)
  if (/^\d{4}-\d{2}-\d{2}$/.test(to || '')) params.set('to', to)
  const seriesId = Number(searchParams.get('seriesId') || 0)
  const sourceUrl = searchParams.get('sourceUrl')?.trim()
  if (Number.isInteger(seriesId) && seriesId > 0) params.set('seriesId', String(seriesId))
  if (sourceUrl) params.set('sourceUrl', sourceUrl)
  try {
    const maoyan = await collectorHistory(`/maoyan/tvinfo?${params}`, 600000)
    if (maoyan?.ok) return { result: maoyan, source: '猫眼 tvinfo', availability: Array.isArray(maoyan.series) && maoyan.series.length ? 'available' : 'not-published' }
  } catch {
    // Preserve the original two-stage fallback: only a failed Maoyan read invokes the public-table reader.
  }
  const fallback = await collectorHistory(`/ratings/collect?${new URLSearchParams({ title })}`, 600000)
  if (!fallback?.ok) throw new Error(fallback?.error || '台端收视率采集失败')
  return { result: fallback.data || fallback, source: '公开逐日收视表' }
}

async function handleDramaSearch(searchParams) {
  try {
    const query = searchParams.get('q')?.trim()
    if (!query) return error(400, '请输入剧名。')
    // 三个目录来源相互独立，并行读取，避免一次搜索把网络耗时串行叠加。
    const [catalogAttempt, tvmaze, douban] = await Promise.allSettled([resolveCatalog(query), searchTvmaze(query), searchDouban(query)])
    const catalogResult = catalogAttempt.status === 'fulfilled' ? catalogAttempt.value : null
    const results = [
      ...searchDomestic(query),
      ...(catalogResult ? [catalogResult] : []),
      ...(tvmaze.status === 'fulfilled' ? tvmaze.value : []),
      ...(douban.status === 'fulfilled' ? douban.value : []),
    ]
    const deduped = consolidateSearchResults(results, query)
    const unavailableSources = [catalogAttempt, tvmaze, douban].filter((entry) => entry.status === 'rejected').map((entry) => entry.reason?.message || String(entry.reason))
    return json(200, { query, results: deduped, source: '国内多源目录 + TVmaze + 豆瓣剧集目录', unavailableSources, fetchedAt: new Date().toISOString() })
  } catch (cause) {
    return error(502, cause?.message || '竞品搜索服务暂时不可用')
  }
}

async function handleDramaDetails(pathname, searchParams) {
  const id = Number(pathname.split('/').at(-1))
  if (!Number.isInteger(id) || id <= 0) return error(400, '电视剧 ID 无效。')
  const provider = searchParams.get('provider') || 'tvmaze'
  try {
    let result
    if (provider === 'domestic') result = await getDomesticDetails(id)
    else if (provider === 'douban') result = await getDoubanDetails(id)
    else if (provider === 'catalog') result = await getCatalogDetails(id, searchParams.get('title')?.trim())
    else if (provider === 'tvmaze') result = await getTvmazeDetails(id)
    else return error(400, '不支持的目录来源')
    return json(200, { result, source: provider === 'catalog' ? '猫眼官方 MDB' : provider === 'douban' ? '豆瓣剧集目录' : provider === 'domestic' ? '国内多源目录' : 'TVmaze' })
  } catch (cause) {
    return error(502, cause?.message || '详情读取失败')
  }
}

async function handleRecommendations(searchParams) {
  const premiere = searchParams.get('premiere')?.trim()
  if (!premiere || !/^\d{4}-\d{2}-\d{2}$/.test(premiere)) return error(400, '缺少有效的首播日期')
  try {
    const dates = Array.from({ length: 21 }, (_, index) => dateOffset(premiere, index - 10))
    const schedules = await Promise.allSettled(dates.map((date) => tvmazeJson(`/schedule?country=CN&date=${date}`, 12000)))
    const rows = schedules.filter((item) => item.status === 'fulfilled').flatMap((item) => item.value || [])
    if (!rows.length) throw new Error('TVmaze 中国区排期暂时无法读取，请稍后重试')
    const exclude = { title: searchParams.get('excludeTitle') || '', premiered: searchParams.get('excludePremiered') || null, year: Number(searchParams.get('excludeYear')) || null }
    const from = dateOffset(premiere, -10)
    const to = dateOffset(premiere, 10)
    const map = new Map()
    for (const row of rows) {
      const show = row?.show
      if (!show?.id || !show.premiered || show.premiered < from || show.premiered > to) continue
      const descriptor = [show.name, show.network?.name, show.webChannel?.name, ...(show.genres || [])].join(' ')
      const duration = show.averageRuntime || show.runtime || 0
      if (/Hongguo|红果|短剧|微短剧|抖音|快手|番茄|河马/i.test(descriptor) || (duration > 0 && duration < 20)) continue
      map.set(show.id, show)
    }
    const shows = [...map.values()].sort((a, b) => String(a.premiered).localeCompare(String(b.premiered))).slice(0, 20)
    const akas = await Promise.all(shows.map((show) => tvmazeAkas(show.id)))
    const results = shows.map((show, index) => toTvmazeSearchResult(show, 1, akas[index])).filter((item) => !sameDramaIdentity(exclude, item))
    return json(200, { results, window: { start: from, end: to }, coverage: 'TVmaze 中国区电视排期' })
  } catch (cause) {
    return error(502, cause?.message || '同期剧推荐失败')
  }
}

async function handleCollectorRoute(pathname, searchParams, body) {
  try {
    if (pathname === '/api/collect/cross') {
      if (!body?.title) return error(400, '缺少剧名')
      return json(200, { outcome: await runCrossCollection(body) })
    }
    if (pathname === '/api/collect/guduo-history') {
      const title = searchParams.get('title')?.trim()
      const from = searchParams.get('from')?.trim()
      const to = searchParams.get('to')?.trim()
      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(from || '')) return error(400, '缺少有效 title / from=YYYY-MM-DD')
      if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return error(400, 'to 必须为 YYYY-MM-DD')
      const params = new URLSearchParams({ title, from })
      if (to) params.set('to', to)
      if (searchParams.get('hadData') === '1') params.set('hadData', '1')
      const emptyStreak = Math.max(0, Math.min(14, Number(searchParams.get('emptyStreak')) || 0))
      params.set('emptyStreak', String(emptyStreak))
      const payload = await collectorHistory(`/guduo/history?${params}`, 600000)
      if (!payload?.ok) throw new Error(payload?.error || '骨朵历史回填失败')
      return json(200, { series: payload.data?.series || [], count: payload.count || 0, complete: payload.complete ?? payload.data?.complete ?? true, failedDates: payload.failedDates ?? payload.data?.failedDates ?? [], rankFailedDates: payload.data?.rankFailedDates || [], attemptedDates: payload.data?.attemptedDates ?? 0, continuity: payload.data?.continuity || null, verification: payload.data?.verification || null, from, to: payload.data?.requestedTo || to || '' })
    }
    if (pathname === '/api/collect/maoyan-history') {
      const title = searchParams.get('title')?.trim()
      if (!title) return error(400, '缺少 title，猫眼 seriesId 由 resolver 自动解析')
      const params = new URLSearchParams({ title })
      const sourceUrl = searchParams.get('sourceUrl')?.trim()
      const seriesId = Number(searchParams.get('seriesId') || 0)
      const from = searchParams.get('from')?.trim()
      const to = searchParams.get('to')?.trim()
      if (sourceUrl) params.set('sourceUrl', sourceUrl)
      if (Number.isInteger(seriesId) && seriesId > 0) params.set('seriesId', String(seriesId))
      if (/^\d{4}-\d{2}-\d{2}$/.test(from || '')) params.set('from', from)
      if (/^\d{4}-\d{2}-\d{2}$/.test(to || '')) params.set('to', to)
      const payload = await collectorHistory(`/maoyan/history?${params}`, 600000)
      if (!payload?.ok) throw new Error(payload?.error || '猫眼历史拉取失败')
      return json(200, {
        seriesId: payload.seriesId,
        totalDays: payload.totalDays,
        series: payload.series || [],
        summary: payload.summary || null,
        coverage: payload.coverage || null,
        complete: payload.complete !== false,
        truncated: payload.truncated === true,
        missingDates: payload.missingDates || [],
        verification: payload.verification || null,
      })
    }
    if (pathname === '/api/collect/maoyan-metric') {
      const metric = searchParams.get('metric')?.trim()
      const title = searchParams.get('title')?.trim()
      if (!['platform', 'effective'].includes(metric) || !title) return error(400, '需要 metric=platform|effective，以及 title')
      const params = new URLSearchParams({ metric, title })
      const sourceUrl = searchParams.get('sourceUrl')?.trim()
      const seriesId = Number(searchParams.get('seriesId') || 0)
      const from = searchParams.get('from')?.trim()
      const to = searchParams.get('to')?.trim()
      if (sourceUrl) params.set('sourceUrl', sourceUrl)
      if (Number.isInteger(seriesId) && seriesId > 0) params.set('seriesId', String(seriesId))
      if (/^\d{4}-\d{2}-\d{2}$/.test(from || '')) params.set('from', from)
      if (/^\d{4}-\d{2}-\d{2}$/.test(to || '')) params.set('to', to)
      const payload = await collectorHistory(`/maoyan/${metric}?${params}`, 600000)
      if (!payload?.ok) throw new Error(payload?.error || '猫眼指标拉取失败')
      return json(200, { seriesId: payload.seriesId, metric, totalDays: payload.totalDays, sourceUrl: payload.sourceUrl, series: payload.series || [], pendingSeries: payload.pendingSeries || [], summary: payload.summary || null, availability: payload.availability, notice: payload.notice, mappingWarnings: payload.mappingWarnings || [], verification: payload.verification || null })
    }
    if (pathname === '/api/collect/ky-history') {
      const title = searchParams.get('title')?.trim()
      const from = searchParams.get('from')?.trim()
      const to = searchParams.get('to')?.trim()
      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) return error(400, '酷云历史采集需要有效的 title / from / to')
      const params = new URLSearchParams({ title, from, to })
      const payload = await collectorHistory(`/ky/history?${params}`, kyHistoryTimeoutMs(from, to))
      if (!payload?.ok) throw new Error(payload?.error || '酷云历史回填失败')
      return json(200, { series: payload.series || [], complete: payload.complete !== false, attemptedDates: payload.attemptedDates || 0, checkedDates: payload.verification?.checkedDates || payload.checkedDates || [], noDataDates: payload.verification?.noDataDates || [], noDataByMetric: payload.noDataByMetric || {}, failedDates: payload.failedDates || [], sourceLatestDate: payload.sourceLatestDate || null, coverageNote: payload.coverageNote || '', verification: payload.verification || null })
    }
    if (pathname === '/api/collect/ky') {
      const title = searchParams.get('title')?.trim()
      if (!title) return error(400, '缺少 title')
      const payload = await collectorHistory(`/ky/collect?title=${encodeURIComponent(title)}`, 180000)
      if (!payload?.ok) throw new Error(payload?.error || '酷云采集失败')
      return json(200, payload.data || payload)
    }
    if (pathname === '/api/collect/tv-ratings') return json(200, await collectTvRatings(searchParams))
    if (pathname === '/api/collect/youku') return error(409, '网端数据已统一按猫眼看板口径采集，当前项目不再单独抓取优酷前台值')
  } catch (cause) {
    return error(502, cause?.message || '采集服务请求失败')
  }
  return null
}

export function handleDramaApi(request, requestUrl, { signal } = {}) {
  return requestContext.run({ signal }, () => handleDramaApiRequest(request, requestUrl))
}

async function handleDramaApiRequest(request, requestUrl) {
  const { pathname, searchParams } = requestUrl
  let body = null
  if (request.method === 'POST') {
    try { body = await readRequestBody(request) } catch (cause) { return error(400, cause?.message || '请求体无效') }
  }
  if (pathname === '/api/dramas/search' && request.method === 'GET') return handleDramaSearch(searchParams)
  if (pathname === '/api/dramas/recommend' && request.method === 'GET') return handleRecommendations(searchParams)
  if (/^\/api\/dramas\/\d+$/.test(pathname) && request.method === 'GET') return handleDramaDetails(pathname, searchParams)
  if (pathname.startsWith('/api/collect/')) return handleCollectorRoute(pathname, searchParams, body)
  if (pathname === '/api/collector/health' && request.method === 'GET') {
    try {
      const [main, ky] = await Promise.allSettled([
        collectorJson('/ping', { timeout: 3000, collector: COLLECTOR }),
        collectorJson('/ping', { timeout: 3000, collector: KY_COLLECTOR }),
      ])
      const collectors = {
        main: main.status === 'fulfilled' ? main.value : { ok: false, error: main.reason?.message || '主采集器不可用' },
        ky: ky.status === 'fulfilled' ? ky.value : { ok: false, error: ky.reason?.message || '酷云采集器不可用' },
      }
      const ok = main.status === 'fulfilled' && ky.status === 'fulfilled'
      return json(ok ? 200 : 503, { ok, collectors })
    } catch (cause) {
      return error(503, cause?.message || '采集服务不可用')
    }
  }
  return null
}
