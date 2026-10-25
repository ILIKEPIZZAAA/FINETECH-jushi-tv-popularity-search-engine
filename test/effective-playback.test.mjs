import assert from 'node:assert/strict'
import test from 'node:test'
import { EFFECTIVE_PLAYBACK_MAPPING_VERSION, effectivePlaybackSourceMetrics, mapEffectivePlayback, mergeEffectivePlayback } from '../src/lib/effectivePlayback.js'
import { buildRawDataWorkbook } from '../src/hooks/useDramaMonitor.js'

test('多平台汇总日期双轮确认无数值时不再误报缺口且不生成数值', () => {
  const result = mapEffectivePlayback({ verification: { noDataByMetric: { effective: ['2026-09-25'] } }, series: [
    { date: '2026-09-24', platform: '', value: '40.00亿' },
    { date: '2026-09-26', platform: '', value: '42.00亿' },
    ...['2026-09-24', '2026-09-25', '2026-09-26'].flatMap((date) => [
      { date, platform: '爱奇艺', cumulativeEffectivePlay: '25.00亿' },
      { date, platform: '腾讯视频', cumulativeEffectivePlay: '16.00亿' },
    ]),
  ] })
  assert.equal(result.records.find((row) => row.date === '2026-09-25').values['有效播放量'], undefined)
  assert.deepEqual(result.warnings, [])
})

test('单平台使用猫眼对应平台页签的逐日累计原值', () => {
  const result = mapEffectivePlayback({
    sourceUrl: 'https://piaofang.maoyan.com/i/tv-datainfo/1500399/effective',
    summary: { items: [{ mainTitle: '累计有效播放', mainData: '9.26', unit: '亿', mainDataNum: 926863802 }] },
    series: [
      { date: '2026-09-24', platform: '', value: '7.1亿' },
      { date: '2026-09-24', platform: '腾讯视频', value: '6807.3万', cumulativeEffectivePlay: '7.43亿' },
      { date: '2026-09-25', platform: '腾讯视频', value: '6957.9万', cumulativeEffectivePlay: '8.13亿' },
      { date: '2026-09-26', platform: '腾讯视频', value: '7585.3万', cumulativeEffectivePlay: '8.89亿' },
      { date: '2026-09-27', platform: '腾讯视频', value: '3741.5万', cumulativeEffectivePlay: '9.26亿' },
    ],
  }, new Set(['腾讯视频']))

  const byDate = new Map(result.records.map((row) => [row.date, row.values]))
  assert.equal(byDate.get('2026-09-24')['有效播放量'], 743000000)
  assert.equal(byDate.get('2026-09-25')['有效播放量'], 813000000)
  assert.equal(byDate.get('2026-09-26')['有效播放量'], 889000000)
  assert.equal(byDate.get('2026-09-27')['有效播放量'], 926000000)
  assert.equal(result.headline.display, '9.26亿')
  assert.equal(result.headline.date, '2026-09-27')
  assert.deepEqual(result.warnings, [])

  const workbook = buildRawDataWorkbook({
    projects: [{ id: 'lanxiang', title: '兰香如故' }], selectedId: 'lanxiang', competitors: {},
    liveHeat: { lanxiang: result.records }, sourceSync: {},
  })
  assert.match(workbook, /2026<\/Data><\/Cell>.*?9<\/Data><\/Cell>.*?27<\/Data><\/Cell>.*?全网<\/Data><\/Cell>.*?926000000/s)
})

test('多平台只使用猫眼全平台累计页签的值', () => {
  const result = mapEffectivePlayback({
    summary: { items: [{ mainTitle: '累计有效播放', mainData: '16.81', unit: '亿', mainDataNum: 1681443815 }] },
    series: [
      { date: '2026-09-27', platform: '', value: '42.84亿' },
      { date: '2026-09-27', platform: '爱奇艺', value: '27.0万', cumulativeEffectivePlay: '26.02亿' },
      { date: '2026-09-27', platform: '腾讯视频', value: '21.2万', cumulativeEffectivePlay: '16.81亿' },
    ],
  }, new Set(['爱奇艺', '腾讯视频']))
  assert.equal(result.records[0].values['有效播放量'], 4284000000)
  assert.equal(result.headline.display, '42.84亿')
  assert.equal(result.headline.kind, 'aggregate-tab')
  assert.deepEqual(result.warnings, [])
})

