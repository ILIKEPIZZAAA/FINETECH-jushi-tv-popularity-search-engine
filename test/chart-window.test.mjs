import test from 'node:test'
import assert from 'node:assert/strict'
import { chartTimeWindow, chartPeriodCaption, chartZoomWindow, metricDateIsVerified } from '../src/lib/chartWindow.js'
import { readFileSync } from 'node:fs'
import { metricValue, platformDisplayName, isoDatesInRange } from '../src/lib/dramaMonitor.js'
import { comparisonSubjects } from '../src/lib/comparisonColors.js'
import { effectiveChartValues } from '../src/lib/effectivePlayback.js'

const group = (dates, data, verified = data.map(() => true)) => ({ dates, series: [{ name: '主剧', data, verified }] })

test('today is the cutoff when a verified zero exists, across months and years', () => {
  const window = chartTimeWindow('7', [group(['2025-12-31', '2026-01-02'], [1, 0])], '2026-01-02')
  assert.equal(window.from, '2025-12-27')
  assert.equal(window.to, '2026-01-02')
  assert.equal(window.dates.length, 7)
})

test('chart period caption reports inclusive calendar coverage, including leap days and sparse observations', () => {
  assert.equal(chartPeriodCaption(['2024-02-28', '2024-03-01']), '当前图表数据周期：2024-02-28—2024-03-01，共涵盖3天')
  assert.equal(chartPeriodCaption(['2026-10-10', '2026-10-16']), '当前图表数据周期：2026-10-10—2026-10-16，共涵盖7天')
  assert.equal(chartPeriodCaption(['2026-10-16']), '当前图表数据周期：2026-10-16—2026-10-16，共涵盖1天')
  assert.equal(chartPeriodCaption([]), '暂无数据')
})

test('unverified today falls back to the latest verified point in the displayed group', () => {
  const groups = [group(['2026-10-01', '2026-10-16'], [1, 100], [true, false]), group(['2026-10-10'], [2])]
  const window = chartTimeWindow('30', groups, '2026-10-16')
  assert.equal(window.to, '2026-10-10')
  assert.equal(window.from, '2026-09-11')
  assert.equal(window.dates.length, 30)
  assert.match(window.label, /最近有效日期/)
})

test('7-day and 30-day controls zoom into the full date axis without rebuilding a filtered chart', () => {
  const dates = Array.from({ length: 90 }, (_, index) => new Date(Date.UTC(2026, 6, 19 + index)).toISOString().slice(0, 10))
  const source = group(dates, dates.map((_, index) => index))
  const sevenDayWindow = chartTimeWindow('7', [source], '2026-10-16')
  const sevenDayZoom = chartZoomWindow(dates, sevenDayWindow)
  assert.equal(sevenDayZoom.start, (83 / 89) * 100)
  assert.equal(sevenDayZoom.end, 100)
  assert.equal(sevenDayZoom.visibleDates.length, 7)
  assert.equal(dates.length, 90)
  assert.equal(source.series[0].data.length, 90)

  const thirtyDayZoom = chartZoomWindow(dates, chartTimeWindow('30', [source], '2026-10-16'))
  assert.equal(thirtyDayZoom.start, (60 / 89) * 100)
  assert.equal(thirtyDayZoom.end, 100)
  assert.equal(thirtyDayZoom.visibleDates.length, 30)
})

test('all-null, failed and entirely unverified series cannot fabricate an anchor', () => {
  for (const source of [group(['2026-10-16'], [null]), group(['2026-10-16'], ['   ']), group(['2026-10-16'], [false]), group(['2026-10-16'], [5], [false]), group([], [])]) {
    const window = chartTimeWindow('7', [source], '2026-10-16')
    assert.equal(window.to, null)
    assert.deepEqual(window.dates, [])
  }
})

test('metric verification remains source-specific and excludes failed or unresolved dates', () => {
  const record = { date: '2026-10-16', values: { '猫眼热度': 0 } }
  const verification = { passes: 2, checkedDates: [record.date], verified: false }
  const sync = { maoyan: { historyVerification: verification } }
  assert.equal(metricDateIsVerified(record, '猫眼热度', sync), true)
  assert.equal(metricDateIsVerified(record, '腾讯视频平台表现', sync), false)
  for (const key of ['failedDates', 'unresolvedDates', 'gapDates', 'noDataDates']) {
    assert.equal(metricDateIsVerified(record, '猫眼热度', { maoyan: { historyVerification: { ...verification, [key]: [record.date] } } }), false)
  }
  assert.equal(metricDateIsVerified(record, '猫眼热度', { maoyan: { historyVerification: verification, failedDates: [record.date] } }), false)
  assert.equal(metricDateIsVerified(record, '爱奇艺有效播放', { maoyan: { metricVerification: { effective: { ...verification, noDataByMetric: { 'effective:爱奇艺': [record.date] } } } } }), false)
})

test('initial and complete views preserve the entire original axis and slider range', () => {
  const source = group(['2026-01-01', '2026-10-16'], [1, 2])
  for (const mode of ['initial', 'all']) {
    const result = chartZoomWindow(source.dates, chartTimeWindow(mode, [source], '2026-10-16'))
    assert.deepEqual(result.visibleDates, source.dates)
    assert.equal(result.start, 0)
    assert.equal(result.end, 100)
  }
})

