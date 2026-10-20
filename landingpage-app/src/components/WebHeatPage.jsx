import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import * as echarts from 'echarts/core'
import { LineChart, PieChart } from 'echarts/charts'
import { DataZoomComponent, GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { trackPage } from '../lib/analytics.js'
import { CompetitorModule } from './CompetitorModule.jsx'
import { DisclaimerModal } from './DisclaimerModal.jsx'
import { CollectionProgressLog } from './CollectionProgressLog.jsx'
import { TvRatingsModule, tvRecords } from './TvRatingsModule.jsx'
import { formatMetric, formatSourceMetric, metricValue, platformDisplayName } from '../lib/dramaMonitor.js'
import { EFFECTIVE_PLAYBACK_MAPPING_VERSION, effectiveChartValues } from '../lib/effectivePlayback.js'
import { desktopLayoutScale } from '../lib/viewportLayout.js'
import { chartPeriodCaption, chartTimeWindow, chartZoomWindow, metricDateIsVerified } from '../lib/chartWindow.js'
import { COMPARISON_COLORS, comparisonColor, comparisonSubjects } from '../lib/comparisonColors.js'
import { installEchartsPointerCoordinates } from '../lib/echartsPointerCoordinates.js'
import { visibleDataMaximum } from '../lib/chartScale.js'
import mangoTvMark from '../assets/logos/mgtv-logo.png'
import youkuMark from '../assets/logos/youku-logo.png'
import { PosterImage } from './PosterImage.jsx'
import { dashboardView, saveDashboardSession } from '../lib/dashboardSession.js'

echarts.use([LineChart, PieChart, DataZoomComponent, GridComponent, LegendComponent, TitleComponent, TooltipComponent, CanvasRenderer])

const platforms = [
  { key: 'maoyan', label: '猫眼', color: '#ff0004' },
  { key: 'guduo', label: '骨朵', color: '#FDBE34' },
  { key: 'kuyun', label: '酷云', color: '#2f6bff' },
]

const WEB_HEAT_CHART_COLOR = '#FDBE34'
const WEB_HEAT_PRIMARY_COLOR = WEB_HEAT_CHART_COLOR

function dashboardLayoutScale() {
  return desktopLayoutScale(window.innerWidth, window.innerHeight)
}

const dimensions = {
  maoyan: [
    { key: 'heat', label: '热度值' },
    { key: 'exposure', label: '全网曝光' },
    { key: 'interaction', label: '全网转评赞' },
    { key: 'publish', label: '全网发布' },
    { key: 'danmaku', label: '全网弹幕' },
    { key: 'effective', label: '有效播放' },
    { key: 'platform', label: '平台表现' },
  ],
  guduo: [
    { key: 'heat', label: '骨朵热度' },
    { key: 'rank', label: '骨朵排名' },
  ],
  kuyun: [
    { key: 'heat', label: '酷云全端热度' },
    { key: 'growth', label: '酷云增长指数' },
  ],
}

const series = {
  maoyan: [520, 640, 430, 720, 810, 690, 880, 760, 940, 860],
  guduo: [42, 51, 38, 63, 71, 58, 79, 66, 84, 73],
  kuyun: [910, 870, 930, 880, 950, 900, 960, 920, 970, 940],
}

const dimensionSeries = {
  maoyan: {
    heat: [520, 640, 430, 720, 810, 690, 880, 760, 940, 860, 910, 870, 980, 920, 1040],
    exposure: [460, 520, 610, 575, 690, 735, 710, 820, 875, 940],
    interaction: [320, 355, 410, 438, 502, 548, 590, 642, 690, 728],
    publish: [180, 240, 220, 310, 338, 372, 405, 438, 460, 512],
    danmaku: [96, 122, 144, 138, 188, 226, 258, 244, 298, 326],
    effective: [280, 310, 348, 330, 396, 442, 480, 468, 520, 564],
    platform: [520, 535, 550, 566, 582, 600, 622, 648, 670, 698],
  },
  guduo: {
    heat: series.guduo,
    rank: [18, 16, 15, 13, 12, 10, 9, 8, 7, 6],
  },
  kuyun: {
    heat: series.kuyun,
    growth: [12, 22, 18, 34, 39, 48, 55, 61, 72, 80],
  },
}

const boardPlatforms = [
  { key: 'iqiyi', label: '爱奇艺', mark: '爱', color: '#19a96b', logo: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQmnwhBzm8NTNFbCg3Bhc9T9uDTMpgazgFAsmIdRCcPSJobhMU_VNv_LTbc&s=10' },
  { key: 'youku', label: '优酷', mark: '优', color: '#168cff', logo: youkuMark },
  { key: 'tencent', label: '腾讯视频', mark: '腾', color: '#f05b68', logo: 'https://yt3.googleusercontent.com/BZ0BcoBm1IDjD4a3XbhnHyNZ3MkLnT9FnRxj_ioc6V3yT2nqcCxR0acvzokp7B019c036G5LHQ=s900-c-k-c0x00ffffff-no-rj' },
  { key: 'mango', label: '芒果TV', mark: '芒', color: '#f2a03d', logo: mangoTvMark },
]

const boardData = {
  effective: [
    { aggregate: true, label: '全平台累计有效播放', values: [280, 310, 348, 330, 396, 442, 480, 468, 520, 564] },
    { kpis: [['有效累计播放', '18.92亿'], ['最高排名', '2'], ['最高有效播放', '7021.8万'], ['均有效播放', '5104.6万']], values: [35, 44, 40, 56, 62, 60, 72, 68, 79, 84] },
    { kpis: [['有效累计播放', '16.38亿'], ['最高排名', '3'], ['最高有效播放', '6350.4万'], ['均有效播放', '4720.2万']], values: [30, 38, 45, 43, 55, 58, 66, 64, 72, 78] },
    { kpis: [['有效累计播放', '12.76亿'], ['最高排名', '4'], ['最高有效播放', '5218.7万'], ['均有效播放', '3986.1万']], values: [26, 32, 36, 42, 48, 46, 58, 60, 66, 70] },
    { kpis: [['有效累计播放', '9.84亿'], ['最高排名', '5'], ['最高有效播放', '4160.5万'], ['均有效播放', '3022.8万']], values: [20, 28, 30, 35, 42, 40, 49, 52, 56, 63] },
  ],
  platform: [
    { kpis: [['实时热度', '10242'], ['昨日热度', '10905'], ['历史最高热度', '31558'], ['最高日期', '2024.06.20']], values: [55, 64, 60, 72, 78, 74, 86, 82, 90, 88] },
    { kpis: [['实时热度', '9340'], ['昨日热度', '10120'], ['历史最高热度', '28780'], ['最高日期', '2024.05.18']], values: [48, 58, 54, 66, 72, 70, 78, 76, 84, 80] },
    { kpis: [['实时热度', '8715'], ['昨日热度', '9280'], ['历史最高热度', '26540'], ['最高日期', '2024.04.26']], values: [42, 51, 49, 60, 65, 62, 74, 70, 78, 75] },
    { kpis: [['实时热度', '7640'], ['昨日热度', '8096'], ['历史最高热度', '23180'], ['最高日期', '2024.03.12']], values: [38, 45, 44, 54, 58, 56, 66, 63, 71, 68] },
  ],
}

const METRIC_BY_PLATFORM = {
  maoyan: {
    heat: '猫眼热度',
    exposure: '猫眼全网曝光',
    interaction: '猫眼全网转评赞',
    publish: '猫眼全网发布',
    danmaku: '猫眼全网弹幕',
    effective: '有效播放量',
  },
  guduo: {
    heat: '骨朵热度',
    rank: '骨朵热度排名',
  },
  kuyun: {
    heat: '酷云全端热度',
    growth: '酷云增长指数',
  },
}

function finiteMetric(record, metric) {
  const direct = record?.values?.[metric]
  if (hasMetricValue(direct)) return Number(direct)
  const normalized = metricValue(record, metric)
  return normalized === null || normalized === undefined || !Number.isFinite(Number(normalized)) ? null : Number(normalized)
}

function effectiveMetric(record) {
  // 累计图只接受猫眼的累计字段，绝不把分平台的每日值相加后冒充累计值。
  return finiteMetric(record, '有效播放量')
}

function effectivePlatformMetricValueFor(record, platformLabel) {
  const targetPlatform = platformDisplayName(platformLabel)
  const keys = platformLabel === '芒果TV'
    ? ['芒果TV有效播放', '平台量有效播放', '平台播放量有效播放']
    : [`${platformLabel}有效播放`]
  const direct = keys.map((key) => finiteMetric(record, key)).find((value) => value !== null)
  if (direct !== undefined) return direct
  return Object.entries(record?.values || {})
    .filter(([name]) => /有效播放$/.test(name) && !/有效播放量$/.test(name))
    .filter(([name]) => platformDisplayName(name.replace(/有效播放$/, '')) === targetPlatform)
    .filter(([, value]) => hasMetricValue(value))
    .map(([, value]) => Number(value))
    .find(Number.isFinite) ?? null
}

function normalizePlatformMetricKey(name) {
  return /^(平台量|平台播放量)平台表现$/.test(String(name || '')) ? '芒果TV平台表现' : name
}

function platformMetricValueFor(record, platformLabel) {
  const targetPlatform = platformDisplayName(platformLabel)
  const keys = platformLabel === '芒果TV'
    ? ['芒果TV平台表现', '平台量平台表现', '平台播放量平台表现']
    : [`${platformLabel}平台表现`]
  const direct = keys.map((key) => finiteMetric(record, key)).find((value) => value !== null && value !== undefined)
  if (direct !== undefined) return direct
  return Object.entries(record?.values || {})
    .filter(([name]) => /平台表现$/.test(name))
    .filter(([name]) => platformDisplayName(name.replace(/平台表现$/, '')) === targetPlatform)
    .filter(([, value]) => hasMetricValue(value))
    .map(([, value]) => Number(value))
    .find(Number.isFinite) ?? null
}

function platformMetric(record) {
  const byPlatform = new Map()
  for (const [name, value] of Object.entries(record?.values || {})) {
    if (!/(?:优酷|爱奇艺|腾讯视频|芒果TV|平台量|平台播放量)平台表现$/.test(name) || !hasMetricValue(value)) continue
    const key = normalizePlatformMetricKey(name)
    const previous = byPlatform.get(key)
    const priority = key === name ? 2 : 1
    if (!previous || priority >= previous.priority) byPlatform.set(key, { priority, value: Number(value) })
  }
  const values = [...byPlatform.values()].map(({ value }) => value)
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null
}

function metricForView(record, platformKey, dimensionKey) {
  if (platformKey === 'maoyan' && dimensionKey === 'effective') return effectiveMetric(record)
  if (platformKey === 'maoyan' && dimensionKey === 'platform') return platformMetric(record)
  return finiteMetric(record, METRIC_BY_PLATFORM[platformKey]?.[dimensionKey] || '')
}

function recordsFor(projectId, liveHeat = {}) {
  return Array.isArray(liveHeat?.[projectId]) ? [...liveHeat[projectId]].sort((a, b) => String(a.date).localeCompare(String(b.date))) : []
}

function recordedPlatformNames(projectId, liveHeat = {}) {
  const names = new Set()
  for (const record of recordsFor(projectId, liveHeat)) {
    for (const name of Object.keys(record.values || {})) {
      const suffix = name.match(/(平台表现|有效播放)$/)?.[1]
      if (!suffix || (suffix === '有效播放' && /有效播放量$/.test(name))) continue
      const rawPlatform = name.slice(0, -suffix.length)
      const platform = /平台(?:播放)?量/.test(rawPlatform) ? '芒果TV' : platformDisplayName(rawPlatform)
      if (boardPlatforms.some((item) => item.label === platform)) names.add(platform)
    }
  }
  return [...names]
}

function hasSourceRecord(record, platformKey) {
  const values = record?.values || {}
  return Object.entries(values).some(([name, value]) => {
    if (!hasMetricValue(value)) return false
    if (platformKey === 'guduo') return name === '骨朵热度' || name === '骨朵热度排名' || name === '骨朵排名' || name === '骨朵榜内排名'
    if (platformKey === 'kuyun') return name === '酷云全端热度' || name === '酷云增长指数'
    return name.startsWith('猫眼') || name === '有效播放量' || name === '累计有效播放' || /(?:平台表现|有效播放)$/.test(name)
  })
}

function latestDateForSource(records = [], platformKey) {
  return [...records].reverse().find((record) => hasSourceRecord(record, platformKey))?.date || null
}

function hasMetricValue(value) {
  return (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value))
}

function maoyanSummaryItem(summary, title) {
  const items = Array.isArray(summary?.subItems) ? summary.subItems : summary?.items
  const aliases = {
    全网曝光: ['全网曝光', '全网总曝光'],
    全网转评赞: ['全网转评赞', '全网总转评赞'],
    全网发布: ['全网发布', '全网总发布'],
    全网弹幕: ['全网弹幕', '全网总弹幕'],
  }
  const titles = aliases[title] || [title]
  return Array.isArray(items)
    ? items.find((item) => titles.includes(item?.mainTitle)) || null
    : null
}

function maoyanSummaryDisplay(item) {
  if (!item) return null
  if (item.mainData !== null && item.mainData !== undefined && item.mainData !== '') {
    return `${item.mainData}${item.unit || ''}`
  }
  return Number.isFinite(Number(item.mainDataNum)) ? formatMetric(item.mainDataNum) : null
}

function liveComparison(project, competitors = [], liveHeat = {}, platformKey, dimensionKey, sourceSync = {}) {
  const subjects = comparisonSubjects(project, competitors)
  const recordsBySubject = subjects.map((item) => new Map(recordsFor(item.id, liveHeat).map((record) => [record.date, record])))
  const candidateDates = [...new Set(recordsBySubject.flatMap((records) => [...records.keys()].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))))].sort()
  // Competitors can have valid source data outside the primary project's date range.
  // Use the union of dates with a value so those series are not silently clipped.
  const allDates = candidateDates.filter((date) => recordsBySubject.some((records) => hasMetricValue(metricForView(records.get(date), platformKey, dimensionKey))))
  return {
    dates: allDates,
    series: subjects.map((item, subjectIndex) => {
      const byDate = recordsBySubject[subjectIndex]
      return {
        name: item.title,
        color: item.color,
        data: allDates.map((date) => metricForView(byDate.get(date), platformKey, dimensionKey)),
        verified: allDates.map(date => metricDateIsVerified(byDate.get(date), METRIC_BY_PLATFORM[platformKey]?.[dimensionKey] || '', sourceSync[item.id])),
      }
    }),
  }
}

