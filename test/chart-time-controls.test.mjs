import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { visibleDataMaximum, visibleRankMaximum } from '../src/lib/chartScale.js'

const css = readFileSync(new URL('../src/styles/responsive.css', import.meta.url), 'utf8')
const globalCss = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8')
const source = readFileSync(new URL('../src/components/WebHeatPage.jsx', import.meta.url), 'utf8')
const redesignCss = readFileSync(new URL('../src/styles/dashboard-redesign.css', import.meta.url), 'utf8')
const rule = (selector) => {
  const start = css.indexOf(`${selector} {`)
  assert.ok(start >= 0, selector)
  return css.slice(start, css.indexOf('}', start))
}

test('time controls use the approved horizontal blue group at the existing chart anchor', () => {
  const group = rule('.web-heat-time-controls')
  for (const declaration of ['position: absolute', 'top: 10px', 'right: 12px', 'flex-direction: row', 'gap: 4px', 'padding: 6px', 'border-radius: 18px', 'background: #edf3ff']) {
    assert.ok(group.includes(declaration), declaration)
  }
  assert.match(source, /\[\['7', '近7天'\], \['30', '近30天'\], \['all', '完整视图'\]\]/)
  assert.match(source, /aria-pressed=\{rangeMode === mode\}/)
  assert.match(source, /onClick=\{\(\) => selectRange\(mode\)\}/)
})

