import { useEffect, useMemo, useRef, useState } from 'react'
import { searchDramas } from '../lib/dramaApi.js'
import { PosterImage } from './PosterImage.jsx'

const recommendationSeed = [
  {
    id: 'catalog-1506550',
    title: '冬至',
    premiered: '2024-12-20',
    platforms: '爱奇艺 · 腾讯视频',
    director: '于中中',
    cast: '黄景瑜 / 孙千 / 施诗',
    dimensions: ['网端', '台端'],
    poster: '冬',
    color: '#d7e4f7',
  },
  {
    id: 'catalog-1210389',
    title: '白夜破晓',
    premiered: '2024-11-20',
    platforms: '优酷',
    director: '刘英剑',
    cast: '潘粤明 / 王龙正 / 梁缘',
    dimensions: ['网端'],
    poster: '白',
    color: '#e5ddcf',
  },
  {
    id: 'catalog-1513026',
    title: '无忧渡',
    premiered: '2025-04-12',
    platforms: '腾讯视频 · 优酷',
    director: '林玉芬',
    cast: '任嘉伦 / 宋祖儿 / 宣言',
    dimensions: ['网端', '台端'],
    poster: '忧',
    color: '#d9eadf',
  },
  {
    id: 'catalog-1438802',
    title: '藏海传',
    premiered: '2025-05-18',
    platforms: '优酷',
    director: '郑晓龙',
    cast: '肖战 / 张婧仪 / 周奇',
    dimensions: ['网端'],
    poster: '藏',
    color: '#e5d9ed',
  },
]

const competitorSeed = [recommendationSeed[0], recommendationSeed[1]]

function Poster({ item }) {
  return (
    <div className="web-heat-competitor-poster" style={{ '--poster-color': item.color }} aria-label={`${item.title}海报`}>
      {item.posterUrl ? <PosterImage src={item.posterUrl} alt={`${item.title}海报`} width="64" height="96" onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.nextElementSibling.hidden = false }} /> : null}
      <span hidden={Boolean(item.posterUrl)}>{item.poster}</span>
    </div>
  )
}

function DimensionTags({ dimensions }) {
  return (
    <div className="web-heat-competitor-tags">
      {dimensions.map((dimension) => <span key={dimension}>{dimension}可比</span>)}
    </div>
  )
}

function displayItem(item) {
  if (!item) return item
  const dimensions = item.dimensions || [...new Set((item.platforms || []).map((platform) => platform.dimension === 'web' ? '网端' : platform.dimension === 'tv' ? '台端' : '').filter(Boolean))]
  const platformNames = typeof item.platforms === 'string' ? [] : (item.platforms || []).map((platform) => platform.name).filter(Boolean)
  const specificPlatformNames = platformNames.filter((name) => name !== '网端' && name !== '台端')
  const posterIsUrl = typeof item.poster === 'string' && /^(?:https?:|data:|\/assets\/)/.test(item.poster)
  return {
    ...item,
    id: item.id || `${item.provider || 'catalog'}-${item.providerId || item.title}`,
    premiered: item.premiered || '首播待补充',
    platforms: typeof item.platforms === 'string' ? item.platforms : (specificPlatformNames.length ? specificPlatformNames : platformNames).join(' · ') || '平台待补充',
    director: item.director || item.directors?.join(' / ') || '待补充',
    cast: item.castText || (Array.isArray(item.cast) ? item.cast.join(' / ') : item.cast) || '待补充',
    dimensions,
    posterUrl: posterIsUrl ? item.poster : '',
    poster: !posterIsUrl && typeof item.poster === 'string' ? item.poster : item.title?.slice(0, 1) || '剧',
    color: item.color || '#d7e4f7',
  }
}

function normalizeSearchTitle(value = '') {
  return String(value).normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, '')
}

function searchResultCompleteness(item) {
  return [
    item.posterUrl,
    item.premiered && item.premiered !== '首播待补充',
    item.platforms && item.platforms !== '平台待补充',
    item.director && item.director !== '待补充',
    item.cast && item.cast !== '待补充',
    item.sourceUrl,
  ].filter(Boolean).length * 10 + Number(item.score || 0)
}

