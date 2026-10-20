import assert from 'node:assert/strict'
import test from 'node:test'
import { kyHistoryTimeoutMs } from '../src/lib/dramaApi.js'

test('酷云历史请求超时随首播至今天的日期跨度扩展并设置上限', () => {
  assert.equal(kyHistoryTimeoutMs('2026-09-27', '2026-09-27'), 605_000)
  assert.equal(kyHistoryTimeoutMs('2026-06-30', '2026-09-27'), 1_050_000)
  assert.equal(kyHistoryTimeoutMs('1900-01-01', '2026-09-27'), 43_200_000)
  assert.equal(kyHistoryTimeoutMs('bad-date', '2026-09-27'), 600_000)
})
