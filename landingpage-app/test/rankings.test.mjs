import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { decodeSourceState } from '../server/source-state.mjs'
import { parseIqiyi, parseYoukuRanking, parseYoukuHeatReference, parseTencentList, parseTencentHeat, parseMango, mangoRankingApi, youkuRankingApi, youkuRankingData, rankingSources, supplementalRankingSources, chinaDate, readRanking } from '../server/ranking-sources.mjs'
import { createRankingsService, rankingAgreement, rankingPeriod, verifyRanking } from '../server/rankings.mjs'
const date = '2026-10-16'
const source = { id: 'test', limit: 2 }
const row = (rank, value = 100) => ({ id: `id${rank}`, title: `剧${rank}`, rank, value, unit: '热度', poster: '', url: '', director: '', actors: '' })
const snapshot = (rows = [row(1), row(2)], dataDate = date) => ({ requestedDate: date, dataDate, checkedDates: [dataDate], metric: '热度', rows, audit: [], fetchedAt: '2026-10-16T00:00:00Z' })
const readerSequence = sequence => { let index = 0; return async () => { const value = sequence[index++]; if (value instanceof Error) throw value; return structuredClone(value) } }
const mangoPayload = (count = 10) => ({ code: 200, serverTime: 1792220000000, data: { topList: [
  { label: '热门内容', data: [{ index: 1, name: '综艺热搜' }] },
  { label: '电视剧', data: Array.from({ length: count }, (_, i) => ({ index: i + 1, name: `芒果剧${i + 1}`, icon: '' })) },
] } })

test('Mango uses the TV hot-search category, keeps rank-only nulls and rejects invalid category/rank/identity', () => {
  const result = parseMango(mangoPayload(), date, date)
  assert.equal(result.rows.length, 10); assert.equal(result.rows[0].title, '芒果剧1')
  assert.equal(result.rows.every(row => row.value === null && row.unit === ''), true)
  assert.equal(result.rankOnly, true); assert.equal(result.metric, '热搜排名'); assert.equal(result.sourceCategory, '电视剧')
  assert.equal(result.dataDate, null); assert.equal(result.sourceUpdatedAt, null); assert.equal(result.observedDate, date)
  const missing = mangoPayload(); missing.data.topList.pop()
  assert.throws(() => parseMango(missing, date, date), /分类/)
  const duplicateGroup = mangoPayload(); duplicateGroup.data.topList.push(duplicateGroup.data.topList[1])
  assert.throws(() => parseMango(duplicateGroup, date, date), /分类/)
  const duplicate = mangoPayload(); duplicate.data.topList[1].data[1].name = '芒果剧1'
  assert.throws(() => parseMango(duplicate, date, date), /重复/)
  const unordered = mangoPayload(); unordered.data.topList[1].data[1].index = 3
  assert.throws(() => parseMango(unordered, date, date), /排名/)
  assert.throws(() => parseMango({ ...mangoPayload(), code: 503 }, date, date), /响应/)
  assert.throws(() => parseMango(mangoPayload(), date, '2026-10-17'), /历史日期/)
})
test('Mango reaches the official source twice; failure is repaired, and rank disagreement preserves only agreed terms', async () => {
  const today = chinaDate(); const mango = rankingSources.find(source => source.id === 'mango'); let calls = 0
  const fetcher = async (url, options) => {
    calls++; assert.equal(url, mangoRankingApi); assert.equal(options.headers['cache-control'], 'no-cache')
    if (calls === 1) throw new Error('temporary source failure')
    return Response.json(mangoPayload())
  }
  const verified = await verifyRanking(mango, today, (source, date) => readRanking(source, date, fetcher))
  assert.equal(verified.status, 'verified'); assert.equal(verified.passCount, 3); assert.equal(calls, 3)
  assert.equal(verified.candidates.length, 2); assert.equal(verified.candidates[0].audit[0].sourceUrl, mangoRankingApi)
  const first = parseMango(mangoPayload(), today, today); const changed = structuredClone(first)
  ;[changed.rows[0], changed.rows[1]] = [{ ...changed.rows[1], rank: 1 }, { ...changed.rows[0], rank: 2 }]
  const partial = await verifyRanking(mango, today, readerSequence([first, changed, first]))
  assert.equal(partial.status, 'verified'); assert.equal(partial.passCount, 3)
  const unresolved = await verifyRanking(mango, today, readerSequence([first, changed, { ...changed, rows: changed.rows.map(row => row.rank === 1 ? { ...row, id: 'third', title: '第三个词条' } : row) }]))
  assert.equal(unresolved.status, 'partial'); assert.equal(unresolved.rows.some(row => row.rank <= 2), false)
})
test('Mango confirmed empty category differs from failed requests and incomplete top ten', async () => {
  const today = chinaDate(); const mango = rankingSources.find(source => source.id === 'mango')
  const run = payload => verifyRanking(mango, today, (source, date) => readRanking(source, date, async () => Response.json(payload)))
  assert.equal((await run(mangoPayload(0))).status, 'empty')
  const partial = await run(mangoPayload(7)); assert.equal(partial.status, 'partial'); assert.equal(partial.rows.length, 7)
  const failed = await verifyRanking(mango, today, (source, date) => readRanking(source, date, async () => { throw new Error('timeout') }))
  assert.equal(failed.status, 'unavailable'); assert.equal(failed.passCount, 3); assert.equal(failed.candidates.length, 0)
})
const tencentList = (count = 12) => ({ ret: 0, data: { modules: { normal: { cards: [{ type: 'searchlist_card', children_list: {
  filter_card: { cards: [{ params: { filter_key: 'sort', is_selected: '1', option_value: '75' } }] },
  nav_card: { cards: [{ params: { is_selected: '1', filter_value: '100113' } }] },
  poster_card: { cards: Array.from({ length: count }, (_, i) => ({ type: 'searchlist_poster_card', id: `mzc00200drama${i}`, params: { cid: `mzc00200drama${i}`, first_vid_in_set: `v4102drama${i}`, type: '2', item_type: '2', title: `剧${i}`, sub_title: '演员甲 演员乙', new_pic_vt: `https://vcover-vt-pic.puui.qpic.cn/cover${i}` } })) },
} }] } } } })
const tencentDetail = (id, title, heat = '24951') => ({ ret: 0, data: { CardList: [{ type: 'pc_introduction', children_list: { '0': { cards: [{ type: 'pc_introduction', params: { 'report.cid': id, title, type: '2', hot_num: heat, hotval: `${heat}热度`, normal_matrix_info: `<font>VIP</font> · <image type="fire"/>${heat} · 全28集` } }] } } }] } })