test('the actual chart mapper preserves zero and never converts empty source values to zero', () => {
  const source = readFileSync(new URL('../src/components/WebHeatPage.jsx', import.meta.url), 'utf8')
  const extract = name => {
    const start = source.indexOf(`function ${name}(`)
    return source.slice(start, source.indexOf('\nfunction ', start + 1))
  }
  const finiteMetric = new Function('metricValue', `${extract('hasMetricValue')}\n${extract('finiteMetric')}\nreturn finiteMetric`)(metricValue)
  for (const value of [null, undefined, '', '   ', false, true]) assert.equal(finiteMetric({ values: { '猫眼热度': value } }, '猫眼热度'), null)
  assert.equal(finiteMetric({ values: { '猫眼热度': 0 } }, '猫眼热度'), 0)
})

function actualChartMappers() {
  const source = readFileSync(new URL('../src/components/WebHeatPage.jsx', import.meta.url), 'utf8')
  const extract = name => {
    const start = source.indexOf(`function ${name}(`)
    return start < 0 ? '' : source.slice(start, source.indexOf('\nfunction ', start + 1))
  }
  const metrics = source.slice(source.indexOf('const METRIC_BY_PLATFORM ='), source.indexOf('\nfunction finiteMetric'))
  const platformList = source.slice(source.indexOf('const boardPlatforms ='), source.indexOf('\nconst boardData ='))
  const definitions = ['hasMetricValue', 'finiteMetric', 'effectiveMetric', 'effectivePlatformMetricValueFor', 'normalizePlatformMetricKey', 'platformMetricValueFor', 'platformMetric', 'metricForView', 'recordsFor', 'chartCalendarDates', 'liveComparison', 'livePlatformSeries', 'liveBoardSeries'].map(extract).join('\n')
  return new Function('metricValue', 'platformDisplayName', 'isoDatesInRange', 'comparisonSubjects', 'metricDateIsVerified', 'effectiveChartValues', `const endataDimensions = []; const iqiyiLogo = '', youkuMark = '', tencentLogo = '', mangoTvMark = ''; ${metrics}\n${platformList}\n${definitions}\nreturn { liveComparison, livePlatformSeries, liveBoardSeries }`)(metricValue, platformDisplayName, isoDatesInRange, comparisonSubjects, metricDateIsVerified, effectiveChartValues)
}

test('actual web mappers retain confirmed source gaps in captured 狂飙 exposure/platform and 边水往事 interaction', () => {
  const { liveComparison, livePlatformSeries, liveBoardSeries } = actualChartMappers()
  // Reduced from the 2026-10-26 source/state audit snapshot. These absent cells
  // have two successful independent reads, while other metrics still have data.
  const project = { id: 'catalog-1430026', title: '狂飙' }
  const records = [
    { date: '2023-04-09', values: {} },
    { date: '2023-04-10', values: { 猫眼全网曝光: 6749000, 爱奇艺平台表现: 6638 } },
    { date: '2023-04-11', values: { 猫眼热度: 5739.96 } },
    { date: '2023-04-12', values: { 猫眼热度: 3677.61 } },
    { date: '2023-04-13', values: { 猫眼全网曝光: 28579000, 爱奇艺平台表现: 6370 } },
    { date: '2023-04-14', values: {} },
  ]
  const liveHeat = { [project.id]: records }
  const expectedDates = ['2023-04-10', '2023-04-11', '2023-04-12', '2023-04-13']
  const exposure = liveComparison(project, [], liveHeat, 'maoyan', 'exposure')
  assert.deepEqual(exposure.dates, expectedDates)
  assert.deepEqual(exposure.series[0].data, [6749000, null, null, 28579000])
  const platform = livePlatformSeries(project, liveHeat)
  assert.deepEqual(platform.dates, expectedDates)
  assert.deepEqual(platform.series[0].data, [6638, null, null, 6370])
  const board = liveBoardSeries(project, [], liveHeat, 'platform')
  assert.deepEqual(board.platformDates[0], expectedDates)
  assert.deepEqual(board.platforms[0][0].data, [6638, null, null, 6370])
  assert.deepEqual(board.platformDates[1], [])
  const other = { id: 'catalog-1486342', title: '边水往事' }
  const interaction = liveComparison(other, [], { [other.id]: [
    { date: '2024-10-20', values: { 猫眼全网转评赞: 118 } },
    { date: '2024-10-21', values: { 猫眼热度: 6701.06 } },
    { date: '2024-10-22', values: { 猫眼全网转评赞: 68 } },
  ] }, 'maoyan', 'interaction')
  assert.deepEqual(interaction.series[0].data, [118, null, 68])
})

test('effective chart axes include internal missing calendar dates without fabricating zero or extending empty tails', () => {
  const { liveBoardSeries } = actualChartMappers()
  const project = { id: 'p', title: '主作品' }
  const board = liveBoardSeries(project, [], { p: [
    { date: '2026-10-01', values: {} },
    { date: '2026-10-02', values: { 有效播放量: 0, 爱奇艺有效播放: 0 } },
    { date: '2026-10-04', values: { 有效播放量: 3, 爱奇艺有效播放: 3 } },
    { date: '2026-10-05', values: {} },
  ] }, 'effective')
  assert.deepEqual(board.aggregateDates, ['2026-10-02', '2026-10-03', '2026-10-04'])
  assert.deepEqual(board.aggregate[0].data, [0, null, 3])
  assert.deepEqual(board.platformDates[0], board.aggregateDates)
  assert.deepEqual(board.platforms[0][0].data, [0, null, 3])
})
