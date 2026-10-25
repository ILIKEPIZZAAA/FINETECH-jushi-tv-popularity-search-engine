import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/CompetitorModule.jsx', import.meta.url), 'utf8')
test('recommendation note explains the current main premiere plus or minus ten days and retains exact dates', () => {
  assert.ok(source.includes('按当前剧目首播日前后各10天抓取同期剧集'))
  assert.ok(source.includes('（${recommendationWindow.start}—${recommendationWindow.end}）'))
  assert.ok(!source.includes('基于首播日期'))
})

const declaration = source.slice(source.indexOf('  const addCompetitor = async'), source.indexOf('  const removeCompetitor ='))
function callback(onAddCompetitor) {
  const state = { pending: [], error: '' }
  const bindings = { competitors: [], isLive: true, pendingAddIds: { current: new Set() }, onAddCompetitor,
    setPendingAdds: update => { state.pending = update(state.pending) },
    setSearchError: error => { state.error = error }, setIsSearchOpen() {} }
  return { state, add: new Function(...Object.keys(bindings), `${declaration}; return addCompetitor`)(...Object.values(bindings)) }
}

test('rapid repeated selection invokes one add and exposes immediate pending feedback', async () => {
  let finish, calls = 0
  const { add, state } = callback(() => { calls++; return new Promise(resolve => { finish = resolve }) })
  const pending = add({ id: 'one' })
  assert.deepEqual(state.pending, ['one'])
  await add({ id: 'one' })
  assert.equal(calls, 1)
  finish()
  await pending
  assert.deepEqual(state.pending, [])
})

test('failed selection releases the synchronous guard so the same candidate can retry', async () => {
  let calls = 0
  const { add, state } = callback(async () => { calls++; throw new Error('source unavailable') })
  await add({ id: 'one' })
  await add({ id: 'one' })
  assert.equal(calls, 2)
  assert.equal(state.error, 'source unavailable')
  assert.deepEqual(state.pending, [])
})
