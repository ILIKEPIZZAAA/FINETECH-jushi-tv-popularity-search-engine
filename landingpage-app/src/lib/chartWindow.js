import { isoDatesInRange, todayInShanghai, platformDisplayName } from './dramaMonitor.js'

const finite = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value))
const includesDate = (items, date) => (items || []).some(item => (typeof item === 'string' ? item : item?.date) === date)

// Read existing verification evidence only. A numeric value is not proof that
// its source read succeeded, and a failed date must never anchor a period.
export function metricDateIsVerified(record, metric, sync = {}) {
  if (!record || record.verificationStatus === 'pending') return false
  const verification = metric.startsWith('骨朵') ? sync.guduo?.verification
    : metric.startsWith('酷云') ? sync.ky?.verification
      : /平台表现$/.test(metric) ? sync.maoyan?.metricVerification?.platform
        : /有效播放/.test(metric) ? sync.maoyan?.metricVerification?.effective
          : sync.maoyan?.historyVerification
  if (!verification || !includesDate(verification.checkedDates, record.date)) return false
  if (Number(verification.passes || 0) < 2 && verification.verified !== true) return false
  if (['failedDates', 'unresolvedDates', 'gapDates', 'noDataDates'].some(key => includesDate(verification[key], record.date))) return false
  const source = metric.startsWith('骨朵') ? sync.guduo : metric.startsWith('酷云') ? sync.ky : sync.maoyan
  if (includesDate(source?.failedDates, record.date)) return false
  const platformMatch = metric.match(/^(.+)(平台表现|有效播放)$/)
  const platform = platformMatch ? platformDisplayName(platformMatch[1]) : ''
  const kind = /平台表现$/.test(metric) ? 'platform' : /有效播放/.test(metric) ? 'effective' : ''
  if (includesDate(verification.noDataByMetric?.[metric], record.date)
    || platform && includesDate(verification.noDataByMetric?.[`${kind}:${platform}`], record.date)
    || (verification.noDataFields || []).some(item => item.date === record.date && item.field === metric && platformDisplayName(item.platform || '') === platform)) return false
  return true
}

export function chartTimeWindow(mode, groups = [], today = todayInShanghai()) {
  const eligible = [...new Set(groups.flatMap(({ dates = [], series = [] }) => dates.filter((date, index) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today
      && series.some(item => finite(item.data?.[index]) && item.verified?.[index] === true),
  )))].sort()
  const to = eligible.at(-1) || null
  if (mode === 'initial') return { mode, from: null, to: null, dates: null, label: '' }
  if (mode === 'all') {
    const available = [...new Set(groups.flatMap(group => group.dates || []))].sort()
    return { mode, from: available[0] || null, to: available.at(-1) || null, dates: null, label: available.length ? `${available[0]} — ${available.at(-1)}` : '暂无数据' }
  }
  if (!to) return { mode, from: null, to: null, dates: [], label: '暂无已核验数据' }
  const date = new Date(`${to}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - (mode === '7' ? 6 : 29))
  const from = date.toISOString().slice(0, 10)
  return { mode, from, to, dates: isoDatesInRange(from, to), label: `${from} — ${to}${to !== today ? ' · 最近有效日期' : ''}` }
}

export function chartZoomWindow(dates = [], window) {
  if (!window?.dates) return { start: 0, end: 100, visibleDates: dates }
  if (!window.dates.length || !window.from || !window.to) return { start: 0, end: 100, visibleDates: [] }

  const visibleDates = dates.filter(date => date >= window.from && date <= window.to)
  if (!visibleDates.length) return { start: 0, end: 100, visibleDates }

  const firstIndex = dates.indexOf(visibleDates[0])
  const lastIndex = dates.lastIndexOf(visibleDates.at(-1))
  const denominator = Math.max(dates.length - 1, 1)
  return {
    start: (firstIndex / denominator) * 100,
    end: (lastIndex / denominator) * 100,
    visibleDates,
  }
}

export function chartPeriodCaption(dates = []) {
  const validDates = dates.filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort()
  const from = validDates[0]
  const to = validDates.at(-1)
  if (!from || !to) return '暂无数据'
  const fromTime = Date.parse(`${from}T00:00:00Z`)
  const toTime = Date.parse(`${to}T00:00:00Z`)
  const coveredDays = Math.floor((toTime - fromTime) / 86400000) + 1
  if (!Number.isFinite(coveredDays) || coveredDays < 1) return '暂无数据'
  return `当前图表数据周期：${from}—${to}，共涵盖${coveredDays}天`
}
