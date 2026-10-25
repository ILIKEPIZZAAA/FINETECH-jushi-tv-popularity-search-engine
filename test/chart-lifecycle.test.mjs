import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chartPeriodCaption, chartTimeWindow, chartZoomWindow } from '../src/lib/chartWindow.js'
import { visibleDataMaximum, visibleRankMaximum } from '../src/lib/chartScale.js'
import { COMPARISON_COLORS, comparisonColor, comparisonThemeColor } from '../src/lib/comparisonColors.js'

// Execute the real component's hooks, stopping before JSX; the ECharts seam
// records init/dispose/setOption across React-style effect dependency updates.
function mountChart(file, name, props) {
  const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8')
  const start = source.indexOf(`function ${name}(`)
  const end = source.indexOf('\n  return ', source.indexOf('\n  useEffect(', start))
  let code = source.slice(start, end)
  // Heat has a range callback before its JSX return; this is valid JS too.
  code += '\n}'
  let cursor = 0
  const slots = [], effects = [], charts = [], observers = []
  const element = { clientWidth: 800, clientHeight: 450, closest: () => null, addEventListener() {}, removeEventListener() {} }
  const useRef = initial => { const i = cursor++; return slots[i] ||= { current: initial } }
  const useState = initial => { const i = cursor++; slots[i] ??= initial; return [slots[i], value => { slots[i] = value }] }
  const useEffect = (run, deps) => { const i = cursor++; const prior = slots[i]; if (!prior || deps.some((d, n) => !Object.is(d, prior.deps[n]))) effects.push(() => { prior?.cleanup?.(); slots[i] = { deps, cleanup: run() } }) }
  const echarts = { init() { const chart = { calls: [], disposed: false, getWidth: () => element.clientWidth, getHeight: () => element.clientHeight, setOption(option, flags) { assert.equal(this.disposed, false); this.calls.push({ option, flags }) }, getOption() { return { dataZoom: [{ start: 20, end: 80 }] } }, clear() { this.clears = (this.clears || 0) + 1 }, resize() { assert.equal(this.disposed, false); this.resizes = (this.resizes || 0) + 1 }, dispatchAction() {}, isDisposed() { return this.disposed }, dispose() { this.disposed = true } }; charts.push(chart); return chart } }
  const bindings = { useRef, useState, useEffect, useMemo: fn => fn(), echarts, chartPeriodCaption, chartTimeWindow, chartZoomWindow, visibleDataMaximum, visibleRankMaximum, COMPARISON_COLORS, comparisonColor, comparisonThemeColor, installEchartsPointerCoordinates: () => () => {}, getComputedStyle: () => ({ fontFamily: 'sans-serif' }), window: { devicePixelRatio: 2, matchMedia: () => ({ matches: false }) }, ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this) } observe() {} disconnect() { this.disconnected = true } }, hasMetricValue: v => v != null, hasNumericValue: v => v != null && Number.isFinite(Number(v)), formatSourceMetric: String, formatMetric: String, dramaNames: ['主剧'], makeCrossYearDates: () => [], makeEffectiveComparisonData: () => [] }
  const renderComponent = new Function(...Object.keys(bindings), `${code}; return ${name}`)(...Object.values(bindings))
  const render = next => { cursor = 0; renderComponent(next); slots[0].current = element; while (effects.length) effects.shift()() }
  render(props)
  return { charts, render, observers, element, detach() { slots[0].current = null }, unmount() { slots[0].current = null; for (const slot of slots) slot?.cleanup?.() } }
}

for (const kind of ['heat', 'tv', 'pie']) {
  test(`${kind}: queued resize callbacks stop after effect replacement, DOM detachment and unmount`, () => {
    const props = kind === 'heat' ? { showName: '主剧', chartTitle: '热度值', dataSeries: [{ name: '主剧', data: [10] }], dateLabels: ['2026-10-01'] }
      : kind === 'tv' ? { channel: 'CCTV-1', metric: 'rating', mainTitle: '主剧', comparisonNames: ['主剧'], chartRecords: [{ date: '2026-10-01', values: { 主剧: { rating: 1 } } }] }
      : { showName: '主剧', items: [{ name: '主剧', value: 20 }] }
    const mounted = mountChart(kind === 'tv' ? 'TvRatingsModule.jsx' : 'WebHeatPage.jsx', kind === 'heat' ? 'EchartsHeatChart' : kind === 'tv' ? 'TvChart' : 'CumulativePlaybackPie', props)
    const stale = mounted.observers[0]
    mounted.render({ ...props, lightTheme: true })
    assert.equal(stale.disconnected, true)
    mounted.element.clientWidth = 640
    const chart = mounted.charts[0]
    const previousCalls = chart.calls.length
    stale.callback()
    assert.equal(chart.calls.length, previousCalls, 'a queued callback from the previous effect must not update the new view')
    mounted.observers.at(-1).callback()
    assert.ok(chart.calls.length > previousCalls, 'the mounted observer must continue responding to a real resize')
    mounted.detach()
    mounted.element.clientWidth = 600
    const beforeDetach = chart.calls.length
    for (const observer of mounted.observers) assert.doesNotThrow(() => observer.callback())
    assert.equal(chart.calls.length, beforeDetach)
    mounted.unmount()
    for (const observer of mounted.observers) assert.doesNotThrow(() => observer.callback())
    assert.equal(chart.calls.length, beforeDetach)
  })
}

