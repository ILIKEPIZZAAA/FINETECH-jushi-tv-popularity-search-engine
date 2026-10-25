import test from 'node:test'
import assert from 'node:assert/strict'
import { foregroundCollection, settleCollectionPhases } from '../src/lib/collectionPhases.js'

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b}); return {promise,resolve,reject} }

test('基础来源落状态后可进入看板，艺恩仍保持原任务直到结束', async () => {
  const core = deferred(), endata = deferred(), events = []
  const work = foregroundCollection(ready => settleCollectionPhases([
    {promise:core.promise}, {promise:endata.promise,background:true},
  ], () => { events.push('core'); ready() }))
  let complete = false
  work.complete.then(() => {complete=true})
  core.resolve()
  await work.ready
  assert.deepEqual(events,['core'])
  assert.equal(complete,false)
  endata.resolve('verified')
  const results = await work.complete
  assert.equal(results[1].value,'verified')
})

test('基础任务失败仍释放页面等待，后台失败独立落状态且无未处理拒绝', async () => {
  const core = deferred(), endata = deferred()
  const work = foregroundCollection(ready => settleCollectionPhases([{promise:core.promise},{promise:endata.promise,background:true}], ready))
  core.reject(new Error('source failure'))
  await work.ready
  endata.reject(new Error('cancelled on page exit'))
  const results = await work.complete
  assert.deepEqual(results.map(result=>result.status),['rejected','rejected'])
  const early = foregroundCollection(async () => {throw new Error('failed before setup')})
  await early.ready
  await assert.rejects(early.complete,/before setup/)
})