test('Tencent takes the first ten in official order and validates the TV/hottest filters', () => {
  const payload = tencentList()
  const rows = parseTencentList(payload)
  assert.equal(rows.length, 10); assert.deepEqual(rows.map(row => row.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.equal(rows[9].title, '剧9'); assert.match(rows[0].url, /mzc00200drama0\/v4102drama0.html$/)
  payload.data.modules.normal.cards[0].children_list.filter_card.cards[0].params.option_value = '79'
  assert.throws(() => parseTencentList(payload), /排序/)
  const wrongChannel = tencentList(); wrongChannel.data.modules.normal.cards[0].children_list.nav_card.cards[0].params.filter_value = '100105'
  assert.throws(() => parseTencentList(wrongChannel), /频道/)
  const duplicate = tencentList(); duplicate.data.modules.normal.cards[0].children_list.poster_card.cards[1] = duplicate.data.modules.normal.cards[0].children_list.poster_card.cards[0]
  assert.throws(() => parseTencentList(duplicate), /重复/)
})
test('Tencent heat must match the detail identity and flame, without manufacturing zero from missing data', () => {
  const row = parseTencentList(tencentList())[0]
  assert.equal(parseTencentHeat(tencentDetail(row.id, row.title), row).value, 24951)
  assert.equal(parseTencentHeat(tencentDetail(row.id, row.title, '0'), row).value, 0)
  for (const value of ['', null, undefined, '热度待补充']) {
    const payload = tencentDetail(row.id, row.title)
    payload.data.CardList[0].children_list['0'].cards[0].params.hot_num = value
    assert.throws(() => parseTencentHeat(payload, row))
  }
  assert.throws(() => parseTencentHeat(tencentDetail('anothercid', row.title), row), /身份/)
  assert.throws(() => parseTencentHeat(tencentDetail(row.id, '另一部剧'), row), /身份/)
  const wrongFlame = tencentDetail(row.id, row.title, '249'); wrongFlame.data.CardList[0].children_list['0'].cards[0].params.normal_matrix_info = '<image type="fire"/>24951'
  assert.throws(() => parseTencentHeat(wrongFlame, row), /火焰/)
})
test('Tencent independently re-reads list and all ten details, retains live-date provenance and repairs transport failure', async () => {
  const today = chinaDate(); const calls = []
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body, headers: options.headers })
    assert.equal(options.method, 'POST'); assert.equal(options.headers.referer, 'https://v.qq.com/')
    assert.equal(options.headers.cookie, undefined); assert.equal(new URL(url).searchParams.has('vdevice_guid'), false)
    if (calls.length === 1) throw new Error('temporary source timeout')
    if (url.includes('getMVLPage')) return Response.json(tencentList())
    const index = Number(body.page_params.cid.match(/drama(\d+)$/)[1])
    // Preserve official list order even when a lower rank has a higher heat.
    return Response.json(tencentDetail(body.page_params.cid, `剧${index}`, String(20000 + index)))
  }
  const result = await verifyRanking(rankingSources.find(source => source.id === 'tencent'), today, (source, date) => readRanking(source, date, fetcher))
  assert.equal(result.status, 'verified'); assert.equal(result.passCount, 3); assert.equal(calls.length, 23)
  assert.equal(result.rows[0].value, 20000); assert.equal(result.rows[9].value, 20009)
  assert.equal(result.dataDate, null); assert.equal(result.sourceUpdatedAt, null); assert.equal(result.observedDate, today); assert.equal(result.dateBasis, 'current-observation')
  assert.deepEqual(result.checkedDates, []); assert.deepEqual(result.returnedRanks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.equal(result.candidates[0].audit.length, 11); assert.equal(result.candidates[1].audit.length, 11)
  assert.equal(result.candidates[0].audit[1].request.body.page_params.cid, result.rows[0].id)
})
test('Tencent partial detail failures preserve agreed rows; total failure cannot establish an empty board', async () => {
  const today = chinaDate(); const tencent = rankingSources.find(source => source.id === 'tencent')
  let failAll = false
  const fetcher = async (url, options) => {
    if (url.includes('getMVLPage')) return Response.json(tencentList())
    const id = JSON.parse(options.body).page_params.cid
    if (failAll || id.endsWith('drama3')) throw new Error('detail timeout')
    return Response.json(tencentDetail(id, `剧${id.match(/drama(\d+)$/)[1]}`))
  }
  const result = await verifyRanking(tencent, today, (source, date) => readRanking(source, date, fetcher))
  assert.equal(result.status, 'partial'); assert.equal(result.rows.length, 9); assert.equal(result.rows.some(row => row.rank === 4), false)
  assert.equal(result.candidates[0].rowFailures[0].rank, 4); assert.ok(result.candidates[0].audit.some(entry => entry.failure === 'detail timeout'))
  failAll = true
  const failure = await verifyRanking(tencent, today, (source, date) => readRanking(source, date, fetcher))
  assert.equal(failure.status, 'unavailable'); assert.equal(failure.candidates.length, 0); assert.equal(failure.passCount, 3)
})
test('current observations keep the first snapshot and enforce date, rank and episode identity', () => {
  const first = { ...snapshot(), dataDate: null, observedDate: date, dateBasis: 'current-observation', checkedDates: [] }
  assert.equal(rankingAgreement(first, { ...first, rows: [row(1, 100.9), row(2)] }, date), true)
  assert.equal(rankingAgreement(first, { ...first, rows: [row(1, 101), row(2)] }, date), false)
  assert.equal(rankingAgreement(first, { ...first, observedDate: '2026-10-17' }, date), false)
  assert.equal(rankingAgreement(first, { ...first, rows: [row(2), row(1)] }, date), false)
  assert.equal(rankingAgreement(first, { ...first, rows: [{ ...row(1), vid: 'changed' }, row(2)] }, date), false)
})

