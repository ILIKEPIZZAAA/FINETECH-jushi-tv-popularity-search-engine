import test from 'node:test'
import assert from 'node:assert/strict'
import * as monitor from '../src/lib/dramaMonitor.js'
import { desktopLayoutScale } from '../src/lib/viewportLayout.js'
import { readFileSync } from 'node:fs'

// Exercise the actual hook callbacks with deterministic network/state seams,
// without introducing a second implementation of their business logic.
function hookCallback(name, bindings) {
  bindings = { preloadDramaPosters: async () => [], ...bindings }
  const source = readFileSync(new URL('../src/hooks/useDramaMonitor.js', import.meta.url), 'utf8')
  const start = source.indexOf(`  const ${name} = useCallback(`)
  const end = source.indexOf('\n  const ', start + 1)
  const declaration = source.slice(start, end).trim().replace(/\}, \[[^\n]*\]\)$/, '}, [])')
  return new Function('useCallback', ...Object.keys(bindings), `${declaration}; return ${name}`)((callback) => callback, ...Object.values(bindings))
}

test('business reset removes only its own keys, preserving stats and visitor identifiers', () => {
  const previous = globalThis.window
  const data = () => new Map([[monitor.STORAGE_KEY, 'old comparison'], ['ft_stats', 'admin'], ['visitor', 'same visitor']])
  const local = data(), session = data()
  globalThis.window = {
    localStorage: { removeItem: (key) => local.delete(key) },
    sessionStorage: { removeItem: (key) => session.delete(key) },
  }
  try {
    monitor.resetBusinessStorage()
    for (const store of [local, session]) {
      assert.equal(store.has(monitor.STORAGE_KEY), false)
      assert.equal(store.get('ft_stats'), 'admin')
      assert.equal(store.get('visitor'), 'same visitor')
    }
  } finally { globalThis.window = previous }
})

test('1280x600 dashboard content fits rather than being cropped at design size', () => {
  const scale = desktopLayoutScale(1280, 600)
  assert.ok(756 * scale + 83 * scale + 43 * scale <= 600)
  assert.ok(scale < 1)
})

test('exports share one frozen snapshot and recover after failure', async () => {
  const { createRawDataExportTask } = await import('../src/lib/rawDataExport.js')
  let complete, count = 0
  const state = { selectedId: '逐玉', competitors: ['狂飙'] }
  let snapshot
  const run = createRawDataExportTask({
    build: (value) => { count++; snapshot = value; return new Promise((resolve) => { complete = resolve }) },
    save: () => {},
  })
  const a = run(state), b = run(state)
  assert.equal(a, b)
  state.competitors.push('三体')
  await Promise.resolve()
  assert.equal(count, 1)
  assert.deepEqual(snapshot.competitors, ['狂飙'])
  complete(new Uint8Array([1]))
  await a
  const fail = createRawDataExportTask({ build: async () => { throw new Error('broken') }, save: () => {} })
  await assert.rejects(fail(state), /broken/)
  await assert.rejects(fail(state), /broken/)
})

test('cross-source search merges matching credits with unknown year, preserves conflicting editions', async () => {
  const { consolidateSearchResults } = await import('../src/lib/searchResults.js')
  const rows = [
    { provider: 'tvmaze', providerId: 1, title: '逐玉', cast: ['张凌赫', '田曦薇'] },
    { provider: 'catalog', providerId: 2, title: '逐玉', premiered: '2026-03-06', year: 2026, cast: ['张凌赫', '田曦薇'], poster: '/good.jpg' },
    { provider: 'other', providerId: 3, title: '逐玉', premiered: '2020-03-06', year: 2020, cast: ['其他演员'] },
    { provider: 'other', providerId: 4, title: '逐玉', cast: ['另一位演员'] },
  ]
  const result = consolidateSearchResults(rows, '逐玉')
  assert.equal(result.length, 3)
  assert.equal(result[0].provider, 'catalog')
  assert.equal(result[0].poster, '/good.jpg')
  assert.equal(result[0].identityCandidates.length, 2)
  assert.equal(result.find((item) => item.providerId === 4).identityUnverified, true)
})

