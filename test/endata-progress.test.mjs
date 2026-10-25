import test from 'node:test'
import assert from 'node:assert/strict'
import { endataProgressText } from '../src/lib/endataProgress.js'

test('艺恩实际读取进度不冒充已核验，第三次显示差异补核', () => {
  const text = endataProgressText({ pass: 1, state: 'queued', waitingTasks: 2, readDays: 12, totalDays: 1377, currentDate: '2023-01-25', startedAt: 1000 }, 61000)
  assert.match(text, /12\/1377/)
  assert.match(text, /总耗时 60 秒/)
  assert.doesNotMatch(text, /已核对|核验完成/)
  assert.match(endataProgressText({ pass: 3, state: 'incomplete' }, 0), /差异补核.*未核实/)
})

test('结束后的耗时固定在任务实际结束时刻', () => {
  assert.match(endataProgressText({ state: 'complete', startedAt: 1000, elapsedMs: 13000 }, 61000), /总耗时 13 秒/)
  assert.doesNotMatch(endataProgressText({ state: 'loading' }, 61000), /总耗时/)
})
