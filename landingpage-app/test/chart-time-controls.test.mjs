import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { visibleDataMaximum } from '../src/lib/chartScale.js'

const css = readFileSync(new URL('../src/styles/responsive.css', import.meta.url), 'utf8')
const globalCss = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8')
const source = readFileSync(new URL('../src/components/WebHeatPage.jsx', import.meta.url), 'utf8')
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
  assert.match(source, /max:\s*visibleDataMaximum/)
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

test('dashboard dimension buttons retain their existing flat styling and color stripe', () => {
  assert.match(source, /<span>\{item\.label\}<\/span><i style=\{\{ background: activePlatform\?\.color \|\| platforms\[0\]\.color \}\} \/>/)
  assert.match(globalCss, /\.web-heat-dimensions button\s*\{[^}]*height: 45px;[^}]*background: #d9d9d9/)
  assert.match(globalCss, /\.web-heat-dimensions button::after\s*\{[^}]*width: 10px;[^}]*background: var\(--heat-accent/)
  assert.match(globalCss, /\.web-heat-dimensions button\.is-selected\s*\{[^}]*var\(--heat-accent/)
})

test('TV status strip is removed and utility links center under the dashboard navigation column', () => {
  const tvSource = readFileSync(new URL('../src/components/TvRatingsModule.jsx', import.meta.url), 'utf8')
  const utilityNavStart = globalCss.indexOf('.web-heat-utility-nav {')
  const utilityNav = globalCss.slice(utilityNavStart, globalCss.indexOf('}', utilityNavStart))
  assert.doesNotMatch(tvSource, /web-heat-data-status/)
  for (const declaration of ['left: 56px', 'width: 122px', 'justify-content: center', 'bottom: 21px']) assert.ok(utilityNav.includes(declaration), declaration)
})

test('Rawdata navigation button includes a leading accessible-hidden download icon', () => {
  assert.match(source, /web-heat-nav-button-download[\s\S]*?<svg aria-hidden="true" viewBox="0 0 24 24"[\s\S]*?<span>\{isExporting \? '正在生成 Excel…' : <>Rawdata<br \/>Download<\/>\}<\/span>/)
  assert.match(globalCss, /\.web-heat-nav-button-download svg\s*\{[^}]*width: 16px;[^}]*height: 16px/)
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
