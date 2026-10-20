import test from 'node:test'
import assert from 'node:assert/strict'
import { dashboardIdleStatus, DASHBOARD_IDLE_MS, DASHBOARD_IDLE_GRACE_MS, DASHBOARD_SESSION_KEY, dashboardView, interruptRestoredCollections, readDashboardSession, saveDashboardSession } from '../src/lib/dashboardSession.js'
import { createEmptyState, resetBusinessStorage, STORAGE_KEY } from '../src/lib/dramaMonitor.js'

test('reload marks only unfinished sources as interrupted and keeps source values, units and audit', () => {
  const observations = [{ date: '2026-10-19', values: { 猫眼热度: 6789 }, units: { 猫眼热度: '热度值' }, sourceUrl: 'https://example.invalid/source', fetchedAt: '2026-10-19T12:00:00Z' }]
  const verification = { failedDates: ['2026-10-20'], noDataDates: ['2026-10-18'], candidates: [{ date: '2026-10-20', value: 123 }] }
  const state = { ...createEmptyState(), liveHeat: { main: observations }, collection: { main: { state: 'loading', sourceUrl: 'source', verification } }, sourceSync: { main: { maoyan: { state: 'loading', verification }, guduo: { state: 'error', verification }, ky: { state: 'empty', verification } } } }
  const restored = interruptRestoredCollections(state, '2026-10-20T12:00:00Z')
  assert.equal(restored.liveHeat, state.liveHeat)
  assert.equal(restored.collection.main.state, 'error')
  assert.equal(restored.collection.main.sourceUrl, 'source')
  assert.equal(restored.collection.main.verification, verification)
  assert.equal(restored.sourceSync.main.maoyan.state, 'error')
  assert.equal(restored.sourceSync.main.maoyan.verification, verification)
  assert.equal(restored.sourceSync.main.guduo, state.sourceSync.main.guduo)
  assert.equal(restored.sourceSync.main.ky, state.sourceSync.main.ky)
  assert.equal(state.collection.main.state, 'loading')
})

test('15-minute idle prompt and one-minute grace period use absolute activity timestamps', () => {
  const activity = 1_000_000
  assert.equal(dashboardIdleStatus(activity, activity + DASHBOARD_IDLE_MS - 1).warning, false)
  const warning = dashboardIdleStatus(activity, activity + DASHBOARD_IDLE_MS)
  assert.equal(warning.warning, true)
  assert.equal(warning.expired, false)
  assert.equal(warning.secondsLeft, 60)
  assert.equal(dashboardIdleStatus(activity, activity + DASHBOARD_IDLE_MS + DASHBOARD_IDLE_GRACE_MS - 1).expired, false)
  assert.equal(dashboardIdleStatus(activity, activity + DASHBOARD_IDLE_MS + DASHBOARD_IDLE_GRACE_MS).expired, true)
  assert.equal(dashboardIdleStatus(activity, activity + 3_600_000).expired, true)
})

test('tab-local view changes retain activity time; explicit reset removes only dashboard keys', () => {
  const previous = globalThis.window
  const session = new Map([[STORAGE_KEY, 'saved data'], ['visitor', 'kept']])
  const local = new Map([[STORAGE_KEY, 'legacy data'], ['ft_stats', 'kept']])
  const adapter = data => ({ getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) })
  globalThis.window = { sessionStorage: adapter(session), localStorage: adapter(local) }
  try {
    saveDashboardSession({ projectId: 'main', lastActivityAt: 1000 })
    saveDashboardSession({ view: 'logs', platform: 'kuyun', dimension: 'growth' })
    assert.equal(readDashboardSession().lastActivityAt, 1000)
    assert.deepEqual(dashboardView('main'), { view: 'logs', platform: 'kuyun', dimension: 'growth' })
    assert.deepEqual(dashboardView('different'), {})
    resetBusinessStorage()
    assert.equal(session.has(DASHBOARD_SESSION_KEY), false)
    assert.equal(session.has(STORAGE_KEY), false)
    assert.equal(local.has(STORAGE_KEY), false)
    assert.equal(session.get('visitor'), 'kept')
    assert.equal(local.get('ft_stats'), 'kept')
  } finally { globalThis.window = previous }
})

test('unavailable or corrupt temporary storage has a safe empty fallback', () => {
  const previous = globalThis.window
  try {
    globalThis.window = { sessionStorage: { getItem() { throw new Error('blocked') }, setItem() { throw new Error('quota') } } }
    assert.deepEqual(readDashboardSession(), {})
    assert.doesNotThrow(() => saveDashboardSession({ view: 'logs' }))
    globalThis.window.sessionStorage.getItem = () => '{'
    assert.deepEqual(dashboardView('main'), {})
  } finally { globalThis.window = previous }
})
