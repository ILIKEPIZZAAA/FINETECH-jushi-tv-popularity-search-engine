import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

test('synthetic dashboard fixtures stay out of production public assets', () => {
  assert.equal(existsSync(new URL('../public/__dashboard-demo.html', import.meta.url)), false)
  const config = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8')
  assert.match(config, /apply: 'serve'/)
  const fixture = readFileSync(new URL('./fixtures/dashboard-demo.html', import.meta.url), 'utf8')
  assert.match(fixture, /合成数据/)
  assert.match(fixture, /isVariety \? 'variety' : 'drama'/)
})

test('source controls cannot flex-shrink when switching metric counts', () => {
  const css = readFileSync(new URL('../src/styles/dashboard-redesign.css', import.meta.url), 'utf8')
  assert.match(css, /dashboard-sidebar > \.dashboard-filters/)
  assert.match(css, /dashboard-sidebar > \.web-heat-utility-nav \{ flex-shrink: 0; \}/)
})

test('empty chart fallback does not assert source-confirmed absence', () => {
  const component = readFileSync(new URL('../src/components/WebHeatPage.jsx', import.meta.url), 'utf8')
  assert.match(component, /emptyMessage \|\| '暂无已核验数据'/)
  assert.doesNotMatch(component, /emptyMessage \|\| .*: '无数据'/)
})