test('safe official SSR decoding supports compressed Nuxt and local Tencent aliases', () => {
  const nuxt = decodeSourceState('<script>window.__NUXT__=(function(a,b){return {x:a,y:b}})("剧",undefined);</script>', '__NUXT__')
  assert.equal(nuxt.x, '剧'); assert.equal(nuxt.y, null)
  const tencent = decodeSourceState('<script>window.ctx.data=(function(a){a.title="剧";return {item:a}})({});</script>', 'ctx.data')
  assert.equal(tencent.item.title, '剧')
})
test('SSR decoder rejects executable calls, prototype writes and remote property reads', () => {
  for (const value of ['fetch("https://evil.test")', 'window.cookie', '({__proto__: {x:1}})', '(function(a){a.__proto__={};return a})({})', '(function(){throw 1;return {}})()']) assert.throws(() => decodeSourceState(`<script>window.data=${value};</script>`, 'data'))
})
test('Shanghai calendar and 12:00 scheduling work across midnight and year changes', () => {
  assert.equal(chinaDate(Date.parse('2026-10-16T16:01:00Z')), '2026-10-17')
  assert.equal(rankingPeriod(Date.parse('2026-10-17T03:59:59Z')), '2026-10-16')
  assert.equal(rankingPeriod(Date.parse('2026-10-17T04:00:00Z')), '2026-10-17')
  assert.equal(rankingPeriod(Date.parse('2026-12-31T17:00:00Z')), '2026-12-31')
  assert.equal(rankingPeriod(Date.parse('2027-01-01T03:59:59Z')), '2026-12-31')
  assert.equal(rankingPeriod(Date.parse('2027-01-01T04:00:00Z')), '2027-01-01')
})
test('two independent reads retain first current snapshot strictly inside one percent', async () => {
  const result = await verifyRanking(source, date, readerSequence([snapshot(), snapshot([row(1, 100.9), row(2, 99.1)])]))
  assert.equal(result.status, 'verified'); assert.equal(result.passCount, 2); assert.equal(result.rows[0].value, 100)
  assert.equal(rankingAgreement(snapshot(), snapshot([row(1, 101), row(2)]), date), false)
})
test('historical values, zero baselines, ranks and identity require exact agreement', () => {
  assert.equal(rankingAgreement(snapshot([row(1)], '2026-10-15'), snapshot([row(1, 100.1)], '2026-10-15'), date), false)
  assert.equal(rankingAgreement(snapshot([row(1, 0)]), snapshot([row(1, 0.001)]), date), false)
  assert.equal(rankingAgreement(snapshot([row(1, null)]), snapshot([row(1, 0)]), date), false)
  assert.equal(rankingAgreement(snapshot([row(1)]), snapshot([{ ...row(1), id: 'other' }]), date), false)
})
test('third read cannot replace the first current snapshot with an out-of-tolerance majority', async () => {
  const result = await verifyRanking(source, date, readerSequence([snapshot([row(1)]), snapshot([row(1, 102)]), snapshot([row(1, 102)])]))
  assert.equal(result.status, 'unresolved'); assert.deepEqual(result.rows, [])
})
test('historical repair uses strict two-of-three consensus', async () => {
  const result = await verifyRanking(source, date, readerSequence([snapshot([row(1)], '2026-10-15'), snapshot([row(1, 105)], '2026-10-15'), snapshot([row(1, 105)], '2026-10-15')]))
  assert.equal(result.status, 'partial'); assert.equal(result.rows[0].value, 105); assert.equal(result.passCount, 3)
})
test('partial-pass preservation retains agreed rows and does not assert unresolved rows', async () => {
  const result = await verifyRanking(source, date, readerSequence([snapshot(), snapshot([row(1), row(2, 105)]), snapshot([row(1), row(2, 110)])]))
  assert.equal(result.status, 'partial'); assert.deepEqual(result.rows.map(row => row.rank), [1]); assert.equal(result.candidates.length, 3)
})
test('successful empty reads establish empty; failed requests do not', async () => {
  const empty = await verifyRanking(source, date, readerSequence([snapshot([], null), snapshot([], null)]))
  assert.equal(empty.status, 'empty')
  const failed = await verifyRanking(source, date, readerSequence([new Error('timeout'), new Error('timeout'), new Error('timeout')]))
  assert.equal(failed.status, 'unavailable'); assert.equal(failed.failures.length, 3)
  const partial = await verifyRanking(source, date, readerSequence([snapshot(), new Error('timeout'), snapshot()]))
  assert.equal(partial.status, 'verified'); assert.equal(partial.passCount, 3)
})
test('official iqiyi adapter checks TV category, metric and publisher timestamp', () => {
  const payload = { data: { items: [{ subCardTitle: '按实时热度排行最近更新10-16 19:30', contents: [{ channelId: 2, indexType: '1', aid: 'a1', title: '剧', order: 1, mainIndex: '6066', tags: '2026 / 古装 / 主演甲', img: '', pageUrl: '' }] }] } }
  const result = parseIqiyi(payload, date)
  assert.equal(result.rows[0].value, 6066); assert.equal(result.dataDate, date); assert.equal(result.sourceUpdatedAt, '2026-10-16T19:30:00+08:00')
  payload.data.items[0].contents[0].channelId = 6
  assert.throws(() => parseIqiyi(payload, date))
})
const youkuPayload = (count = 10) => ({ ret: ['SUCCESS::调用成功'], data: { nodes: [{ nodes: [{ data: { tabDataMap: { '电视剧': { nodes: [{ nodes: Array.from({ length: count }, (_, i) => ({ data: { rank: i + 1, keyword: `优酷剧${i + 1}`, title: `优酷剧${i + 1}`, videoInfo: '电视剧·都市', showId: String(7000 + i), posterImage: `http://m.ykimg.com/poster${i}`, searchIndexTitle: '搜索指数', searchIndexValue: '83.9w' } })) }] } } } }] }] } })

