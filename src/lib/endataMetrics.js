export const ENDATA_COLOR = '#8b5cf6'
// Keep the source visible while collection is paused at the product level.
export const ENDATA_ENABLED = false
export const ENDATA_SOURCE_URL = 'https://app.endata.com.cn/DataBox/Video/Home/Index'
export const endataDimensions = [
  { key: 'playCountIndex', label: '播放量指数', field: 'PlayCountIndex', unit: '指数' },
  { key: 'playShare', label: '播放市占率', field: 'PlayShare', unit: '%' },
  { key: 'playIndex', label: '播映指数', field: 'PlayIndex', unit: '指数' },
  { key: 'mediaHot', label: '媒体热度', field: 'MediaHot', unit: '指数' },
  { key: 'personHot', label: '用户热度', field: 'PersonHot', unit: '指数' },
  { key: 'commentHot', label: '好评度', field: 'CommentHot', unit: '指数' },
  { key: 'playHot', label: '观看度', field: 'PlayHot', unit: '指数' },
].map(item => ({ ...item, metric: `艺恩${item.label}` }))

export function dashboardSources(contentType = 'drama') {
  const sources = [
    { key: 'maoyan', label: '猫眼', color: '#ff0004' },
    { key: 'guduo', label: '骨朵', color: '#FDBE34' },
  ]
  if (contentType !== 'variety') sources.push({ key: 'kuyun', label: '酷云', color: '#2f6bff' })
  return [...sources, { key: 'endata', label: '艺恩', color: ENDATA_COLOR }]
}

export function mapEndataObservations(observations = [], fetchedAt) {
  const dates = new Map()
  for (const row of observations) {
    if (!endataDimensions.some(item => item.metric === row.name) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue
    if (row.value === null || row.value === undefined || row.value === '' || !Number.isFinite(Number(row.value))) continue
    const record = dates.get(row.date) || { date: row.date, values: {}, metricSources: {}, fetchedAt, sourceUrl: row.sourceUrl || ENDATA_SOURCE_URL }
    record.values[row.name] = Number(row.value)
    record.metricSources[row.name] = row.sourceUrl || ENDATA_SOURCE_URL
    dates.set(row.date, record)
  }
  return [...dates.values()].sort((a, b) => a.date.localeCompare(b.date))
}

const dateOf = item => typeof item === 'string' ? item : item?.date
export function endataVerifiedDates(check = {}) {
  const blocked = new Set(['failedDates', 'gapDates', 'unresolvedDates'].flatMap(key => check[key] || []).map(dateOf))
  return (check.checkedDates || []).filter(date => !blocked.has(date) && (check.passes >= 2 || check.verified === true))
}

export function preserveEndataObservedHistory(check, records = []) {
  const inferred = new Set(check?.inferredNoDataDates || [])
  const conflicts = new Set(records.filter(row => inferred.has(row.date) && endataDimensions.some(({ metric }) => {
    const value = row.values?.[metric]
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  })).map(row => row.date))
  if (!conflicts.size) return check
  return { ...check, verified: false, state: 'incomplete',
    inferredNoDataDates: (check.inferredNoDataDates || []).filter(date => !conflicts.has(date)),
    noDataDates: (check.noDataDates || []).filter(date => !conflicts.has(date)),
    noDataByMetric: Object.fromEntries(Object.entries(check.noDataByMetric || {}).map(([name, dates]) => [name, dates.filter(date => !conflicts.has(date))])),
    unresolvedDates: [...new Set([...(check.unresolvedDates || []), ...conflicts])].sort(),
    inferenceConflicts: [...conflicts].sort(),
    message: '已保存的实测值与推定无数据冲突；保留原值，相关日期待复核',
  }
}

// A bounded read may finish only part of a long history. A retry starts at the
// earliest unchecked day and retains the evidence for earlier confirmed days.
export function endataResumeFrom(previous, premiere, to, dates) {
  if (previous?.verification?.from !== premiere || !previous?.verification?.to || previous.verification.to > to) return premiere
  const passed = new Set(endataVerifiedDates(previous.verification))
  return dates.find(date => !passed.has(date)) || premiere
}

export function mergeEndataVerification(previous, incoming, from, to, dates) {
  if (!previous || incoming.from === from) return incoming
  const outside = date => date < incoming.from || date > incoming.to
  const merged = { ...incoming, from, to }
  for (const key of ['checkedDates', 'noDataDates', 'observedDates', 'failedDates', 'gapDates', 'unresolvedDates']) {
    merged[key] = [...new Set([...(previous[key] || []).map(dateOf).filter(outside), ...(incoming[key] || []).map(dateOf)])].sort()
  }
  merged.noDataByMetric = Object.fromEntries([...new Set([...Object.keys(previous.noDataByMetric || {}), ...Object.keys(incoming.noDataByMetric || {})])].map(metric => [metric,
    [...new Set([...(previous.noDataByMetric?.[metric] || []).filter(outside), ...(incoming.noDataByMetric?.[metric] || [])])].sort(),
  ]))
  merged.noDataFields = [...(previous.noDataFields || []).filter(item => outside(item.date)), ...(incoming.noDataFields || [])]
  merged.passes = Math.min(previous.passes || 0, incoming.passes || 0)
  const verified = new Set(endataVerifiedDates(merged))
  merged.verified = dates.every(date => verified.has(date))
  merged.state = merged.verified ? 'verified' : 'incomplete'
  merged.observations = [...(previous.observations || []), ...(incoming.observations || []).map(item => ({ ...item, from: incoming.from, to: incoming.to }))]
  return merged
}
