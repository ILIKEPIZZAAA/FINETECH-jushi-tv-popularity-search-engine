const numericObservation = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value))

// Availability describes loaded observations, not a claim about source coverage.
// In particular, numeric zero is data and an empty series is not verified absence.
export function boardAvailability(series, primaryName) {
  const observed = (Array.isArray(series) ? series : []).filter(item => Array.isArray(item.data) && item.data.some(numericObservation))
  const primaryHasData = observed.some(item => item.name === primaryName)
  const hasData = observed.length > 0
  return {
    hasData,
    primaryHasData,
    state: primaryHasData ? 'available' : hasData ? 'competitors-only' : 'not-loaded',
    statusLabel: primaryHasData ? '有数据' : hasData ? '仅分析作品' : '未载入',
  }
}

export function preferredBoardKey(tabs) {
  return tabs.find(tab => tab.primaryHasData)?.key
    ?? tabs.find(tab => tab.hasData)?.key
    ?? tabs[0]?.key
    ?? null
}
