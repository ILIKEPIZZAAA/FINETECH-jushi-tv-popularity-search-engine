import { DatabaseSync } from 'node:sqlite'
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { analyticsGroups, analyticsPages, analyticsPageName } from '../src/lib/analyticsCatalog.js'

const deriveKey = promisify(scrypt)
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const pages = new Set(analyticsPages.map(page => page.id))
const namePattern = /^[\p{L}\p{N} .:_-]{1,100}$/u
const dayOf = (time) => new Date(time + 8 * 3600_000).toISOString().slice(0, 10)
const sha256 = (text) => createHash('sha256').update(text).digest('hex')

export async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: (await deriveKey(password, salt, 64)).toString('hex') }
}

export function analyticsRange(params, now = Date.now()) {
  const to = params.get('to') || dayOf(now)
  const from = params.get('from') || dayOf(now - 6 * 86400_000)
  const validDate = (day) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day
  if (!validDate(from) || !validDate(to) || from > to || Date.parse(to) - Date.parse(from) > 365 * 86400_000) throw new Error('请选择最多 366 天的有效日期范围')
  return { from, to }
}

export function createAnalyticsStore(path) {
  const db = new DatabaseSync(path)
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, at INTEGER NOT NULL, day TEXT NOT NULL, visitor TEXT NOT NULL, kind TEXT NOT NULL, page TEXT NOT NULL, component TEXT NOT NULL, action TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS events_day_kind ON events(day,kind);
    CREATE INDEX IF NOT EXISTS events_day_visitor ON events(day,visitor);
    CREATE INDEX IF NOT EXISTS events_page_day_kind ON events(page,day,kind,visitor);`)
  db.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES (?,?)').run('visitor_salt', randomBytes(32).toString('hex'))
  const salt = db.prepare('SELECT value FROM meta WHERE key=?').get('visitor_salt').value
  const insert = db.prepare('INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?,?,?)')
  let cleanedDay = ''
  const store = {
    accept(visitor, events, now = Date.now()) {
      if (!uuid.test(visitor) || !Array.isArray(events) || !events.length || events.length > 30) throw new Error('无效的统计事件')
      for (const event of events) {
        if (!uuid.test(event?.id || '') || !['pageview', 'click'].includes(event.kind) || !pages.has(event.page) || !namePattern.test(event.component || '') || !namePattern.test(event.action || '')) throw new Error('无效的统计事件')
      }
      const hash = createHmac('sha256', salt).update(visitor).digest('hex')
      let accepted = 0
      db.exec('BEGIN')
      try {
        for (const event of events) {
          const at = Number.isFinite(event.at) && event.at >= now - 86400_000 && event.at <= now + 300_000 ? event.at : now
          accepted += Number(insert.run(event.id, at, dayOf(at), hash, event.kind, event.page, event.component, event.action).changes)
        }
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      if (cleanedDay !== dayOf(now)) {
        db.prepare('DELETE FROM events WHERE day < ?').run(dayOf(now - 365 * 86400_000))
        cleanedDay = dayOf(now)
      }
      return accepted
    },
    report(from, to) {
      const totals = db.prepare(`SELECT COUNT(DISTINCT CASE WHEN kind='pageview' THEN visitor END) uv,
        SUM(CASE WHEN kind='pageview' THEN 1 ELSE 0 END) pv,
        SUM(CASE WHEN kind='click' THEN 1 ELSE 0 END) clicks FROM events WHERE day BETWEEN ? AND ?`).get(from, to)
      const dailyRows = db.prepare(`SELECT day,COUNT(DISTINCT CASE WHEN kind='pageview' THEN visitor END) uv,
        SUM(CASE WHEN kind='pageview' THEN 1 ELSE 0 END) pv,SUM(CASE WHEN kind='click' THEN 1 ELSE 0 END) clicks
        FROM events WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day`).all(from, to)
      const byDay = new Map(dailyRows.map((row) => [row.day, row]))
      const daily = []
      for (let time = Date.parse(`${from}T00:00:00Z`); time <= Date.parse(`${to}T00:00:00Z`); time += 86400_000) {
        const day = new Date(time).toISOString().slice(0, 10)
        daily.push(byDay.get(day) || { day, uv: 0, pv: 0, clicks: 0 })
      }
      const rollup = (pageIds) => {
        const placeholders = pageIds.map(() => '?').join(',')
        const args = [from, to, ...pageIds]
        const scope = `SELECT * FROM events WHERE day BETWEEN ? AND ? AND page IN (${placeholders})`
        const summary = db.prepare(`WITH scoped AS (${scope}) SELECT
          COUNT(DISTINCT CASE WHEN kind='pageview' THEN visitor END) uv,
          SUM(kind='pageview') pv, SUM(kind='click') clicks,
          COUNT(DISTINCT CASE WHEN kind='click' THEN visitor END) clickUv FROM scoped`).get(...args)
        const actions = db.prepare(`WITH scoped AS (${scope}), visits AS (SELECT DISTINCT visitor FROM scoped WHERE kind='pageview')
          SELECT component,action,COUNT(*) clicks,COUNT(DISTINCT visitor) uv,
          COUNT(DISTINCT CASE WHEN visitor IN (SELECT visitor FROM visits) THEN visitor END) matchedUv,
          GROUP_CONCAT(DISTINCT page) sources
          FROM scoped WHERE kind='click' GROUP BY component,action ORDER BY clicks DESC,component,action`).all(...args)
        const uv = summary.uv || 0
        return { pv: summary.pv || 0, uv, clicks: summary.clicks || 0, clickUv: summary.clickUv || 0,
          actions: actions.map(row => ({ ...row, sources: row.sources.split(','), pageUv: uv, ctr: uv ? row.matchedUv / uv : null })) }
      }
      const pageDetails = analyticsPages.map(page => ({ page: page.id, ...rollup([page.id]) }))
      const groups = analyticsGroups.map(group => ({ ...group, ...rollup(group.pages) }))
      return {
        from, to, timezone: 'Asia/Shanghai', retentionDays: 365,
        startedAt: db.prepare('SELECT MIN(day) day FROM events').get().day || null,
        totals: { uv: totals.uv || 0, pv: totals.pv || 0, clicks: totals.clicks || 0 }, daily,
        pages: pageDetails.map(({ actions, ...page }) => page),
        groups,
        components: db.prepare(`SELECT page,component,COUNT(*) clicks,COUNT(DISTINCT visitor) uv FROM events WHERE kind='click' AND day BETWEEN ? AND ? GROUP BY page,component ORDER BY clicks DESC,page,component`).all(from, to),
        actions: pageDetails.flatMap(page => page.actions.map(action => ({ page: page.page, ...action }))).sort((a, b) => b.clicks - a.clicks),
      }
    },
    exportSnapshot(now = Date.now()) {
      db.exec('BEGIN')
      try {
        const range = db.prepare('SELECT MIN(day) firstDay, MAX(day) lastDay FROM events').get()
        const report = store.report(range.firstDay || dayOf(now), range.lastDay || dayOf(now))
        const events = db.prepare('SELECT id,at,day,visitor,kind,page,component,action FROM events ORDER BY at,id').all()
        db.exec('COMMIT')
        return { report, events, generatedAt: now }
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    close() { db.close() },
  }
  return store
}

export function analyticsCsv(report, type) {
  if (!['daily', 'pages', 'components', 'actions'].includes(type)) throw new Error('无效的下载类型')
  const tables = {
    daily: { headers: ['日期', 'UV', 'PV', '点击次数'], rows: report.daily.map((row) => [row.day, row.uv, row.pv, row.clicks]) },
    pages: { headers: ['页面', 'PV', 'UV'], rows: report.pages.map((row) => [analyticsPageName(row.page), row.pv, row.uv]) },
    components: { headers: ['页面', '组件', '点击次数', '点击UV'], rows: report.components.map((row) => [analyticsPageName(row.page), row.component, row.clicks, row.uv]) },
    actions: { headers: ['页面', '组件', '按钮或操作', '点击次数', '点击UV', '所属页面UV', '页面点击率'], rows: report.actions.map((row) => [analyticsPageName(row.page), row.component, row.action, row.clicks, row.uv, row.pageUv ?? '', row.ctr === null || row.ctr === undefined ? '' : `${(row.ctr * 100).toFixed(2)}%`]) },
  }
  const table = tables[type]
  if (!table) throw new Error('无效的下载类型')
  const cell = (value) => {
    let text = String(value ?? '')
    if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`
    return `"${text.replaceAll('"', '""')}"`
  }
  return '\uFEFF' + [table.headers, ...table.rows].map((row) => row.map(cell).join(',')).join('\r\n')
}