test('未收敛候选不映射到正式图表或Rawdata，有一致数据的日期仍保留', () => {
  const result = mapEffectivePlayback({
    series: [
      { date: '2026-09-26', platform: '', value: '9.20亿' },
      { date: '2026-09-26', platform: '腾讯视频', cumulativeEffectivePlay: '8.4亿' },
      { date: '2026-09-26', platform: '爱奇艺', cumulativeEffectivePlay: '7.1亿' },
    ],
    pendingSeries: [{ date: '2026-09-27', platform: '', value: '9.26亿' }],
    verification: { verified: false, unresolvedDates: ['2026-09-27'] },
  })
  assert.equal(EFFECTIVE_PLAYBACK_MAPPING_VERSION, 6)
  assert.equal(result.records.length, 1)
  assert.equal(result.records[0].date, '2026-09-26')
  const workbook = buildRawDataWorkbook({
    projects: [{ id: 'early-spring', title: '早春晴朗' }], selectedId: 'early-spring', competitors: {},
    liveHeat: { 'early-spring': result.records },
    sourceSync: { 'early-spring': { maoyan: { metricVerification: { effective: { unresolvedDates: ['2026-09-27'] } } } } },
  })
  const sheet = workbook.match(/<Worksheet ss:Name="猫眼-有效播放">([\s\S]*?)<\/Worksheet>/)?.[1]
  assert.doesNotMatch(sheet, /核验状态|待复核/)
  assert.doesNotMatch(sheet, /<Data ss:Type="Number">27<\/Data><\/Cell><Cell ss:StyleID="Center"><Data ss:Type="String">全网<\/Data><\/Cell><Cell ss:StyleID="Center"><Data ss:Type="Number">926000000<\/Data>/)
})

test('早春晴朗单一平台序列只映射两轮一致的猫眼原值', () => {
  const sourcePayload = {
    summary: { items: [{ mainTitle: '累计有效播放', mainData: '13.03', unit: '亿', mainDataNum: 1303334255 }] },
    series: [
      { date: '2026-09-26', platform: '优酷', effectivePlay: '2670.5万', cumulativeEffectivePlay: '12.76亿' },
      { date: '2026-09-27', platform: '优酷', effectivePlay: '2644.4万', cumulativeEffectivePlay: '13.02亿' },
    ],
    pendingSeries: [
      { date: '2026-09-28', platform: '优酷', effectivePlay: '64.3万', cumulativeEffectivePlay: '13.03亿' },
    ],
    verification: { verified: false, unresolvedDates: ['2026-09-28'] },
  }
  const mapped = mapEffectivePlayback(sourcePayload, new Set(['优酷']))
  const byDate = new Map(mapped.records.map((record) => [record.date, record.values]))
  assert.equal(byDate.get('2026-09-26')['有效播放量'], 1276000000)
  assert.equal(byDate.get('2026-09-27')['有效播放量'], 1302000000)
  assert.equal(byDate.has('2026-09-28'), false)
  assert.equal(mapped.headline.display, '13.02亿')

  const workbook = buildRawDataWorkbook({
    projects: [{ id: 'early-spring', title: '早春晴朗', platforms: [{ name: '优酷', dimension: 'web' }] }],
    selectedId: 'early-spring', competitors: {}, liveHeat: { 'early-spring': mapped.records },
    sourceSync: { 'early-spring': { maoyan: { metricVerification: { effective: { unresolvedDates: ['2026-09-28'] } } } } },
  })
  const sheet = workbook.match(/<Worksheet ss:Name="猫眼-有效播放">([\s\S]*?)<\/Worksheet>/)?.[1]
  for (const [date, sourceValue] of [['26', '1276000000'], ['27', '1302000000']]) {
    const row = new RegExp(`<Data ss:Type="Number">${date}<\\/Data><\\/Cell><Cell ss:StyleID="Center"><Data ss:Type="String">全网<\\/Data><\\/Cell><Cell ss:StyleID="Center"><Data ss:Type="Number">${sourceValue}<\\/Data>`)
    assert.match(sheet, row, `Rawdata应保留猫眼${date}日源值`)
  }
  assert.doesNotMatch(sheet, /<Data ss:Type="Number">28<\/Data><\/Cell><Cell ss:StyleID="Center"><Data ss:Type="String">全网<\/Data><\/Cell><Cell ss:StyleID="Center"><Data ss:Type="Number">1303000000<\/Data>/)
  assert.doesNotMatch(sheet, /核验状态|待复核/)
})

