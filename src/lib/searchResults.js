const titleKey = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '')
const year = (item) => Number(item.year || String(item.premiered || item.firstAired || '').slice(0, 4)) || null
const credits = (item) => [...(item.cast || []), ...(item.directors || [])].map(titleKey).filter(Boolean)
const hasIdentityValue = (value) => {
  if (Array.isArray(value)) return value.some(hasIdentityValue)
  if (value && typeof value === 'object') return hasIdentityValue(value.name || value.title)
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  if (typeof value !== 'string') return false
  const normalized = value.trim()
  return Boolean(normalized) && !/^(?:待补充|待核实|未知|不详|暂无)$/u.test(normalized)
}

function hasSearchIdentityDetails(item) {
  return [item.year, item.premiered, item.firstAired, item.cast, item.actors,
    item.directors, item.director, item.platforms, item.platform].some(hasIdentityValue)
}

function sameEdition(a, b) {
  if (titleKey(a.title) !== titleKey(b.title)) return false
  if (year(a) && year(b) && year(a) !== year(b)) return false
  if (a.premiered && b.premiered && a.premiered !== b.premiered) return false
  if (a.maoyanSeriesId && b.maoyanSeriesId) return String(a.maoyanSeriesId) === String(b.maoyanSeriesId)
  if (a.provider && a.provider === b.provider && a.providerId != null && String(a.providerId) === String(b.providerId)) return true
  if (a.premiered && a.premiered === b.premiered) return true
  const names = new Set(credits(a))
  return credits(b).filter((name) => names.has(name)).length >= 2
}

export function consolidateSearchResults(rows, query = '') {
  const normalizedQuery = titleKey(query)
  const priority = (item) => (titleKey(item.title) === normalizedQuery ? 100 : 0)
    + (item.provider === 'catalog' ? 20 : 0) + (/[\u3400-\u9fff]/.test((item.cast || []).join('')) ? 5 : 0)
    + (item.poster ? 1 : 0)
  const sorted = [...rows].filter((item) => item?.title && hasSearchIdentityDetails(item)).sort((a, b) => priority(b) - priority(a))
  const results = []
  for (const item of sorted) {
    // Compare against the preferred record; aliases must not bridge distinct remakes.
    const existing = results.find((entry) => sameEdition(entry, item))
    const candidate = { provider: item.provider, providerId: item.providerId, title: item.title, premiered: item.premiered, sourceUrl: item.sourceUrl }
    const candidates = item.identityCandidates?.length ? item.identityCandidates : [candidate]
    if (existing) existing.identityCandidates.push(...candidates)
    else results.push({ ...item, identityCandidates: [...candidates] })
  }
  return results.map((item) => ({ ...item, identityUnverified: !year(item)
    && results.some((other) => other !== item && titleKey(other.title) === titleKey(item.title) && year(other)) }))
}
