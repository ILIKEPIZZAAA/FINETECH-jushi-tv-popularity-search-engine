import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createAnalyticsStore, createAnalyticsService, analyticsCsv, analyticsRange, passwordHash } from '../server/analytics.mjs'
import { createTracker, analyticsName, ANALYTICS_OPT_OUT } from '../src/lib/analytics.js'
import { reportControlRows } from '../src/lib/analyticsCatalog.js'
import { analyticsWorkbook } from '../server/analytics-workbook.mjs'
import * as XLSX from 'xlsx'

const now = Date.parse('2026-10-15T12:00:00Z')
const event = (kind = 'pageview', overrides = {}) => ({ id: randomUUID(), at: now, kind, page: 'home', component: '首页搜索', action: kind === 'click' ? '搜索' : 'view', ...overrides })
function temp(t) { const path = mkdtempSync(join(tmpdir(), 'finetech-analytics-test-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path }

test('匿名UV按区间去重、PV和组件按钮点击分别计数；重试事件不重复', (t) => {
  const path = join(temp(t), 'events.sqlite'), visitor = randomUUID(), store = createAnalyticsStore(path)
  const batch = [event(), event(), event('click'), event('click')]
  assert.equal(store.accept(visitor, batch, now), 4)
  assert.equal(store.accept(visitor, batch, now), 0)
  store.accept(visitor, [event('pageview', { at: now - 86400000 })], now)
  store.accept(randomUUID(), [event()], now)
  let report = store.report('2026-10-14', '2026-10-15')
  assert.deepEqual(report.totals, { uv: 2, pv: 4, clicks: 2 })
  assert.equal(report.daily.reduce((sum, row) => sum + row.uv, 0), 3)
  assert.equal(report.components[0].clicks, 2)
  assert.equal(report.actions[0].action, '搜索')
  store.close()
  const reopened = createAnalyticsStore(path)
  assert.deepEqual(reopened.report('2026-10-14', '2026-10-15').totals, report.totals)
  reopened.close()
})

test('无效事件整批拒绝，时间按上海日历，空范围无伪造历史', (t) => {
  const store = createAnalyticsStore(join(temp(t), 'events.sqlite'))
  t.after(() => store.close())
  assert.throws(() => store.accept(randomUUID(), [event(), event('click', { page: 'arbitrary' })], now), /无效/)
  assert.equal(store.report('2026-10-15', '2026-10-15').totals.pv, 0)
  store.accept(randomUUID(), [event('pageview', { at: Date.parse('2026-10-14T17:00:00Z') })], now)
  assert.equal(store.report('2026-10-15', '2026-10-15').totals.pv, 1)
  assert.equal(store.report('2026-10-14', '2026-10-14').totals.pv, 0)
  for (const query of ['from=2026-02-30', 'from=2026-10-16&to=2026-10-15', 'from=2020-01-01&to=2026-10-15']) assert.throws(() => analyticsRange(new URLSearchParams(query), now))
  assert.deepEqual(analyticsRange(new URLSearchParams(), now), { from: '2026-10-09', to: '2026-10-15' })
})

test('页面分组跨子页去重，同名按钮归属正确，点击率按页面访问UV计算', t => {
  const store = createAnalyticsStore(join(temp(t), 'events.sqlite'))
  t.after(() => store.close())
  const first = randomUUID(), second = randomUUID(), clickOnly = randomUUID()
  const control = { component: '顶部导航', action: '小红书' }
  store.accept(first, [event(), event('click', control), event('click', control),
    event('pageview', { page: 'dashboard.heat' }), event('click', { ...control, page: 'dashboard.heat' }),
    event('pageview', { page: 'dashboard.tv' }), event('click', { ...control, page: 'dashboard.tv' })], now)
  store.accept(second, [event(), event('click', control)], now)
  store.accept(clickOnly, [event('click', control)], now)
  const report = store.report('2026-10-15', '2026-10-15')
  const home = report.groups.find(group => group.id === 'home')
  const dashboard = report.groups.find(group => group.id === 'dashboard')
  assert.equal(home.uv, 2)
  assert.equal(home.actions[0].clicks, 4)
  assert.equal(home.actions[0].uv, 3)
  assert.equal(home.actions[0].matchedUv, 2)
  assert.equal(home.actions[0].ctr, 1)
  assert.equal(dashboard.uv, 1)
  assert.equal(dashboard.pv, 2)
  assert.equal(dashboard.actions[0].uv, 1)
  assert.equal(dashboard.actions[0].clicks, 2)
  assert.deepEqual(new Set(dashboard.actions[0].sources), new Set(['dashboard.heat', 'dashboard.tv']))
  assert.equal(report.actions.find(action => action.page === 'dashboard.tv').pageUv, 1)
  assert.equal(report.groups.find(group => group.id === 'fetching').actions.length, 0)
  const controls = reportControlRows(home.actions, ['home'], home.uv)
  assert.equal(controls.find(row => row.action === '点击搜索框').clicks, 0)
  assert.equal(controls.find(row => row.action === '小红书' && row.component === '顶部导航').clicks, 4)
  assert.ok(!controls.some(row => row.component === '看板导航'))
  const csv = analyticsCsv(report, 'actions')
  assert.match(csv, /看板 · 台端热度/)
  assert.match(csv, /页面点击率/)
  assert.match(csv, /100.00%/)
})

test('有点击但查询区间没有页面访问时，点击率保持未知', t => {
  const store = createAnalyticsStore(join(temp(t), 'events.sqlite'))
  t.after(() => store.close())
  store.accept(randomUUID(), [event('click')], now)
  const report = store.report('2026-10-15', '2026-10-15')
  assert.equal(report.actions[0].clicks, 1)
  assert.equal(report.actions[0].ctr, null)
  assert.equal(report.groups.find(group => group.id === 'home').uv, 0)
  assert.equal(reportControlRows([], ['home'], 0)[0].ctr, null)
})

test('CSV带UTF8 BOM、完整表头和公式注入保护', () => {
  const csv = analyticsCsv({ daily: [], pages: [], components: [], actions: [{ page: 'home', component: '=bad', action: 'a"b', clicks: 2, uv: 1 }] }, 'actions')
  assert.ok(csv.startsWith('\uFEFF"页面","组件","按钮或操作"'))
  assert.ok(csv.includes('"\'=bad"'))
  assert.ok(csv.includes('"a""b"'))
  assert.throws(() => analyticsCsv({}, '../auth'), /无效/)
})

test('全量 Excel 包含全部留存历史、分类汇总与原始事件，百分比保留未知状态', t => {
  const store = createAnalyticsStore(join(temp(t), 'events.sqlite'))
  t.after(() => store.close())
  const visitor = randomUUID(), older = now - 10 * 86400000
  store.accept(visitor, [event('pageview', { at: older })], older)
  store.accept(visitor, [event(), event('click', { component: '腾讯视频首页榜单', action: '查看官方来源' }),
    event('pageview', { page: 'dashboard.heat' }), event('click', { page: 'dashboard.heat', component: '看板导航', action: '刷新数据' })], now)
  store.accept(randomUUID(), [event('click', { page: 'fetching', component: '-采集进度', action: '打开采集日志' })], now)
  const snapshot = store.exportSnapshot(now)
  assert.equal(snapshot.report.from, '2026-10-05')
  assert.equal(snapshot.report.to, '2026-10-15')
  assert.equal(snapshot.events.length, 6)
  assert.deepEqual(snapshot.report.totals, { uv: 1, pv: 3, clicks: 3 })
  assert.ok(snapshot.events.every(row => /^[a-f0-9]{64}$/.test(row.visitor) && row.visitor !== visitor))
  const workbook = XLSX.read(analyticsWorkbook(snapshot), { type: 'buffer', cellNF: true })
  assert.deepEqual(workbook.SheetNames, ['统计说明', '访问总览', '每日趋势', '页面访问', '组件点击', '按钮点击', '分类按钮点击', '原始事件明细'])
  const rows = name => XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: null })
  assert.equal(rows('原始事件明细').length, 7)
  assert.deepEqual(rows('访问总览')[1], ['全站（跨页面去重）', 3, 1, 3, 2])
  const actions = rows('按钮点击')
  const source = actions.find(row => row[2] === '腾讯视频首页榜单' && row[3] === '查看官方来源')
  assert.equal(source[8], 1)
  const actionIndex = actions.indexOf(source)
  assert.equal(workbook.Sheets['按钮点击'][`I${actionIndex + 1}`].z, '0.00%')
  assert.equal(actions.find(row => row[2] === '-采集进度')[8], null)
  assert.equal(actions.find(row => row[3] === '点击搜索框')[4], 0)
  const raw = workbook.Sheets['原始事件明细']
  const rawIndex = rows('原始事件明细').findIndex(row => row[7] === '-采集进度') + 1
  assert.equal(raw[`H${rawIndex}`].t, 's')
  assert.equal(raw[`H${rawIndex}`].f, undefined)
})

test('空统计库也可以下载有效 Excel，记录范围和未知点击率明确', t => {
  const store = createAnalyticsStore(join(temp(t), 'events.sqlite'))
  t.after(() => store.close())
  const snapshot = store.exportSnapshot(now)
  assert.equal(snapshot.report.startedAt, null)
  assert.equal(snapshot.report.from, '2026-10-15')
  assert.equal(snapshot.events.length, 0)
  const workbook = XLSX.read(analyticsWorkbook(snapshot), { type: 'buffer' })
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets['原始事件明细']).length, 0)
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets['按钮点击'], { defval: null })[0]['页面点击率'], null)
})

