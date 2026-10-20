import { useEffect, useState } from 'react'
import { ANALYTICS_OPT_OUT } from '../lib/analytics.js'
import { analyticsGroups, analyticsPageName, reportControlRows } from '../lib/analyticsCatalog.js'
import '../styles/analytics.css'

const day = (offset = 0) => new Date(Date.now() + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10)
async function api(path, options) {
  const response = await fetch(`/api/analytics/${path}`, options)
  const data = await response.json()
  if (!response.ok) { const error = new Error(data.error || '统计请求失败'); error.status = response.status; throw error }
  return data
}
const post = (body = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const format = (number) => Number(number || 0).toLocaleString('zh-CN')

function Table({ title, headers, rows, empty = '此时间范围暂无记录' }) {
  return <section className="stats-table-card"><h2>{title}</h2><div className="stats-table-scroll"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>) : <tr><td colSpan={headers.length}>{empty}</td></tr>}</tbody></table></div></section>
}

const percent = value => value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`

function PageInteractions({ report }) {
  const [groupId, setGroupId] = useState('home')
  const [pageId, setPageId] = useState('all')
  const [filter, setFilter] = useState('')
  const [onlyClicked, setOnlyClicked] = useState(false)
  const group = report.groups.find(item => item.id === groupId) || report.groups[0]
  const page = pageId === 'all' ? group : report.pages.find(item => item.page === pageId)
  const pageIds = pageId === 'all' ? group.pages : [pageId]
  const actions = pageId === 'all' ? group.actions : report.actions.filter(item => item.page === pageId)
  const rows = reportControlRows(actions, pageIds, page.uv).filter(row =>
    (!onlyClicked || row.clicks > 0) && `${row.component} ${row.action}`.toLowerCase().includes(filter.trim().toLowerCase()))
  const sections = new Map()
  for (const row of rows) {
    if (!sections.has(row.component)) sections.set(row.component, [])
    sections.get(row.component).push(row)
  }
  return <section className="stats-page-explorer" aria-labelledby="stats-explorer-title">
    <div className="stats-section-heading"><div><span className="stats-eyebrow">页面 → 组件 → 具体操作</span><h2 id="stats-explorer-title">每个按钮，归属清楚</h2><p>点击次数、去重点击人数及所属页面点击率，放在同一处查看。</p></div></div>
    <nav className="stats-page-tabs" aria-label="选择统计页面分类">{analyticsGroups.map(item => {
      const data = report.groups.find(value => value.id === item.id)
      return <button key={item.id} type="button" aria-pressed={groupId === item.id} onClick={() => { setGroupId(item.id); setPageId('all') }}><strong>{item.label}</strong><span>{format(data?.pv)} PV · {format(data?.uv)} UV</span><small>{format(data?.clicks)} 次交互</small></button>
    })}</nav>
    <div className="stats-explorer-toolbar">
      <label>具体页面<select aria-label="具体页面" value={pageId} onChange={event => setPageId(event.target.value)}><option value="all">{group.label}{group.pages.length > 1 ? ' · 全部子页面' : ''}</option>{group.pages.length > 1 ? group.pages.map(id => <option key={id} value={id}>{analyticsPageName(id)}</option>) : null}</select></label>
      <label className="stats-control-search">查找控件<input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="搜索框、腾讯视频、刷新、免责声明…" /></label>
      <label className="stats-opt-out"><input type="checkbox" checked={onlyClicked} onChange={event => setOnlyClicked(event.target.checked)} />仅看有点击的控件</label>
    </div>
    <div className="stats-page-summary" aria-label="当前页面概览">{[['页面访问', page.pv, 'PV'], ['访问人数', page.uv, 'UV'], ['点击次数', page.clicks, '次'], ['点击人数', page.clickUv, 'UV']].map(([label, value, unit]) => <div key={label}><span>{label}</span><strong>{format(value)} <small>{unit}</small></strong></div>)}</div>
    <p className="stats-rate-note">当前点击率分母：{pageId === 'all' ? group.label : analyticsPageName(pageId)}的 {format(page.uv)} 个访问 UV。控件点击人数按匿名浏览器去重；同一人反复点击只计一人。不同子页面合并时再次去重。</p>
    {sections.size ? [...sections].map(([component, items]) => <details className="stats-component-group" key={`${groupId}-${pageId}-${component}`} open>
      <summary><span>{component}</span><small>{items.length} 个操作 · {format(items.reduce((sum, item) => sum + item.clicks, 0))} 次点击</small></summary>
      <div className="stats-table-scroll"><table><thead><tr><th>控件 / 操作</th><th>发生页面</th><th>点击次数</th><th>点击人数 UV</th><th>页面点击率</th></tr></thead><tbody>{items.map(row => <tr key={row.action} className={row.clicks ? '' : 'stats-zero-row'}><td><strong>{row.action}</strong></td><td>{(row.sources?.length ? row.sources : pageIds).map(id => <span className="stats-page-badge" key={id}>{analyticsPageName(id)}</span>)}</td><td>{format(row.clicks)}</td><td>{format(row.uv)}</td><td><div className="stats-rate"><span>{percent(row.ctr)}</span>{row.ctr !== null && row.ctr !== undefined ? <i aria-hidden="true"><b style={{ width: `${row.ctr * 100}%` }} /></i> : null}</div></td></tr>)}</tbody></table></div>
    </details>) : <p className="stats-empty">没有匹配的控件，试试调整关键词或显示全部控件。</p>}
  </section>
}

export default function AnalyticsPage() {
  const [session, setSession] = useState(null)
  const [password, setPassword] = useState('')
  const [initialRange] = useState(() => ({ from: day(-6), to: day() }))
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [ignored, setIgnored] = useState(() => { try { return localStorage.getItem(ANALYTICS_OPT_OUT) !== '0' } catch { return true } })
  useEffect(() => { api('session').then(setSession).catch((reason) => setError(reason.message)) }, [])
  useEffect(() => {
    if (!session?.authenticated) return
    try { localStorage.setItem(ANALYTICS_OPT_OUT, ignored ? '1' : '0') } catch { /* browser may deny storage */ }
  }, [session, ignored])
  const load = async (event) => {
    event?.preventDefault()
    const range = event ? Object.fromEntries(new FormData(event.currentTarget)) : initialRange
    setBusy(true); setError(''); setReport(null)
    try { setReport(await api(`report?${new URLSearchParams(range)}`)) }
    catch (reason) { setError(reason.message); if (reason.status === 401) setSession({ authenticated: false, configured: true }) }
    finally { setBusy(false) }
  }
  useEffect(() => { if (session?.authenticated) void load() }, [session?.authenticated]) // Dates apply only on query.
  const login = async (event) => {
    event.preventDefault(); setBusy(true); setError('')
    try { await api('login', post({ password })); setPassword(''); setSession({ authenticated: true, configured: true }) }
    catch (reason) { setError(reason.message) }
    finally { setBusy(false) }
  }
  const logout = async () => {
    setError('')
    try { await api('logout', post()); setReport(null); setSession({ authenticated: false, configured: true }) }
    catch (reason) { setError(reason.message) }
  }
  const downloadAll = async () => {
    if (downloading) return
    setDownloading(true); setError('')
    try {
      const response = await fetch('/api/analytics/export?type=all')
      if (!response.ok) {
        const data = await response.json()
        if (response.status === 401) setSession({ authenticated: false, configured: true })
        throw new Error(data.error || '导出失败，请重试')
      }
      if (!response.headers.get('content-type')?.includes('spreadsheetml.sheet')) throw new Error('统计服务尚未加载 Excel 导出功能，请更新服务后重试')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      try {
        link.href = url
        link.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'finetech-all.xlsx'
        document.body.appendChild(link)
        link.click()
      } finally {
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 2000)
      }
    } catch (reason) { setError(reason.message) }
    finally { setDownloading(false) }
  }
  return <main className="stats-page" data-analytics-ignore>
    <header className="stats-header"><div><a href="/">FINETECH</a><p>网站访问与交互统计</p></div>{session?.authenticated && <button onClick={logout}>退出登录</button>}</header>
    {error && <p className="stats-error" role="alert">{error}</p>}
    {!session ? <p role="status">正在连接统计服务…</p> : !session.authenticated ? <section className="stats-login"><span className="stats-eyebrow">仅管理员可见</span><h1>统计看板</h1><p>查看访问趋势、组件及按钮点击，一键导出全部数据</p>{!session.configured ? <p role="status">管理员尚未在服务器设置统计密码，统计数据不会公开展示</p> : <form onSubmit={login}><label htmlFor="stats-password">管理员密码</label><input id="stats-password" type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} /><button disabled={busy}>{busy ? '登录中…' : '登录'}</button></form>}</section> : <>
      <div className="stats-heading"><div><span className="stats-eyebrow">站点运营</span><h1>访问与交互概览</h1></div><label className="stats-opt-out"><input type="checkbox" checked={ignored} onChange={(event) => setIgnored(event.target.checked)} />忽略本浏览器的后续访问</label></div>
      <form className="stats-filters" onSubmit={load}><label>开始日期<input type="date" name="from" required defaultValue={initialRange.from} max={day()} /></label><label>结束日期<input type="date" name="to" required defaultValue={initialRange.to} max={day()} /></label><button disabled={busy}>{busy ? '查询中…' : '查询 / 刷新'}</button><span>北京时间 · 最多查询 366 天</span></form>
      <section className="stats-download"><div><h2>下载全部数据</h2><p>一次导出当前留存的全部历史数据，按 Sheet 分类；不受上方查询和页面筛选影响。</p></div><button type="button" onClick={downloadAll} disabled={downloading} aria-busy={downloading}>{downloading ? '正在打包全部数据…' : '一键下载全部数据（Excel）↓'}</button></section>
      {report && <>
        <div className="stats-cards">{[['UV', report.totals.uv, '区间内去重匿名浏览器'], ['PV', report.totals.pv, '页面进入及刷新次数'], ['交互点击', report.totals.clicks, '按钮、链接与图表点击']].map(([label, value, detail]) => <section key={label}><span>{label}</span><strong>{format(value)}</strong><small>{detail}</small></section>)}</div>
        {report.groups?.length ? <PageInteractions report={report} /> : <p className="stats-error">统计服务尚未加载页面分组，请重启服务后重新查询。</p>}
        <Table title="每日趋势" headers={['日期', 'UV', 'PV', '点击次数']} rows={report.daily.map((row) => [row.day, format(row.uv), format(row.pv), format(row.clicks)])} />
        <Table title="页面访问明细" headers={['页面', 'PV', 'UV', '点击次数', '点击人数 UV']} rows={report.pages.map((row) => [analyticsPageName(row.page), format(row.pv), format(row.uv), format(row.clicks), format(row.clickUv)])} />
        <aside className="stats-notes"><h2>统计口径</h2><p>数据从接入后开始记录，历史未采集的点击无法补算。新增控件名称从本次更新起记录；旧记录保留原来的组件和操作名。{report.startedAt ? `当前留存记录最早日期：${report.startedAt}。` : '尚未收到访问记录。'}数据保留约 365 天。</p><p>页面点击率 = 查询区间内访问过该页面、且点击过该控件的去重 UV ÷ 该页面访问 UV。没有页面访问时显示“—”。这是页面访问口径，未衡量控件实际曝光。区间内只有点击、没有页面进入的访客仍计入点击人数，但不进入点击率分子。</p><p>UV 按匿名浏览器标识去重；换设备、清除存储或禁用存储可能产生新的 UV，区间 UV 不等于每日 UV 之和。导航按钮的点击归属点击前所在页面，切换后的页面另计 PV。看板大类 UV 跨子页面去重；切换数据维度仅计入点击。</p><p>不保存搜索输入、IP 地址和个人资料。遵循浏览器 DNT / GPC 设置；统计页自身不计数。拦截工具、网络失败和未触发点击的拖动操作会造成漏计，统计结果不能当作精确人数。</p></aside>
      </>}
    </>}
  </main>
}
