import test from 'node:test'
import assert from 'node:assert/strict'
import { runSharedTask, createSerialTaskQueue } from '../src/lib/sharedTask.js'

test('四部竞品可以立即入队，采集逐部执行且单部失败不阻断后续', async () => {
  const queue = createSerialTaskQueue()
  const events = []
  let finish
  const first = queue(() => new Promise((resolve) => { events.push('first'); finish = resolve }))
  const second = queue(async () => { events.push('second'); throw new Error('source failed') })
  const third = queue(async () => { events.push('third'); return 3 })
  const fourth = queue(async () => { events.push('fourth'); return 4 })
  const results = Promise.allSettled([first, second, third, fourth])
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['first'])
  finish(1)
  assert.deepEqual((await results).map((item) => item.status), ['fulfilled', 'rejected', 'fulfilled', 'fulfilled'])
  assert.deepEqual(events, ['first', 'second', 'third', 'fourth'])
})

test('a second caller waits for the active collection task instead of treating it as complete', async () => {
  const tasks = new Map()
  let finish
  let calls = 0
  const work = () => {
    calls += 1
    return new Promise((resolve) => { finish = resolve })
  }

  const first = runSharedTask(tasks, 'project-1', work)
  const second = runSharedTask(tasks, 'project-1', work)
  let secondSettled = false
  void second.then(() => { secondSettled = true })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls, 1)
  assert.equal(secondSettled, false)
  finish(42)
  assert.deepEqual(await Promise.all([first, second]), [42, 42])
  assert.equal(tasks.size, 0)
})