function livePlatformSeries(project, liveHeat = {}) {
  const records = recordsFor(project?.id, liveHeat)
  const keys = [...new Set(records.flatMap((record) => Object.keys(record.values || {})
    .filter((name) => /(?:优酷|爱奇艺|腾讯视频|芒果TV|平台量|平台播放量)平台表现$/.test(name))
    .map(normalizePlatformMetricKey)))]
  const byDate = new Map(records.map((record) => [record.date, record]))
  const candidateDates = records.map((record) => record.date).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
  const dates = candidateDates.filter((date) => keys.some((key) => hasMetricValue(platformMetricValueFor(byDate.get(date), key.replace('平台表现', '')))))
  return {
    dates,
    series: keys.map((key) => ({
      name: key.replace('平台表现', ''),
      data: dates.map((date) => platformMetricValueFor(byDate.get(date), key.replace('平台表现', ''))),
    })),
  }
}

function liveBoardSeries(project, competitors = [], liveHeat = {}, mode, sourceSync = {}) {
  const subjects = comparisonSubjects(project, competitors)
  const recordsBySubject = subjects.map((subject) => {
    const records = recordsFor(subject.id, liveHeat)
    return { subject, records, byDate: new Map(records.map((record) => [record.date, record])), effectiveByDate: mode === 'effective' ? effectiveChartValues(records) : null }
  })
  const aggregateMetric = mode === 'effective' ? '有效播放量' : null
  const datesFor = (selector) => {
    const dateValues = recordsBySubject.flatMap(({ records, byDate }) => records
      .map((record) => record.date)
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && selector(byDate.get(date))))
    return [...new Set(dateValues)].sort()
  }
  const aggregateDates = aggregateMetric
    ? [...new Set(recordsBySubject.flatMap(({ records, effectiveByDate }) => records
      .filter((record) => /^\d{4}-\d{2}-\d{2}$/.test(record.date) && hasMetricValue(effectiveByDate.get(record.date)))
      .map((record) => record.date)))].sort()
    : datesFor((record) => boardPlatforms.some((platform) => hasMetricValue(platformMetricValueFor(record, platform.label))))
  const platformDates = boardPlatforms.map((platform) => datesFor((record) => hasMetricValue(
    mode === 'platform'
      ? platformMetricValueFor(record, platform.label)
      : effectivePlatformMetricValueFor(record, platform.label),
  )))
  const seriesFor = (entry, metricLabel, dates, isAggregate = false) => ({
    name: entry.subject?.title || '当前项目',
    color: entry.subject.color,
    data: dates.map((date) => isAggregate
      ? entry.effectiveByDate.get(date) ?? null
      : mode === 'platform'
        ? platformMetricValueFor(entry.byDate.get(date), metricLabel)
        : effectivePlatformMetricValueFor(entry.byDate.get(date), metricLabel)),
    verified: dates.map(date => metricDateIsVerified(entry.byDate.get(date), isAggregate ? '有效播放量' : `${metricLabel}${mode === 'platform' ? '平台表现' : '有效播放'}`, sourceSync[entry.subject.id])),
  })
  const withData = (items) => items.filter((item) => item.data.some((value) => hasMetricValue(value)))
  return {
    dates: aggregateDates,
    aggregateDates,
    platformDates,
    aggregate: aggregateMetric ? withData(recordsBySubject.map((entry) => seriesFor(entry, aggregateMetric, aggregateDates, true))) : undefined,
    platforms: boardPlatforms.map((platform, index) => withData(recordsBySubject.map((entry) => seriesFor(entry, platform.label, platformDates[index])))),
  }
}

function comparisonPlayback(project, competitors = [], liveHeat = {}) {
  return comparisonSubjects(project, competitors).map((item) => ({
    name: item.title,
    color: item.color,
    // 猫眼的有效播放字段已经是“截至该日”的累计值。按日期相加会把同一播放量
    // 重复累计，因此饼图使用每部剧最后一个公开的累计值。
    value: [...recordsFor(item.id, liveHeat)].reverse().map((record) => effectiveMetric(record)).find((value) => value !== null && value !== undefined) ?? null,
  })).filter((item) => hasMetricValue(item.value))
}

function cumulativeEffectiveByPlatform(records = []) {
  const latestByPlatform = new Map()
  for (const record of [...records].reverse()) {
    for (const [name, value] of Object.entries(record.values || {})) {
      const match = name.match(/^(.+)累计有效播放$/)
      if (!match || !Number.isFinite(Number(value))) continue
      const platform = platformDisplayName(match[1])
      if (platform && !latestByPlatform.has(platform)) latestByPlatform.set(platform, { value: Number(value), date: record.date })
    }
  }
  const entries = [...latestByPlatform.values()]
  return entries.length ? {
    platformCount: entries.length,
    singlePlatform: entries.length === 1 ? entries[0] : null,
  } : null
}