test('worker failures and cancellation terminate the worker, without downloading stale data', async () => {
  const { generateWorkbookInWorker } = await import('../src/lib/rawDataExport.js')
  let worker, terminated = 0
  const workerFactory = () => (worker = { postMessage() {}, terminate() { terminated++ } })
  const controller = new AbortController()
  const pending = generateWorkbookInWorker({}, { signal: controller.signal, workerFactory })
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(terminated, 1)
  const failed = generateWorkbookInWorker({}, { workerFactory })
  worker.onmessage({ data: { error: 'bad snapshot' } })
  await assert.rejects(failed, /bad snapshot/)
  assert.equal(terminated, 2)
})

test('a closed API session cannot issue new requests or finish an old search', async () => {
  const { createDramaApiSession } = await import('../src/lib/dramaApi.js')
  const oldWindow = globalThis.window, oldFetch = globalThis.fetch
  globalThis.window = { setTimeout, clearTimeout, addEventListener() {} }
  let calls = 0
  globalThis.fetch = (url, { signal }) => {
    calls++
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }))
  }
  try {
    const api = createDramaApiSession()
    const pending = api.searchDramas('逐玉')
    api.abort()
    await assert.rejects(pending, { name: 'AbortError' })
    await assert.rejects(api.searchDramas('狂飙'), { name: 'AbortError' })
    assert.equal(calls, 1)
  } finally { globalThis.window = oldWindow; globalThis.fetch = oldFetch }
})

test('new comparison sessions have distinct collection subscribers and release only their own client', async () => {
  const { createDramaApiSession } = await import('../src/lib/dramaApi.js')
  const oldWindow = globalThis.window, oldFetch = globalThis.fetch
  globalThis.window = { setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} }
  const calls = []
  globalThis.fetch = (url, options) => {
    calls.push({ url, options })
    if (url.startsWith('/api/collect/release')) return Promise.resolve({ ok: true })
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }))
  }
  try {
    const a = createDramaApiSession(), b = createDramaApiSession()
    const first = a.collectMaoyanHistory({ title: '逐玉' }), second = b.collectMaoyanHistory({ title: '逐玉' })
    const clientA = calls[0].options.headers['X-Collection-Client']
    const clientB = calls[1].options.headers['X-Collection-Client']
    assert.notEqual(clientA, clientB)
    a.abort()
    await assert.rejects(first, { name: 'AbortError' })
    assert.equal(calls[1].options.signal.aborted, false)
    assert.ok(calls.some(({ url }) => url === `/api/collect/release?client=${clientA}`))
    b.abort()
    await assert.rejects(second, { name: 'AbortError' })
  } finally { globalThis.window = oldWindow; globalThis.fetch = oldFetch }
})

test('reselecting the same main drama clears its previous competitor association', async () => {
  const main = { id: 'catalog-1', provider: 'catalog', providerId: 1, title: '逐玉', premiered: '2026-03-06', platforms: [{ name: '网端', dimension: 'web' }] }
  const stateRef = { current: { ...monitor.createEmptyState(), projects: [main], selectedId: main.id, competitors: { [main.id]: [{ id: 'old', title: '狂飙' }] } } }
  const noOp = () => {}
  const started = []
  let finishPreparation
  const add = hookCallback('addProject', {
    getDramaDetails: async () => ({ result: main }), stateRef,
    makeProject: monitor.makeProject, sameDramaIdentity: monitor.sameDramaIdentity,
    appendLog: monitor.appendLog, hasDimension: monitor.hasDimension,
    todayInShanghai: monitor.todayInShanghai,
    commit: (update) => { stateRef.current = update(stateRef.current) },
    loadRecommendations: (project, force, options) => {
      assert.equal(project.title, '逐玉')
      assert.equal(options.silent, true)
      started.push('recommendations')
      return new Promise((resolve) => { finishPreparation = resolve })
    },
    collectProject: async () => { started.push('web'); return 0 }, collectTvForProject: async () => { started.push('tv'); return 0 },
    updateCollection: noOp, tvCollectAttempts: { current: new Set() },
    setRecommendations: noOp, setRecommendationWindow: noOp, setRecommendationFor: noOp, setRecommendationError: noOp,
  })
  let complete = false
  const pending = add(main).then((value) => { complete = true; return value })
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(started, ['recommendations', 'web', 'tv'])
  assert.equal(complete, false, 'do not enter the dashboard before candidate preparation has settled')
  finishPreparation([])
  const project = await pending
  assert.deepEqual(stateRef.current.competitors[project.id], [])
})