function dedupeSearchResults(items = []) {
  const groups = new Map()
  for (const item of items) {
    const key = normalizeSearchTitle(item.title)
    if (!key) continue
    const bucket = groups.get(key) || []
    bucket.push(item)
    groups.set(key, bucket)
  }
  return [...groups.values()].flatMap((bucket) => {
    const years = [...new Set(bucket.map((item) => item.year || (item.premiered && /^\d{4}/.test(item.premiered) ? item.premiered.slice(0, 4) : '')).filter(Boolean))]
    const candidates = years.length > 1
      ? years.map((year) => bucket.filter((item) => String(item.year || item.premiered || '').startsWith(String(year))).sort((a, b) => searchResultCompleteness(b) - searchResultCompleteness(a))[0]).filter(Boolean)
      : [bucket.sort((a, b) => searchResultCompleteness(b) - searchResultCompleteness(a))[0]]
    return candidates
  })
}

export function CompetitorModule({
  mainTitle = '逐玉',
  mainProject = null,
  competitors: remoteCompetitors,
  recommendations: remoteRecommendations,
  recommendationWindow,
  recommendationLoading = false,
  recommendationError = '',
  onAddCompetitor,
  onRemoveCompetitor,
  onLoadRecommendations,
  collectingProjectIds = {},
  collectingTvRatingsById = {},
}) {
  const [localCompetitors, setLocalCompetitors] = useState(competitorSeed)
  const [localRecommendations, setLocalRecommendations] = useState(recommendationSeed.slice(2))
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [submittedSearch, setSubmittedSearch] = useState(null)
  const [remoteSearchResults, setRemoteSearchResults] = useState([])
  const [searchError, setSearchError] = useState('')
  const [isSearchLoading, setIsSearchLoading] = useState(false)
  const [pendingAdds, setPendingAdds] = useState([])
  const pendingAddIds = useRef(new Set())
  const [localRecommendationLoading, setLocalRecommendationLoading] = useState(false)
  const isLive = Boolean(mainProject)
  const competitors = (isLive ? remoteCompetitors || [] : localCompetitors).map(displayItem)
  const recommendations = (isLive ? remoteRecommendations || [] : localRecommendations).map(displayItem)
  const recommendationBusy = recommendationLoading || localRecommendationLoading
  const currentProject = displayItem(mainProject || { title: mainTitle, poster: mainTitle?.slice(0, 1) || '剧', premiered: '首播待补充', platforms: [] })

  useEffect(() => {
    if (!isLive || !isSearchOpen || !submittedSearch) {
      setRemoteSearchResults([])
      setIsSearchLoading(false)
      return undefined
    }
    let cancelled = false
    setIsSearchLoading(true)
    const runSearch = async () => {
      try {
        const payload = await searchDramas(submittedSearch.term)
        if (cancelled) return
        const results = Array.isArray(payload) ? payload : payload?.results
        setRemoteSearchResults(Array.isArray(results) ? results : [])
        setSearchError('')
      } catch (error) {
        if (cancelled) return
        setRemoteSearchResults([])
        setSearchError(error instanceof Error ? error.message : '搜索竞品失败')
      } finally {
        if (!cancelled) setIsSearchLoading(false)
      }
    }
    runSearch()
    return () => { cancelled = true }
  }, [isLive, isSearchOpen, submittedSearch])

  const searchResults = useMemo(() => {
    const keyword = submittedSearch?.term.toLowerCase() || ''
    const base = isLive && keyword.length >= 2 ? dedupeSearchResults(remoteSearchResults.map(displayItem)) : isLive ? recommendations : recommendationSeed
    if (!keyword) return base
    return base.filter((item) => `${item.title}${item.director}${item.cast}`.toLowerCase().includes(keyword))
  }, [isLive, recommendations, remoteSearchResults, submittedSearch])

  const submitSearch = (event) => {
    if (event.nativeEvent.isComposing) return
    const term = searchTerm.trim()
    if (term.length < 2) {
      setSubmittedSearch(null)
      setRemoteSearchResults([])
      setSearchError('请输入至少两个字，再按回车搜索')
      return
    }
    setSearchError('')
    setRemoteSearchResults([])
    setSubmittedSearch({ term })
  }

  const addCompetitor = async (item) => {
    if (competitors.some((competitor) => competitor.id === item.id)) return
    if (competitors.length >= 4) {
      setSearchError('竞品池已满，最多只能添加 4 部竞品')
      setIsSearchOpen(true)
      return
    }
    if (isLive) {
      if (pendingAddIds.current.has(item.id)) return
      pendingAddIds.current.add(item.id)
      setPendingAdds((current) => [...current, item.id])
      try {
        await onAddCompetitor?.(item)
        setSearchError('')
        return
      } catch (error) {
        setSearchError(error instanceof Error ? error.message : '加入看板失败')
        return
      } finally {
        pendingAddIds.current.delete(item.id)
        setPendingAdds((current) => current.filter((id) => id !== item.id))
      }
    }
    setLocalCompetitors((current) => [...current, item])
    setLocalRecommendations((current) => current.filter((candidate) => candidate.id !== item.id))
    setIsSearchOpen(false)
  }

  const removeCompetitor = (id) => {
    const removed = competitors.find((competitor) => competitor.id === id)
    if (isLive) {
      onRemoveCompetitor?.(id)
      return
    }
    setLocalCompetitors((current) => current.filter((competitor) => competitor.id !== id))
    if (removed) setLocalRecommendations((current) => [...current, removed])
  }

  const matchRecommendations = async () => {
    if (recommendationBusy) return
    if (isLive) {
      await onLoadRecommendations?.(mainProject, true)
      return
    }
    setLocalRecommendationLoading(true)
    try {
      await Promise.resolve()
      setLocalRecommendations(recommendationSeed.filter((item) => !competitors.some((competitor) => competitor.id === item.id)))
    } finally {
      setLocalRecommendationLoading(false)
    }
  }

  return (
    <div className="web-heat-competitor-page" data-analytics-component="同期竞品管理">
      <header className="web-heat-competitor-heading">
        <div>
          <h1>剧目对比选择</h1>
        </div>
        <div className="web-heat-competitor-current">
          <Poster item={currentProject} />
          <div>
            <span>当前主项目</span>
            <strong>{mainTitle}</strong>
            <small>{mainProject ? `首播 ${mainProject.premiered || '待补充'} · ${mainProject.platforms?.map((platform) => platform.dimension === 'web' ? '网端' : '台端').join(' / ') || '播出端待补充'}` : '首播 2025-05-01 · 网端 / 台端'}</small>
          </div>
        </div>
      </header>

      <section className="web-heat-competitor-actions" aria-label="竞品操作">
        <article className="web-heat-competitor-action-card">
          <strong>手动搜索添加</strong>
          <button type="button" onClick={() => {
            setSearchTerm('')
            setSubmittedSearch(null)
            setRemoteSearchResults([])
            setSearchError(competitors.length >= 4 ? '竞品池已满，最多只能添加 4 部竞品' : '')
            setIsSearchOpen(true)
          }}>搜索竞品</button>
        </article>
        <article className="web-heat-competitor-action-card is-recommend">
          <strong>自动推荐同期剧</strong>
          <button type="button" data-analytics-action="重新匹配" onClick={matchRecommendations} disabled={recommendationBusy} aria-busy={recommendationBusy}>{recommendationBusy ? <><span className="web-heat-spinner" aria-hidden="true" />匹配中</> : '重新匹配'}</button>
        </article>
      </section>

      <section className="web-heat-competitor-section">
        <div className="web-heat-competitor-section-heading">
          <div><h2>推荐候选</h2><span>{recommendationBusy ? '正在匹配同期剧集' : `${recommendations.length} 部同期剧集`}</span></div>
          <small>按当前剧目首播日前后各10天抓取同期剧集{recommendationWindow ? `（${recommendationWindow.start}—${recommendationWindow.end}）` : ''}</small>
        </div>
        <div className="web-heat-recommendation-list">
          {recommendations.map((item) => (
            <article className="web-heat-recommendation-row" key={item.id}>
              <Poster item={item} />
              <div className="web-heat-competitor-info">
                <strong>{item.title}</strong>
                <span>{item.premiered} · {item.platforms}</span>
                <small>导演 {item.director} · 主演 {item.cast}</small>
                <DimensionTags dimensions={item.dimensions} />
              </div>
              <button type="button" data-analytics-action="推荐候选 加入看板" className="web-heat-outline-button" disabled={pendingAdds.includes(item.id)} aria-busy={pendingAdds.includes(item.id)} onClick={() => addCompetitor(item)}>{pendingAdds.includes(item.id) ? '正在加入看板…' : '加入看板'}</button>
            </article>
          ))}
          {recommendations.length === 0 && !recommendationError && <div className="web-heat-competitor-empty">暂无可选同期候选，可手动搜索添加。</div>}
          {recommendationError && <div className="web-heat-competitor-empty">{recommendationError}</div>}
        </div>
      </section>

      <section className="web-heat-competitor-section">
        <div className="web-heat-competitor-section-heading">
          <div><h2>当前剧目对比池</h2><span>{competitors.length} 部竞品</span></div>
        </div>
        <div className="web-heat-competitor-list">
          {competitors.map((item) => (
            <article className={`web-heat-competitor-card ${collectingProjectIds?.[item.id] || collectingTvRatingsById?.[item.id] ? 'is-collecting' : ''}`} key={item.id}>
              <div className="web-heat-competitor-card-main">
                <Poster item={item} />
                <div className="web-heat-competitor-info">
                  <strong>{item.title}</strong>
                  <span>{item.premiered} · {item.platforms}</span>
                  {(collectingProjectIds?.[item.id] || collectingTvRatingsById?.[item.id]) && <small className="web-heat-collecting-status"><i className="web-heat-spinner" aria-hidden="true" />数据抓取中</small>}
                </div>
                <button type="button" data-analytics-action="移除竞品" className="web-heat-remove-button" onClick={() => removeCompetitor(item.id)}>移除</button>
              </div>
              <dl className="web-heat-competitor-facts">
                <div><dt>导演</dt><dd>{item.director}</dd></div>
                <div><dt>主演</dt><dd>{item.cast}</dd></div>
                <div><dt>播出平台</dt><dd>{item.platforms === item.dimensions.join(' / ') ? item.platforms : `${item.platforms} · ${item.dimensions.join(' / ')}`}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      {isSearchOpen && (
        <div className="web-heat-competitor-modal-backdrop" role="presentation" onClick={() => setIsSearchOpen(false)}>
          <section className="web-heat-competitor-modal" data-analytics-component="竞品搜索弹窗" role="dialog" aria-modal="true" aria-label="搜索对比剧目" onClick={(event) => event.stopPropagation()}>
            <header><div><h2>搜索对比剧目</h2><p>为《{mainTitle}》搜索可比剧集</p></div><button type="button" data-analytics-action="关闭竞品搜索" onClick={() => setIsSearchOpen(false)} aria-label="关闭">×</button></header>
            <label className="web-heat-search-field"><span>⌕</span><input autoFocus data-analytics-action="点击竞品搜索框" data-analytics-enter="提交竞品搜索" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              submitSearch(event)
            }} placeholder="输入剧名，按回车搜索" /></label>
            <div className="web-heat-search-results" aria-busy={isSearchLoading}>
              {isSearchLoading && <div className="web-heat-search-state"><span className="web-heat-spinner" aria-hidden="true" />正在搜索可比剧集…</div>}
              {searchResults.map((item) => (
                <div className="web-heat-search-result" key={item.id}>
                  <Poster item={item} />
                  <div className="web-heat-competitor-info"><strong>{item.title}</strong><span>{item.premiered} · {item.platforms}</span><small>{item.director} · {item.cast}</small></div>
                  <button type="button" data-analytics-action="搜索结果 加入看板" className="web-heat-outline-button" disabled={isSearchLoading || pendingAdds.includes(item.id) || competitors.length >= 4 || competitors.some((competitor) => competitor.id === item.id)} onClick={() => addCompetitor(item)}>{competitors.some((competitor) => competitor.id === item.id) ? '已加入看板' : pendingAdds.includes(item.id) ? '正在加入看板…' : '加入看板'}</button>
                </div>
              ))}
              {searchError && <div className="web-heat-competitor-empty">{searchError}</div>}
              {!isSearchLoading && !searchError && submittedSearch?.term.length >= 2 && searchResults.length === 0 && <div className="web-heat-competitor-empty">暂无匹配结果，请换个剧名试试。</div>}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