for (const kind of ['heat', 'tv', 'pie']) {
  test(`${kind}: background observations update the same chart without replaying entrance animation`, () => {
    const initial = kind === 'heat' ? { showName: '主剧', chartTitle: '热度值', dataSeries: [{ name: '主剧', data: [10, 20] }], dateLabels: ['2026-10-01', '2026-10-02'] }
      : kind === 'tv' ? { channel: 'CCTV-1', metric: 'rating', mainTitle: '主剧', comparisonNames: ['主剧'], chartRecords: [{ date: '2026-10-01', values: { 主剧: { rating: 1 } } }] }
      : { showName: '主剧', items: [{ name: '主剧', value: 20 }] }
    const mounted = mountChart(kind === 'tv' ? 'TvRatingsModule.jsx' : 'WebHeatPage.jsx', kind === 'heat' ? 'EchartsHeatChart' : kind === 'tv' ? 'TvChart' : 'CumulativePlaybackPie', initial)
    mounted.render(kind === 'heat' ? { ...initial, dataSeries: [{ name: '主剧', data: [10, 21] }, { name: '对比剧', data: [5, 8] }] }
      : kind === 'tv' ? { ...initial, chartRecords: [...initial.chartRecords, { date: '2026-10-02', values: { 主剧: { rating: 2 } } }] }
      : { ...initial, items: [...initial.items, { name: '对比剧', value: 30 }] })
    assert.equal(mounted.charts.length, 1, 'data update must not create another ECharts instance')
    assert.equal(mounted.charts[0].disposed, false)
    const updates = mounted.charts[0].calls.filter(c => c.option.animation !== undefined)
    assert.equal(updates[0].option.animation, true)
    assert.equal(updates.at(-1).option.animation, false)
    if (kind !== 'pie') {
      assert.deepEqual(updates.at(-1).flags, { replaceMerge: ['series'] }, 'removed works must not leave stale series')
      mounted.render(kind === 'heat' ? { ...initial, chartTitle: '全网曝光' } : { ...initial, channel: 'CCTV-8' })
      assert.equal(mounted.charts.length, 1)
      assert.equal(mounted.charts[0].calls.filter(c => c.option.animation !== undefined).at(-1).option.animation, true, 'explicit metric/channel switches retain entrance animation')
    }
    mounted.unmount()
    assert.equal(mounted.charts[0].disposed, true)
  })
}

test('initial empty chart animates the first result, later empty updates remove old data', () => {
  const props = { chartTitle: '热度值', showName: '主剧', dataSeries: [], dateLabels: ['2026-10-01'] }
  const mounted = mountChart('WebHeatPage.jsx', 'EchartsHeatChart', props)
  assert.equal(mounted.charts.length, 0)
  mounted.render({ ...props, dataSeries: [{ name: '主剧', data: [10] }] })
  assert.equal(mounted.charts[0].calls[0].option.animation, true)
  const clears = mounted.charts[0].clears
  mounted.render(props)
  assert.equal(mounted.charts[0].clears, clears + 1)
  mounted.render({ ...props, dataSeries: [{ name: '主剧', data: [11] }] })
  assert.equal(mounted.charts.length, 1)
  assert.equal(mounted.charts[0].calls.at(-1).option.animation, false)
  mounted.unmount()
})

test('five work colors retain identity across themes with readable stroke contrast', () => {
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    return rgb.reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0)
  }
  for (const light of [false, true]) {
    const colors = COMPARISON_COLORS.map(color => comparisonThemeColor(color, light))
    assert.equal(new Set(colors).size, 5)
    const bg = luminance(light ? '#ffffff' : '#20272b')
    for (const color of colors) {
      const fg = luminance(color)
      assert.ok((Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) >= 3, color)
    }
  }
})
