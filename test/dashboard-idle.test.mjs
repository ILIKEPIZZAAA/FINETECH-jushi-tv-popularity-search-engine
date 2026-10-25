import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dashboardIdleStatus, readDashboardSession, saveDashboardSession, interruptRestoredCollections } from '../src/lib/dashboardSession.js'
import { createSerialTaskQueue } from '../src/lib/sharedTask.js'

// Execute the production hook with a deterministic clock and browser events.
function idleHarness(onExpire, initial = {}) {
  const previous = { window: globalThis.window, document: globalThis.document, now: Date.now }
  let now = 1_000_000, value = null, cleanup, nextId = 0
  const timers = new Map(), listeners = new Map(), storage = new Map()
  const listen = (name, fn) => listeners.set(name, fn)
  const remove = name => listeners.delete(name)
  globalThis.window = {
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, data) => storage.set(key, data) },
    setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id },
    clearTimeout: id => timers.delete(id), addEventListener: listen, removeEventListener: remove,
  }
  globalThis.document = { hidden: false, addEventListener: listen, removeEventListener: remove }
  Date.now = () => now
  saveDashboardSession(initial)
  const source = readFileSync(new URL('../src/hooks/useDashboardIdle.js', import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '').replace('export function', 'function')
  const hook = new Function('useCallback', 'useEffect', 'useRef', 'useState', 'dashboardIdleStatus', 'readDashboardSession', 'saveDashboardSession', `${source}; return useDashboardIdle`)(
    fn => fn, fn => { cleanup = fn() }, current => ({ current }), initialValue => [initialValue, next => { value = next }],
    dashboardIdleStatus, readDashboardSession, saveDashboardSession,
  )
  const controls = hook(true, onExpire)
  return {
    controls, storage, get value() { return value },
    advance(ms) {
      const target = now + ms
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        now = due[1].at; timers.delete(due[0]); due[1].fn()
      }
      now = target
    },
    emit: name => listeners.get(name)?.(),
    close() { cleanup?.(); Date.now = previous.now; globalThis.window = previous.window; globalThis.document = previous.document },
  }
}

test('idle expiry stops once, closes its warning and preserves tab data and selected view', () => {
  let stopped = 0
  const clock = idleHarness(() => { stopped++; saveDashboardSession({ backgroundPaused: true }) }, { projectId: 'main', platform: 'guduo', view: 'heat' })
  clock.storage.set('drama-observations', '{"value":0,"verified":false}')
  try {
    clock.advance(15 * 60_000)
    assert.equal(clock.value, 60)
    clock.advance(60_000)
    assert.equal(stopped, 1)
    assert.equal(clock.value, null)
    assert.equal(readDashboardSession().projectId, 'main')
    assert.equal(readDashboardSession().platform, 'guduo')
    assert.equal(clock.storage.get('drama-observations'), '{"value":0,"verified":false}')
    clock.emit('pointerdown'); clock.emit('pageshow'); clock.emit('visibilitychange')
    clock.advance(60 * 60_000)
    assert.equal(stopped, 1)
    assert.equal(clock.value, null)
  } finally { clock.close() }
})

test('continue during grace renews the clock without releasing the connection', () => {
  let stopped = 0
  const clock = idleHarness(() => stopped++)
  try {
    clock.advance(15 * 60_000 + 30_000)
    assert.equal(clock.value, 30)
    clock.controls.continueViewing()
    assert.equal(clock.value, null)
    clock.advance(14 * 60_000)
    assert.equal(stopped, 0)
    clock.advance(2 * 60_000)
    assert.equal(stopped, 1)
  } finally { clock.close() }
})

test('restoring an idle-paused tab does not reopen a warning or restart work; explicit refresh rearms idle timing', () => {
  let stopped = 0
  const clock = idleHarness(() => stopped++, { backgroundPaused: true, lastActivityAt: 1 })
  try {
    clock.advance(60 * 60_000); clock.emit('pointerdown')
    assert.equal(stopped, 0)
    assert.equal(clock.value, null)
    clock.controls.continueViewing()
    clock.advance(16 * 60_000)
    assert.equal(stopped, 1)
  } finally { clock.close() }
})

function callback(name, bindings) {
  const source = readFileSync(new URL('../src/hooks/useDramaMonitor.js', import.meta.url), 'utf8')
  const start = source.indexOf(`  const ${name} = useCallback(`)
  const end = source.indexOf('\n', source.indexOf('\n  }, [', start) + 1)
  const declaration = source.slice(start, end).trim().replace(/\}, \[[^\n]*\]\)$/, '}, [])')
  return new Function('useCallback', ...Object.keys(bindings), `${declaration}; return ${name}`)(fn => fn, ...Object.values(bindings))
}

