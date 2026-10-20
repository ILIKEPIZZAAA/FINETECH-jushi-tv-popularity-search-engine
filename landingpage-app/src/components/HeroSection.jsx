import { useEffect, useRef, useState } from 'react'
import { SearchIcon } from './SearchIcon.jsx'
import { SearchPanel } from './SearchPanel.jsx'
import { HeroPosterWall } from './HeroPosterWall.jsx'

export function HeroSection({ brand, title, tagline, searchPlaceholder, onSearch, onResultSelected, rankings }) {
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [isChoosing, setIsChoosing] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const choosingRef = useRef(false)
  const searchRequestRef = useRef(0)
  const searchExperienceRef = useRef(null)
  const searchInputRef = useRef(null)
  const recentRanking = rankings?.boards.find(board => board.id === 'guduo')
  const recentRows = recentRanking?.rows || []

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!searchExperienceRef.current?.contains(event.target)) setIsSearchOpen(false)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsSearchOpen(false)
        setActiveSuggestion(-1)
        if (searchExperienceRef.current?.contains(document.activeElement)) document.activeElement?.blur()
      }
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey
        && !event.target.closest('input, textarea, select, [contenteditable="true"]')) {
        event.preventDefault()
        searchInputRef.current?.focus()
        setIsSearchOpen(true)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      searchRequestRef.current += 1
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const runSearch = async (term) => {
    setIsSearchOpen(true)
    if (!term.trim()) return
    if (choosingRef.current) return
    const requestId = ++searchRequestRef.current
    setHasSearched(true)
    setIsSearching(true)
    setActiveSuggestion(-1)
    setSearchError('')
    try {
      const results = await onSearch?.(term.trim())
      if (requestId !== searchRequestRef.current) return
      setSearchResults(Array.isArray(results) ? results : [])
    } catch (error) {
      if (requestId !== searchRequestRef.current) return
      setSearchResults([])
      setSearchError(error instanceof Error ? error.message : '实时搜索失败')
    } finally {
      if (requestId === searchRequestRef.current) setIsSearching(false)
    }
  }

  return (
    <>
      <section className="hero-section" aria-labelledby="hero-title">
        <HeroPosterWall />
        <div className="hero-content">
          <h1 id="hero-title" className="hero-wordmark" aria-label={title?.split(/\s+/)[0] || '剧势'}>
            <span className="hero-wordmark-cut" aria-hidden="true">剧势</span>
          </h1>
          <svg className="hero-title-trend" viewBox="0 0 400 32" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
            <defs>
              <linearGradient id="hero-trend-gradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#8dc9ff" stopOpacity=".56" />
                <stop offset="68%" stopColor="#a9d6ff" />
                <stop offset="100%" stopColor="#f9c65b" />
              </linearGradient>
            </defs>
            <path className="hero-title-trend-track" d="M12 25 H388" />
            <path className="hero-title-trend-path" d="M18 20 C56 20 71 19 105 21 S154 22 185 16 S233 9 264 12 S306 17 333 12 S361 7 374 6" />
            <circle className="hero-title-trend-node" cx="105" cy="21" r="2" />
            <circle className="hero-title-trend-node" cx="185" cy="16" r="2" />
            <circle className="hero-title-trend-node" cx="264" cy="12" r="2" />
            <circle className="hero-title-trend-halo" cx="374" cy="6" r="5.8" />
            <circle className="hero-title-trend-point" cx="374" cy="6" r="2.3" />
          </svg>
          <p className="hero-tagline">{tagline}</p>
          <p className="hero-tagline-support">热度、对比、走势，一站掌握</p>
          <div className={`search-experience search-command ${isSearchOpen ? 'is-open' : ''}`} data-analytics-component="首页剧集搜索" ref={searchExperienceRef}>
            <form className="search-bar" role="search" data-analytics-submit="提交搜索" onSubmit={event => {
              event.preventDefault()
              const term = !hasSearched && activeSuggestion >= 0 ? recentRows[activeSuggestion]?.title || query : query
              setQuery(term)
              void runSearch(term)
            }}>
              <button className="hero-search-submit" type="submit" data-analytics-action="点击搜索按钮" aria-label={isSearching ? '正在搜索剧集' : '搜索剧集'} disabled={isSearching || isChoosing}>
                <SearchIcon />
              </button>
              <input
                ref={searchInputRef}
                type="search"
                data-analytics-action="点击搜索框"
                role="combobox"
                aria-expanded={isSearchOpen}
                aria-controls={isSearchOpen ? 'hero-search-panel' : undefined}
                aria-autocomplete="list"
                aria-activedescendant={isSearchOpen && !hasSearched && activeSuggestion >= 0 ? `recent-drama-${activeSuggestion}` : undefined}
                enterKeyHint="search"
                aria-label={searchPlaceholder}
                value={query}
                disabled={isChoosing}
                placeholder={searchPlaceholder}
                onFocus={() => setIsSearchOpen(true)}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setIsSearchOpen(false)
                    setActiveSuggestion(-1)
                    event.currentTarget.blur()
                    return
                  }
                  if (event.nativeEvent.isComposing || hasSearched || !recentRows.length) return
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    setIsSearchOpen(true)
                    setActiveSuggestion(current => event.key === 'ArrowDown'
                      ? (current + 1) % recentRows.length
                      : (current < 0 ? recentRows.length - 1 : (current - 1 + recentRows.length) % recentRows.length))
                  }
                }}
                onChange={(event) => {
                  searchRequestRef.current += 1
                  setIsSearching(false)
                  setQuery(event.target.value)
                  setActiveSuggestion(-1)
                  setHasSearched(false)
                  setSearchResults([])
                  setSearchError('')
                  setIsSearchOpen(true)
                }}
              />
              <kbd className="search-command-shortcut" aria-hidden="true">/</kbd>
            </form>
            {isSearchOpen ? (
                <SearchPanel
                query={query}
                hasSearched={hasSearched}
                results={searchResults}
                isSearching={isSearching}
                isChoosing={isChoosing}
                searchError={searchError}
                ranking={recentRanking}
                activeSuggestion={activeSuggestion}
                onActiveSuggestion={setActiveSuggestion}
                onSearchSuggestion={term => { setQuery(term); void runSearch(term) }}
                onChooseResult={async (result) => {
                  if (choosingRef.current) return
                  choosingRef.current = true
                  setIsChoosing(true)
                  setQuery(result.title)
                  setSearchError('')
                  try {
                    await onResultSelected?.(result)
                    setIsSearchOpen(false)
                  } catch (error) {
                    setSearchError(error instanceof Error ? error.message : '项目创建失败')
                    setIsSearchOpen(true)
                  } finally {
                    choosingRef.current = false
                    setIsChoosing(false)
                  }
                }}
              />
            ) : null}
          </div>
        </div>
      </section>
    </>
  )
}