test('统计API需要登录、隔离跨站写入、支持下载和退出；密码变更撤销会话', async (t) => {
  const directory = temp(t)
  writeFileSync(join(directory, 'auth.json'), JSON.stringify(await passwordHash('test-only-password-123')))
  const service = createAnalyticsService({ directory, production: true, now: () => now })
  const server = createServer((req, res) => service.handle(req, res, new URL(req.url, 'https://stats.test')))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); service.close() })
  const base = `http://127.0.0.1:${server.address().port}`
  const request = (path, body, cookie = '', origin = base) => fetch(base + '/api/analytics/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', origin, cookie, 'user-agent': 'test-browser' }, body: body === undefined ? undefined : JSON.stringify(body) })
  assert.equal((await request('report')).status, 401)
  assert.equal((await request('export')).status, 401)
  assert.equal((await request('export?type=all')).status, 401)
  assert.equal((await request('events', { visitor: randomUUID(), events: [event()] }, '', 'https://untrusted.test')).status, 403)
  assert.equal((await request('login', { password: 'wrong' })).status, 401)
  const response = await request('login', { password: 'test-only-password-123' })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Max-Age=28800; Secure/)
  const cookie = response.headers.get('set-cookie').split(';')[0]
  assert.equal((await request('events', { visitor: randomUUID(), events: [event(), event('click')] })).status, 202)
  const report = await (await request('report', undefined, cookie)).json()
  assert.deepEqual(report.totals, { uv: 1, pv: 1, clicks: 1 })
  const download = await request('export?type=daily', undefined, cookie)
  assert.equal(download.status, 200)
  assert.match(download.headers.get('content-disposition'), /attachment/)
  assert.match(await download.text(), /日期/)
  await request('events', { visitor: randomUUID(), events: [event('pageview', { at: now - 86400000 })] })
  const all = await request('export?type=all&from=2026-10-15&to=2026-10-15', undefined, cookie)
  assert.equal(all.status, 200)
  assert.match(all.headers.get('content-type'), /spreadsheetml\.sheet/)
  assert.match(all.headers.get('content-disposition'), /finetech-all-2026-10-14-2026-10-15\.xlsx/)
  const workbook = XLSX.read(Buffer.from(await all.arrayBuffer()), { type: 'buffer' })
  assert.equal(workbook.SheetNames.length, 8)
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets['原始事件明细']).length, 3)
  writeFileSync(join(directory, 'auth.json'), JSON.stringify(await passwordHash('changed-test-password')))
  assert.equal((await request('report', undefined, cookie)).status, 401)
  const next = await request('login', { password: 'changed-test-password' })
  const nextCookie = next.headers.get('set-cookie').split(';')[0]
  assert.equal((await request('logout', {}, nextCookie)).status, 200)
  assert.equal((await request('report', undefined, nextCookie)).status, 401)
})

