import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { COMPARISON_COLORS, comparisonColor, comparisonThemeColor } from '../lib/comparisonColors.js'
import { installEchartsPointerCoordinates } from '../lib/echartsPointerCoordinates.js'
import { visibleDataMaximum } from '../lib/chartScale.js'
import { buildTvComparison, comparableTvChannels, hasNumericValue, periodKey, ratingValue, rowChannel, rowsForChannel } from '../lib/tvComparison.js'
import { chartPeriodCaption } from '../lib/chartWindow.js'

echarts.use([LineChart, DataZoomComponent, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const CHART_PRIMARY_COLOR = '#FDBE34'

const channels = ['CCTV-8', '湖南卫视', '浙江卫视']
const dramaNames = ['逐玉', '分析作品一', '分析作品二', '分析作品三']
function breakthroughLabel(value) {
  const level = Math.floor(value)
  return level >= 1 ? `破${level}` : ''
}

export const tvRecords = channels.flatMap((channel, channelIndex) => {
  const dates = ['2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27']
  return dates.map((date, dateIndex) => {
    const base = 0.42 + channelIndex * .08 + dateIndex * .012
    const values = dramaNames.reduce((result, name, dramaIndex) => {
      const rating = +(base - dramaIndex * .07 + Math.sin((dateIndex + dramaIndex) * .8) * .025).toFixed(3)
      const share = +(rating * (5.2 - dramaIndex * .35)).toFixed(2)
      result[name] = { rating, share }
      return result
    }, {})
    return {
      date,
      channel,
      slot: '收视率',
      episodes: `第${18 + dateIndex}集`,
      values,
      sourceUrl: 'tvinfo://demo',
    }
  })
})

function summaryForRows(rows, subjectName = '') {
  const ratedRows = rows.filter((row) => ratingValue(row, 'rating', subjectName) !== null)
  const goldenRows = ratedRows.filter((row) => periodKey(row.slot) === 'golden')
  const nonGoldenRows = ratedRows.filter((row) => periodKey(row.slot) === 'non-golden')
  const primaryRows = goldenRows.length ? goldenRows : nonGoldenRows
  const primarySlot = goldenRows.length ? 'golden' : 'non-golden'
  const latestPrimaryRow = primaryRows.reduce((latest, row) => {
    if (!latest || String(row.date || '') > String(latest.date || '')) return row
    return latest
  }, null)
  const latestPrimaryValue = latestPrimaryRow ? ratingValue(latestPrimaryRow, 'rating', subjectName) : null
  const ratings = ratedRows.map((row) => ratingValue(row, 'rating', subjectName))
  const highestRow = ratedRows.reduce((best, row) => {
    if (!best || ratingValue(row, 'rating', subjectName) > ratingValue(best, 'rating', subjectName)) return row
    return best
  }, null)
  const dateRange = (items) => {
    const dates = items.map((row) => row.date).filter(Boolean).sort()
    return dates.length ? (dates.length === 1 ? dates[0] : `${dates[0]}—${dates.at(-1)}`) : '暂无公开记录'
  }
  return {
    primary: latestPrimaryValue,
    primaryLabel: primarySlot === 'golden' ? '黄金时段收视率' : '收视率',
    primarySlot,
    primarySlotLabel: primarySlot === 'golden' ? '黄金时段' : '',
    primaryPeriod: latestPrimaryRow?.date || '暂无公开记录',
    highest: ratings.length ? Math.max(...ratings) : null,
    highestSlot: highestRow ? periodKey(highestRow.slot) : 'non-golden',
    highestSlotLabel: highestRow && periodKey(highestRow.slot) === 'golden' ? '黄金时段' : '',
    period: dateRange(ratedRows),
  }
}

function TvChart({ channel, metric, mainTitle, chartRecords, comparisonNames, seriesColors, lightTheme = false }) {
  const chartRef = useRef(null)
  const chartInstanceRef = useRef(null)
  const animatedViewRef = useRef(null)
  const records = useMemo(() => Array.isArray(chartRecords) ? chartRecords : tvRecords.filter((record) => record.channel === channel), [channel, chartRecords])
  const names = useMemo(() => Array.isArray(comparisonNames) && comparisonNames.length ? comparisonNames : [mainTitle || '逐玉', ...dramaNames.slice(1)], [comparisonNames, mainTitle])
  const hasData = useMemo(() => names.some((name) => records.some((record) => {
    const value = record.values?.[name]?.[metric] ?? record.values?.[dramaNames[names.indexOf(name)]]?.[metric]
    return hasNumericValue(value)
  })), [metric, names, records])
  const periodCaption = useMemo(() => chartPeriodCaption(records.map((record) => record.date)), [records])

  useEffect(() => {
    if (!chartRef.current) return undefined
    const chart = chartInstanceRef.current || echarts.init(chartRef.current, null, { devicePixelRatio: Math.max(2, Math.min(window.devicePixelRatio || 1, 3)) })
    chartInstanceRef.current = chart
    const viewKey = JSON.stringify([channel, metric, mainTitle])
    const replay = animatedViewRef.current !== viewKey
    const retainedZoom = !replay ? chart.getOption().dataZoom?.[0] : null
    if (replay) chart.clear()
    if (hasData) animatedViewRef.current = viewKey
    const removePointerCoordinateNormalizer = installEchartsPointerCoordinates(chart, chartRef.current)
    const primaryColor = lightTheme ? '#835711' : '#ebc56f'
    const narrow = chart.getWidth() < 520
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const chartSeries = names.map((name, index) => {
      const subjectColor = seriesColors?.[index] || comparisonColor(index)
      const seriesColor = name === mainTitle || subjectColor === COMPARISON_COLORS[0] ? primaryColor : subjectColor
      return {
        id: name,
        name,
        type: 'line',
        smooth: false,
        connectNulls: false,
        clip: true,
        symbol: 'circle',
        symbolSize: 7,
        itemStyle: { color: comparisonThemeColor(seriesColor, lightTheme) },
        lineStyle: { color: comparisonThemeColor(seriesColor, lightTheme) },
        data: records.map((record) => record.values?.[name]?.[metric] ?? record.values?.[dramaNames[index]]?.[metric] ?? null),
      }
    }).filter((item) => item.data.some((value) => value !== null && value !== undefined && Number.isFinite(Number(value))))
    chart.setOption({
      animation: replay && !reducedMotion,
      animationDuration: 900,
      animationEasing: 'linear',
      animationDurationUpdate: 0,
      textStyle: { fontFamily: getComputedStyle(chartRef.current).fontFamily },
      tooltip: { trigger: 'axis', confine: true, backgroundColor: lightTheme ? '#ffffff' : '#20252e', borderColor: lightTheme ? '#b9d1d8' : '#414956', textStyle: { fontSize: 15, color: lightTheme ? '#18323b' : '#eff1f5' } },
      legend: { type: 'scroll', show: chartSeries.length > 0, data: chartSeries.map((item) => item.name), top: 8, left: 'center', itemWidth: 18, itemHeight: 10, itemGap: narrow ? 12 : 18, textStyle: { fontSize: narrow ? 11 : 15, color: lightTheme ? '#455d65' : '#d4d9e3' } },
      grid: { left: narrow ? 12 : 24, right: narrow ? 16 : 32, top: 48, bottom: 64, containLabel: true },
      xAxis: { type: 'category', inverse: false, data: records.map((record) => record.date), axisLabel: { fontSize: narrow ? 10 : 12, hideOverlap: true, margin: 12, color: lightTheme ? '#536a72' : '#d4d9e3' }, axisLine: { lineStyle: { color: lightTheme ? '#9eb9c0' : '#626b79' } } },
      yAxis: { type: 'value', scale: true, max: visibleDataMaximum, name: '', nameTextStyle: { fontSize: 15, color: lightTheme ? '#536a72' : '#d4d9e3' }, axisLabel: { fontSize: narrow ? 11 : 15, color: lightTheme ? '#536a72' : '#d4d9e3' }, splitLine: { lineStyle: { color: lightTheme ? '#c7dce1' : '#30363f', type: 'dashed' } } },
      dataZoom: [{ type: 'inside', xAxisIndex: 0, start: retainedZoom?.start ?? 0, end: retainedZoom?.end ?? 100, preventDefaultMouseMove: !narrow, moveOnMouseMove: !narrow, zoomOnMouseWheel: !narrow }, { type: 'slider', xAxisIndex: 0, start: retainedZoom?.start ?? 0, end: retainedZoom?.end ?? 100, left: '8%', right: '8%', height: narrow ? 24 : 20, bottom: 16, showDetail: false, borderColor: 'transparent', backgroundColor: lightTheme ? '#d7e8ec' : '#272d37', fillerColor: primaryColor, handleSize: '160%', handleStyle: { color: '#f7fbff', borderColor: lightTheme ? '#6e929c' : '#101a2b', borderWidth: 2, shadowBlur: 4, shadowColor: lightTheme ? 'rgba(24, 50, 59, 0.22)' : 'rgba(0, 0, 0, 0.75)' }, moveHandleStyle: { color: '#d7e7ff', borderColor: lightTheme ? '#6e929c' : '#101a2b' }, dataBackground: { lineStyle: { color: lightTheme ? '#8faeb6' : '#66758e' }, areaStyle: { color: lightTheme ? '#b9d5dc' : '#3b465a' } }, textStyle: { fontSize: 15, color: lightTheme ? '#455d65' : '#d4d9e3' } }],
      color: [primaryColor, ...COMPARISON_COLORS.slice(1)],
      series: chartSeries,
    }, { replaceMerge: ['series'] })
    const chartElement = chartRef.current
    let active = true
    let size = [chartElement.clientWidth, chartElement.clientHeight]
    const resizeChart = () => {
      if (!active || chartRef.current !== chartElement || chart.isDisposed()) return
      const next = [chartElement.clientWidth, chartElement.clientHeight]
      if (next[0] === size[0] && next[1] === size[1]) return
      size = next
      chart.resize({ animation: { duration: 0 } })
      const narrow = chart.getWidth() < 520
      chart.setOption({
        legend: { itemGap: narrow ? 12 : 18, textStyle: { fontSize: narrow ? 11 : 15 } },
        grid: { left: narrow ? 12 : 24, right: narrow ? 16 : 32, bottom: 64 },
        xAxis: { axisLabel: { fontSize: narrow ? 10 : 12, hideOverlap: true, margin: 12 } },
        yAxis: { axisLabel: { fontSize: narrow ? 11 : 15 } },
        dataZoom: [
          { type: 'inside', preventDefaultMouseMove: !narrow, moveOnMouseMove: !narrow, zoomOnMouseWheel: !narrow },
          { type: 'slider', height: narrow ? 24 : 20, bottom: 16, textStyle: { fontSize: narrow ? 11 : 15 } },
        ],
      })
    }
    const resizeObserver = new ResizeObserver(resizeChart)
    resizeObserver.observe(chartElement)
    return () => { active = false; resizeObserver.disconnect(); removePointerCoordinateNormalizer() }
  }, [channel, lightTheme, metric, names, records, seriesColors, mainTitle, hasData])

  useEffect(() => () => {
    chartInstanceRef.current?.dispose()
    chartInstanceRef.current = null
    animatedViewRef.current = null
  }, [])

  return (
    <div className="web-heat-tv-chart-wrap" data-analytics-component={`台端图表 ${channel} ${metric}`}>
      <div className="web-heat-tv-chart" ref={chartRef} aria-label={`${channel}${metric === 'rating' ? '收视率' : '市占率'}趋势图`} />
      {!hasData ? <div className="web-heat-tv-chart-empty" role="status">暂无公开数据</div> : null}
      <span className="web-heat-time-caption" role="status">{periodCaption}</span>
    </div>
  )
}

export function TvRatingsModule({ mainTitle = '逐玉', mainProject = null, competitors = [], ratings = {}, lightTheme = false, sidebarTarget = null }) {
  const isLive = Boolean(mainProject)
  const liveChannels = useMemo(() => [...new Set([mainProject, ...competitors].filter(Boolean).flatMap((project) => (ratings?.[project.id] || []).map(rowChannel).filter(Boolean)))], [competitors, mainProject, ratings])
  const availableChannels = isLive ? liveChannels : channels
  const [channel, setChannel] = useState(availableChannels[0] || '')
  useEffect(() => {
    if (!availableChannels.includes(channel)) setChannel(availableChannels[0] || '')
  }, [availableChannels, channel])
  const liveRows = useMemo(() => rowsForChannel(ratings, mainProject, channel), [channel, mainProject, ratings])
  const summaryRows = isLive ? liveRows : tvRecords.filter((record) => record.channel === channel)
  const summary = summaryForRows(summaryRows, mainTitle || dramaNames[0])
  const comparison = useMemo(() => isLive ? buildTvComparison(mainProject, competitors, ratings, channel) : null, [channel, competitors, isLive, mainProject, ratings])
  const comparableChannels = useMemo(() => isLive ? comparableTvChannels(mainProject, competitors, ratings, liveChannels) : new Set(), [competitors, isLive, liveChannels, mainProject, ratings])
  const chartRecords = comparison?.records
  const comparisonNames = comparison?.names
  const primaryValue = summary.primary ?? summary.golden
  const displayPrimary = primaryValue === null || primaryValue === undefined ? '—' : `${primaryValue.toFixed(4)}%`
  const displayHighest = summary.highest === null || summary.highest === undefined ? '—' : `${summary.highest.toFixed(4)}%`
  const goldenContext = summary.primarySlot === 'golden' ? ' · 黄金时段' : ''
  const channelControls = <section className="web-heat-tv-toolbar dashboard-metric-section" data-analytics-component="台端筛选" aria-label="台端筛选">
    <h2>播出频道</h2>
    <div className="dashboard-channel-list" role="region" aria-label="播出频道列表" tabIndex={0}>{availableChannels.map((item) => <button key={item} type="button" data-analytics-action={`切换播出频道 ${item}`} className={`web-heat-tv-channel ${channel === item ? 'is-selected' : ''}`} onClick={() => setChannel(item)}>
      <span className="web-heat-platform-shadow" aria-hidden="true" /><span className="web-heat-platform-edge" aria-hidden="true" />
      <span className="web-heat-platform-front"><i aria-hidden="true" />{item}{comparableChannels.has(item) ? <em className="web-heat-tv-channel-badge" title="该频道有主剧和已选分析作品的收视数据，播出日期可不同" aria-label="该频道有主剧和已选分析作品的收视数据，播出日期可不同" /> : null}</span>
    </button>)}</div>
    {!availableChannels.length ? <p className="dashboard-source-hint">暂无已载入的播出频道</p> : null}
  </section>

  return (
    <div className="web-heat-tv-page">
      <section className="web-heat-tv-kpis" aria-label="台端关键指标">
        <div><span>{summary.primaryLabel || '收视率'}</span><strong>{displayPrimary} {primaryValue !== null && primaryValue !== undefined && breakthroughLabel(primaryValue) && <b>{breakthroughLabel(primaryValue)}</b>}</strong><small>{summary.primaryPeriod || summary.period}{summary.primarySlot === 'golden' ? <em className="web-heat-tv-slot-tag is-golden">黄金时段</em> : null}</small></div>
        <div><span>最高收视率</span><strong>{displayHighest} {summary.highest !== null && summary.highest !== undefined && breakthroughLabel(summary.highest) && <b>{breakthroughLabel(summary.highest)}</b>}</strong><small>{summary.period}{summary.highestSlot === 'golden' ? <em className="web-heat-tv-slot-tag is-golden">黄金时段</em> : null}</small></div>
      </section>

      {sidebarTarget ? createPortal(channelControls, sidebarTarget) : channelControls}

      <section className="web-heat-tv-charts">
        <article><header><strong>收视率趋势</strong><small>{channel ? `${channel}${goldenContext} · 同频道分析` : '暂无已载入的播出频道'}</small></header><TvChart channel={channel} metric="rating" mainTitle={mainTitle} chartRecords={chartRecords} comparisonNames={comparisonNames} seriesColors={comparison?.colors} lightTheme={lightTheme} /></article>
        <article><header><strong>市占率趋势</strong><small>{channel ? `${channel}${goldenContext} · 同频道分析` : '暂无已载入的播出频道'}</small></header><TvChart channel={channel} metric="share" mainTitle={mainTitle} chartRecords={chartRecords} comparisonNames={comparisonNames} seriesColors={comparison?.colors} lightTheme={lightTheme} /></article>
      </section>

    </div>
  )
}