test('a failed new-main recommendation request does not leave the old-main list visible', async () => {
  let visible = [{ title: '旧主剧候选' }]
  const noOp = () => {}
  const load = hookCallback('loadRecommendations', {
    stateRef: { current: { selectedId: 'new', competitors: {} } },
    recommendationFor: 'old', recommendations: visible, recommendationRequestRef: { current: null },
    recommendationCacheRef: { current: new Map() }, activeRef: { current: true },
    setRecommendations: (items) => { visible = items }, setRecommendationWindow: noOp,
    setRecommendationFor: noOp, setRecommendationLoading: noOp, setRecommendationError: noOp,
    recommendDramas: async () => { throw new Error('offline') }, getDramaDetails: noOp,
    sameDramaIdentity: monitor.sameDramaIdentity, sharedDimensions: monitor.sharedDimensions,
    readableError: (error) => error.message, appendActivity: noOp,
  })
  await load({ id: 'new', title: '狂飙', premiered: '2023-01-14' })
  assert.deepEqual(visible, [])
})

test('a prepared competitor is added without another metadata network request', async () => {
  const main = { id: 'main', title: '逐玉', platforms: [{ dimension: 'web' }] }
  const prepared = { id: 'catalog-2', provider: 'catalog', providerId: 2, title: '狂飙', year: 2023, cast: ['张译'], platforms: [{ dimension: 'web' }], detailsPrepared: true }
  const stateRef = { current: { ...monitor.createEmptyState(), projects: [main], selectedId: main.id, competitors: { [main.id]: [] } } }
  const add = hookCallback('addCompetitor', {
    stateRef, competitorAddQueue: { current: (run) => run() }, MAX_COMPARABLE_COMPETITORS: 4,
    recommendationCacheRef: { current: new Map([[main.id, { results: [prepared] }]]) },
    getDramaDetails: () => { throw new Error('unexpected network request') },
    makeProject: monitor.makeProject, sameDramaIdentity: monitor.sameDramaIdentity, sharedDimensions: monitor.sharedDimensions,
    commit: (update) => { stateRef.current = update(stateRef.current) }, appendLog: monitor.appendLog, setRecommendations() {},
  })
  await add(prepared)
  assert.equal(stateRef.current.competitors[main.id][0].title, '狂飙')
  assert.deepEqual(stateRef.current.competitors[main.id][0].cast, ['张译'])
})

test('candidate preparation prefers a verified domestic identity and bounds concurrent reads', async () => {
  const { prepareRecommendedCandidates } = await import('../src/lib/recommendationPreparation.js')
  let concurrent = 0, maximum = 0
  const rows = Array.from({ length: 7 }, (_, id) => ({ provider: 'tvmaze', providerId: id + 1, title: `剧${id}`, premiered: '2026-03-06' }))
  const result = await prepareRecommendedCandidates(rows, {
    searchDramas: async (title) => ({ results: [{ provider: 'catalog', providerId: 90, title, premiered: '2026-03-06' }] }),
    getDramaDetails: async (target) => {
      assert.equal(target.provider, 'catalog')
      maximum = Math.max(maximum, ++concurrent)
      await new Promise((resolve) => setImmediate(resolve))
      concurrent--
      return { result: { ...target, cast: ['张译'], directors: ['徐纪周'] } }
    },
  })
  assert.equal(maximum, 3)
  assert.equal(result.length, 7)
  assert.ok(result.every((item) => item.detailsPrepared && item.cast[0] === '张译'))
})

