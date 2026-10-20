import assert from 'node:assert/strict'
import test from 'node:test'
import { coalesceInFlight } from '../src/inflight.js'

test('并行标题共享同一榜单日期的在途 HTTP 读取，已完成的响应不缓存', async () => {
  const inflight = new Map()
  let reads = 0
  const load = () => coalesceInFlight(inflight, 'NETWORK_DRAMA:2026-09-28', async () => {
    reads += 1
    await new Promise((resolve) => setTimeout(resolve, 5))
    return [{ name: '剧' }]
  })

  const [first, second] = await Promise.all([load(), load()])
  assert.equal(reads, 1)
  assert.deepEqual(first, second)
  await load()
  assert.equal(reads, 2, '后续独立采集轮必须重新读取来源')
})

test('失败请求完成后移除在途项，之后可以重新读取', async () => {
  const inflight = new Map()
  let reads = 0
  await assert.rejects(coalesceInFlight(inflight, 'key', async () => {
    reads += 1
    throw new Error('source failed')
  }), /source failed/)
  await assert.rejects(coalesceInFlight(inflight, 'key', async () => {
    reads += 1
    throw new Error('source failed again')
  }), /source failed again/)
  assert.equal(reads, 2)
})