function ProjectIdentityCard({ project, title, sourceLabel, latestDate }) {
  const displayTitle = project?.title || title || '当前项目'
  const poster = typeof project?.poster === 'string' && /^(?:https?:|data:|\/|\.\/)/.test(project.poster)
    ? project.poster
    : (typeof project?.posterUrl === 'string' ? project.posterUrl : '')
  const cast = project?.cast?.length ? project.cast.join('、') : '待补充'
  const directors = project?.directors?.length ? project.directors.join('、') : '待补充'
  const premiered = project?.premiered || '待补充'
  const latestLabel = sourceLabel ? `最新${sourceLabel}数据` : '最新数据'

  return (
    <div className="web-heat-project-card" aria-label={`${displayTitle}项目信息`}>
      <div className="web-heat-project-poster">
        {poster ? <PosterImage src={poster} alt={`${displayTitle}封面`} width="64" height="96" onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.nextElementSibling.hidden = false }} /> : null}
        <span hidden={Boolean(poster)}>{displayTitle.slice(0, 1) || '剧'}</span>
      </div>
      <div className="web-heat-project-copy">
        <strong>{displayTitle}</strong>
        <div className="web-heat-project-meta">
          <div className="web-heat-project-meta-main">
            <span>主演 {cast}</span>
            <span>导演 {directors}</span>
          </div>
          <div className="web-heat-project-meta-side">
            <small><b>首播</b><em>{premiered}</em></small>
            <small><b>{latestLabel}</b><em>{latestDate || '待补充'}</em></small>
          </div>
        </div>
      </div>
    </div>
  )
}

function makeEffectiveComparisonData(showName = '逐玉') {
  const values = boardData.effective[0].values
  const latest = values[values.length - 1] ?? 0
  const factors = [1, .86, .72, .58, .44]
  const offsets = [0, 0, 14, 22, 40]
  return [showName, '竞品一', '竞品二', '竞品三', '竞品四'].map((name, index) => ({
    name,
    value: Math.round(latest * factors[index] + offsets[index]),
  }))
}

const CHART_ZOOM_LEVELS = [.5, .75, 1, 1.5, 2, 3]

function closestZoomIndex(scale) {
  return CHART_ZOOM_LEVELS.reduce((closest, value, index) => {
    return Math.abs(value - scale) < Math.abs(CHART_ZOOM_LEVELS[closest] - scale) ? index : closest
  }, 0)
}

function chartTickStride(length, scale) {
  const target = scale <= .5 ? 6 : scale <= .75 ? 8 : scale <= 1 ? 12 : scale <= 1.5 ? 20 : scale <= 2 ? 30 : Math.max(1, Math.floor(length / 2))
  return Math.max(1, Math.ceil(Math.max(1, length - 1) / Math.max(1, target - 1)))
}

function parseDateOnly(value) {
  return new Date(`${value}T00:00:00Z`).getTime()
}

