import test from 'node:test'
import assert from 'node:assert/strict'
import { clearCompetitorAttemptMarkers, refreshCompetitorPool } from '../src/lib/competitorCollection.js'

test('removing a competitor clears its daily auto-collection guard for a later re-add', () => {
  const attempts = new Set([
    'competitor-a:web:2026-10-21',
    'competitor-a:tv:2026-10-21',
    'competitor-b:web:2026-10-21',
  ])

  clearCompetitorAttemptMarkers(attempts, 'competitor-a')

  assert.deepEqual([...attempts], ['competitor-b:web:2026-10-21'])
})

test('manual competitor refresh collects only the current competitor pool in serial order', async () => {
  const started = []
  const completed = []
  let active = 0
  let maxActive = 0
  const enqueue = async (work) => {
    active += 1
    maxActive = Math.max(maxActive, active)
    const result = await work()
    active -= 1
    completed.push(true)
    return result
  }
  const collect = (dimension) => async (competitor) => {
    started.push(`${competitor.id}:${dimension}`)
    return 1
  }

  const count = await refreshCompetitorPool([
    { id: 'new-1', web: true, tv: true },
    { id: 'new-2', web: true, tv: false },
  ], {
    enqueue,
    hasWeb: (competitor) => competitor.web,
    hasTv: (competitor) => competitor.tv,
    collectWeb: collect('web'),
    collectTv: collect('tv'),
  })

  assert.deepEqual(started, ['new-1:web', 'new-1:tv', 'new-2:web'])
  assert.equal(completed.length, 2)
  assert.equal(maxActive, 1)
  assert.equal(count, 3)
})

test('competitor refresh still attempts the other dimension when one collection rejects', async () => {
  const attempted = []
  const count = await refreshCompetitorPool([{ id: 'c', web: true, tv: true }], {
    enqueue: (work) => work(),
    hasWeb: (item) => item.web,
    hasTv: (item) => item.tv,
    collectWeb: async () => { attempted.push('web'); throw new Error('web failed') },
    collectTv: async () => { attempted.push('tv'); return 1 },
  })
  assert.deepEqual(attempted.sort(), ['tv', 'web'])
  assert.equal(count, 1)
})
