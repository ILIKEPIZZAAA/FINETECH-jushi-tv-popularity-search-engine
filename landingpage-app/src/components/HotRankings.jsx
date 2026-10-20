import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useReveal } from '../hooks/useReveal.js'
import youkuLogo from '../assets/logos/youku-logo.png'
import mangoLogo from '../assets/logos/mgtv-logo.png'
import '../styles/rankings.css'

const RankingChart = lazy(() => import('./RankingChart.jsx'))
const platformIds = ['tencent', 'iqiyi', 'youku', 'mango']
const platformLogos = {
  tencent: 'https://yt3.googleusercontent.com/BZ0BcoBm1IDjD4a3XbhnHyNZ3MkLnT9FnRxj_ioc6V3yT2nqcCxR0acvzokp7B019c036G5LHQ=s900-c-k-c0x00ffffff-no-rj',
  iqiyi: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQmnwhBzm8NTNFbCg3Bhc9T9uDTMpgazgFAsmIdRCcPSJobhMU_VNv_LTbc&s=10',
  youku: youkuLogo,
  mango: mangoLogo,
}

function Board({ board: sourceBoard }) {
  const heatReference = sourceBoard.id === 'youku' ? sourceBoard.heatReference : null
  const hasCurrentHeat = heatReference && ['verified', 'partial'].includes(heatReference.status) && !heatReference.stale
  const board = sourceBoard.id === 'youku' ? {
    ...sourceBoard,
    title: '电视剧热度榜',
    url: heatReference?.url || 'https://www.juyunlu.top/',
    rankOnly: false,
    status: heatReference?.status || 'pending',
    rows: hasCurrentHeat ? [...heatReference.rows].sort((a, b) => b.value - a.value).slice(0, 4).map((row, index) => ({ ...row, rank: index + 1 })) : [],
  } : sourceBoard
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '0px', threshold: 0.01 })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  const rows = board.rows || []
  return <article ref={ref} className={`hot-ranking-card hot-ranking-${board.id}`} data-analytics-component={`${board.name}首页榜单`}>
    <header><img className="hot-ranking-logo" src={platformLogos[board.id]} alt={`${board.name} Logo`} /><div><span className="hot-ranking-platform">{board.name}</span><h3>{board.title}</h3></div></header>
    {rows.length ? <>
      <div className="hot-ranking-chart" aria-label={`${board.name}${board.title}`}>
        {board.rankOnly ? visible ? <Suspense fallback={<p className="hot-ranking-placeholder">正在绘制榜单…</p>}><RankingChart board={board} /></Suspense> : null : rows.some(row => row.value === null) ? <ol className="hot-ranking-rank-only" aria-label="官网已确认名次，热度值待核实">{rows.map(row => <li key={row.id}><span>{row.rank}</span><strong>{row.title}</strong></li>)}</ol> : visible ? <Suspense fallback={<p className="hot-ranking-placeholder">正在绘制榜单…</p>}><RankingChart board={board} /></Suspense> : null}
      </div>
    </> : <div className="hot-ranking-placeholder"><span>—</span><p>{board.status === 'empty' ? '官网尚未发布对应数据' : '暂无榜单数据'}</p></div>}
    <footer>
      <a href={board.url} target="_blank" rel="noreferrer" data-analytics-action={board.id === 'youku' ? '查看聚云录来源' : '查看官方来源'}>{board.id === 'youku' ? '数据来源：聚云录 ↗' : '查看官方来源 ↗'}</a>
    </footer>
  </article>
}

export function HotRankings({ rankings }) {
  const [sectionRef, isVisible] = useReveal()
  const boards = platformIds.map(id => rankings.boards.find(board => board.id === id)).filter(Boolean)
  return <section ref={sectionRef} className={`hot-rankings ${isVisible ? 'is-visible' : ''}`} aria-labelledby="hot-rankings-title">
    <header className="hot-rankings-heading"><h2 id="hot-rankings-title">今日热榜</h2><span className="hot-rankings-schedule">每日 12:00 更新</span></header>
    {rankings.loading || rankings.error ? <p role="status">{rankings.error || '正在读取已核验榜单…'}</p> : <RankingBoardsGrid boards={boards} />}
  </section>
}

function RankingBoardsGrid({ boards }) {
  const [gridRef, isVisible] = useReveal()
  return <div ref={gridRef} className={`hot-rankings-grid ${isVisible ? 'is-visible' : ''}`}>
    {boards.map(board => <Board board={board} key={board.id} />)}
  </div>
}
