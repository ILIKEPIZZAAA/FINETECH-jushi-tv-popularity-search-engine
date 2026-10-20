import { useEffect, useRef } from 'react'
import { init, use } from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const platformColors = { tencent: '#2388f5', iqiyi: '#19b777', youku: '#ffffff', mango: '#f47721' }

export default function RankingChart({ board }) {
  const ref = useRef(null)
  useEffect(() => {
    const element = ref.current
    const rows = board.rows
    const hasValues = board.rankOnly || rows.every(row => row.value !== null)
    if (!hasValues) return undefined
    const chartRows = rows.map(row => ({ ...row, chartValue: board.rankOnly ? Math.max(0, 11 - row.rank) : row.value }))
    const topValue = board.rankOnly ? 10 : chartRows.find(row => row.rank === 1)?.chartValue ?? Math.max(...chartRows.map(row => row.chartValue))
    const chart = init(element, null, { renderer: 'canvas' })
    chart.setOption({
      textStyle: { fontFamily: getComputedStyle(element).fontFamily },
      animationDuration: 220,
      grid: { top: 10, bottom: 24, left: 104, right: 48 },
      tooltip: { trigger: 'item', confine: true, triggerOn: 'mousemove|click', formatter: params => {
        const row = chartRows[params.dataIndex]
        return board.rankOnly ? `${escape(row.title)}<br/>热搜榜 Top${row.rank}` : `${escape(row.title)}<br/>第 ${row.rank} 名 · ${escape(row.value)} ${escape(row.unit)}`
      } },
      xAxis: { type: 'value', min: 0, max: topValue > 0 ? topValue : 1, splitNumber: 2, splitLine: { lineStyle: { color: 'rgba(255,255,255,.12)' } }, axisLabel: { color: '#aebed5', fontSize: 9, hideOverlap: true } },
      yAxis: { type: 'category', inverse: true, data: chartRows.map(row => `${row.rank} ${row.title}`), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { width: 94, overflow: 'truncate', color: '#e2eaf5', fontSize: 11 } },
      series: [{ type: 'bar', barMaxWidth: 17, data: chartRows.map(row => row.chartValue), itemStyle: { color: platformColors[board.id] || '#5279ff', borderRadius: [0, 0, 0, 0] }, label: { show: true, position: 'right', fontSize: board.rankOnly ? 9 : 10, color: '#c5d3e6', formatter: params => board.rankOnly ? `Top${chartRows[params.dataIndex].rank}` : String(chartRows[params.dataIndex].chartValue) } }],
    })
    let disposed = false
    const observer = new ResizeObserver(() => { if (!disposed && element.clientWidth > 0 && element.clientHeight > 0) chart.resize() })
    observer.observe(element)
    return () => { disposed = true; observer.disconnect(); chart.dispose() }
  }, [board])
  return <div className="hot-ranking-canvas" ref={ref} role="img" aria-label={`${board.title}：${board.rows.map(row => board.rankOnly ? `Top${row.rank}${row.title}` : `第${row.rank}名${row.title}${row.value === null ? '，热度待核实' : `，${row.value}${row.unit}`}`).join('；')}`} />
}
