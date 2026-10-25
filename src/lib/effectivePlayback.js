import { formatMetric, isConfirmedNoDataDate, mergeMetricHistory, metricValue, parseChineseCount, platformDisplayName } from './dramaMonitor.js'

export const EFFECTIVE_PLAYBACK_MAPPING_VERSION = 6

// Build once per subject, rather than scanning every historical row for each date.
export function effectiveChartValues(records = []) {
  const recordsByDate = new Map(records.map((record) => [record.date, record]))
  const valuesByDate = new Map([...recordsByDate].map(([date, record]) => [date, metricValue(record, '有效播放量')]))
  if (![...valuesByDate.values()].includes(null)) return valuesByDate
  const platforms = [...new Set(records.flatMap((record) => Object.keys(record.values || {})
    .map((name) => name.match(/^(.+)累计有效播放$/)?.[1])
    .filter(Boolean)
    .map(platformDisplayName)))]
  // A single source platform's cumulative value is usable; multiple totals are never summed.
  if (platforms.length !== 1) return valuesByDate
  for (const record of recordsByDate.values()) {
    if (valuesByDate.get(record.date) !== null) continue
    const sourceKey = Object.keys(record.values || {}).find((name) => {
      const platform = name.match(/^(.+)累计有效播放$/)?.[1]
      return platform && platformDisplayName(platform) === platforms[0]
    })
    if (sourceKey) valuesByDate.set(record.date, metricValue(record, sourceKey))
  }
  return valuesByDate
}

export function effectivePlaybackSourceMetrics(expectedPlatforms = [], ...recordGroups) {
  const platforms = expectedPlatforms instanceof Set ? [...expectedPlatforms] : expectedPlatforms
  const observedMetrics = recordGroups.flatMap((records) => (Array.isArray(records) ? records : [])
    .flatMap((record) => Object.keys(record?.values || {}).filter((name) => /有效播放/.test(name))))
  return [...new Set([
    '有效播放量',
    '累计有效播放',
    ...platforms.flatMap((platform) => [`${platform}有效播放`, `${platform}累计有效播放`]),
    ...observedMetrics,
  ])]
}

function playbackCount(value) {
  const parsed = parseChineseCount(value)
  if (parsed === null) return null
  // 猫眼表格以“万/亿”展示整数播放次数；去掉二进制浮点乘法产生的小数尾巴。
  return typeof value === 'string' && /[万亿]/.test(value) ? Math.round(parsed) : parsed
}

function sourcePlatform(row) {
  const label = String(row?.platform || row?.platformLabel || '').trim()
  if (!label) return ''
  if (/^平台(?:播放)?量$/.test(label)) return '芒果TV'
  return platformDisplayName(label)
}

function sourceDisplay(value) {
  if (value === null || value === undefined || value === '') return null
  return typeof value === 'string' ? value.trim() : formatMetric(value, 2)
}

function cumulativeSummary(summary) {
  const items = Array.isArray(summary?.items) ? summary.items : summary?.subItems
  return Array.isArray(items) ? items.find((item) => item?.mainTitle === '累计有效播放') || null : null
}

