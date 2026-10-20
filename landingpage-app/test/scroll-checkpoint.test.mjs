import test from 'node:test'
import assert from 'node:assert/strict'
import { createScrollCheckpoint } from '../src/lib/scrollCheckpoint.js'

test('a large wheel gesture cannot skip the checkpoint', () => {
  const checkpoint = createScrollCheckpoint()
  assert.equal(checkpoint.shouldStop({ position: 0, delta: 500, stop: 1000, now: 0 }), false)
  assert.equal(checkpoint.shouldStop({ position: 500, delta: 5000, stop: 1000, now: 20 }), true)
})

test('continuous wheel input and inertial tail stay held, then a fresh gesture releases', () => {
  const checkpoint = createScrollCheckpoint()
  assert.equal(checkpoint.shouldStop({ position: 900, delta: 200, stop: 1000, now: 0 }), true)
  for (let now = 80; now <= 1600; now += 80) {
    assert.equal(checkpoint.shouldStop({ position: 1000, delta: 2, stop: 1000, now }), true)
  }
  assert.equal(checkpoint.shouldStop({ position: 1000, delta: 200, stop: 1000, now: 1900 }), false)
  assert.equal(checkpoint.shouldStop({ position: 1001, delta: 200, stop: 1000, now: 1910 }), false)
})

test('upward scrolling is immediate and returning to the story rearms the stop', () => {
  const checkpoint = createScrollCheckpoint()
  checkpoint.shouldStop({ position: 900, delta: 200, stop: 1000, now: 0 })
  assert.equal(checkpoint.shouldStop({ position: 1000, delta: -200, stop: 1000, now: 20 }), false)
  assert.equal(checkpoint.shouldStop({ position: 800, delta: 500, stop: 1000, now: 40 }), true)
  assert.equal(checkpoint.shouldStop({ position: 1000, delta: 200, stop: 1000, now: 400 }), false)
  assert.equal(checkpoint.shouldStop({ position: 800, delta: 500, stop: 1000, now: 500 }), true)
})

test('navigation below the checkpoint is untouched and reset clears release state', () => {
  const checkpoint = createScrollCheckpoint()
  assert.equal(checkpoint.shouldStop({ position: 1500, delta: 200, stop: 1000, now: 0 }), false)
  checkpoint.shouldStop({ position: 900, delta: 200, stop: 1000, now: 10 })
  checkpoint.shouldStop({ position: 1000, delta: 200, stop: 1000, now: 400 })
  checkpoint.reset()
  assert.equal(checkpoint.shouldStop({ position: 900, delta: 200, stop: 1000, now: 500 }), true)
})