test('reselecting a main restores prepared candidates from cache without fetching again', async () => {
  const main = { id: 'main', title: '逐玉', premiered: '2026-03-06' }
  const candidate = { provider: 'catalog', providerId: 2, title: '狂飙', detailsPrepared: true }
  let visible = []
  const noOp = () => {}
  const load = hookCallback('loadRecommendations', {
    stateRef: { current: { selectedId: main.id, competitors: {} } }, activeRef: { current: true },
    recommendationCacheRef: { current: new Map([[main.id, { results: [candidate], window: null }]]) },
    setRecommendations: (items) => { visible = items }, setRecommendationWindow: noOp,
    setRecommendationFor: noOp, setRecommendationError: noOp, setRecommendationLoading: noOp,
    sameDramaIdentity: monitor.sameDramaIdentity,
    recommendDramas: () => { throw new Error('unexpected recommendation request') },
    getDramaDetails: noOp, searchDramas: noOp, appendActivity: noOp,
  })
  assert.deepEqual(await load(main, false, { silent: true }), [candidate])
  assert.deepEqual(visible, [candidate])
})

test('candidate publication waits for poster preparation and rejects a stale main after decoding', async () => {
  for (const switchMain of [false, true]) {
    const main = { id: 'main', title: '逐玉', premiered: '2026-03-06', poster: 'https://example.com/main.jpg', platforms: [{ dimension: 'web' }] }
    const candidate = { id: 'candidate', title: '候选', poster: 'https://example.com/candidate.jpg', platforms: [{ dimension: 'web' }] }
    const stateRef = { current: { selectedId: main.id, competitors: {} } }
    const noOp = () => {}
    let visible = [], finish, started
    const loading = new Promise(resolve => { started = resolve })
    const load = hookCallback('loadRecommendations', {
      stateRef, recommendationRequestRef: { current: null }, recommendationCacheRef: { current: new Map() }, activeRef: { current: true },
      setRecommendations: items => { visible = items }, setRecommendationWindow: noOp, setRecommendationFor: noOp,
      setRecommendationLoading: noOp, setRecommendationError: noOp,
      recommendDramas: async () => ({ results: [candidate] }), prepareRecommendedCandidates: async items => items,
      preloadDramaPosters: items => {
        assert.deepEqual(items.map(item => item.id), ['main', 'candidate'])
        started()
        return new Promise(resolve => { finish = resolve })
      },
      getDramaDetails: noOp, searchDramas: noOp, sameDramaIdentity: monitor.sameDramaIdentity,
      sharedDimensions: monitor.sharedDimensions, readableError: error => error.message, appendActivity: noOp,
    })
    const pending = load(main, false, { silent: true })
    await loading
    assert.deepEqual(visible, [])
    if (switchMain) stateRef.current.selectedId = 'other'
    finish([])
    assert.deepEqual(await pending, switchMain ? [] : [candidate])
    assert.deepEqual(visible, switchMain ? [] : [candidate])
  }
})

test('failed candidate details remain unprepared and preserve their source identity', async () => {
  const { prepareRecommendedCandidates } = await import('../src/lib/recommendationPreparation.js')
  const candidate = { provider: 'tvmaze', providerId: 1, title: '来源原名', cast: [] }
  const results = await prepareRecommendedCandidates([candidate], {
    searchDramas: async () => ({ results: [] }),
    getDramaDetails: async () => { throw new Error('source unavailable') },
  })
  assert.deepEqual(results, [{ ...candidate, detailsPrepared: false }])
})
