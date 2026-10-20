import { comparisonSubjects } from './comparisonColors.js'

export function hasNumericValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value))
}

export function ratingValue(row, metric, subjectName = '') {
  const subjectValue = subjectName ? row?.values?.[subjectName] : null
  const candidates = metric === 'rating'
    ? [row?.csmCityRating, row?.rating, subjectValue?.rating, row?.values?.rating, row?.values?.csmCityRating]
    : [row?.csmCityShare, row?.share, subjectValue?.share, row?.values?.share, row?.values?.csmCityShare]
  const value = candidates.find(hasNumericValue)
  return value === undefined ? null : Number(value)
}

export function rowChannel(row) {
  return row?.channel || row?.platform || ''
}

export function rowsForChannel(ratings, project, channel) {
  if (!project) return []
  return (ratings?.[project.id] || []).filter((row) => rowChannel(row) === channel)
}

export function periodKey(slot = '') {
  const value = String(slot).trim()
  if (/非黄金|non[-\s]?golden|regular|晚间|白天|全天/i.test(value)) return 'non-golden'
  return /黄金|prime|golden/i.test(value) ? 'golden' : 'non-golden'
}

function pickDateRow(rows, date, targetPeriod = null) {
  const candidates = rows.filter((row) => row.date === date)
  if (targetPeriod) return candidates.find((row) => periodKey(row.slot) === targetPeriod) || null
  return candidates.find((row) => periodKey(row.slot) === 'golden') || candidates[0] || null
}

export function buildTvComparison(mainProject, competitors, ratings, channel) {
  const subjectDetails = comparisonSubjects(mainProject, competitors).map((project) => {
    const rows = rowsForChannel(ratings, project, channel)
    const hasGolden = rows.some((row) => periodKey(row.slot) === 'golden' && ratingValue(row, 'rating') !== null)
    const period = hasGolden ? 'golden' : 'non-golden'
    return { project, rows, period, label: period === 'golden' ? `${project.title} · 黄金时段` : project.title }
  })
  const dates = [...new Set(subjectDetails.flatMap(({ rows }) => rows.map((row) => row.date).filter(Boolean)))].sort()
  const records = dates.map((date) => ({
    date,
    channel,
    values: Object.fromEntries(subjectDetails.map(({ label, rows, period }) => {
      const row = pickDateRow(rows, date, period)
      return [label, { rating: ratingValue(row, 'rating'), share: ratingValue(row, 'share') }]
    })),
  }))
  return { records, names: subjectDetails.map(({ label }) => label), colors: subjectDetails.map(({ project }) => project.color) }
}

export function comparableTvChannels(mainProject, competitors, ratings, channels) {
  if (!mainProject) return new Set()
  return new Set(channels.filter((channel) => {
    const candidate = buildTvComparison(mainProject, competitors.filter((project) => project.id !== mainProject.id), ratings, channel)
    // Historical competitors need not air on the same calendar date.
    const hasData = (name) => candidate.records.some((record) => (
      ['rating', 'share'].some((metric) => hasNumericValue(record.values?.[name]?.[metric]))
    ))
    return hasData(candidate.names[0]) && candidate.names.slice(1).some(hasData)
  }))
}
