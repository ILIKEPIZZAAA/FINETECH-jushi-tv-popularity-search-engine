import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { desktopLayoutScale } from '../src/lib/viewportLayout.js'

test('the complete online reference canvas uses one uniform viewport scale', () => {
  for (const [width, height, expected] of [[1643, 905, 1], [1920, 1080, 1920 / 1643], [3840, 2160, 3840 / 1643], [1366, 768, 1366 / 1643]]) {
    assert.equal(desktopLayoutScale(width, height), expected)
  }
})

test('extra space belongs outside the reference canvas rather than inside its white panel', () => {
  assert.equal(desktopLayoutScale(3440, 1440), 1440 / 905)
  assert.equal(desktopLayoutScale(1920, 800), 800 / 905)
  assert.equal(desktopLayoutScale(1280, 1024), 1280 / 1643)
  for (const [width, height] of [[1728, 1436], [1280, 600], [3440, 1440]]) {
    const scale = desktopLayoutScale(width, height)
    assert.ok(1643 * scale <= width + 1e-9)
    assert.ok(905 * scale <= height + 1e-9)
  }
})

test('dashboard adaptation preserves reference canvas aspect and typography scale', () => {
  for (const [width, height] of [[1280, 600], [1920, 1080], [2560, 1440], [3440, 1440]]) {
    const scale = desktopLayoutScale(width, height)
    assert.ok(Math.abs((1270 * scale) / (756 * scale) - 1270 / 756) < 1e-12)
    assert.ok(Math.abs((258 * scale) / (45 * scale) - 258 / 45) < 1e-12)
    assert.ok(Math.abs((15 * scale) / (24 * scale) - 15 / 24) < 1e-12)
  }
})

test('dashboard internal element geometry retains the measured online baseline', () => {
  const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8')
  const rules = {
    '.web-heat-content': ['width: min(1270px, 100%)', 'height: 756px', 'zoom: var(--heat-scale, 1)'],
    '.web-heat-content-tv': ['width: min(1100px, 100%)'],
    '.web-heat-nav': ['left: 56px', 'gap: 48px', 'zoom: var(--heat-scale, 1)'],
    '.web-heat-nav-button': ['width: 122px', 'height: 52px', 'font-size: 14px'],
    '.web-heat-controls': ['top: 295px', 'width: 258px', 'height: 464px'],
    '.web-heat-playback-pie': ['top: 115px', 'width: 258px', 'height: 160px'],
    '.web-heat-panel-header h1': ['font-size: 24px'],
  }
  for (const [selector, expected] of Object.entries(rules)) {
    const start = css.indexOf(`${selector} {`)
    assert.ok(start >= 0, selector)
    const rule = css.slice(start, css.indexOf('}', start))
    for (const declaration of expected) assert.ok(rule.includes(declaration), `${selector}: ${declaration}`)
  }
})

test('the redesigned dashboard uses a fixed sidebar and fluid content without a second viewport scale', () => {
  const jsx = readFileSync(new URL('../src/components/WebHeatPage.jsx', import.meta.url), 'utf8')
  assert.ok(jsx.includes('web-heat-viewport is-redesigned'))
  assert.ok(jsx.includes("'--heat-scale': 1"), 'inner elements cannot have a second viewport scale')
  assert.ok(!jsx.includes('desktopLayoutScale'))
  const css = readFileSync(new URL('../src/styles/dashboard-redesign.css', import.meta.url), 'utf8')
  assert.ok(css.includes('--dash-sidebar-width: 232px;'))
  assert.ok(css.includes('grid-template-columns: var(--dash-sidebar-width) minmax(0, 1fr)'))
  assert.ok(css.includes('position: fixed; left: 0; top: var(--site-header-height); bottom: 0;'))
  assert.ok(css.includes('@media (max-width: 760px)'))
})

test('mobile retains its separate responsive layout', () => {
  assert.equal(desktopLayoutScale(390, 844), 1)
  assert.equal(desktopLayoutScale(760, 1024), 1)
})

test('project identity separates date metadata on desktop and stacks it on narrow screens', () => {
  const css = readFileSync(new URL('../src/styles/dashboard-redesign.css', import.meta.url), 'utf8')
  assert.match(css, /web-heat-project-copy \{\s*display: grid; grid-template-columns: minmax\(0, 1fr\) 246px/)
  assert.match(css, /web-heat-project-meta \{ display: contents/)
  assert.match(css, /web-heat-project-meta-side \{ grid-column: 2; grid-row: 1 \/ span 2/)
  assert.match(css, /web-heat-project-meta-side small \{ display: flex; justify-content: space-between/)
  assert.match(css, /web-heat-project-meta-side \{ grid-column: 1; grid-row: 3; display: flex; flex-wrap: wrap/)
  assert.match(css, /font-variant-numeric: tabular-nums/)
})
