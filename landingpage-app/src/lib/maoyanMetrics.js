import { parseChineseCount, platformDisplayName } from './dramaMonitor.js'

const PLATFORM_NAMES = new Set(['优酷', '爱奇艺', '腾讯视频', '芒果TV'])

function platformName(value) {
  const label = String(value || '').trim()
  if (/^平台(?:播放)?量$/.test(label)) return '芒果TV'
  const normalized = platformDisplayName(label)
  return PLATFORM_NAMES.has(normalized) ? normalized : ''
}

export function mapMaoyanPlatformRows(rows = [], { sourceUrl = '' } = {}) {
  return rows.flatMap((row) => {
    const date = String(row?.date || '')
    const platform = platformName(row?.platform || row?.platformLabel)
    const value = parseChineseCount(row?.value ?? row?.platformHeat)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || value === null) return []
    if (!platform) return []
    return [{ date, values: { [`${platform}平台表现`]: value }, sourceUrl: row?.sourceUrl || sourceUrl }]
  })
}
