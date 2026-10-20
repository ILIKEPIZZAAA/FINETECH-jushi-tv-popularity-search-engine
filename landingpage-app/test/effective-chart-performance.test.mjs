import assert from 'node:assert/strict'
import test from 'node:test'
import { effectiveChartValues, mapEffectivePlayback } from '../src/lib/effectivePlayback.js'
import { buildRawDataWorkbook } from '../src/hooks/useDramaMonitor.js'

test('有效播放图只使用源端累计值，缺失留空，多平台累计不相加', () => {
  assert.deepEqual([...effectiveChartValues([
    { date: '2026-10-01', values: { '优酷累计有效播放': 123 } },
    { date: '2026-10-02', values: { '有效播放量': 0, '优酷累计有效播放': 456 } },
    { date: '2026-10-03', values: { '有效播放量': '', '优酷累计有效播放': null } },
  ])], [['2026-10-01', 123], ['2026-10-02', 0], ['2026-10-03', null]])
  assert.deepEqual([...effectiveChartValues([
    { date: '2026-10-01', values: { '优酷累计有效播放': 123, '爱奇艺累计有效播放': 456 } },
    { date: '2026-10-02', values: { '有效播放量': 900, '优酷累计有效播放': 333, '爱奇艺累计有效播放': 666 } },
  ])], [['2026-10-01', null], ['2026-10-02', 900]])
})

test('长历史按线性次数读取字段，避免每个日期再次遍历全部历史', () => {
  let reads = 0
  const rows = Array.from({ length: 1371 }, (_, index) => ({
    date: new Date(Date.UTC(2023, 0, 14 + index)).toISOString().slice(0, 10),
    get values() { reads += 1; return { '优酷累计有效播放': index + 1 } },
  }))
  const result = effectiveChartValues(rows)
  assert.equal(result.size, rows.length)
  assert.equal(result.get(rows.at(-1).date), rows.length)
  assert.ok(reads <= rows.length * 10, `${reads} reads exceeds the linear scan budget`)
})

test('同日记录使用最终归一化观测，未用早期候选填补最终缺值', () => {
  assert.equal(effectiveChartValues([
    { date: '2026-10-01', values: { '优酷累计有效播放': 100 } },
    { date: '2026-10-01', values: { '优酷累计有效播放': null } },
  ]).get('2026-10-01'), null)
})

test('有效播放图与Rawdata使用同一日期的平台累计观测', () => {
  const mapped = mapEffectivePlayback({
    sourceUrl: 'https://piaofang.maoyan.com/i/tv-datainfo/1500399/effective',
    series: [
      { date: '2026-09-26', platform: '优酷', effectivePlay: '2670.5万', cumulativeEffectivePlay: '12.76亿' },
      { date: '2026-09-27', platform: '优酷', effectivePlay: '2644.4万', cumulativeEffectivePlay: '13.02亿' },
    ],
  }, new Set(['优酷']))
  const chart = effectiveChartValues(mapped.records)
  const xml = buildRawDataWorkbook({ projects: [{ id: 'p', title: '测试剧' }], selectedId: 'p', liveHeat: { p: mapped.records }, competitors: {}, sourceSync: {} })
  const sheet = xml.match(/<Worksheet ss:Name="有效播放">([\s\S]*?)<\/Worksheet>/)?.[1] || ''
  const rows = [...sheet.matchAll(/<Row>([\s\S]*?)<\/Row>/g)].slice(1).map((row) => [...row[1].matchAll(/<Data ss:Type="[^"]+">([\s\S]*?)<\/Data>/g)].map((cell) => cell[1]))
  for (const row of rows.filter((cells) => cells[4] === '全网')) {
    const date = `${row[1]}-${row[2].padStart(2, '0')}-${row[3].padStart(2, '0')}`
    assert.equal(chart.get(date), Number(row[5]))
  }
  assert.equal(rows.filter((cells) => cells[4] === '全网').length, 2)
})
