import { createHash } from 'node:crypto'

export const rankingSources = [
  { id: 'guduo', name: '骨朵', title: '综合剧集榜', limit: 5, url: 'https://d2.guduomedia.com/' },
  { id: 'tencent', name: '腾讯视频', title: '电视剧热播榜', limit: 10, url: 'https://v.qq.com/tv-series-list/v-index.html?filter_params=sort%3D75&page_id=channel_list_second_page&channel_id=100113' },
  { id: 'iqiyi', name: '爱奇艺', title: '电视剧热播榜', limit: 10, url: 'https://www.iqiyi.com/ranks1PCW/2/0' },
  { id: 'youku', name: '优酷', title: '电视剧热搜榜', limit: 10, url: 'https://www.youku.com/ku/webtv' },
  { id: 'mango', name: '芒果TV', title: '电视剧热搜榜', limit: 10, url: 'https://www.mgtv.com/' },
]
export const supplementalRankingSources = [
  { id: 'youku-heat-reference', name: '聚云录', title: '优酷电视剧当前热度参考', limit: 10, url: 'https://www.juyunlu.top/' },
]
export const chinaDate = (now = Date.now()) => new Date(Number(now) + 8 * 3_600_000).toISOString().slice(0, 10)
const previousDate = date => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null
export const safeUrl = value => typeof value === 'string' && /^https?:\/\//i.test(value) ? value.replace(/^http:/i, 'https:') : ''

