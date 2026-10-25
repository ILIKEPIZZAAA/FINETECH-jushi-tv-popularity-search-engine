import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { boardAvailability, preferredBoardKey } from '../src/lib/platformBoardTabs.js'

test('platform availability treats numeric zero as an observation', () => {
  const state = boardAvailability([{ name: '主品', data: [null, 0] }], '主品')
  assert.equal(state.state, 'available')
  assert.equal(state.primaryHasData, true)
  assert.equal(state.statusLabel, '有数据')
})

test('empty, failed and invalid observations never become confirmed source absence', () => {
  for (const series of [undefined, [], [{ name: '主品', data: [null, undefined, '', ' ', false, {}, NaN, Infinity] }]]) {
    const state = boardAvailability(series, '主品')
    assert.equal(state.hasData, false)
    assert.equal(state.state, 'not-loaded')
    assert.equal(state.statusLabel, '未载入')
  }
})

test('competitor-only data is distinct from primary title data', () => {
  assert.equal(boardAvailability([{ name: '竞品', data: [3.75] }], '主品').state, 'competitors-only')
  assert.equal(boardAvailability([{ name: '竞品', data: [3.75] }], '主品').statusLabel, '仅分析作品')
})

test('default board prefers primary data, then competitor data, then the first empty board', () => {
  const empty = { key: 'empty', ...boardAvailability([], '主品') }
  const peer = { key: 'peer', ...boardAvailability([{ name: '竞品', data: [1] }], '主品') }
  const main = { key: 'main', ...boardAvailability([{ name: '主品', data: [2] }], '主品') }
  assert.equal(preferredBoardKey([empty, peer, main]), 'main')
  assert.equal(preferredBoardKey([empty, peer]), 'peer')
  assert.equal(preferredBoardKey([empty]), 'empty')
  assert.equal(preferredBoardKey([]), null)
})

test('availability and default selection preserve source dates, values and verification flags', () => {
  const data = Object.freeze([null, 0, 123.456789])
  const verified = Object.freeze([false, true, true])
  const series = Object.freeze([Object.freeze({ name: '主品', data, verified, sourceUrl: 'source://fixture' })])
  const before = structuredClone(series)
  const state = boardAvailability(series, '主品')
  preferredBoardKey([{ key: 'aggregate', ...state }])
  assert.deepEqual(series, before)
  assert.equal(series[0].data, data)
  assert.equal(series[0].verified, verified)
})

test('the board mounts one switchable chart and keeps overview cards outside the switcher', () => {
  const source = readFileSync(new URL('../src/components/WebHeatPage.jsx', import.meta.url), 'utf8')
  const board = source.slice(source.indexOf('function BoardStack('), source.indexOf('function RawDataModule('))
  assert.match(board, /role="tablist"/)
  assert.match(board, /role="tab"/)
  assert.match(board, /role="tabpanel"/)
  assert.match(board, /aria-selected=\{selected\?\.key === tab\.key\}/)
  assert.match(board, /dataSeries=\{selected\.series\} dateLabels=\{selected\.dates\}/)
  assert.match(board, /mode === 'effective' \? \[\{/)
  assert.match(board, /key: 'aggregate', label: '总播放'/)
  assert.doesNotMatch(board, /web-heat-board-card/)
  assert.match(source, /<div className="dashboard-summary" aria-label="关键指标">/)
  assert.match(source, /effectiveKpis=\{effectiveKpis\}/)
  assert.match(source, /hasLoadedData && timeWindow\?\.dates\?\.length === 0/)
  assert.match(source, /所选时间范围暂无已核验数据/)
  const css = readFileSync(new URL('../src/styles/dashboard-redesign.css', import.meta.url), 'utf8')
  assert.match(css, /web-heat-panel\.is-web-heat \{[^}]*grid-template-columns: minmax\(0, 1fr\); grid-template-rows: auto minmax\(0, 1fr\)/)
  assert.match(css, /web-heat-panel\.is-web-heat > \.web-heat-content-heat \{[^}]*grid-template-rows: minmax\(0, 1fr\) auto/)
})