export function mapEffectivePlayback(payload = {}, expectedPlatforms = new Set()) {
  const recognized = /^(优酷|爱奇艺|腾讯视频|芒果TV)$/
  const unresolvedDates = new Set(payload.verification?.unresolvedDates || [])
  // pendingSeries are unresolved source candidates; keep them out of canonical charts and Rawdata.
  const rows = (Array.isArray(payload.series) ? payload.series : [])
    .map((row) => ({ ...row, platform: sourcePlatform(row), date: String(row?.date || '') }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date))
  const platformRows = rows.filter((row) => recognized.test(row.platform))
  const aggregateRows = rows.filter((row) => !row.platform)
  const platforms = [...new Set(platformRows.map((row) => row.platform))]
  const singlePlatform = platforms.length === 1
  const valuesByDate = new Map()
  const addValue = (date, key, value) => {
    if (value === null) return
    if (!valuesByDate.has(date)) valuesByDate.set(date, {})
    valuesByDate.get(date)[key] = value
  }

  for (const row of platformRows) {
    addValue(row.date, `${row.platform}有效播放`, playbackCount(row.value ?? row.effectivePlay))
    addValue(row.date, `${row.platform}累计有效播放`, playbackCount(row.cumulativeEffectivePlay))
    if (singlePlatform) addValue(row.date, '有效播放量', playbackCount(row.cumulativeEffectivePlay))
  }
  if (!singlePlatform) {
    for (const row of aggregateRows) addValue(row.date, '有效播放量', playbackCount(row.value ?? row.effectivePlay))
  }

  const summary = cumulativeSummary(payload.summary)
  const latestPlatformRow = [...platformRows].sort((a, b) => b.date.localeCompare(a.date))[0]
  const latestAggregateRow = [...aggregateRows].sort((a, b) => b.date.localeCompare(a.date))[0]
  let headline = null
  if (!singlePlatform && latestAggregateRow) {
    const display = sourceDisplay(latestAggregateRow.value ?? latestAggregateRow.effectivePlay)
    if (display) headline = { date: latestAggregateRow.date, display, kind: 'aggregate-tab' }
  } else if (singlePlatform && latestPlatformRow) {
    const cumulative = playbackCount(latestPlatformRow.cumulativeEffectivePlay)
    if (cumulative !== null) addValue(latestPlatformRow.date, '有效播放量', cumulative)
    const display = sourceDisplay(latestPlatformRow.cumulativeEffectivePlay)
    if (display) headline = { date: latestPlatformRow.date, display, kind: 'single-platform-source' }
  }

  const expected = expectedPlatforms instanceof Set ? expectedPlatforms : new Set(expectedPlatforms)
  const emptyDate = (date, platform = '', field = '') => isConfirmedNoDataDate(payload.verification, date, 'effective', platform, field)
  const entirePlatformEmpty = (platform) => payload.verification?.checkedDates?.length && payload.verification.checkedDates.every((date) => emptyDate(date, platform))
  const warnings = [...expected].filter((platform) => !platforms.includes(platform) && !entirePlatformEmpty(platform)).map((platform) => `缺少${platform}有效播放`)
  if (platforms.length > 1 && !aggregateRows.length && !entirePlatformEmpty('')) warnings.push('多个平台缺少全平台累计有效播放页签')
  if (platforms.length > 1 && latestAggregateRow && latestPlatformRow && latestAggregateRow.date < latestPlatformRow.date && !platformRows.filter((row) => row.date > latestAggregateRow.date).every((row) => emptyDate(row.date))) {
    warnings.push(`全平台累计有效播放仅到${latestAggregateRow.date}，分平台已到${latestPlatformRow.date}`)
  }
  if (platforms.length > 1 && aggregateRows.length) {
    const aggregateDates = new Set(aggregateRows.map((row) => row.date))
    const missing = [...new Set(platformRows.map((row) => row.date))].filter((date) => !aggregateDates.has(date) && !emptyDate(date))
    if (missing.length) warnings.push(`全平台累计有效播放缺少${missing.length}天：${missing.slice(0, 3).join('、')}${missing.length > 3 ? '等' : ''}`)
  }
  if (singlePlatform && playbackCount(latestPlatformRow?.cumulativeEffectivePlay) === null && !emptyDate(latestPlatformRow?.date, platforms[0], 'cumulativeEffectivePlay')) {
    warnings.push(`${platforms[0]}缺少累计有效播放`)
  }

  return {
    records: [...valuesByDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ date, values, ...(unresolvedDates.has(date) ? { verificationStatus: 'pending' } : {}) })),
    platforms,
    headline,
    warnings,
    latestDate: [...valuesByDate.keys()].sort().at(-1) || null,
  }
}

export function mergeEffectivePlayback(existing = [], incoming = []) {
  const withoutOldAggregate = existing.map((record) => {
    const values = { ...(record.values || {}) }
    const metricSources = { ...(record.metricSources || {}) }
    delete values['有效播放量']
    delete metricSources['有效播放量']
    return { ...record, values, metricSources }
  })
  return mergeMetricHistory(withoutOldAggregate, incoming)
}