async function get(url, audit, fetcher, options = {}) {
  const startedAt = new Date().toISOString()
  const request = { method: options.method || 'GET', ...(options.body ? { body: JSON.parse(options.body) } : {}) }
  try {
    const response = await fetcher(url, { ...options, headers: { 'cache-control': 'no-cache', 'user-agent': 'Mozilla/5.0 FINETECH-Rankings/1.0', ...options.headers }, signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`官网请求失败（HTTP ${response.status}）`)
    const text = await response.text()
    if (text.length > 8_000_000) throw new Error('官网响应超过大小限制')
    audit.push({ sourceUrl: url, request, startedAt, finishedAt: new Date().toISOString(), sha256: createHash('sha256').update(text).digest('hex') })
    return text
  } catch (error) {
    error.sourceUrl = url
    error.audit = [...audit, { sourceUrl: url, request, startedAt, finishedAt: new Date().toISOString(), failure: error.message }]
    throw error
  }
}

const tencentListApi = 'https://pbaccess.video.qq.com/trpc.multi_vector_layout.mvl_controller.MVLPageHTTPService/getMVLPage?&vversion_platform=2'
const tencentDetailApi = 'https://pbaccess.video.qq.com/trpc.vector_layout.page_view.PageService/getPage?video_appid=3000010&vversion_name=8.5.96&vversion_platform=2'
const tencentId = value => typeof value === 'string' && /^[a-zA-Z0-9]{10,32}$/.test(value)

export function parseTencentList(payload) {
  const groups = payload?.data?.modules?.normal?.cards
  if (payload?.ret !== 0 || !Array.isArray(groups)) throw new Error('腾讯电视剧列表响应未确认')
  const lists = groups.filter(card => card.type === 'searchlist_card')
  if (lists.length !== 1) throw new Error('腾讯电视剧列表结构已变化')
  const children = lists[0].children_list
  const sort = children?.filter_card?.cards?.filter(card => card.params?.filter_key === 'sort' && card.params?.is_selected === '1')
  const channel = children?.nav_card?.cards?.filter(card => card.params?.is_selected === '1')
  if (sort?.length !== 1 || sort[0].params.option_value !== '75' || channel?.length !== 1 || channel[0].params.filter_value !== '100113') throw new Error('腾讯最热排序或电视剧频道未确认')
  const cards = children?.poster_card?.cards
  if (!Array.isArray(cards) || !cards.length) throw new Error('腾讯未返回可核验的电视剧列表')
  // The site renders this first-page sequence left-to-right. Keep its order;
  // the detail-page heat is a separate field and must never re-sort the list.
  const rows = cards.slice(0, 10).map((card, index) => {
    const p = card.params
    if (card.type !== 'searchlist_poster_card' || p?.type !== '2' || p.item_type !== '2' || !tencentId(p.cid) || card.id !== p.cid || !tencentId(p.first_vid_in_set) || !p.title) throw new Error('腾讯列表剧目分类或身份未确认')
    return { id: p.cid, title: p.title, rank: index + 1, vid: p.first_vid_in_set, poster: safeUrl(p.new_pic_vt), url: `https://v.qq.com/x/cover/${p.cid}/${p.first_vid_in_set}.html`, director: '', actors: p.sub_title || '' }
  })
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('腾讯列表包含重复剧目')
  return rows
}

export function parseTencentHeat(payload, row) {
  const cards = payload?.data?.CardList
  if (payload?.ret !== 0 || !Array.isArray(cards)) throw new Error('腾讯详情响应未确认')
  const intro = cards.filter(card => card.type === 'pc_introduction')
    .flatMap(card => Object.values(card.children_list || {}).flatMap(group => group.cards || []))
    .filter(card => card.type === 'pc_introduction')
  if (intro.length !== 1) throw new Error('腾讯详情简介结构已变化')
  const p = intro[0].params
  const value = numeric(p?.hot_num)
  if (p?.['report.cid'] !== row.id || p.title !== row.title || p.type !== '2') throw new Error('腾讯详情身份与列表不符')
  // Cross-check the same heat field against the official rendered flame tag.
  // Missing or malformed fields are failures, never numerical zero/no-data.
  const flame = p.normal_matrix_info?.match(/<image type="fire"\/>((?:\d+)(?:\.\d+)?)(?=\s|·|<|$)/)
  if (value === null || value < 0 || p.hotval !== `${p.hot_num}热度` || flame?.[1] !== String(p.hot_num)) throw new Error('腾讯详情火焰热度值未确认')
  return { ...row, value, unit: '热度' }
}

async function readTencentRanking(requestedDate, audit, fetcher) {
  const observedDate = chinaDate()
  if (requestedDate !== observedDate) throw new Error('腾讯官网仅提供当前实时榜单，无法核验历史日期')
  const post = async (url, body) => {
    try {
      return JSON.parse(await get(url, audit, fetcher, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', origin: 'https://v.qq.com', referer: 'https://v.qq.com/' }, body: JSON.stringify(body) }))
    } catch (error) { error.sourceUrl ||= url; error.audit ||= [...audit]; throw error }
  }
  let list
  try {
    list = parseTencentList(await post(tencentListApi, { page_params: { channel_id: '100113', filter_params: 'sort=75', page_id: 'channel_list', page_type: 'operation' } }))
  } catch (error) { error.sourceUrl ||= tencentListApi; error.audit ||= [...audit]; throw error }
  const rows = []
  const rowFailures = []
  for (const row of list) {
    try {
      const payload = await post(tencentDetailApi, {
        page_params: { ad_wechat_authorization_status: '0', req_from: 'web_vsite', ad_exp_ids: '', pc_sdk_version: '', pc_oaid: '', new_mark_label_enabled: '1', pc_device_info: '', support_pc_yyb_mobile_app_engine: '0', pc_wegame_version: '', cid: row.id, history_vid: '', vid: row.vid, is_pc_new_detail_page: '0', is_from_web_flyflow: '1', lid: '' },
        page_bypass_params: { params: { caller_id: '3000010', platform_id: '2' }, scene: 'desk_detail', app_version: '' }, page_context: {},
      })
      rows.push(parseTencentHeat(payload, row))
    } catch (error) {
      const failure = { id: row.id, title: row.title, rank: row.rank, sourceUrl: tencentDetailApi, detailUrl: row.url, at: new Date().toISOString(), message: error.message }
      rowFailures.push(failure)
      if (error.audit?.length > audit.length) audit.push(...error.audit.slice(audit.length))
      audit.push({ ...failure, failure: error.message })
    }
  }
  if (chinaDate() !== observedDate || !rows.length) {
    const error = new Error(rows.length ? '腾讯实时采集跨越北京时间日期，需重新读取' : '腾讯前十详情热度均未通过读取核验')
    error.sourceUrl = tencentDetailApi; error.audit = [...audit]; throw error
  }
  // No publisher date is present. observedDate is our live-read date, kept
  // separate from the unknown source dataDate and sourceUpdatedAt.
  return { requestedDate, dataDate: null, sourceUpdatedAt: null, observedDate, dateBasis: 'current-observation', checkedDates: [], metric: '实时热度', rows, rowFailures, requestedRanks: list.map(row => row.rank), returnedRanks: rows.map(row => row.rank), partialReason: rowFailures.length ? '部分剧目详情读取失败，仅展示两次核验通过的条目' : list.length < 10 ? '官网首屏返回条目不足十部' : '' }
}

export function parseIqiyi(payload, requestedDate) {
  const section = payload?.data?.items?.[0]
  if (!Array.isArray(section?.contents) || !/按实时热度排行/.test(section.subCardTitle || '')) throw new Error('爱奇艺热播榜结构或口径未确认')
  const match = section.subCardTitle.match(/最近更新(\d{2}-\d{2})\s+(\d{2}:\d{2})/)
  if (!match) throw new Error('爱奇艺官网更新时间缺失')
  let year = Number(requestedDate.slice(0, 4))
  if (requestedDate.slice(5, 7) === '01' && match[1].startsWith('12')) year -= 1
  const dataDate = `${year}-${match[1]}`
  const rows = section.contents.slice(0, 10).map(item => {
    if (item.channelId !== 2 || item.indexType !== '1' || numeric(item.mainIndex) === null || !item.aid || !item.title) throw new Error('爱奇艺条目分类、身份或热度未确认')
    return { id: String(item.aid), title: item.title, rank: Number(item.order), value: numeric(item.mainIndex), unit: '热度', poster: safeUrl(item.img), url: safeUrl(item.pageUrl), director: '', actors: item.tags?.split(' / ').at(-1) || '' }
  })
  return { requestedDate, dataDate, sourceUpdatedAt: `${dataDate}T${match[2]}:00+08:00`, checkedDates: [dataDate], rows, metric: '实时热度', partialReason: '' }
}

export const youkuRankingApi = 'https://acs.youku.com/h5/mtop.youku.soku.yksearch/2.0/'
export const youkuRankingData = '{"pg":"1","pz":"10","appScene":"default_page","appCaller":"youku-search-sdk","searchFrom":"home","utdId":"NfP+IIzquwkCAd7a0yS+4fxD"}'
const youkuRankingHeaders = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  referer: 'https://so.youku.com/search/q_',
}

export function parseYoukuRanking(payload, requestedDate, observedDate = chinaDate()) {
  if (requestedDate !== observedDate) throw new Error('优酷官网仅提供当前热搜榜，无法核验历史日期')
  if (!Array.isArray(payload?.ret) || !payload.ret.some(value => String(value).startsWith('SUCCESS'))) throw new Error('优酷热搜榜接口未返回成功状态')
  const group = payload?.data?.nodes?.[0]?.nodes?.[0]?.data?.tabDataMap?.['电视剧']
  if (!Array.isArray(group?.nodes) || group.nodes.length !== 1 || !Array.isArray(group.nodes[0]?.nodes)) throw new Error('优酷电视剧热搜榜节点结构未确认')
  const items = group.nodes[0].nodes.map(node => node?.data)
  if (!items.length) throw new Error('优酷电视剧热搜榜未返回词条')
  const rows = items.map(item => {
    const rank = Number(item?.rank)
    const keyword = typeof item?.keyword === 'string' ? item.keyword.trim() : ''
    const title = typeof item?.title === 'string' ? item.title.trim() : ''
    if (!Number.isInteger(rank) || rank < 1 || rank > 10 || !keyword || !title || !/^电视剧(?:·|$)/.test(item.videoInfo || '')) throw new Error('优酷电视剧热搜词条的排名、身份或分类未确认')
    return { id: `youku:tv:${keyword}`, title: keyword, rank, value: null, unit: '', poster: safeUrl(item.posterImage), url: item.showId ? `https://www.youku.com/v_show/id_${encodeURIComponent(String(item.showId))}.html` : '', director: '', actors: '' }
  }).sort((a, b) => a.rank - b.rank)
  if (new Set(rows.map(row => row.rank)).size !== rows.length || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('优酷电视剧热搜榜包含重复名次或词条')
  return { requestedDate, dataDate: null, sourceUpdatedAt: null, observedDate, dateBasis: 'current-observation', checkedDates: [], metric: '热搜排名', rankOnly: true, identityBasis: 'search-term', sourceCategory: '电视剧', rows, partialReason: rows.length < 10 ? '优酷接口返回条目不足十条' : '' }
}

function youkuAuditUrl() {
  return `${youkuRankingApi}?jsv=2.7.5&appKey=23774304&t=[per-request]&sign=[redacted]&api=mtop.youku.soku.yksearch&v=2.0&ecode=1&data=[redacted]`
}

async function fetchYoukuText(url, audit, fetcher, request) {
  const startedAt = new Date().toISOString()
  try {
    const response = await fetcher(url, { headers: { 'cache-control': 'no-cache', ...youkuRankingHeaders, ...request.headers }, signal: AbortSignal.timeout(15_000), cache: 'no-store' })
    if (!response.ok) throw new Error(`优酷官网请求失败（HTTP ${response.status}）`)
    const text = await response.text()
    if (text.length > 8_000_000) throw new Error('优酷官网响应超过大小限制')
    audit.push({ sourceUrl: youkuAuditUrl(), request: { method: 'GET', step: request.step, category: '电视剧', parameters: request.parameters, dataSha256: createHash('sha256').update(youkuRankingData).digest('hex'), session: 'ephemeral; credentials omitted' }, startedAt, finishedAt: new Date().toISOString(), sha256: createHash('sha256').update(text).digest('hex') })
    return { text, headers: response.headers }
  } catch (error) {
    const safeMessage = String(error.message || '优酷官网请求失败').replace(url, youkuRankingApi)
    error.sourceUrl = youkuRankingApi
    error.message = safeMessage
    error.audit = [...audit, { sourceUrl: youkuAuditUrl(), request: { method: 'GET', step: request.step, category: '电视剧', parameters: request.parameters, dataSha256: createHash('sha256').update(youkuRankingData).digest('hex'), session: 'ephemeral; credentials omitted' }, startedAt, finishedAt: new Date().toISOString(), failure: safeMessage }]
    throw error
  }
}

function youkuCookies(headers) {
  const cookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : (headers.get('set-cookie') || '').split(/, (?=[^;,]+=)/)
  const values = cookies.map(cookie => cookie.split(';', 1)[0])
  const tokenCookie = values.find(cookie => cookie.startsWith('_m_h5_tk='))?.slice('_m_h5_tk='.length)
  const encrypted = values.find(cookie => cookie.startsWith('_m_h5_tk_enc='))?.slice('_m_h5_tk_enc='.length)
  if (!tokenCookie || !encrypted || !tokenCookie.includes('_')) throw new Error('优酷预请求未返回 MTOP token cookie')
  return { tokenCookie, encrypted, token: tokenCookie.slice(0, tokenCookie.indexOf('_')) }
}

async function readYoukuRanking(requestedDate, audit, fetcher) {
  const observedDate = chinaDate()
  if (requestedDate !== observedDate) throw new Error('优酷官网仅提供当前热搜榜，无法核验历史日期')
  const parameters = { jsv: '2.7.5', appKey: '23774304', api: 'mtop.youku.soku.yksearch', v: '2.0', ecode: '1', dataType: 'json', category: '电视剧' }
  const preflightQuery = new URLSearchParams({ ...parameters, t: String(Date.now()), sign: '', type: 'jsonp', dataType: 'jsonp', jsonpIncPrefix: 'soukuheaderSearch', callback: 'mtopjsonpsoukuheaderSearch1', data: youkuRankingData })
  const preflight = await fetchYoukuText(`${youkuRankingApi}?${preflightQuery}`, audit, fetcher, { step: 'token-preflight', parameters: { ...parameters, t: '[per-request]', sign: '[empty]', dataType: 'jsonp' } })
  let credentials
  try { credentials = youkuCookies(preflight.headers) }
  catch (error) { error.sourceUrl = youkuRankingApi; error.audit = [...audit]; throw error }
  const { tokenCookie, encrypted, token } = credentials
  const timestamp = String(Date.now())
  const sign = createHash('md5').update(`${token}&${timestamp}&23774304&${youkuRankingData}`).digest('hex')
  const signedQuery = new URLSearchParams({ jsv: '2.7.5', appKey: '23774304', t: timestamp, sign, api: 'mtop.youku.soku.yksearch', v: '2.0', ecode: '1', dataType: 'json', data: youkuRankingData })
  const signed = await fetchYoukuText(`${youkuRankingApi}?${signedQuery}`, audit, fetcher, { step: 'signed-ranking-read', parameters, headers: { cookie: `_m_h5_tk=${tokenCookie}; _m_h5_tk_enc=${encrypted}` } })
  let payload
  try { payload = JSON.parse(signed.text) } catch { throw Object.assign(new Error('优酷热搜榜响应 JSON 无法解析'), { sourceUrl: youkuRankingApi, audit: [...audit] }) }
  let snapshot
  try { snapshot = parseYoukuRanking(payload, requestedDate, observedDate) }
  catch (error) { error.sourceUrl = youkuRankingApi; error.audit = [...audit]; throw error }
  if (chinaDate() !== observedDate) throw Object.assign(new Error('优酷热搜榜读取跨越北京时间日期，需重新读取'), { sourceUrl: youkuRankingApi, audit: [...audit] })
  // Keep both cookie values in memory only for this signed request. They are
  // intentionally excluded from audit records, errors and persisted rows.
  return snapshot
}

export const mangoRankingApi = 'https://mobileso.bz.mgtv.com/pc/suggest/v1?allowedRC=1&src=mgtv&pc=1&q=&_support=10000000'
export function parseMango(payload, requestedDate, observedDate = chinaDate()) {
  if (requestedDate !== observedDate) throw new Error('芒果官网仅提供当前热搜榜，无法核验历史日期')
  if (payload?.code !== 200 || !Array.isArray(payload.data?.topList)) throw new Error('芒果热搜榜响应未确认')
  const groups = payload.data.topList.filter(group => group.label === '电视剧')
  if (groups.length !== 1 || !Array.isArray(groups[0].data)) throw new Error('芒果电视剧热搜榜分类缺失或重复')
  const rows = groups[0].data.slice(0, 10).map((item, index) => {
    if (typeof item.name !== 'string' || !item.name.trim() || item.index !== index + 1) throw new Error('芒果电视剧热搜词或排名未确认')
    // This source identifies search terms by name and provides no numerical
    // heat metric or content ID. Retain that identity and the official order.
    return { id: `mango:tv:${item.name}`, title: item.name, rank: item.index, value: null, unit: '', poster: '', url: '', director: '', actors: '' }
  })
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('芒果电视剧热搜榜包含重复词条')
  return { requestedDate, dataDate: null, sourceUpdatedAt: null, observedDate, dateBasis: 'current-observation', checkedDates: [], metric: '热搜排名', rankOnly: true, identityBasis: 'search-term', sourceCategory: '电视剧', sourceServerTime: payload.serverTime ?? null, rows, partialReason: rows.length && rows.length < 10 ? '官网返回条目不足十条' : '' }
}

const htmlText = value => value
  .replace(/<[^>]*>/g, '')
  .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10)
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[code.toLowerCase()] || entity
  }).trim()