function formatMonthDay(value) {
  const date = new Date(parseDateOnly(value))
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`
}

function makeDateRange(start, end, length) {
  if (length <= 1) return [start]
  const startTime = parseDateOnly(start)
  const endTime = parseDateOnly(end)
  return Array.from({ length }, (_, index) => {
    const time = startTime + ((endTime - startTime) * index) / (length - 1)
    return new Date(time).toISOString().slice(0, 10)
  })
}

function makeReferenceDates(length) {
  const anchors = ['2025-02-18', '2025-03-09', '2025-03-28', '2025-04-16', '2025-05-05', '2025-05-19']
  const anchorIndexes = anchors.map((_, index) => Math.min(length - 1, Math.round((index * Math.max(1, length)) / (anchors.length - 1))))
  const dates = Array.from({ length }, () => anchors[0])
  anchors.forEach((anchor, anchorIndex) => {
    const startIndex = anchorIndexes[anchorIndex]
    const endIndex = anchorIndexes[Math.min(anchorIndex + 1, anchorIndexes.length - 1)]
    const endDate = anchors[Math.min(anchorIndex + 1, anchors.length - 1)]
    if (anchorIndex === anchors.length - 1) {
      dates[startIndex] = anchor
      return
    }
    const startTime = parseDateOnly(anchor)
    const endTime = parseDateOnly(endDate)
    for (let index = startIndex; index <= endIndex; index += 1) {
      const ratio = (index - startIndex) / Math.max(1, endIndex - startIndex)
      dates[index] = new Date(startTime + (endTime - startTime) * ratio).toISOString().slice(0, 10)
    }
  })
  return dates
}

function xForDate(date, index, dates, width, left, right) {
  if (dates.length <= 1) return left
  const start = parseDateOnly(dates[0])
  const end = parseDateOnly(dates[dates.length - 1])
  const current = parseDateOnly(date)
  const ratio = (current - start) / Math.max(1, end - start)
  return left + Math.max(0, Math.min(1, ratio)) * (width - left - right)
}

function scaledPlotX(baseX, zoomFactor) {
  return 34 + (baseX - 34) * zoomFactor
}

function chartViewBoxWidth(zoomFactor) {
  return scaledPlotX(660, zoomFactor)
}

function svgPointerX(event) {
  const svg = event.currentTarget
  const screenMatrix = svg.getScreenCTM()
  if (!screenMatrix) return null
  const point = svg.createSVGPoint()
  point.x = event.clientX
  point.y = event.clientY
  return point.matrixTransform(screenMatrix.inverse()).x
}

function chartYearGroups(dates) {
  const groups = []
  dates.forEach((date, index) => {
    const year = date.slice(0, 4)
    const previous = groups[groups.length - 1]
    if (previous?.year === year) previous.end = index
    else groups.push({ year, start: index, end: index })
  })
  return groups
}

function lineSegments(points) {
  const segments = []
  let current = []
  points.forEach((point) => {
    if (point.value === null || point.value === undefined || !Number.isFinite(point.value)) {
      if (current.length) segments.push(current)
      current = []
      return
    }
    current.push(`${point.x},${point.y}`)
  })
  if (current.length) segments.push(current)
  return segments
}

function makeStandaloneTrendData() {
  const start = new Date(Date.UTC(2025, 1, 18))
  const end = new Date(Date.UTC(2025, 4, 19))
  const dates = []
  const values = []
  for (let cursor = new Date(start), index = 0; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1), index += 1) {
    dates.push(cursor.toISOString().slice(0, 10))
    const trend = 9816.87 - index * 25.8
    const wave = Math.sin(index * 0.71) * 58 + Math.sin(index * 1.93) * 30
    const drop = (index > 25 ? 110 : 0) + (index > 49 ? 120 : 0) + (index > 72 ? 50 : 0)
    values.push(Math.round(trend + wave - drop))
  }
  return { dates, values }
}

const standaloneTrendData = makeStandaloneTrendData()

function standaloneTickStride(length, scale, plotWidth) {
  const byZoom = scale <= 0.5 ? 5 : scale <= 0.75 ? 8 : scale <= 1 ? 12 : scale <= 1.5 ? 20 : scale <= 2 ? 30 : length
  const byPixels = Math.max(2, Math.floor(plotWidth / 88))
  return Math.max(1, Math.ceil(length / Math.min(byZoom, byPixels)))
}

function ChartToolbar({ scale, onScaleChange }) {
  const zoomIndex = closestZoomIndex(scale)
  return (
    <div className="web-heat-chart-toolbar" aria-label="图表比例控制">
      <button type="button" disabled={zoomIndex === 0} onClick={() => onScaleChange(CHART_ZOOM_LEVELS[Math.max(0, zoomIndex - 1)])} aria-label="缩小图表">−</button>
      <span>{Math.round(CHART_ZOOM_LEVELS[zoomIndex] * 100)}%</span>
      <button type="button" disabled={zoomIndex === CHART_ZOOM_LEVELS.length - 1} onClick={() => onScaleChange(CHART_ZOOM_LEVELS[Math.min(CHART_ZOOM_LEVELS.length - 1, zoomIndex + 1)])} aria-label="放大图表">＋</button>
      <button type="button" onClick={() => onScaleChange(CHART_ZOOM_LEVELS[0])}>适配全部</button>
      <button type="button" onClick={() => onScaleChange(CHART_ZOOM_LEVELS[CHART_ZOOM_LEVELS.length - 1])}>最大视图</button>
    </div>
  )
}

function makeDates(length) {
  return Array.from({ length }, (_, index) => `05/${String(index * 2 + 1).padStart(2, '0')}`)
}

function makeCrossYearDates(length) {
  const dates = [
    '2024/02', '2024/04', '2024/06', '2024/08', '2024/10', '2024/12',
    '2025/02', '2025/04', '2025/06', '2025/08', '2025/10', '2025/12',
    '2026/02', '2026/04', '2026/05',
  ]
  return dates.slice(0, length)
}

function Chart({ values, color }) {
  const [scale, setScale] = useState(.5)
  const [hovered, setHovered] = useState(null)
  const dates = makeDates(values.length)
  const points = values.map((value, index) => {
    const x = 48 + (index * 560) / (values.length - 1)
    const y = 330 - ((value - Math.min(...values)) / (Math.max(...values) - Math.min(...values) || 1)) * 258
    return { x, y, value, date: dates[index] }
  })
  const pointString = points.map(({ x, y }) => `${x},${y}`).join(' ')
  const hoveredPoint = hovered === null ? null : points[hovered]

  return (
    <div className="web-heat-chart-wrap">
      <ChartToolbar scale={scale} onScaleChange={setScale} />
      <div className="web-heat-chart-viewport">
        <div className="web-heat-chart-canvas" style={{ width: `${(CHART_ZOOM_LEVELS[closestZoomIndex(scale)] / .5) * 100}%` }}>
          <svg className="web-heat-chart-svg" viewBox="0 0 660 390" role="img" aria-label="热度趋势图">
            <g className="web-heat-grid-lines">
              {[72, 136, 200, 264, 330].map((y) => <line key={y} x1="48" x2="608" y1={y} y2={y} />)}
              {[48, 110, 172, 234, 296, 358, 420, 482, 544, 608].map((x) => <line key={x} x1={x} x2={x} y1="72" y2="330" />)}
            </g>
            <polyline points={pointString} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            {points.map(({ x, y, value, date }, index) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r={hovered === index ? 7 : 5} fill="#fff" stroke={color} strokeWidth="3" onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)}>
                <title>{`${date} · ${value}`}</title>
              </circle>
            ))}
            <line className="web-heat-axis" x1="48" x2="608" y1="330" y2="330" />
            <line className="web-heat-axis" x1="48" x2="48" y1="72" y2="330" />
            <text x="48" y="360">{dates[0]}</text>
            <text x="170" y="360">{dates[2]}</text>
            <text x="292" y="360">{dates[4]}</text>
            <text x="414" y="360">{dates[6]}</text>
            <text x="536" y="360">{dates[8]}</text>
            <text x="330" y="386" className="web-heat-year-label">2025</text>
          </svg>
          {hoveredPoint && <div className="web-heat-tooltip" style={{ left: `${(hoveredPoint.x / 660) * 100}%`, top: `${(hoveredPoint.y / 390) * 100}%` }}><strong>{hoveredPoint.date} · 当日数据</strong><span><i style={{ background: color }} />数值：{hoveredPoint.value}</span></div>}
        </div>
      </div>
    </div>
  )
}

export function EchartsHeatChart({ values = [], color, showName, chartTitle, hideChartTitle = false, compact = false, logo, logoMark, dataSeries, dateLabels, inverseYAxis = false, preserveSourceDecimals = false, sliderBottom = compact ? 46 : 56 }) {
  const chartRef = useRef(null)
  const chartInstanceRef = useRef(null)
  const [rangeMode, setRangeMode] = useState('all')
  const chartValues = useMemo(() => {
    const nextValues = values.slice(0, 15)
    while (nextValues.length < 15) {
      const previous = nextValues[nextValues.length - 1] ?? 0
      nextValues.push(Math.round(previous * (1 + ((nextValues.length % 4) - 1) * .025)))
    }
    return nextValues
  }, [values])
  const hasLiveSeries = Array.isArray(dataSeries)
  const sourceDates = useMemo(() => {
    if (hasLiveSeries) return Array.isArray(dateLabels) ? dateLabels : []
    return makeCrossYearDates(chartValues.length)
  }, [chartValues.length, dateLabels, hasLiveSeries])
  const sourceSeries = useMemo(() => {
    if (hasLiveSeries) {
      return dataSeries.map((item) => ({
      name: item.name || '未命名项目',
      data: sourceDates.map((_, index) => item.data?.[index] ?? null),
      color: item.color,
      verified: item.verified,
      })).filter((item) => item.data.some((value) => value !== null && value !== undefined && Number.isFinite(Number(value))))
    }
    const currentName = showName || '逐玉'
    return [
      { name: currentName, data: chartValues, color },
      { name: '竞品一', data: chartValues.map((value, index) => Math.round(value * .86 + (index % 3) * 18)) },
      { name: '竞品二', data: chartValues.map((value, index) => Math.round(value * .72 + (index % 4) * 14)) },
      { name: '竞品三', data: chartValues.map((value, index) => Math.round(value * .58 + (index % 2) * 22)) },
      { name: '竞品四', data: chartValues.map((value, index) => Math.round(value * .44 + (index % 5) * 10)) },
    ]
  }, [chartValues, color, dataSeries, sourceDates, hasLiveSeries, showName])
  const timeWindow = useMemo(
    () => chartTimeWindow(rangeMode, [{ dates: sourceDates, series: sourceSeries }]),
    [rangeMode, sourceDates, sourceSeries],
  )
  const zoomWindow = useMemo(() => chartZoomWindow(sourceDates, timeWindow), [sourceDates, timeWindow])
  const dates = sourceDates
  const chartSeries = timeWindow?.dates?.length === 0
    ? sourceSeries.map(item => ({ ...item, data: sourceDates.map(() => null) }))
    : sourceSeries
  const periodCaption = chartPeriodCaption(zoomWindow.visibleDates)
  const hasChartData = chartSeries.some((item) => item.data.some((value) => value !== null && value !== undefined && Number.isFinite(Number(value))))
  const emptyLabel = timeWindow?.dates?.length === 0 ? '暂无已核验数据' : '无数据'

  useEffect(() => {
    if (!chartRef.current) return undefined
    const chart = echarts.init(chartRef.current)
    chartInstanceRef.current = chart
    const removePointerCoordinateNormalizer = installEchartsPointerCoordinates(chart, chartRef.current)
    chart.setOption({
      textStyle: { fontFamily: getComputedStyle(chartRef.current).fontFamily },
      title: {
        show: !hideChartTitle,
        text: `${chartTitle || '热度值'}趋势`,
        left: 'center',
        top: 12,
        textStyle: { fontSize: 15, fontWeight: 600, color: '#eff1f5' },
      },
      tooltip: {
        trigger: 'axis',
        triggerOn: 'none',
        confine: true,
        backgroundColor: '#20252e',
        borderColor: '#414956',
        axisPointer: { type: 'line' },
        textStyle: { fontSize: 15, color: '#eff1f5' },
        formatter: (params) => {
          const items = Array.isArray(params) ? params : [params]
          const date = items[0]?.axisValueLabel || items[0]?.axisValue || ''
          const rows = items
            .map((item) => {
              const rawValue = Array.isArray(item?.value) ? item.value[item.value.length - 1] : item?.value
              if (!hasMetricValue(rawValue)) return null
              const numericValue = Number(rawValue)
              if (!Number.isFinite(numericValue)) return null
              const displayValue = preserveSourceDecimals
                ? formatSourceMetric(numericValue)
                : Math.round(numericValue).toLocaleString('zh-CN')
              return `${item.marker || ''}${item.seriesName || ''} ${displayValue}`
            })
            .filter(Boolean)
          return [date, ...rows].join('<br/>')
        },
      },
      legend: {
        type: 'scroll',
        data: chartSeries.map((item) => item.name),
        top: 42,
        left: 'center',
        itemWidth: 18,
        itemHeight: 10,
        itemGap: 18,
        textStyle: { fontSize: 15, color: '#d4d9e3' },
      },
      // The compact cards have a separate slider below the x-axis labels.
      // Reserve that space explicitly so the slider never sits on top of dates.
      // Keep the card and dataZoom slider separated from the plot labels.
      grid: { left: '5%', right: '5%', top: 88, bottom: compact ? '18%' : '14%', containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: dates,
        axisLabel: { fontSize: 15, color: '#d4d9e3' },
        axisLine: { lineStyle: { color: '#626b79' } },
        axisTick: { alignWithLabel: true },
      },
      yAxis: {
        type: 'value',
        scale: true,
        // ECharts recalculates the extent after dataZoom filters the active
        // category window, so each selected or dragged range gets its own max.
        max: visibleDataMaximum,
        inverse: inverseYAxis,
        min: inverseYAxis ? 1 : undefined,
        axisLabel: { fontSize: 15, color: '#d4d9e3' },
        splitLine: { lineStyle: { color: '#30363f', type: 'dashed' } },
      },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          start: zoomWindow.start,
          end: zoomWindow.end,
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          moveOnMouseWheel: true,
        },
        {
          type: 'slider',
          xAxisIndex: 0,
          start: zoomWindow.start,
          end: zoomWindow.end,
          height: 20,
          // Keep the range slider visibly above the chart footer/date metadata.
          bottom: sliderBottom,
          borderColor: 'transparent',
          backgroundColor: '#272d37',
          fillerColor: WEB_HEAT_PRIMARY_COLOR,
          handleSize: '160%',
          handleStyle: { color: '#f7fbff', borderColor: '#101a2b', borderWidth: 2, shadowBlur: 4, shadowColor: 'rgba(0, 0, 0, 0.75)' },
          moveHandleStyle: { color: '#d7e7ff', borderColor: '#101a2b' },
          dataBackground: { lineStyle: { color: '#66758e' }, areaStyle: { color: '#3b465a' } },
          selectedDataBackground: { lineStyle: { color: WEB_HEAT_CHART_COLOR }, areaStyle: { color: '#607ba6' } },
          textStyle: { fontSize: 15, color: '#d4d9e3' },
        },
      ],
      color: COMPARISON_COLORS,
      series: chartSeries.map((item) => {
        const seriesColor = item.color === COMPARISON_COLORS[0] || (!compact && item.name === showName) ? WEB_HEAT_CHART_COLOR : item.color
        return {
          name: item.name,
          type: 'line',
          stack: hasLiveSeries ? undefined : 'Total',
          smooth: false,
          symbol: 'circle',
          symbolSize: 6,
          showSymbol: true,
          data: item.data,
          itemStyle: seriesColor ? { color: seriesColor } : undefined,
          lineStyle: seriesColor ? { color: seriesColor, width: 2.5 } : undefined,
        }
      }),
    })

    const syncTooltipPointer = (event) => {
      const rect = chartRef.current?.getBoundingClientRect()
      if (!rect?.width || !rect.height) return
      const x = ((event.clientX - rect.left) / rect.width) * chart.getWidth()
      const y = ((event.clientY - rect.top) / rect.height) * chart.getHeight()
      chart.dispatchAction({ type: 'showTip', x, y })
    }
    const hideTooltipPointer = (event) => {
      if (event.type === 'pointercancel' || event.pointerType !== 'touch') chart.dispatchAction({ type: 'hideTip' })
    }
    chartRef.current.addEventListener('pointerdown', syncTooltipPointer, { passive: true })
    chartRef.current.addEventListener('pointermove', syncTooltipPointer, { passive: true })
    chartRef.current.addEventListener('pointerleave', hideTooltipPointer, { passive: true })
    chartRef.current.addEventListener('pointercancel', hideTooltipPointer, { passive: true })

    const resizeChart = () => {
      chart.resize()
      const narrow = chart.getWidth() < 520
      chart.setOption({
        legend: { top: narrow ? 54 : 42, itemGap: narrow ? 12 : 18, textStyle: { fontSize: narrow ? 11 : 15 } },
        grid: { top: narrow ? 92 : 88, bottom: narrow ? 68 : compact ? '18%' : '14%' },
        xAxis: { axisLabel: { fontSize: narrow ? 11 : 15, hideOverlap: true } },
        yAxis: { axisLabel: { fontSize: narrow ? 11 : 15 } },
        dataZoom: [
          { type: 'inside', zoomOnMouseWheel: !narrow, moveOnMouseMove: !narrow, moveOnMouseWheel: !narrow, preventDefaultMouseMove: !narrow },
          { type: 'slider', height: narrow ? 26 : 20, bottom: narrow ? 24 : sliderBottom, textStyle: { fontSize: narrow ? 11 : 15 } },
        ],
      })
    }
    resizeChart()
    const resizeObserver = new ResizeObserver(resizeChart)
    resizeObserver.observe(chartRef.current)
    return () => {
      resizeObserver.disconnect()
      removePointerCoordinateNormalizer()
      chartRef.current?.removeEventListener('pointerdown', syncTooltipPointer)
      chartRef.current?.removeEventListener('pointermove', syncTooltipPointer)
      chartRef.current?.removeEventListener('pointerleave', hideTooltipPointer)
      chartRef.current?.removeEventListener('pointercancel', hideTooltipPointer)
      chartInstanceRef.current = null
      chart.dispose()
    }
  }, [chartSeries, chartTitle, color, dates, hasLiveSeries, inverseYAxis, sliderBottom, rangeMode, zoomWindow])

  const selectRange = (mode) => {
    setRangeMode(mode)
  }

  return (
    <div className="web-heat-echarts-wrap" data-analytics-component="网端趋势图">
      {logo && <span className="web-heat-echarts-logo" aria-label={`${showName} logo`}><img src={logo} alt="" onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.nextElementSibling.hidden = false }} /><span hidden>{logoMark}</span></span>}
      <div ref={chartRef} className="web-heat-echarts" aria-label={`${chartTitle || '热度值'}堆叠折线统计图`} />
      {!hasChartData && <div className="web-heat-echarts-empty" aria-label={emptyLabel}>{emptyLabel}</div>}
      <div className="web-heat-time-controls" role="group" aria-label={`${chartTitle || '热度值'}时间范围`}>
        {[['7', '近7天'], ['30', '近30天'], ['all', '完整视图']].map(([mode, label]) => <button key={mode} type="button" className="web-heat-echarts-fit" aria-pressed={rangeMode === mode} onClick={() => selectRange(mode)}>{label}</button>)}
      </div>
      {periodCaption && <span className="web-heat-time-caption" role="status">{periodCaption}</span>}
    </div>
  )
}

function CumulativePlaybackPie({ showName, items }) {
  const chartRef = useRef(null)

  useEffect(() => {
    if (!chartRef.current) return undefined
    const chart = echarts.init(chartRef.current)
    chart.setOption({
      textStyle: { fontFamily: getComputedStyle(chartRef.current).fontFamily },
      title: {
        text: '累计有效播放对比',
        left: 12,
        top: 9,
        textStyle: { fontSize: 13, fontWeight: 600, color: '#eff1f5' },
      },
      tooltip: {
        trigger: 'item',
        backgroundColor: '#20252e',
        borderColor: '#414956',
        formatter: ({ name, value, percent }) => `${name}<br/>${formatMetric(value)}（${percent}%）`,
        textStyle: { fontSize: 11, color: '#eff1f5' },
      },
      legend: {
        orient: 'vertical',
        right: 8,
        top: 'middle',
        itemWidth: 8,
        itemHeight: 8,
        itemGap: 7,
        textStyle: { fontSize: 10, color: '#d4d9e3' },
      },
      series: [{
        type: 'pie',
        radius: ['34%', '64%'],
        center: ['31%', '56%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 6, borderColor: '#191d24', borderWidth: 2 },
        label: { show: false },
        labelLine: { show: false },
        data: (Array.isArray(items) ? items : makeEffectiveComparisonData(showName)).map((item, index) => ({
          ...item,
          itemStyle: { color: item.name === showName ? WEB_HEAT_CHART_COLOR : item.color || comparisonColor(index) },
        })),
      }],
    })
    const resizeObserver = new ResizeObserver(() => chart.resize())
    resizeObserver.observe(chartRef.current)
    return () => { resizeObserver.disconnect(); chart.dispose() }
  }, [items, showName])

  return <div ref={chartRef} className="web-heat-playback-pie-chart" aria-label="累计有效播放对比饼图" />
}

function BoardChart({ values, color }) {
  const [scale, setScale] = useState(.5)
  const [hovered, setHovered] = useState(null)
  const dates = makeReferenceDates(values.length)
  const numericValues = values.filter((value) => Number.isFinite(value))
  const min = Math.min(...numericValues)
  const max = Math.max(...numericValues)
  const points = values.map((value, index) => ({
    x: xForDate(dates[index], index, dates, 660, 34, 34),
    y: Number.isFinite(value) ? 44 + 100 - ((value - min) / (max - min || 1)) * 100 : null,
    value,
    date: dates[index],
  }))
  const hoveredPoint = hovered === null ? null : points[hovered]
  const yearGroups = chartYearGroups(dates)
  const tickStride = chartTickStride(dates.length, scale)
  const zoomFactor = CHART_ZOOM_LEVELS[closestZoomIndex(scale)] / .5
  const handlePointerMove = (event) => {
    const pointerX = svgPointerX(event)
    if (pointerX === null) return
    const plotLeft = 34
    const plotRight = scaledPlotX(626, zoomFactor)
    const ratio = Math.max(0, Math.min(1, (pointerX - plotLeft) / Math.max(1, plotRight - plotLeft)))
    setHovered(Math.min(points.length - 1, Math.max(0, Math.round(ratio * Math.max(1, points.length - 1)))))
  }
  const handleScaleChange = (nextScale) => {
    setHovered(null)
    setScale(nextScale)
  }

  return (
    <div className="web-heat-board-chart-wrap">
      <ChartToolbar scale={scale} onScaleChange={handleScaleChange} />
      <div className="web-heat-chart-viewport">
        <div className="web-heat-chart-canvas" style={{ width: `${(CHART_ZOOM_LEVELS[closestZoomIndex(scale)] / .5) * 100}%` }}>
          <svg className="web-heat-board-svg" viewBox={`0 0 ${chartViewBoxWidth(zoomFactor)} 220`} role="img" aria-label="平台趋势图" onMouseMove={handlePointerMove} onMouseLeave={() => setHovered(null)}>
            <g className="web-heat-grid-lines">
              {[44, 78, 112, 144].map((y) => <line key={y} x1="34" x2={scaledPlotX(626, zoomFactor)} y1={y} y2={y} />)}
              {points.filter(({ x }, index) => index % Math.max(1, Math.ceil(points.length / 10)) === 0).map(({ x }, index) => <line key={`${x}-${index}`} x1={scaledPlotX(x, zoomFactor)} x2={scaledPlotX(x, zoomFactor)} y1="44" y2="144" />)}
            </g>
            {lineSegments(points.map((point) => ({ ...point, x: scaledPlotX(point.x, zoomFactor) }))).map((segment, index) => <polyline key={index} points={segment.join(' ')} fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />)}
            {hoveredPoint?.y !== null && hoveredPoint && <line className="web-heat-crosshair" x1={scaledPlotX(hoveredPoint.x, zoomFactor)} x2={scaledPlotX(hoveredPoint.x, zoomFactor)} y1="44" y2="144" />}
            {points.map(({ x, y }, index) => y === null ? null : <circle key={`${x}-${y}`} cx={scaledPlotX(x, zoomFactor)} cy={y} r={hovered === index ? 6 : 0} fill="#fff" stroke={color} strokeWidth="2.5" />)}
            <line className="web-heat-axis" x1="34" x2={scaledPlotX(626, zoomFactor)} y1="144" y2="144" />
            {points.map(({ x, date }, index) => (index % tickStride !== 0 && index !== points.length - 1) ? null : <text key={date} x={scaledPlotX(x, zoomFactor)} y="169" textAnchor="middle">{formatMonthDay(date)}</text>)}
            {yearGroups.map((group) => {
              const x1 = points[group.start].x
              const x2 = points[group.end].x
              return <g key={group.year}><line className="web-heat-year-axis" x1={scaledPlotX(x1, zoomFactor)} x2={scaledPlotX(x2, zoomFactor)} y1="191" y2="191" /><line className="web-heat-year-boundary" x1={scaledPlotX(x1, zoomFactor)} x2={scaledPlotX(x1, zoomFactor)} y1="186" y2="196" /><line className="web-heat-year-boundary" x1={scaledPlotX(x2, zoomFactor)} x2={scaledPlotX(x2, zoomFactor)} y1="186" y2="196" /><text x={scaledPlotX((x1 + x2) / 2, zoomFactor)} y="214" className="web-heat-year-label">{group.year}</text></g>
            })}
          </svg>
          {hoveredPoint?.y !== null && hoveredPoint && <div className="web-heat-tooltip" style={{ left: `${(scaledPlotX(hoveredPoint.x, zoomFactor) / chartViewBoxWidth(zoomFactor)) * 100}%`, top: `${(hoveredPoint.y / 220) * 100}%` }}><strong>{formatMonthDay(hoveredPoint.date)} · 当日数据</strong><span><i style={{ background: color }} />数值：{hoveredPoint.value}</span></div>}
        </div>
      </div>
      {scale > .5 && <small className="web-heat-chart-scroll-hint">日期较多，可横向滚动查看</small>}
    </div>
  )
}

function AggregateChart({ showName = '逐玉' }) {
  const [zoomIndex, setZoomIndex] = useState(0)
  const [hovered, setHovered] = useState(null)
  const [viewportWidth, setViewportWidth] = useState(880)
  const scrollRef = useRef(null)
  const { dates, values } = standaloneTrendData
  const scale = CHART_ZOOM_LEVELS[zoomIndex]
  const displayScale = 0.5
  const chartHeight = 400 * displayScale
  const margins = { left: 76 * displayScale, right: 22 * displayScale, top: 22 * displayScale, bottom: 62 * displayScale }
  const chartWidth = Math.max(1, Math.round(viewportWidth * displayScale * (scale / 0.5)))
  const plotWidth = chartWidth - margins.left - margins.right
  const plotHeight = chartHeight - margins.top - margins.bottom
  const min = 6988.29
  const max = 9816.87
  const range = max - min
  const x = (index) => margins.left + plotWidth * index / Math.max(1, values.length - 1)
  const y = (value) => margins.top + plotHeight * (1 - (value - min) / range)
  const stride = standaloneTickStride(dates.length, scale, plotWidth)
  const yearGroups = chartYearGroups(dates)

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return undefined
    const updateWidth = () => setViewportWidth(Math.max(320, node.clientWidth))
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(node)
    return () => observer.disconnect()
  }, [showName])

  const handlePointerMove = (event) => {
    const pointerX = svgPointerX(event)
    if (pointerX === null) return
    const ratio = Math.max(0, Math.min(1, (pointerX - margins.left) / Math.max(1, plotWidth)))
    setHovered(Math.min(values.length - 1, Math.max(0, Math.round(ratio * (values.length - 1)))))
  }

  const handleScaleChange = (nextScale) => {
    setHovered(null)
    setZoomIndex(closestZoomIndex(nextScale))
  }

  const hoveredValue = hovered === null ? null : values[hovered]
  const hoveredX = hovered === null ? 0 : x(hovered)
  const hoveredY = hovered === null ? 0 : y(hoveredValue)
  const tooltipX = Math.min(chartWidth - 198, Math.max(8, hoveredX > chartWidth - 220 ? hoveredX - 206 : hoveredX + 16))
  const tooltipY = Math.min(chartHeight - 58, Math.max(8, hoveredY < 70 ? hoveredY + 16 : hoveredY - 58))
  const tooltipTextX = Math.min(chartWidth - 186, Math.max(20, hoveredX > chartWidth - 220 ? hoveredX - 194 : hoveredX + 28))
  const tooltipDateY = Math.min(chartHeight - 39, Math.max(27, hoveredY < 70 ? hoveredY + 35 : hoveredY - 39))
  const tooltipValueY = Math.min(chartHeight - 20, Math.max(46, hoveredY < 70 ? hoveredY + 54 : hoveredY - 20))
  return (
    <div className="web-heat-aggregate-wrap web-heat-aggregate-reference">
      <div className="web-heat-aggregate-legend"><i style={{ background: '#4f7cff' }} /><span>累计有效播放</span></div>
      <div className="web-heat-aggregate-toolbar-row">
        <span className="web-heat-aggregate-toolbar-label">时间轴密度随缩放调整</span>
        <ChartToolbar scale={scale} onScaleChange={handleScaleChange} />
      </div>
      <div className="web-heat-aggregate-tag">首播—完播</div>
      <div ref={scrollRef} className="web-heat-chart-viewport web-heat-aggregate-scroll" aria-label="趋势图，可按比例缩放">
        <div className="web-heat-chart-canvas" style={{ width: `${chartWidth}px`, height: `${chartHeight}px` }}>
          <svg className="web-heat-aggregate-svg" width={chartWidth} height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="累计有效播放量趋势图" onMouseMove={handlePointerMove} onMouseLeave={() => setHovered(null)}>
            <g className="web-heat-grid-lines">
              {Array.from({ length: 5 }, (_, row) => {
                const yy = margins.top + plotHeight * row / 4
                return <line key={yy} x1={margins.left} y1={yy} x2={chartWidth - margins.right} y2={yy} />
              })}
            </g>
            <g className="web-heat-aggregate-y-axis">
              {Array.from({ length: 5 }, (_, row) => {
                const yy = margins.top + plotHeight * row / 4
                const axisValue = max - range * row / 4
                return <text key={yy} x={margins.left - 2} y={yy + 6} textAnchor="end">{axisValue.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</text>
              })}
            </g>
            <g className="web-heat-aggregate-date-axis">
              {dates.map((date, index) => (index % stride !== 0 && index !== dates.length - 1) ? null : <text key={date} x={x(index)} y={chartHeight - 38} textAnchor="middle">{formatMonthDay(date)}</text>)}
            </g>
            <g className="web-heat-year-axis-group">
              {yearGroups.map((group) => {
                const startX = x(group.start)
                const endX = x(group.end)
                const lineEnd = Math.max(startX + 14, endX)
                return <g key={group.year}><line className="web-heat-year-axis" x1={startX} y1={chartHeight - 20} x2={lineEnd} y2={chartHeight - 20} /><line className="web-heat-year-boundary" x1={startX} y1={chartHeight - 26} x2={startX} y2={chartHeight - 14} /><line className="web-heat-year-boundary" x1={endX} y1={chartHeight - 26} x2={endX} y2={chartHeight - 14} /><text x={(startX + endX) / 2} y={chartHeight - 1} className="web-heat-year-label">{group.year}</text></g>
              })}
            </g>
            <polyline className="web-heat-reference-line" points={values.map((value, index) => `${x(index)},${y(value)}`).join(' ')} />
            {hovered !== null && <g className="web-heat-reference-hover"><line className="web-heat-crosshair" x1={hoveredX} y1={margins.top} x2={hoveredX} y2={chartHeight - margins.bottom} /><circle className="web-heat-reference-active-point" cx={hoveredX} cy={hoveredY} r="6" /><g className="web-heat-reference-tooltip"><rect x={tooltipX} y={tooltipY} width="190" height="48" rx="8" /><text x={tooltipTextX} y={tooltipDateY}>{`${formatMonthDay(dates[hovered])} · 当日数据`}</text><text x={tooltipTextX} y={tooltipValueY}>● {showName}：{hoveredValue.toLocaleString('zh-CN')}</text></g></g>}
          </svg>
        </div>
      </div>
      <p className="web-heat-aggregate-note">日期按实际数据对齐；没有数据的日期会保留断点，不补零。</p>
    </div>
  )
}

function BoardStack({ mode, showName, values, chartTitle, dataSeries, dateLabels, boardSeries, inverseYAxis = false, preserveSourceDecimals = false }) {
  if (mode === 'trend') {
    return (
      <div className="web-heat-board-stack is-single" aria-label={`${chartTitle}趋势图大看板`}>
        <EchartsHeatChart values={values} color={WEB_HEAT_CHART_COLOR} showName={showName} chartTitle={chartTitle} dataSeries={dataSeries} dateLabels={dateLabels} inverseYAxis={inverseYAxis} preserveSourceDecimals={preserveSourceDecimals} />
      </div>
    )
  }
  const visibleBoards = boardData[mode] ?? []
  return (
    <div className={`web-heat-board-stack ${visibleBoards.length === 1 ? 'is-single' : ''}`} aria-label={mode === 'effective' ? '有效播放看板' : '平台表现看板'}>
      {visibleBoards.map((board, index) => {
        if (board.aggregate) {
          return (
            <article className="web-heat-board-card web-heat-board-card-effective" key={`${mode}-aggregate`}>
              <EchartsHeatChart values={board.values} color={WEB_HEAT_CHART_COLOR} showName={showName} chartTitle={board.label} dataSeries={boardSeries?.aggregate} dateLabels={boardSeries?.aggregateDates || dateLabels} sliderBottom={24} />
            </article>
          )
        }
        const platform = boardPlatforms[mode === 'effective' ? index - 1 : index]
        const platformIndex = index - (mode === 'effective' ? 1 : 0)
        const platformChartTitle = mode === 'effective'
          ? `${platform.label}当日有效播放`
          : platform.label === '芒果TV' ? '芒果TV平台播放量趋势' : `${platform.label}热度`
        return (
          <article className="web-heat-board-card" key={`${mode}-${platform.key}`}>
              <EchartsHeatChart values={board.values} color={platform.color} showName={platform.label} chartTitle={platformChartTitle} logo={platform.logo} logoMark={platform.mark} compact sliderBottom={24} dataSeries={boardSeries?.platforms?.[platformIndex]} dateLabels={boardSeries?.platformDates?.[platformIndex] || dateLabels} />
          </article>
        )
      })}
    </div>
  )
}

function RawDataModule({ mainTitle }) {
  const [showDownloaded, setShowDownloaded] = useState(false)

  return (
    <div className="web-heat-rawdata-page">
      <header className="web-heat-rawdata-heading">
        <div>
          <span className="web-heat-rawdata-kicker">RAW DATA DOWNLOAD</span>
          <h1>Rawdata Download</h1>
          <p>查看当前项目已下载的原始数据，接口位置已预留。</p>
        </div>
        <button className="web-heat-rawdata-button" type="button" data-analytics-component="日志" data-analytics-action="查看已下载数据" onClick={() => setShowDownloaded(true)}>已下载数据</button>
      </header>
      {showDownloaded ? (
        <section className="web-heat-rawdata-card" aria-label="已下载数据">
          <div className="web-heat-rawdata-card-heading"><strong>已下载数据</strong><span>1 个项目</span></div>
          <div className="web-heat-rawdata-row">
            <div><strong>{mainTitle}</strong><span>网端热度 · 台端热度</span></div>
            <span>2025.02.18—2025.05.19</span>
            <b className="is-ready">已完成</b>
          </div>
        </section>
      ) : (
        <section className="web-heat-rawdata-empty" aria-live="polite">
          <strong>点击“已下载数据”查看本地数据</strong>
          <span>后续可在此接入下载接口，当前仅保留前端入口。</span>
        </section>
      )}
    </div>
  )
}

function LogModule({ activity, collectionProgress }) {
  const entries = Array.isArray(activity)
    ? activity.map((entry) => [new Date(entry.at).toLocaleTimeString('zh-CN', { hour12: false }), entry.source, entry.message, entry.level || 'info'])
    : []

  return (
    <div className="web-heat-log-page">
      <header className="web-heat-log-heading">
        <div><h1>日志</h1><p>查看前端页面事件和数据状态。</p></div>
        <b>实时采集</b>
      </header>
      {collectionProgress && (collectionProgress.logs?.length > 0 || Object.keys(collectionProgress.sources || {}).length > 0) ? <CollectionProgressLog {...collectionProgress} /> : null}
      <section className="web-heat-log-list" aria-label="维护日志">
        {entries.map(([time, source, message, type], index) => <div className="web-heat-log-row" key={`${time}-${source}-${index}`}><time>{time}</time><strong>{source}</strong><span>{message}</span><i className={`is-${type}`} /></div>)}
      </section>
    </div>
  )
}

export function WebHeatPage({
  onBack,
  title,
  project = null,
  projectState = {},
  collectionProgress = null,
  storageWarning = false,
  recommendations = [],
  recommendationWindow = null,
  recommendationLoading = false,
  recommendationError = '',
  onAddCompetitor,
  onRemoveCompetitor,
  onLoadRecommendations,
  onRefresh,
  onDownloadRawData,
  isExporting = false,
  exportError = '',
  collectingProjectIds = {},
  collectingTvRatingsById = {},
}) {
  const [platform, setPlatform] = useState(() => dashboardView(project?.id).platform || 'maoyan')
  const [dimension, setDimension] = useState(() => dashboardView(project?.id).dimension || 'heat')
  const [activeView, setActiveView] = useState(() => dashboardView(project?.id).view || 'heat')
  const [selectedView, setSelectedView] = useState(() => dashboardView(project?.id).view || 'heat')
  useEffect(() => {
    if (project?.id) saveDashboardSession({ projectId: project.id, view: activeView, platform, dimension })
  }, [project?.id, activeView, platform, dimension])
  const [isViewTransitionPending, startViewTransition] = useTransition()
  useEffect(() => { trackPage(`dashboard.${activeView}`) }, [activeView])
  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [layoutScale, setLayoutScale] = useState(dashboardLayoutScale)

  useEffect(() => {
    const updateLayoutScale = () => setLayoutScale(dashboardLayoutScale())
    updateLayoutScale()
    window.addEventListener('resize', updateLayoutScale)
    return () => window.removeEventListener('resize', updateLayoutScale)
  }, [])
  const dims = useMemo(() => dimensions[platform], [platform])
  const activeDimension = dims.find((item) => item.key === dimension) ?? dims[0]
  const lineColor = WEB_HEAT_CHART_COLOR
  const activeSeries = dimensionSeries[platform]?.[activeDimension.key] ?? series[platform]
  const activePlatform = platforms.find((item) => item.key === platform)
  const competitors = project ? projectState.competitors?.[project.id] || [] : []
  const displayProject = useMemo(() => {
    if (!project) return project
    const recordedPlatforms = recordedPlatformNames(project.id, projectState.liveHeat)
    return recordedPlatforms.length ? { ...project, platforms: [...recordedPlatforms.map((name) => ({ name, dimension: 'web' })), ...(project.platforms || []).filter((item) => item.dimension === 'tv')] } : project
  }, [project, projectState.liveHeat])
  const displayCompetitors = useMemo(() => competitors.map((item) => {
    const recordedPlatforms = recordedPlatformNames(item.id, projectState.liveHeat)
    return recordedPlatforms.length ? { ...item, platforms: [...recordedPlatforms.map((name) => ({ name, dimension: 'web' })), ...(item.platforms || []).filter((platformItem) => platformItem.dimension === 'tv')] } : item
  }), [competitors, projectState.liveHeat])
  const isBackgroundCollecting = Boolean(project && (
    collectingProjectIds?.[project.id]
    || collectingTvRatingsById?.[project.id]
    || competitors.some((item) => collectingProjectIds?.[item.id] || collectingTvRatingsById?.[item.id])
  ))
  const isRefreshBusy = isRefreshing || isBackgroundCollecting
  const projectRecords = useMemo(() => recordsFor(project?.id, projectState.liveHeat), [project?.id, projectState.liveHeat])
  const liveData = useMemo(() => {
    if (!project || ['effective', 'platform'].includes(dimension)) return null
    return liveComparison(project, competitors, projectState.liveHeat, platform, dimension, projectState.sourceSync)
  }, [competitors, dimension, platform, project, projectState.liveHeat, projectState.sourceSync])
  const liveBoards = useMemo(() => {
    if (!project || !['effective', 'platform'].includes(dimension)) return null
    return liveBoardSeries(project, competitors, projectState.liveHeat, dimension, projectState.sourceSync)
  }, [competitors, dimension, project, projectState.liveHeat, projectState.sourceSync])
  const playbackData = useMemo(() => project ? comparisonPlayback(project, competitors, projectState.liveHeat) : undefined, [competitors, project, projectState.liveHeat])
  const latestDataDate = latestDateForSource(projectRecords, platform)
  const webKpis = useMemo(() => {
    if (!project) return null
    const latest = (metric) => [...projectRecords].reverse().map((record) => metric === '有效播放量' ? effectiveMetric(record) : finiteMetric(record, metric)).find((value) => value !== null && value !== undefined)
    const maoyanSummary = projectState.sourceSync?.[project.id]?.maoyan?.summary
    if (dimension === 'effective') {
      const effectiveRecords = [...projectRecords].reverse().filter((record) => effectiveMetric(record) !== null)
      const cumulative = effectiveRecords.length ? effectiveMetric(effectiveRecords[0]) : null
      const latestDate = effectiveRecords[0]?.date || null
      const effectiveSummary = projectState.sourceSync?.[project.id]?.maoyan?.effectiveSummary
      const effectiveSync = projectState.sourceSync?.[project.id]?.maoyan
      const averageItem = maoyanSummaryItem(effectiveSummary, '集均有效播放')
      const platformCumulative = cumulativeEffectiveByPlatform(projectRecords)
      const singlePlatformCumulative = platformCumulative?.singlePlatform
      const mappingCurrent = effectiveSync?.effectiveCumulativeMappingVersion === EFFECTIVE_PLAYBACK_MAPPING_VERSION
      const sourceHeadline = mappingCurrent && effectiveSync?.effectiveHeadline?.date === latestDate ? effectiveSync.effectiveHeadline : null
      const cumulativeValue = mappingCurrent && !effectiveSync?.effectiveUnavailable ? (cumulative ?? (platformCumulative?.platformCount === 1 ? singlePlatformCumulative?.value : null)) : null
      const cumulativeNote = !mappingCurrent
        ? '正在核对猫眼累计有效播放口径'
        : effectiveSync?.effectiveUnavailable
          ? '猫眼源端当前无有效播放数据'
        : cumulative !== null
        ? (latestDate ? `猫眼“累计有效播放”源端值 · 截至 ${latestDate}` : '猫眼“累计有效播放”源端值')
        : platformCumulative?.platformCount === 1 && singlePlatformCumulative
          ? `猫眼单平台源端值 · 截至 ${singlePlatformCumulative.date}`
          : platformCumulative?.platformCount > 1
            ? '猫眼未返回汇总累计值；未合计分平台数据'
            : (latestDate ? `截至 ${latestDate}` : '暂无公开明细')
      const effectivePending = Boolean(latestDate && effectiveSync?.metricVerification?.effective?.unresolvedDates?.includes(latestDate))
      return [
        { label: '累计有效播放', value: sourceHeadline?.display || (cumulativeValue !== null && cumulativeValue !== undefined ? formatMetric(cumulativeValue, 2) : '—'), note: effectivePending ? `待复核 · ${cumulativeNote}` : cumulativeNote },
        { label: '集均有效播放', value: mappingCurrent && !effectiveSync?.effectiveUnavailable ? (maoyanSummaryDisplay(averageItem) || '—') : '—', note: mappingCurrent && !effectiveSync?.effectiveUnavailable ? (averageItem?.otherInfo || '猫眼源端未返回集均口径') : '正在核对猫眼集均有效播放口径' },
      ]
    }
    const definitions = [
      ['全网曝光', '猫眼全网曝光'],
      ['全网转评赞', '猫眼全网转评赞'],
      ['全网发布', '猫眼全网发布'],
      ['全网弹幕', '猫眼全网弹幕'],
    ]
    return definitions.map(([label, metric]) => {
      const summaryItem = maoyanSummaryItem(maoyanSummary, label)
      const sourceValue = maoyanSummaryDisplay(summaryItem)
      return {
        label,
        value: summaryItem ? (sourceValue || '—') : formatMetric(latest(metric)),
        note: summaryItem?.otherInfo || (summaryItem ? '猫眼源端未提供该指标' : (latest(metric) === null || latest(metric) === undefined ? '暂无公开明细' : '猫眼源端未返回累计口径')),
      }
    })
  }, [dimension, project, projectRecords, projectState.sourceSync])
  const displayedKpis = webKpis || (activeDimension.key === 'effective' ? [
    { label: '累计有效播放', value: '18.92亿', note: '截至当前项目' },
    { label: '集均有效播放', value: '5104.6万', note: '按已播集数计算' },
  ] : [
    { label: '全网曝光', value: '6.95亿', note: '累计 47.94亿' },
    { label: '全网转评赞', value: '658.7万', note: '累计 4072.5万' },
    { label: '全网发布', value: '22.7万', note: '累计 963.5万' },
    { label: '全网弹幕', value: '77.8万', note: '累计 268.7万' },
  ])
  const trendDimensions = ['heat', 'exposure', 'interaction', 'publish', 'danmaku', 'rank', 'growth']
  const boardMode = trendDimensions.includes(activeDimension.key)
    ? 'trend'
    : activeDimension.key === 'effective'
      ? 'effective'
      : activeDimension.key === 'platform'
        ? 'platform'
        : null

  const handlePlatform = (key) => {
    setPlatform(key)
    setDimension(dimensions[key][0].key)
  }

  const handleRefresh = async () => {
    if (isRefreshBusy) return
    setIsRefreshing(true)
    try {
      await onRefresh?.()
      setRefreshKey((value) => value + 1)
    } finally {
      setIsRefreshing(false)
    }
  }

  const navigateView = (view) => {
    setSelectedView(view)
    startViewTransition(() => setActiveView(view))
  }

  return (
    <div className="web-heat-viewport" style={{ '--dashboard-scale': layoutScale }}>
    <main className="web-heat-page" data-analytics-component="看板" aria-label="网端热度页面" style={{ '--heat-scale': 1 }}>
      <div className="web-heat-topbar" aria-hidden="true" />
      <div className="web-heat-stage">
        {exportError ? <div className="web-heat-storage-warning" role="alert">{exportError}</div> : null}
        {storageWarning ? <div className="web-heat-storage-warning" role="alert">本地保存失败，可能是浏览器存储空间不足；当前页面数据尚未可靠留存，请先导出 Rawdata。</div> : null}
        <nav className="web-heat-nav" data-analytics-component="看板导航" aria-label="热度页面导航">
          <button className={`web-heat-nav-button ${selectedView === 'heat' ? 'is-active' : ''}`} type="button" onClick={() => navigateView('heat')}>网端热度</button>
          <button className={`web-heat-nav-button ${selectedView === 'tv' ? 'is-active' : ''}`} type="button" onClick={() => navigateView('tv')}>台端热度</button>
          <button className={`web-heat-nav-button ${selectedView === 'competitor' ? 'is-active' : ''}`} type="button" data-analytics-action="同期竞品" aria-busy={isViewTransitionPending && selectedView === 'competitor'} onClick={() => navigateView('competitor')}>剧目对比</button>
          <button className="web-heat-nav-button web-heat-nav-button-download" type="button" data-analytics-action="导出原始数据" disabled={isExporting} aria-busy={isExporting} onClick={onDownloadRawData}>
            <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v3h14v-3" /></svg>
            <span>{isExporting ? '正在生成 Excel…' : <>Rawdata<br />Download</>}</span>
          </button>
          <button type="button" data-analytics-action="刷新数据" className={`web-heat-nav-refresh ${isRefreshBusy ? 'is-loading' : ''}`} aria-label="重新抓取数据" aria-busy={isRefreshBusy} disabled={isRefreshBusy} onClick={handleRefresh}>{isRefreshBusy ? <span className="web-heat-spinner" aria-hidden="true" /> : '↻'}</button>
        </nav>

        <div className="web-heat-utility-nav" data-analytics-component="看板辅助入口" aria-label="辅助入口">
          <button type="button" className={selectedView === 'logs' ? 'is-active' : ''} onClick={() => navigateView('logs')}>日志</button>
          <button type="button" data-analytics-action="打开免责声明" onClick={() => setIsDisclaimerOpen(true)}>免责声明</button>
        </div>

        <section className={`web-heat-panel${['heat', 'tv', 'competitor'].includes(activeView) ? ' is-dark-dashboard' : ''}${activeView === 'heat' ? ' is-web-heat' : ''}`} style={{ '--heat-accent': activePlatform?.color || platforms[0].color }}>
          <span className="sr-only">{title || '逐玉'} 网端热度</span>

            <div key={`competitor-view-${project?.id || 'demo'}`} className="web-heat-content web-heat-content-competitor" hidden={activeView !== 'competitor'} style={{ display: activeView === 'competitor' ? undefined : 'none' }}>
              <CompetitorModule
                mainTitle={title || '逐玉'}
                mainProject={displayProject}
                competitors={displayCompetitors}
                recommendations={recommendations}
                recommendationWindow={recommendationWindow}
                recommendationLoading={recommendationLoading}
                recommendationError={recommendationError}
                onAddCompetitor={onAddCompetitor}
                onRemoveCompetitor={onRemoveCompetitor}
                onLoadRecommendations={() => onLoadRecommendations?.(project, true)}
                collectingProjectIds={collectingProjectIds}
                collectingTvRatingsById={collectingTvRatingsById}
              />
            </div>

          {activeView === 'logs' ? (
            <div key={`logs-view-${refreshKey}`} className="web-heat-content web-heat-content-logs">
              <LogModule activity={projectState.logs} collectionProgress={collectionProgress} />
            </div>
          ) : null}

          {activeView === 'tv' ? (
            <div key={`tv-view-${refreshKey}`} className="web-heat-content web-heat-content-tv">
              <TvRatingsModule
                mainTitle={title || '逐玉'}
                mainProject={project}
                competitors={competitors}
                ratings={projectState.tvRatings}
              />
            </div>
          ) : ['competitor', 'logs'].includes(activeView) ? null : <div key={`heat-view-${refreshKey}`} className="web-heat-content web-heat-content-heat">
            <div className={`web-heat-kpis has-project-card ${activeDimension.key === 'effective' ? 'is-effective' : ''}`} aria-label="关键指标">
              <ProjectIdentityCard key={`${platform}:${activeDimension.key}`} project={project} title={title || '逐玉'} sourceLabel={activePlatform?.label} latestDate={latestDataDate} />
              {displayedKpis.slice(0, 2).map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.note}</small></div>)}
              {displayedKpis.slice(2).map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.note}</small></div>)}
            </div>

            <div className="web-heat-chart-block">
              {boardMode ? <BoardStack key={`${platform}:${activeDimension.key}`} mode={boardMode} showName={title || '逐玉'} values={activeSeries} chartTitle={activeDimension.label} dataSeries={project && boardMode === 'trend' ? liveData?.series || [] : undefined} dateLabels={project ? (boardMode === 'trend' ? liveData?.dates || [] : liveBoards?.dates || []) : undefined} boardSeries={liveBoards} inverseYAxis={activeDimension.key === 'rank'} preserveSourceDecimals={(activeDimension.key === 'heat' && (platform === 'maoyan' || platform === 'guduo')) || (platform === 'kuyun' && activeDimension.key === 'growth')} /> : <Chart values={activeSeries} color={lineColor} />}
            </div>

            <div className="web-heat-playback-pie" data-analytics-component="有效播放对比饼图">
              <CumulativePlaybackPie showName={title || '逐玉'} items={playbackData} />
            </div>

            <aside className="web-heat-controls" data-analytics-component="网端数据筛选" aria-label="数据筛选">
              <div className="web-heat-platforms">
                {platforms.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    data-analytics-action={`切换平台 ${item.label}`}
                    className={platform === item.key ? 'is-selected' : ''}
                    style={{ '--platform-color': item.color }}
                    onClick={() => handlePlatform(item.key)}
                  >
                    <span className="web-heat-platform-shadow" aria-hidden="true" />
                    <span className="web-heat-platform-edge" aria-hidden="true" />
                    <span className="web-heat-platform-front">
                      <i aria-hidden="true" />
                      {item.label}
                    </span>
                  </button>
                ))}
              </div>
              {platform === 'kuyun' ? <div className="web-heat-kuyun-note" role="note">酷云仅支持近30天数据，且榜单仅覆盖前10部剧</div> : null}
              {platform === 'guduo' ? <div className="web-heat-source-note" role="note">骨朵数据仅覆盖榜单排名前20的剧</div> : null}
              <div className="web-heat-dimensions">
                {dims.map((item) => (
                  <button key={item.key} type="button" data-analytics-action={`${activePlatform?.label || platform} ${item.label}`} className={activeDimension.key === item.key ? 'is-selected' : ''} onClick={() => setDimension(item.key)}>
                    <span>{item.label}</span><i style={{ background: activePlatform?.color || platforms[0].color }} />
                  </button>
                ))}
              </div>
            </aside>
          </div>}

        </section>
      </div>
      {isDisclaimerOpen && <DisclaimerModal onClose={() => setIsDisclaimerOpen(false)} />}
    </main>
    </div>
  )
}