test('浏览器埋点去掉StrictMode重复PV、区分组件、忽略输入与自用浏览器', async () => {
  const data = new Map(), listeners = new Map(), sent = []
  const win = { localStorage: { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) }, navigator: {}, crypto: { randomUUID }, setTimeout: () => 1, clearTimeout() {}, addEventListener() {}, removeEventListener() {} }
  const doc = { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener() {} }
  const tracker = createTracker({ win, doc, send: async (body) => { sent.push(JSON.parse(body)); return { ok: true } } })
  tracker.start(); tracker.page('home'); tracker.page('home')
  const button = { tagName: 'BUTTON', textContent: '有效播放', getAttribute: () => null, closest: (selector) => selector === '[data-analytics-component]' ? { getAttribute: () => '网端数据筛选' } : null }
  listeners.get('click')({ target: { closest: () => button } })
  const input = { ...button, tagName: 'INPUT', type: 'search', value: 'DO-NOT-LOG' }
  listeners.get('click')({ target: { closest: () => input } })
  await tracker.flush()
  assert.equal(sent[0].events.length, 2)
  assert.equal(sent[0].events[1].component, '网端数据筛选')
  assert.ok(!JSON.stringify(sent).includes('DO-NOT-LOG'))
  data.set(ANALYTICS_OPT_OUT, '1'); tracker.page('fetching'); await tracker.flush()
  assert.equal(sent.length, 1)
  assert.equal(analyticsName(' <搜索>   / 热度! '), '搜索 热度')
  tracker.stop()
})