test('Youku parses the official TV hot-search group as rank-only observations', () => {
  const result = parseYoukuRanking(youkuPayload(), date, date)
  assert.deepEqual(result.rows.map(row => row.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.equal(result.rows[0].title, '优酷剧1'); assert.equal(result.rows[0].id, 'youku:tv:优酷剧1')
  assert.equal(result.rows.every(row => row.value === null && row.unit === ''), true)
  assert.equal(result.rankOnly, true); assert.equal(result.metric, '热搜排名'); assert.equal(result.sourceCategory, '电视剧')
  assert.equal(result.observedDate, date); assert.equal(result.dataDate, null); assert.equal(result.sourceUpdatedAt, null)
  const divergentLabel = youkuPayload(); divergentLabel.data.nodes[0].nodes[0].data.tabDataMap['电视剧'].nodes[0].nodes[0].data.title = '片名与热搜词不同'
  assert.equal(parseYoukuRanking(divergentLabel, date, date).rows[0].title, '优酷剧1')
  assert.throws(() => parseYoukuRanking({ ...youkuPayload(), ret: ['FAIL_SYS_ILLEGAL_ACCESS'] }, date, date), /成功状态/)
  assert.throws(() => parseYoukuRanking(youkuPayload(0), date, date), /词条/)
  assert.throws(() => parseYoukuRanking(youkuPayload(), date, '2026-10-17'), /历史日期/)
  const duplicate = youkuPayload(); duplicate.data.nodes[0].nodes[0].data.tabDataMap['电视剧'].nodes[0].nodes[1].data.keyword = '优酷剧1'
  duplicate.data.nodes[0].nodes[0].data.tabDataMap['电视剧'].nodes[0].nodes[1].data.title = '优酷剧1'
  assert.throws(() => parseYoukuRanking(duplicate, date, date), /重复/)
  const wrongCategory = youkuPayload(); wrongCategory.data.nodes[0].nodes[0].data.tabDataMap['电视剧'].nodes[0].nodes[0].data.videoInfo = '综艺·真人秀'
  assert.throws(() => parseYoukuRanking(wrongCategory, date, date), /分类/)
})
test('Youku performs a fresh token preflight and signed category read on each independent pass without auditing credentials', async () => {
  const today = chinaDate(); const youku = rankingSources.find(source => source.id === 'youku'); const calls = []
  const tokenCookie = '0123456789abcdef0123456789abcdef_1792228551396'; const encrypted = 'ephemeral-encrypted-cookie'
  const fetcher = async (url, options) => {
    const parsed = new URL(url); const params = parsed.searchParams
    calls.push({ url, params, options })
    if (!params.get('sign')) return { ok: true, status: 200, headers: { getSetCookie: () => [`_m_h5_tk=${tokenCookie}; Path=/`, `_m_h5_tk_enc=${encrypted}; Path=/`] }, text: async () => 'preflight' }
    const expected = createHash('md5').update(`0123456789abcdef0123456789abcdef&${params.get('t')}&23774304&${youkuRankingData}`).digest('hex')
    assert.equal(params.get('sign'), expected)
    assert.equal(params.get('data'), youkuRankingData)
    assert.equal(options.headers.cookie, `_m_h5_tk=${tokenCookie}; _m_h5_tk_enc=${encrypted}`)
    assert.equal(options.headers.referer, 'https://so.youku.com/search/q_')
    assert.match(options.headers['user-agent'], /Chrome\/120/)
    return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(youkuPayload()) }
  }
  const result = await verifyRanking(youku, today, (source, date) => readRanking(source, date, fetcher))
  assert.equal(result.status, 'verified'); assert.equal(result.passCount, 2); assert.equal(calls.length, 4)
  assert.deepEqual(calls.map(call => call.params.get('sign') ? 'signed' : 'preflight'), ['preflight', 'signed', 'preflight', 'signed'])
  assert.equal(result.candidates[0].audit.length, 2)
  assert.ok(result.candidates[0].audit.every(item => !JSON.stringify(item).includes(tokenCookie) && !JSON.stringify(item).includes(encrypted)))
  assert.equal(result.candidates[0].audit[1].request.step, 'signed-ranking-read')
})
const juyunluYoukuHtml = (entries = [
  ['yk-1', '嫁金钗', '9,266'], ['yk-2', '无可替代', '6,769'], ['yk-3', '此处通往繁星', '5,810'], ['yk-4', '一瓯春', '4,678'],
]) => `<div class="platform-divider" data-platform="youku">优酷</div>${entries.map(([id, title, value]) => `<article class="video-card" data-platform="youku" data-video-id="${id}" data-video-title="${title}"><h2 class="video-title">${title}</h2><div class="current-heat"><div class="heat-label">当前热度</div><div class="heat-value">${value}</div></div></article>`).join('')}<div class="platform-divider" data-platform="iqiyi">爱奇艺</div><article class="video-card" data-platform="iqiyi" data-video-id="other" data-video-title="不应混入"><h2 class="video-title">不应混入</h2><div class="heat-value">9999</div></article>`

test('Juyunlu parser keeps only the four Youku current-heat entries and their source identity', () => {
  const result = parseYoukuHeatReference(juyunluYoukuHtml(), date, date)
  assert.equal(result.metric, '聚云录当前热度参考'); assert.equal(result.sourceCategory, '优酷电视剧')
  assert.equal(result.rows.length, 4); assert.equal(result.partialReason, '聚云录当前仅返回 4 部电视剧')
  assert.deepEqual(result.rows.map(row => [row.title, row.value]), [['嫁金钗', 9266], ['无可替代', 6769], ['此处通往繁星', 5810], ['一瓯春', 4678]])
  assert.equal(result.rows.every(row => row.unit === '热度' && row.id.startsWith('juyunlu:youku:')), true)
  assert.equal(result.dataDate, null); assert.equal(result.observedDate, date); assert.deepEqual(result.checkedDates, [])
  assert.throws(() => parseYoukuHeatReference(juyunluYoukuHtml().replace('>嫁金钗</h2>', '>别的剧名</h2>'), date, date), /身份或热度/)
  assert.throws(() => parseYoukuHeatReference(juyunluYoukuHtml().replace('9,266', '待补充'), date, date), /身份或热度/)
  assert.throws(() => parseYoukuHeatReference(juyunluYoukuHtml(), date, '2026-10-17'), /历史日期/)
})

test('Juyunlu Youku heat is fetched fresh twice and applies the current-snapshot consensus rule', async () => {
  const today = chinaDate(); const source = supplementalRankingSources.find(item => item.id === 'youku-heat-reference'); let reads = 0
  const result = await verifyRanking(source, today, (item, requestedDate) => readRanking(item, requestedDate, async (url, options) => {
    reads++; assert.equal(url, source.url); assert.equal(options.cache, 'no-store'); assert.equal(options.headers['cache-control'], 'no-cache')
    return new Response(juyunluYoukuHtml())
  }))
  assert.equal(reads, 2)
  assert.equal(result.status, 'partial')
  assert.equal(result.passCount, 2)
  assert.equal(result.rows.length, 4); assert.equal(result.rows[0].value, 9266)
  assert.equal(result.candidates[0].audit.length, 1); assert.equal(result.candidates[1].audit.length, 1)
  assert.equal(result.candidates[0].audit[0].sourceUrl, source.url)
  const drifted = parseYoukuHeatReference(juyunluYoukuHtml([['yk-1', '嫁金钗', '9,360'], ['yk-2', '无可替代', '6,769'], ['yk-3', '此处通往繁星', '5,810'], ['yk-4', '一瓯春', '4,678']]), today, today)
  const first = parseYoukuHeatReference(juyunluYoukuHtml(), today, today)
  assert.equal(rankingAgreement(first, drifted, today), false)
})
test('cache-only reads never fetch, update coalesces, persists audits and preserves stale verified data on failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finetech-rankings-'))
  let calls = 0; let fail = false
  const reader = async source => { calls++; if (fail) throw new Error('source offline'); return { ...snapshot(Array.from({ length: source.limit }, (_, i) => row(i + 1))), requestedDate: date } }
  const service = createRankingsService({ directory, now: () => Date.parse('2026-10-16T06:00:00Z'), reader })
  try {
    await service.read(); assert.equal(calls, 0)
    await Promise.all([service.update(), service.update()]); assert.equal(calls, 12)
    const first = await service.read(); assert.equal(first.boards[0].rows.length, 5)
    assert.equal(first.boards.find(board => board.id === 'youku').heatReference.status, 'verified')
    assert.equal(first.boards.find(board => board.id === 'youku').heatReference.rows.length, 10)
    fail = true; await service.update()
    const stale = await service.read(); assert.equal(stale.boards[0].stale, true); assert.equal(stale.boards[0].rows.length, 5)
    const saved = JSON.parse(await readFile(join(directory, 'current.json'), 'utf8')); assert.equal(saved.boards.guduo.candidates.length, 2)
    const restarted = createRankingsService({ directory, now: () => Date.parse('2026-10-16T06:00:00Z'), reader })
    assert.equal((await restarted.read()).boards[0].rows.length, 5)
  } finally { service.stop(); await rm(directory, { recursive: true, force: true }) }
})
test('adding a supplemental ranking source triggers a refresh from a same-day legacy cache', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finetech-rankings-migration-'))
  const boards = Object.fromEntries(rankingSources.map(source => [source.id, { status: 'verified', rows: [row(1)], period: '2026-10-17' }]))
  await writeFile(join(directory, 'current.json'), JSON.stringify({ version: 1, boards, period: '2026-10-17', attempts: 3, lastAttemptAt: Date.now() }))
  let calls = 0
  const service = createRankingsService({ directory, now: () => Date.parse('2026-10-17T06:00:00Z'), reader: async source => {
    calls++
    return { ...snapshot(Array.from({ length: source.limit }, (_, i) => row(i + 1))), requestedDate: '2026-10-17' }
  } })
  try {
    const initial = await service.read()
    assert.equal(initial.boards.find(board => board.id === 'youku').heatReference.status, 'pending')
    await service.refreshIfDue()
    assert.equal(calls, 12)
    const refreshed = await service.read()
    assert.equal(refreshed.boards.find(board => board.id === 'youku').heatReference.status, 'verified')
  } finally { service.stop(); await rm(directory, { recursive: true, force: true }) }
})
test('Guduo fallback dates and details reach source again in both independent passes', async () => {
  const calls = []
  const fetcher = async url => {
    calls.push(url)
    const parsed = new URL(url)
    const payload = parsed.pathname.includes('/billboard/list') ? { code: 0, data: parsed.searchParams.get('date') === '2026-10-15' ? [{ category: 'DRAMA', showId: 1, name: '剧一', rank: 1, gdi: '71.25' }] : [] } : { showId: 1, show_name: '剧一', cover: '', director: '', actor_info: [] }
    return new Response(JSON.stringify(payload))
  }
  const guduo = { id: 'guduo', limit: 5 }
  const result = await verifyRanking(guduo, '2026-10-17', (source, date) => readRanking(source, date, fetcher))
  assert.equal(result.status, 'partial'); assert.equal(calls.length, 8)
  assert.deepEqual(result.checkedDates, ['2026-10-17', '2026-10-16', '2026-10-15'])
  assert.equal(result.dataDate, '2026-10-15'); assert.equal(result.candidates[0].audit.length, 4)
  assert.equal(result.rows[0].value, 71.25)
})
test('source failures retain URL and timing without manufacturing an empty observation', async () => {
  const result = await verifyRanking({ id: 'iqiyi', limit: 10, url: 'https://www.iqiyi.com/ranks1PCW/2/0' }, date, (source, date) => readRanking(source, date, async () => { throw new Error('timeout') }))
  assert.equal(result.status, 'unavailable'); assert.equal(result.candidates.length, 0)
  assert.match(result.failures[0].sourceUrl, /mesh.if.iqiyi.com/)
  assert.ok(result.failures[0].audit[0].finishedAt); assert.ok(result.elapsedMs >= 0)
})
test('noon refresh runs once at the boundary and migrates a legacy morning cache', async () => {
  for (const legacyMorning of [false, true]) {
    const directory = await mkdtemp(join(tmpdir(), 'finetech-rank-noon-'))
    const period = legacyMorning ? '2026-10-17' : '2026-10-16'
    const lastAttemptAt = Date.parse(legacyMorning ? '2026-10-16T22:00:00Z' : '2026-10-16T04:00:00Z')
    const boards = Object.fromEntries([...rankingSources, ...supplementalRankingSources].map(source => [source.id, { status: 'verified', rows: [row(1)], period }]))
    await writeFile(join(directory, 'current.json'), JSON.stringify({ version: 1, boards, period, attempts: 3, lastAttemptAt }))
    let time = Date.parse('2026-10-17T03:59:59Z'); let calls = 0
    const service = createRankingsService({ directory, now: () => time, reader: async source => {
      calls++
      return snapshot(Array.from({ length: source.limit }, (_, i) => row(i + 1)))
    } })
    try {
      if (!legacyMorning) { await service.refreshIfDue(); assert.equal(calls, 0) }
      time = Date.parse('2026-10-17T04:00:00Z')
      await service.refreshIfDue(); assert.equal(calls, 12)
      await service.refreshIfDue(); assert.equal(calls, 12)
      assert.equal((await service.read()).schedule, '每日 12:00（北京时间）')
      const saved = JSON.parse(await readFile(join(directory, 'current.json'), 'utf8'))
      assert.equal(saved.period, '2026-10-17'); assert.equal(saved.attempts, 1)
    } finally { service.stop(); await rm(directory, { recursive: true, force: true }) }
  }
})
test('scheduler catches up once, retries at bounded intervals and stops after three attempts per period', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finetech-rank-schedule-'))
  let time = Date.parse('2026-10-17T04:01:00Z'); let calls = 0
  const service = createRankingsService({ directory, now: () => time, reader: async () => { calls++; throw new Error('offline') } })
  try {
    await service.refreshIfDue(); const first = calls; assert.ok(first > 0)
    await service.refreshIfDue(); assert.equal(calls, first)
    time += 15 * 60_000; await service.refreshIfDue(); assert.equal(calls, first * 2)
    time += 15 * 60_000; await service.refreshIfDue(); assert.equal(calls, first * 3)
    time += 60 * 60_000; await service.refreshIfDue(); assert.equal(calls, first * 3)
    time = Date.parse('2026-10-18T04:00:00Z'); await service.refreshIfDue(); assert.equal(calls, first * 4)
  } finally { service.stop(); await rm(directory, { recursive: true, force: true }) }
})