async function bodyJson(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (Buffer.byteLength(body) > 16384) throw new Error('请求过大')
  }
  return JSON.parse(body || '{}')
}

export function createAnalyticsService({ directory, production = false, now = Date.now } = {}) {
  let store
  const sessions = new Map()
  const limits = new Map()
  const getStore = () => {
    if (!store) { mkdirSync(directory, { recursive: true, mode: 0o700 }); store = createAnalyticsStore(join(directory, 'events.sqlite')) }
    return store
  }
  const auth = () => {
    try { return JSON.parse(readFileSync(join(directory, 'auth.json'), 'utf8')) } catch { return null }
  }
  const token = (request) => String(request.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith('ft_stats='))?.slice(9) || ''
  const authenticated = (request) => {
    const session = sessions.get(sha256(token(request)))
    return Boolean(session && session.expires > now() && session.authHash === auth()?.hash)
  }
  const originOk = (request) => {
    try {
      const origin = new URL(request.headers.origin)
      return origin.host === request.headers.host || (!production && ['localhost', '127.0.0.1'].includes(origin.hostname))
    } catch { return false }
  }
  const permit = (key, max, windowMs) => {
    const time = now()
    for (const [item, limit] of limits) if (limit.until <= time) limits.delete(item)
    if (!limits.has(key)) { if (limits.size >= 10000) return false; limits.set(key, { count: 0, until: time + windowMs }) }
    return ++limits.get(key).count <= max
  }
  const json = (response, status, value) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    response.end(JSON.stringify(value))
  }
  const cookie = (value, age) => `ft_stats=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${production ? '; Secure' : ''}`
  return {
    async handle(request, response, url) {
      try {
        const path = url.pathname
        if (path === '/api/analytics/events' && request.method === 'POST') {
          if (!originOk(request)) return json(response, 403, { error: '来源校验失败' })
          if (/bot|crawler|spider|headless|lighthouse|curl|wget/i.test(request.headers['user-agent'] || '')) return json(response, 202, { accepted: 0 })
          const network = sha256(String(request.headers['x-real-ip'] || request.socket.remoteAddress || 'unknown'))
          if (!permit(`events:${network}`, 120, 60000)) return json(response, 429, { error: '请求过于频繁' })
          const payload = await bodyJson(request)
          if (!payload || typeof payload !== 'object') return json(response, 400, { error: '无效的统计事件' })
          return json(response, 202, { accepted: getStore().accept(payload.visitor, payload.events, now()) })
        }
        if (path === '/api/analytics/session' && request.method === 'GET') return json(response, 200, { authenticated: authenticated(request), configured: Boolean(auth()) })
        if (path === '/api/analytics/login' && request.method === 'POST') {
          if (!originOk(request)) return json(response, 403, { error: '来源校验失败' })
          const key = `login:${sha256(String(request.headers['x-real-ip'] || request.socket.remoteAddress || 'unknown'))}`
          if (!permit(key, 10, 15 * 60000)) return json(response, 429, { error: '尝试次数过多，请 15 分钟后重试' })
          const credentials = auth()
          if (!credentials) return json(response, 503, { error: '管理员尚未设置统计密码' })
          const { password } = await bodyJson(request)
          if (typeof password !== 'string' || password.length > 256) return json(response, 401, { error: '密码不正确' })
          const actual = await passwordHash(password, credentials.salt)
          const expected = Buffer.from(credentials.hash || '', 'hex'), actualKey = Buffer.from(actual.hash, 'hex')
          if (expected.length !== actualKey.length || !timingSafeEqual(expected, actualKey)) return json(response, 401, { error: '密码不正确' })
          limits.delete(key)
          for (const [id, session] of sessions) if (session.expires <= now()) sessions.delete(id)
          if (sessions.size >= 10) sessions.delete(sessions.keys().next().value)
          const session = randomBytes(32).toString('hex')
          sessions.set(sha256(session), { expires: now() + 8 * 3600_000, authHash: credentials.hash })
          response.setHeader('set-cookie', cookie(session, 8 * 3600))
          return json(response, 200, { authenticated: true })
        }
        if (path === '/api/analytics/logout' && request.method === 'POST') {
          if (!originOk(request)) return json(response, 403, { error: '来源校验失败' })
          sessions.delete(sha256(token(request)))
          response.setHeader('set-cookie', cookie('', 0))
          return json(response, 200, { authenticated: false })
        }
        if (!authenticated(request)) return json(response, 401, { error: '请先登录统计看板' })
        if (request.method !== 'GET' || !['/api/analytics/report', '/api/analytics/export'].includes(path)) return json(response, 404, { error: '接口不存在' })
        if (path === '/api/analytics/export' && url.searchParams.get('type') === 'all') {
          const snapshot = getStore().exportSnapshot(now())
          const { analyticsWorkbook } = await import('./analytics-workbook.mjs')
          const bytes = analyticsWorkbook(snapshot)
          response.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="finetech-all-${snapshot.report.from}-${snapshot.report.to}.xlsx"`, 'X-Content-Type-Options': 'nosniff' })
          return response.end(bytes)
        }
        const { from, to } = analyticsRange(url.searchParams, now())
        const report = getStore().report(from, to)
        if (path.endsWith('/report')) return json(response, 200, report)
        const type = url.searchParams.get('type') || 'daily'
        const csv = analyticsCsv(report, type)
        response.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="finetech-${type}-${from}-${to}.csv"`, 'X-Content-Type-Options': 'nosniff' })
        response.end(csv)
      } catch (error) {
        json(response, error instanceof SyntaxError || /无效|请选择|请求过大/.test(error.message) ? 400 : 503, { error: /无效|请选择|请求过大/.test(error.message) ? error.message : '统计服务暂时不可用' })
      }
    },
    close() { store?.close() },
  }
}