test('web heat and TV charts scale their vertical axis to the visible data window', () => {
  const tvSource = readFileSync(new URL('../src/components/TvRatingsModule.jsx', import.meta.url), 'utf8')
  assert.match(source, /yAxis:\s*\{[\s\S]*?scale:\s*true/)
  assert.match(tvSource, /yAxis:\s*\{[^}]*scale:\s*true/)
  assert.match(source, /max:\s*inverseYAxis \? visibleRankMaximum : visibleDataMaximum/)
  assert.match(tvSource, /max:\s*visibleDataMaximum/)
})

test('value-axis maximum equals the maximum of each active visible data window', () => {
  assert.equal(visibleDataMaximum({ min: 0, max: 100 }), 100)
  assert.equal(visibleDataMaximum({ min: 10, max: 200 }), 200)
  assert.equal(visibleDataMaximum({ min: 0, max: 0 }), 0)
  assert.equal(visibleDataMaximum({ min: 0, max: Number.NaN }), undefined)
})

test('platform buttons keep their source colors and use the layered pushable structure', () => {
  for (const declaration of ['web-heat-platform-shadow', 'web-heat-platform-edge', 'web-heat-platform-front']) {
    assert.ok(source.includes(declaration), declaration)
  }
  assert.match(source, /style=\{\{ '--platform-color': item\.color \}\}/)
  assert.match(globalCss, /\.web-heat-platforms button:hover \.web-heat-platform-front/)
  assert.match(globalCss, /\.web-heat-platforms button:active \.web-heat-platform-shadow/)
})

test('sidebar metrics keep the existing dimension selection and accessible icon labels', () => {
  assert.match(source, /aria-label="指标选择"/)
  assert.match(source, /<MetricIcon aria-hidden="true" \/><span>\{item\.label\}<\/span>/)
  assert.match(source, /onClick=\{\(\) => handleDimension\(item\.key\)\}/)
})

test('light multi-chart boards keep one white surface per card and clip chart overflow', () => {
  const viewport = rule('.web-heat-stage.is-light-dashboard .web-heat-content-heat .web-heat-board-stack:not(.is-single)')
  for (const declaration of ['background: transparent', 'border: 0', 'overflow-x: hidden', 'box-shadow: none']) assert.ok(viewport.includes(declaration), declaration)
  assert.ok(rule('.web-heat-stage.is-light-dashboard .web-heat-content-heat .web-heat-board-stack:not(.is-single) .web-heat-board-card').includes('overflow: hidden'))
  assert.ok(css.includes('.web-heat-content-heat .web-heat-dimensions { gap: calc(70px / 6); }'))
})

test('TV status strip is removed and utility links center under the dashboard navigation column', () => {
  const tvSource = readFileSync(new URL('../src/components/TvRatingsModule.jsx', import.meta.url), 'utf8')
  const utilityNavStart = globalCss.indexOf('.web-heat-utility-nav {')
  const utilityNav = globalCss.slice(utilityNavStart, globalCss.indexOf('}', utilityNavStart))
  assert.doesNotMatch(tvSource, /web-heat-data-status/)
  for (const declaration of ['left: 56px', 'width: 122px', 'justify-content: center', 'bottom: 21px']) assert.ok(utilityNav.includes(declaration), declaration)
})

test('Excel export retains its handler, busy state and accessible-hidden leading icon', () => {
  assert.match(source, /web-heat-nav-button-download[\s\S]*?disabled=\{isExporting\}[\s\S]*?aria-busy=\{isExporting\}[\s\S]*?onClick=\{onDownloadRawData\}/)
  assert.match(source, /<IconFiles aria-hidden="true" \/>/)
  assert.ok(source.includes('Excel导出<small>Rawdata Download</small>'))
})

test('TV channel buttons share the platform skin while preserving channel and star states', () => {
  const tvSource = readFileSync(new URL('../src/components/TvRatingsModule.jsx', import.meta.url), 'utf8')
  assert.match(tvSource, /web-heat-platform-shadow/)
  assert.match(tvSource, /web-heat-platform-edge/)
  assert.match(tvSource, /web-heat-platform-front/)
  assert.match(tvSource, /comparableChannels\.has\(item\)/)
  assert.match(globalCss, /\.web-heat-tv-toolbar \.web-heat-tv-channel\s*\{[^}]*--platform-color: #2f6bff/)
  assert.match(globalCss, /\.web-heat-tv-toolbar button\.is-selected\s*\{[^}]*--platform-color: #ff0004/)
})

test('cat-eye, guduo and kuyun button labels use 14px text', () => {
  assert.match(globalCss, /\.web-heat-platform-front\s*\{[^}]*font-size: 14px/)
})

test('selected range uses the amber chart accent with dark text, visible keyboard focus and reduced motion', () => {
  const selected = rule('.web-heat-content-heat .web-heat-time-controls .web-heat-echarts-fit[aria-pressed="true"]')
  assert.ok(selected.includes('color: #15233d'))
  assert.ok(selected.includes('background: #FDBE34'))
  assert.ok(rule('.web-heat-time-controls .web-heat-echarts-fit').includes('white-space: nowrap'))
  assert.ok(rule('.web-heat-content-heat .web-heat-time-controls .web-heat-echarts-fit:focus-visible').includes('outline: 2px solid #FDBE34'))
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  assert.doesNotMatch(css, /\.web-heat-time-controls\s*\{[^}]*flex-direction: column/)
})

test('phones reserve a separate toolbar row while preserving the original plot height', () => {
  assert.match(css, /@media \(max-width: 540px\)\s*\{(?:(?!@media)[\s\S])*?\.web-heat-board-stack\.is-single > \.web-heat-echarts-wrap \{ height: 408px; padding-top: 48px; \}/)
  assert.equal(408 - 48, 360)
})

test('redesigned views share sidebar controls and compact summary cards without resuming Endata', () => {
  const tvSource = readFileSync(new URL('../src/components/TvRatingsModule.jsx', import.meta.url), 'utf8')
  const competitorSource = readFileSync(new URL('../src/components/CompetitorModule.jsx', import.meta.url), 'utf8')
  const endataSource = readFileSync(new URL('../src/lib/endataMetrics.js', import.meta.url), 'utf8')
  assert.match(source, /sidebarTarget=\{activeView === 'competitor' \? sidebarFiltersTarget : null\}/)
  assert.match(tvSource, /createPortal\(channelControls, sidebarTarget\)/)
  assert.match(competitorSource, /createPortal\(comparisonControls, sidebarTarget\)/)
  assert.match(redesignCss, /grid-template-rows: minmax\(380px, 1fr\) 112px/)
  assert.match(redesignCss, /web-heat-tv-kpis \{ order: 2/)
  assert.match(source, /dashboard-source-logo/)
  assert.doesNotMatch(source, /暂停采集|艺恩数据采集暂时停用/)
  assert.doesNotMatch(source, /onLoadEndata\?\.\(/)
  assert.match(endataSource, /export const ENDATA_ENABLED = false/)
  for (const animation of ['dashboard-refresh-spin', 'dashboard-export-bounce', 'dashboard-theme-enter']) assert.ok(redesignCss.includes(`@keyframes ${animation}`))
})

test('platform chart logo and title share a flex header and never overlay the canvas title', () => {
  assert.match(source, /show: !hideChartTitle && !logo/)
  assert.match(source, /className="web-heat-chart-heading"/)
  assert.match(source, /<h2 title=\{headingText\}>\{headingText\}<\/h2>/)
  assert.match(redesignCss, /web-heat-chart-heading \{[^}]*display: flex;[^}]*gap: 10px/)
  assert.match(redesignCss, /web-heat-chart-heading \{[^}]*justify-content: flex-start/)
  assert.match(redesignCss, /web-heat-chart-heading \.web-heat-echarts-logo \{ position: static/)
  assert.match(redesignCss, /web-heat-board-card > \.web-heat-echarts-wrap \{[^}]*height: 100%;[^}]*padding: 0/)
  assert.match(source, /if \(!hasChartData\) \{ chartInstanceRef.current\?\.clear\(\); return undefined \}/)
  assert.match(source, /'当前未载入该平台数据'/)
  assert.match(source, /hasChartData && periodCaption/)
  assert.match(redesignCss, /web-heat-board-card:has\(> \.is-empty\) \{ height: 144px/)
  assert.match(source, /narrow && mobileLayout \? 108/)
  assert.match(source, /narrow && mobileLayout \? 52/)
})


test('rank axis keeps first place at the top without fractional ranks for constant or filtered series', () => {
  assert.equal(visibleRankMaximum({ min: 1, max: 1 }), 2)
  assert.equal(visibleRankMaximum({ min: 1, max: 20 }), 20)
  assert.equal(visibleRankMaximum({ min: 5, max: 5 }), 5)
  assert.equal(visibleRankMaximum({ min: 1, max: Number.NaN }), 2)
  assert.match(source, /inverse: inverseYAxis/)
  assert.match(source, /minInterval: inverseYAxis \? 1 : undefined/)
})
