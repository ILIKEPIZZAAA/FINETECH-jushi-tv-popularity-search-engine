import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FilmIcon } from './FilmIcon.jsx'
import { fallbackSearchResults } from '../data/fallback.js'
import { PosterImage } from './PosterImage.jsx'

export function SearchPanel({ contentType = 'drama', query, hasSearched, results: remoteResults, isSearching = false, isChoosing = false, searchError = '', onChooseResult, ranking, onSearchSuggestion, activeSuggestion = -1, onActiveSuggestion }) {
  const panelRef = useRef(null)
  useLayoutEffect(() => {
    const panel = panelRef.current
    const anchor = panel?.parentElement?.querySelector('.search-bar')
    if (!panel || !anchor) return undefined
    const compact = window.matchMedia('(max-width: 1024px)')
    const viewport = window.visualViewport
    let frame = null
    const update = () => {
      frame = null
      if (!compact.matches) {
        panel.style.removeProperty('--search-panel-space')
        delete panel.dataset.placement
        return
      }
      const rect = anchor.getBoundingClientRect()
      const viewportTop = viewport?.offsetTop || 0
      const viewportBottom = viewportTop + (viewport?.height || window.innerHeight)
      const headerBottom = Math.max(viewportTop, document.querySelector('.global-header')?.getBoundingClientRect().bottom || 0)
      const below = Math.max(0, viewportBottom - rect.bottom - 12)
      const above = Math.max(0, rect.top - headerBottom - 20)
      const flip = below < 220 && above > below
      panel.dataset.placement = flip ? 'above' : 'below'
      panel.style.setProperty('--search-panel-space', `${Math.min(400, flip ? above : below)}px`)
    }
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(update)
    }
    update()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, { passive: true })
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule, { passive: true })
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule)
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
    }
  }, [])
  const normalizedQuery = query.trim().toLowerCase()
  const fallbackResults = fallbackSearchResults.filter((result) => {
    if (!normalizedQuery) return true
    return `${result.title} ${result.originalTitle}`.toLowerCase().includes(normalizedQuery)
  })
  const results = Array.isArray(remoteResults) ? remoteResults : fallbackResults
  const primaryResults = results.filter((result) => !result.identityUnverified)
  const unverifiedResults = results.filter((result) => result.identityUnverified)
  const [showUnverified, setShowUnverified] = useState(false)
  useEffect(() => {
    setShowUnverified(false)
  }, [query])
  const visibleResults = showUnverified ? results : primaryResults
  const recentLabel = contentType === 'variety' ? '近期热综' : '近期热剧'
  const recentRows = ranking?.rows?.slice(0, 5) || []
  const maximumHeat = Math.max(0, ...(ranking?.rows || []).map(row => typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : 0))

  return (
    <div ref={panelRef} id="hero-search-panel" className={`search-panel ${!hasSearched ? 'has-hot-recommendations' : ''}`} role="dialog" aria-label={hasSearched ? '剧综搜索结果' : recentLabel}>
      {!hasSearched ? (
        <div className="search-panel-empty">
          <div className="search-hot-list" data-analytics-component={contentType === 'variety' ? '骨朵全部综艺榜搜索推荐' : '骨朵综合剧集榜搜索推荐'}>
            {recentRows.length ? <>
              <h3 className="search-hot-heading">{recentLabel}</h3>
              <div className="search-hot-cards" role="listbox" aria-label={recentLabel}>{recentRows.map((row, index) => {
                const hasHeat = typeof row.value === 'number' && Number.isFinite(row.value)
                const rank = row.rank ?? index + 1
                const isTopThree = rank <= 3
                const isLowerRanked = rank === 4 || rank === 5
                return <button type="button" data-analytics-action={`选择${recentLabel}`} role="option" aria-selected={activeSuggestion === index} id={`recent-drama-${index}`} className={`search-hot-card ${isTopThree ? 'is-top-three' : ''} ${isLowerRanked ? 'is-lower-ranked' : ''}`} key={row.id} disabled={isChoosing} onMouseEnter={() => onActiveSuggestion?.(index)} onClick={() => onSearchSuggestion?.(row.title)} aria-label={`搜索${row.title}${hasHeat ? `，${row.unit || '热度'} ${row.value}` : ''}`}>
                  <span className="search-hot-rank">{rank}</span>
                  <span className="search-hot-title">{row.title}</span>
                  {hasHeat ? <><span className="search-hot-meter" aria-hidden="true"><span style={{ width: `${maximumHeat > 0 ? Math.max(0, row.value / maximumHeat * 100) : 0}%` }} /></span><span className="search-hot-value" title={row.unit}>{row.value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</span></> : <span className="search-hot-value">—</span>}
                </button>
              })}</div>
            </> : <p className="search-hot-note">榜单暂未就绪，你可以直接输入{contentType === 'variety' ? '综艺名' : '剧名'}搜索</p>}
          </div>
        </div>
      ) : (
        <div className="search-results" aria-live="polite">
          <div className="search-results-header">
            <strong>搜索结果</strong>
            {isSearching ? (
              <span className="search-status-loading">正在读取实时目录</span>
            ) : (
              <span>{primaryResults.length ? `找到 ${primaryResults.length} ${contentType === 'variety' ? '档相关综艺' : '部相关剧集'}` : `暂无匹配${contentType === 'variety' ? '综艺' : '剧集'}`}</span>
            )}
          </div>
          {searchError ? <p className="search-results-empty search-results-error" role="alert">{searchError}。请保留当前结果并重试选择。</p> : isSearching && !results.length ? <p className="search-results-empty">正在搜索{contentType === 'variety' ? '综艺' : '剧集'}…</p> : results.length ? (
            <div className="search-result-list">
              {visibleResults.map((result) => (
                <article className="search-result-item" key={`${result.provider || 'fallback'}-${result.providerId || result.title}-${result.year || ''}`}>
                  <div className="search-result-poster">
                    {result.poster ? (
                      <>
                        <PosterImage
                          src={result.poster}
                          width="64"
                          height="96"
                          fetchpriority="high"
                          alt=""
                          aria-hidden="true"
                          onError={(event) => {
                            event.currentTarget.hidden = true
                            event.currentTarget.nextElementSibling.hidden = false
                          }}
                        />
                        <span className="search-result-poster-fallback" hidden>{result.title?.slice(0, 1) || '剧'}</span>
                      </>
                    ) : <span className="search-result-poster-fallback"><FilmIcon /></span>}
                  </div>
                  <div className="search-result-copy">
                    <strong>{result.title}</strong>
                    {result.identityUnverified ? <small>同名条目，年份和身份待核实</small> : null}
                    <span>{contentType === 'variety' ? '嘉宾' : '主演'}：{result.actors || result.cast?.join(' / ') || '待补充'}</span>
                    <small>导演：{result.director || result.directors?.join(' / ') || '待补充'} · {result.year || '年份待补充'} · 首播：{result.firstAired || result.premiered || '待补充'} · {result.platform || result.platforms?.map((platform) => {
                      const dimension = platform.dimension === 'web' ? '网端' : '台端'
                      return platform.name === dimension ? dimension : `${platform.name} · ${dimension}`
                    }).join(' / ') || '平台待补充'}</small>
                  </div>
                  <button type="button" data-analytics-action="选择剧集" className="search-result-select" disabled={isSearching || isChoosing} onClick={() => onChooseResult(result)}>
                    选择
                  </button>
                </article>
              ))}
              {unverifiedResults.length ? <button type="button" data-analytics-action="展开待核实条目" className="search-unverified-toggle" onClick={() => setShowUnverified((current) => !current)}>{showUnverified ? '收起' : '查看'} {unverifiedResults.length} 个待核实同名条目</button> : null}
            </div>
          ) : (
            <p className="search-results-empty">换一个剧名试试，或从搜索框下方的示例开始。</p>
          )}
        </div>
      )}
    </div>
  )
}
