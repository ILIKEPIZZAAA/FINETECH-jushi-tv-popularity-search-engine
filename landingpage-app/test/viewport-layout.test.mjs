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
    '.web-heat-playback-pie': ['top: 117px', 'width: 258px', 'height: 175px'],
    '.web-heat-panel-header h1': ['font-size: 24px'],
  }
  for (const [selector, expected] of Object.entries(rules)) {
    const start = css.indexOf(`${selector} {`)
    assert.ok(start >= 0, selector)
    const rule = css.slice(start, css.indexOf('}', start))
    for (const declaration of expected) assert.ok(rule.includes(declaration), `${selector}: ${declaration}`)
  }
})

test('the viewport scales the fixed content below the shared header and keeps panel margins fixed', () => {
  const jsx = readFileSync(new URL('../src/components/WebHeatPage.jsx', import.meta.url), 'utf8')
  assert.ok(jsx.includes('className="web-heat-viewport"'))
  assert.ok(jsx.includes("'--heat-scale': 1"), 'inner elements cannot have a second viewport scale')
  const css = readFileSync(new URL('../src/styles/responsive.css', import.meta.url), 'utf8')
  assert.ok(css.includes('width: 1643px;'))
  assert.ok(css.includes('padding-top: var(--site-header-height);'))
  assert.ok(css.includes('height: 822px;'))
  assert.ok(css.includes('zoom: var(--dashboard-scale, 1);'))
})

test('mobile retains its separate responsive layout', () => {
  assert.equal(desktopLayoutScale(390, 844), 1)
  assert.equal(desktopLayoutScale(760, 1024), 1)
})