test('单平台使用对应平台页签，汇总页签的更新值不覆盖到旧日期', () => {
  const result = mapEffectivePlayback({
    summary: { items: [{ mainTitle: '累计有效播放', mainData: '13.03', unit: '亿', mainDataNum: 1303334255 }] },
    series: [{ date: '2026-09-27', platform: '优酷', cumulativeEffectivePlay: '13.02亿' }],
    pendingSeries: [{ date: '2026-09-28', platform: '', value: '13.03亿' }],
    verification: { verified: false, unresolvedDates: ['2026-09-28'] },
  }, new Set(['优酷']))

  assert.equal(result.records.length, 1)
  assert.equal(result.records[0].date, '2026-09-27')
  assert.equal(result.records[0].values['有效播放量'], 1302000000)
  assert.equal(result.headline.date, '2026-09-27')
  assert.equal(result.headline.display, '13.02亿')
})

test('存在前台汇总但单平台页签漏累计值时仍显式告警', () => {
  const result = mapEffectivePlayback({
    summary: { items: [{ mainTitle: '累计有效播放', mainData: '13.03', unit: '亿', mainDataNum: 1303334255 }] },
    series: [{ date: '2026-09-28', platform: '优酷', effectivePlay: '64.3万' }],
  }, new Set(['优酷']))

  assert.equal(result.records[0].values['有效播放量'], undefined)
  assert.equal(result.headline, null)
  assert.match(result.warnings.join('；'), /优酷缺少累计有效播放/)
})

test('有效播放替换列接受平台集合，并保留响应中实际返回的分平台字段', () => {
  const metrics = effectivePlaybackSourceMetrics(
    new Set(['腾讯视频']),
    [{ values: { '爱奇艺累计有效播放': 100, '猫眼热度': 7000 } }],
    [{ values: { '优酷有效播放': 200, '优酷累计有效播放': 300, '有效播放量': 400 } }],
  )
  assert.deepEqual(metrics, [
    '有效播放量', '累计有效播放', '腾讯视频有效播放', '腾讯视频累计有效播放',
    '爱奇艺累计有效播放', '优酷有效播放', '优酷累计有效播放',
  ])
})

test('多平台缺失全平台页签时标记缺口，不合计平台数值', () => {
  const result = mapEffectivePlayback({ series: [
    { date: '2026-09-27', platform: '爱奇艺', value: '27.0万', cumulativeEffectivePlay: '26.02亿' },
    { date: '2026-09-27', platform: '腾讯视频', value: '21.2万', cumulativeEffectivePlay: '16.81亿' },
  ] }, new Set(['爱奇艺', '腾讯视频']))
  assert.equal(result.records[0].values['有效播放量'], undefined)
  assert.equal(result.headline, null)
  assert.match(result.warnings.join('；'), /全平台累计/)
})

test('多平台汇总页签漏掉中间日期时提示缺口，不用分平台相加补洞', () => {
  const result = mapEffectivePlayback({ series: [
    { date: '2026-09-24', platform: '', value: '40.00亿' },
    { date: '2026-09-26', platform: '', value: '42.00亿' },
    ...['2026-09-24', '2026-09-25', '2026-09-26'].flatMap((date) => [
      { date, platform: '爱奇艺', cumulativeEffectivePlay: '25.00亿' },
      { date, platform: '腾讯视频', cumulativeEffectivePlay: '16.00亿' },
    ]),
  ] })
  assert.equal(result.records.find((row) => row.date === '2026-09-25').values['有效播放量'], undefined)
  assert.match(result.warnings.join('；'), /缺少1天：2026-09-25/)
})

test('重新采集时清除旧全网累计行并保留其他指标', () => {
  const existing = [
    { date: '2026-09-24', values: { '有效播放量': 710000000, '猫眼热度': 6200 } },
    { date: '2026-09-25', values: { '有效播放量': 800000000, '骨朵热度': 78.3 } },
  ]
  const incoming = [{ date: '2026-09-24', values: { '有效播放量': 743000000 } }, { date: '2026-09-27', values: { '有效播放量': 926863802 } }]
  const merged = mergeEffectivePlayback(existing, incoming)
  assert.equal(merged.find((row) => row.date === '2026-09-24').values['有效播放量'], 743000000)
  assert.equal(merged.find((row) => row.date === '2026-09-24').values['猫眼热度'], 6200)
  assert.equal(merged.find((row) => row.date === '2026-09-25').values['有效播放量'], undefined)
  assert.equal(merged.find((row) => row.date === '2026-09-25').values['骨朵热度'], 78.3)
  assert.equal(merged.find((row) => row.date === '2026-09-27').values['有效播放量'], 926863802)
})