test('pause releases transport while retaining source values and audits; resume drains old queued work before reopening', async () => {
  const observed = [{ date: '2026-10-23', value: 0, sourceUrl: 'source' }]
  const audit = { candidates: [1, 2], verified: false }
  let state = { liveHeat: { main: observed }, collection: { main: { state: 'loading', verification: audit } }, sourceSync: {} }
  let released = 0, persisted = {}, queuedSawPaused = false
  const paused = { current: false }, active = { current: true }, queue = createSerialTaskQueue()
  const pause = callback('pauseBackground', {
    activeRef: active, backgroundPausedRef: paused, apiRef: { current: { abort() { released++ } } },
    saveDashboardSession: patch => Object.assign(persisted, patch),
    commit: update => { state = update(state) }, interruptRestoredCollections,
  })
  pause(); pause()
  assert.equal(released, 1)
  assert.equal(state.liveHeat.main, observed)
  assert.equal(state.collection.main.verification, audit)
  assert.equal(state.collection.main.state, 'error')
  assert.equal(persisted.backgroundPaused, true)
  void queue(async () => { queuedSawPaused = paused.current })
  const resume = callback('resumeBackground', {
    activeRef: active, backgroundPausedRef: paused, competitorCollectionAttempts: { current: new Set() }, setResumeRevision() {},
    collectingProjectTasksRef: { current: new Map() }, collectingTvTasksRef: { current: new Map() }, endataTasksRef: { current: new Map() },
    competitorCollectionQueue: { current: queue }, competitorAddQueue: { current: createSerialTaskQueue() },
    saveDashboardSession: patch => Object.assign(persisted, patch),
  })
  await resume()
  assert.equal(queuedSawPaused, true)
  assert.equal(paused.current, false)
  assert.equal(persisted.backgroundPaused, false)
  assert.equal(state.liveHeat.main, observed)
})

test('metric source errors and partial verification cannot become available or confirmed unpublished', () => {
  const source = readFileSync(new URL('../src/hooks/useDramaMonitor.js', import.meta.url), 'utf8')
  const start = source.indexOf('function maoyanMetricAvailability(')
  const end = source.indexOf('\n}\n', start) + 2
  const classify = new Function(`${source.slice(start, end)}; return maoyanMetricAvailability`)()
  assert.equal(classify({ error: 'HTTP 500', availability: 'available', verification: { verified: true } }), 'error')
  assert.equal(classify({ availability: 'error', verification: { verified: false } }), 'error')
  assert.equal(classify({ availability: 'not-published', verification: { verified: false }, series: [] }), 'unverified')
  assert.equal(classify({ availability: 'available', verification: { verified: false }, series: [{ value: 0 }] }), 'unverified')
  assert.equal(classify({ availability: 'not-published', verification: { verified: true }, series: [] }), 'not-published')
  assert.equal(classify({ availability: 'available', verification: { verified: true }, series: [{ value: 0 }] }), 'available')
})

test('paused API wrapper cannot silently recreate an aborted session; explicit resume allows a new read', async () => {
  const source = readFileSync(new URL('../src/hooks/useDramaMonitor.js', import.meta.url), 'utf8')
  const start = source.indexOf('  const { collectCross,')
  const end = source.indexOf('  const exportController', start)
  const active = { current: true }, paused = { current: true }, api = { current: { aborted: true } }
  let sessions = 0, reads = 0
  const read = new Function('useMemo', 'activeRef', 'backgroundPausedRef', 'apiRef', 'createDramaApiSession', 'pageSuspendedRef', `${source.slice(start, end)}; return collectMaoyanHistory`)(
    fn => fn(), active, paused, api,
    () => { sessions++; return { collectMaoyanHistory: async () => { reads++; return 'new-source-read' } } }, { current: false },
  )
  await assert.rejects(read({ id: 'main' }), error => error.name === 'AbortError')
  assert.equal(sessions, 0)
  assert.equal(reads, 0)
  paused.current = false
  assert.equal(await read({ id: 'main' }), 'new-source-read')
  assert.equal(sessions, 1)
  assert.equal(reads, 1)
})

test('idle pause permits explicit directory recommendations without resuming background collection', async () => {
  const source = readFileSync(new URL('../src/hooks/useDramaMonitor.js', import.meta.url), 'utf8')
  const start = source.indexOf('  const { collectCross,')
  const end = source.indexOf('  const exportController', start)
  const paused = { current: true }
  const api = new Function('useMemo', 'activeRef', 'backgroundPausedRef', 'apiRef', 'createDramaApiSession', 'pageSuspendedRef', `${source.slice(start, end)}; return {recommendDramas, collectCross}`)(
    fn => fn(), { current: true }, paused, { current: null }, () => ({ recommendDramas: async () => 'directory-only' }), { current: false },
  )
  assert.equal(await api.recommendDramas({}), 'directory-only')
  assert.equal(paused.current, true)
  await assert.rejects(api.collectCross({}), error => error.name === 'AbortError')
})
