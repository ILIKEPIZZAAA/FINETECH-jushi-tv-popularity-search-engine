import test from 'node:test'
import assert from 'node:assert/strict'
import { createJobSubscriptions } from '../server/job-subscriptions.mjs'

test('共享采集仅在最后一个标签页离开后取消，轮询续租且失联可清理', () => {
  let now = 0
  const subscriptions = createJobSubscriptions({ now: () => now, leaseMs: 100 })
  const controller = new AbortController()
  subscriptions.join('a', 'job', controller)
  subscriptions.join('b', 'job', controller)
  subscriptions.release('a')
  assert.equal(controller.signal.aborted, false)
  now = 80
  subscriptions.join('b', 'job', controller)
  now = 150
  subscriptions.expire()
  assert.equal(controller.signal.aborted, false)
  subscriptions.release('b')
  assert.equal(controller.signal.aborted, true)
  const orphan = new AbortController()
  subscriptions.join('c', 'orphan', orphan)
  now = 251
  subscriptions.expire()
  assert.equal(orphan.signal.aborted, true)
})
