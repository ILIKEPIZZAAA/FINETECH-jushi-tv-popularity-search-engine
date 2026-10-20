import assert from 'node:assert/strict'
import test from 'node:test'
import { waitForDate } from '../src/date-readiness.js'

test('日期页短暂保持旧值时等待到目标日期，不用固定长延时', async () => {
  const values = ['2026-09-03', '2026-09-03', '2026-09-02']
  const date = await waitForDate(async () => values.shift(), '2026-09-02', { intervalMs: 1 })
  assert.equal(date, '2026-09-02')
})

test('翻页跳过应核对日期时明确失败，不得伪装为无数据', async () => {
  await assert.rejects(
    waitForDate(async () => '2026-09-01', '2026-09-02', { intervalMs: 1 }),
    /跳过了预期日期/,
  )
})

test('日期迟迟不更新时超时失败', async () => {
  await assert.rejects(
    waitForDate(async () => '2026-09-03', '2026-09-02', { timeoutMs: 2, intervalMs: 1 }),
    /等待来源切换.*超时/,
  )
})
