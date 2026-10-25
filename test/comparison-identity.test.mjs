import assert from 'node:assert/strict'
import test from 'node:test'
import { comparisonSubjects } from '../src/lib/comparisonColors.js'
import { buildTvComparison, comparableTvChannels } from '../src/lib/tvComparison.js'

const main = { id: 'kuangbiao', title: '狂飙' }
const competitors = ['三体', '夜城赋', '逐玉', '藏海传'].map((title, index) => ({ id: `competitor-${index}`, title }))
const row = (date, channel, rating, share = null) => ({ date, channel, rating, share })

test('同频道多部剧的播出日期不重叠也标星，数据按日期并集保留断点', () => {
  const ratings = { [main.id]: [row('2023-01-14', '东方卫视', 1.2)], [competitors[0].id]: [row('2023-02-01', '东方卫视', 0.8)] }
  assert.equal(comparableTvChannels(main, competitors, ratings, ['东方卫视']).has('东方卫视'), true)
  const comparison = buildTvComparison(main, competitors, ratings, '东方卫视')
  assert.equal(comparison.records.length, 19)
  assert.deepEqual(comparison.records.filter(record => record.values[main.title].rating !== null).map(record => [record.date, record.values[main.title].rating]), [['2023-01-14', 1.2]])
  assert.deepEqual(comparison.records.filter(record => record.values['三体'].rating !== null).map(record => [record.date, record.values['三体'].rating]), [['2023-02-01', 0.8]])
  assert.ok(comparison.records.slice(1, -1).every(record => record.values[main.title].rating === null && record.values['三体'].rating === null))
})

test('主剧无该频道数据时，两部竞品有数据也不标星；单剧和未知值不标星', () => {
  const ratings = {
    [competitors[0].id]: [row('2023-02-01', '东方卫视', 0.8), row('2023-02-01', 'CCTV-8', 0.9)],
    [competitors[1].id]: [row('2024-02-01', '东方卫视', null, 2.1), row('2024-02-01', 'CCTV-8', '')],
  }
  assert.deepEqual([...comparableTvChannels(main, competitors, ratings, ['东方卫视', 'CCTV-8'])], [])
  ratings[main.id] = [row('2023-01-14', '东方卫视', null), row('2023-01-15', 'CCTV-8', 0)]
  assert.deepEqual([...comparableTvChannels(main, competitors, ratings, ['东方卫视', 'CCTV-8'])], ['CCTV-8'])
  assert.deepEqual([...comparableTvChannels(main, [], ratings, ['CCTV-8'])], [])
  assert.deepEqual([...comparableTvChannels(main, [main], ratings, ['CCTV-8'])], [])
})

test('主剧加四部竞品颜色各异，过滤缺数据剧集后仍保留原剧集颜色', () => {
  const subjects = comparisonSubjects(main, competitors)
  assert.equal(new Set(subjects.map(({ color }) => color)).size, 5)
  const colorsById = new Map(subjects.map(({ id, color }) => [id, color]))
  const exposure = subjects.filter(({ title }) => title !== '夜城赋')
  const interaction = subjects.filter(({ title }) => title !== '三体')
  for (const subject of [...exposure, ...interaction]) assert.equal(subject.color, colorsById.get(subject.id))
  const tv = buildTvComparison(main, competitors, {}, '东方卫视')
  assert.deepEqual(tv.colors, subjects.map(({ color }) => color))
})


test('跨年同月同日仍按完整日期排序，保留各作品的值和缺失状态', () => {
  const ratings = {
    [main.id]: [row('2026-07-01', '东方卫视', 1.2), row('2023-07-01', '东方卫视', 0)],
    [competitors[0].id]: [row('2025-07-01', '东方卫视', 0.8)],
  }
  const { records } = buildTvComparison(main, competitors, ratings, '东方卫视')
  assert.equal(records.length, 1097)
  const observedRecords = records.filter(record => Object.values(record.values).some(values => values.rating !== null))
  assert.deepEqual(observedRecords.map(({ date }) => date), ['2023-07-01', '2025-07-01', '2026-07-01'])
  assert.deepEqual(observedRecords.map(({ values }) => values[main.title].rating), [0, null, 1.2])
  assert.deepEqual(observedRecords.map(({ values }) => values['三体'].rating), [null, 0.8, null])
})

test('狂飙 CCTV-8 真实历史的间歇播出保留日历断点，未播日不跨线、不补零', () => {
  const ratings = { [main.id]: [
    { date: '2023-08-20', channel: 'CCTV-8', slot: '非黄金时段', csmCityRating: null, csmCityShare: null },
    { date: '2023-08-21', channel: 'CCTV-8', slot: '非黄金时段', csmCityRating: 0.5212, csmCityShare: 7.9653 },
    { date: '2023-09-13', channel: 'CCTV-8', slot: '非黄金时段', csmCityRating: 0.3924, csmCityShare: 5.9754 },
    { date: '2023-09-14', channel: 'CCTV-8', slot: '非黄金时段', csmCityRating: null, csmCityShare: null },
  ] }
  const { records } = buildTvComparison(main, [], ratings, 'CCTV-8')
  assert.equal(records.length, 24)
  assert.equal(records[0].date, '2023-08-21')
  assert.equal(records.at(-1).date, '2023-09-13')
  assert.equal(records[0].values[main.title].rating, 0.5212)
  assert.equal(records.at(-1).values[main.title].share, 5.9754)
  assert.ok(records.slice(1, -1).every(record => record.values[main.title].rating === null && record.values[main.title].share === null))
})