test('搜索框与键盘提交可计数，输入内容不上传，切页前的点击保留来源页', async () => {
  const listeners = new Map(), sent = []
  const win = { localStorage: { getItem: () => null, setItem() {} }, navigator: {}, crypto: { randomUUID }, setTimeout: () => 1, clearTimeout() {}, addEventListener() {}, removeEventListener() {} }
  const doc = { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener() {} }
  const tracker = createTracker({ win, doc, send: async body => { sent.push(JSON.parse(body)); return { ok: true } } })
  const root = { getAttribute: () => '首页剧集搜索' }
  const input = { tagName: 'INPUT', type: 'search', value: 'PRIVATE-SEARCH', getAttribute: name => name === 'data-analytics-action' ? '点击搜索框' : null, closest: selector => selector === '[data-analytics-component]' ? root : null }
  tracker.start(); tracker.page('home')
  listeners.get('click')({ target: { closest: () => input } })
  listeners.get('submit')({ target: { getAttribute: () => '提交搜索', closest: input.closest } })
  tracker.page('dashboard.heat')
  const nav = { tagName: 'BUTTON', textContent: '台端热度', getAttribute: () => null, closest: selector => selector === '[data-analytics-component]' ? { getAttribute: () => '看板导航' } : null }
  listeners.get('click')({ target: { closest: () => nav } })
  tracker.page('dashboard.tv')
  await tracker.flush()
  const rows = sent.flatMap(batch => batch.events)
  assert.equal(rows.find(row => row.action === '点击搜索框').page, 'home')
  assert.equal(rows.filter(row => row.action === '提交搜索').length, 1)
  assert.equal(rows.find(row => row.action === '台端热度').page, 'dashboard.heat')
  assert.ok(!JSON.stringify(sent).includes('PRIVATE-SEARCH'))
  tracker.stop()
})
