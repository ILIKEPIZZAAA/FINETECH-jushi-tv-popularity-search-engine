import test from 'node:test'
import assert from 'node:assert/strict'
import { collectCross } from '../src/lib/dramaApi.js'
import { collectionTicketKey, readCollectionTicket, saveCollectionTicket } from '../src/lib/collectionTickets.js'

function browser() {
  const original = { window: globalThis.window, fetch: globalThis.fetch }
  const stored = new Map()
  globalThis.window = { sessionStorage: { getItem: k => stored.get(k), setItem: (k, v) => stored.set(k, v) }, setTimeout, clearTimeout, addEventListener() {} }
  return () => { globalThis.window = original.window; globalThis.fetch = original.fetch }
}
const key = collectionTicketKey('/api/collect/cross', { method: 'POST', body: JSON.stringify({title:'test',contentType:'drama',skipMaoyan:false,skipGuduo:false}) })
test('restored source ticket retrieves completed job without starting a duplicate independent collection', async () => {
  const close = browser(), calls = []
  try {
    saveCollectionTicket(key, 'existing')
    const result = { rows: [{ date: '2026-10-24', value: 0 }], verification: { verified: false, unresolvedDates: ['2026-10-25'] } }
    globalThis.fetch = async path => { calls.push(path); return Response.json(result) }
    assert.deepEqual(await collectCross({title:'test'}, {clientId:'a'}), result)
    assert.deepEqual(calls, ['/api/collect/jobs/existing'])
    assert.equal(readCollectionTicket(key), null)
  } finally { close() }
})
test('cancelled restored job restarts once; source failure remains an error', async () => {
  const close = browser(), calls = []
  try {
    saveCollectionTicket(key, 'cancelled')
    globalThis.fetch = async path => {
      calls.push(path)
      if (path.endsWith('/cancelled')) return Response.json({status:'failed',interrupted:true,error:'page left'})
      return Response.json({error:'source unavailable'}, {status:503})
    }
    await assert.rejects(collectCross({title:'test'}, {clientId:'a'}), /source unavailable/)
    assert.deepEqual(calls, ['/api/collect/jobs/cancelled','/api/collect/cross'])
    assert.equal(readCollectionTicket(key), null)
  } finally { close() }
})
test('expired tickets do not reuse old collection results', () => {
  const close = browser()
  try {
    saveCollectionTicket(key, 'old', 1)
    assert.equal(readCollectionTicket(key, 31 * 60_000), null)
  } finally { close() }
})