const htmlAttribute = (tag, name) => {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))
  return match?.[2] ?? ''
}

export function parseYoukuHeatReference(html, requestedDate, observedDate = chinaDate()) {
  if (requestedDate !== observedDate) throw new Error('聚云录仅提供当前热度，无法核验历史日期')
  if (typeof html !== 'string' || !html.trim()) throw new Error('聚云录页面内容为空')
  const dividers = [...html.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)].filter(match => {
    const tag = match[0]
    return htmlAttribute(tag, 'class').split(/\s+/).includes('platform-divider') && htmlAttribute(tag, 'data-platform') === 'youku'
  })
  if (dividers.length !== 1) throw new Error('聚云录优酷平台区块缺失或重复')
  const sectionStart = dividers[0].index + dividers[0][0].length
  const nextDivider = [...html.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)].find(match => match.index > sectionStart && htmlAttribute(match[0], 'class').split(/\s+/).includes('platform-divider'))
  const section = html.slice(sectionStart, nextDivider?.index ?? html.length)
  const articles = [...section.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/gi)].filter(match => {
    const tag = match[0].match(/^<article\b[^>]*>/i)?.[0] || ''
    return htmlAttribute(tag, 'class').split(/\s+/).includes('video-card') && htmlAttribute(tag, 'data-platform') === 'youku'
  })
  if (!articles.length) throw new Error('聚云录优酷区块未返回电视剧条目')
  if (articles.length > 10) throw new Error('聚云录优酷区块返回条目超过十部')
  const rows = articles.map((article, index) => {
    const tag = article[0].match(/^<article\b[^>]*>/i)?.[0] || ''
    const id = htmlAttribute(tag, 'data-video-id').trim()
    const title = htmlAttribute(tag, 'data-video-title').trim()
    const titleMatch = article[0].match(/<h2\b[^>]*class=["'][^"']*\bvideo-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i)
    const heatMatch = article[0].match(/<[^>]*class=["'][^"']*\bheat-value\b[^"']*["'][^>]*>([\s\S]*?)<\//i)
    const visibleTitle = titleMatch ? htmlText(titleMatch[1]) : ''
    const heatText = heatMatch ? htmlText(heatMatch[1]).replace(/,/g, '') : ''
    const value = numeric(heatText)
    if (!id || !title || !visibleTitle || title !== visibleTitle || value === null || value < 0) throw new Error(`聚云录优酷第 ${index + 1} 条身份或热度未确认`)
    return { id: `juyunlu:youku:${id}`, title, rank: index + 1, value, unit: '热度', poster: '', url: '', director: '', actors: '' }
  })
  if (new Set(rows.map(row => row.id)).size !== rows.length || new Set(rows.map(row => row.title)).size !== rows.length) throw new Error('聚云录优酷区块包含重复剧目')
  return { requestedDate, dataDate: null, sourceUpdatedAt: null, observedDate, dateBasis: 'current-observation', checkedDates: [], metric: '聚云录当前热度参考', identityBasis: 'video-id-and-title', sourceCategory: '优酷电视剧', rows, partialReason: rows.length < 10 ? `聚云录当前仅返回 ${rows.length} 部电视剧` : '' }
}

export async function readRanking(source, requestedDate, fetcher = fetch) {
  const audit = []
  let snapshot
  if (source.id === 'mango') {
    try {
      snapshot = parseMango(JSON.parse(await get(mangoRankingApi, audit, fetcher, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36' } })), requestedDate)
    } catch (error) { error.sourceUrl ||= mangoRankingApi; error.audit ||= [...audit]; throw error }
  } else if (source.id === 'tencent') snapshot = await readTencentRanking(requestedDate, audit, fetcher)
  else if (source.id === 'iqiyi') {
    const url = 'https://mesh.if.iqiyi.com/portal/pcw/rankList/comSecRankList?page_st=0&tag=0&category_id=2&channelId=2&date=&pg_num=1&server=false&v=13.084.0&refresh=1'
    snapshot = parseIqiyi(JSON.parse(await get(url, audit, fetcher)), requestedDate)
  } else if (source.id === 'youku') snapshot = await readYoukuRanking(requestedDate, audit, fetcher)
  else if (source.id === 'youku-heat-reference') {
    const observedDate = chinaDate()
    if (requestedDate !== observedDate) throw Object.assign(new Error('聚云录仅提供当前热度，无法核验历史日期'), { sourceUrl: source.url })
    try {
      const html = await get(source.url, audit, fetcher, { cache: 'no-store', headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36', referer: source.url } })
      snapshot = parseYoukuHeatReference(html, requestedDate, observedDate)
    } catch (error) { error.sourceUrl ||= source.url; error.audit ||= [...audit]; throw error }
    if (chinaDate() !== observedDate) throw Object.assign(new Error('聚云录读取跨越北京时间日期，需重新读取'), { sourceUrl: source.url, audit: [...audit] })
  }
  else if (source.id === 'guduo') {
    let date = requestedDate
    const checkedDates = []
    let data
    for (let offset = 0; offset < 3; offset += 1) {
      const url = `https://d2.guduomedia.com/m/v3/billboard/list?type=DAILY&category=DRAMA&date=${date}&orderTitle=gdi&platformId=0`
      const payload = JSON.parse(await get(url, audit, fetcher))
      if (payload.code !== 0 || !Array.isArray(payload.data)) throw new Error('骨朵综合剧集榜响应未确认')
      checkedDates.push(date)
      data = payload.data
      if (data.length) break
      date = previousDate(date)
    }
    const rows = []
    for (const item of data.slice(0, 5)) {
      if (item.category !== 'DRAMA' || !item.showId || !item.name || numeric(item.gdi) === null) throw new Error('骨朵榜单身份或指数未确认')
      // Details are read again in every independent pass, never borrowed from
      // local search results or from a completed ranking pass.
      const detail = JSON.parse(await get(`https://d2.guduomedia.com/m/show/detail/${item.showId}`, audit, fetcher))
      if (String(detail.showId || detail.show_id) !== String(item.showId) || detail.show_name !== item.name) throw new Error('骨朵详情身份与榜单不符')
      rows.push({ id: String(item.showId), title: item.name, rank: Number(item.rank), value: numeric(item.gdi), unit: '骨朵热度', poster: safeUrl(detail.cover), url: `https://d2.guduomedia.com/m/detail_v3#show_id=${item.showId}`, director: detail.director || '', actors: (detail.actor_info || []).slice(0, 4).map(actor => actor.actorName).join(' / ') })
    }
    snapshot = { requestedDate, dataDate: rows.length ? date : null, sourceUpdatedAt: null, checkedDates, rows, metric: '骨朵热度指数', partialReason: rows.length && rows.length < 5 ? '官网返回条目不足五部' : '' }
  } else throw new Error('未知榜单来源')
  return { ...snapshot, audit, fetchedAt: new Date().toISOString() }
}
