import test from 'node:test'
import assert from 'node:assert/strict'
import * as monitor from '../src/lib/dramaMonitor.js'
import { desktopLayoutScale } from '../src/lib/viewportLayout.js'
import { refreshCompetitorPool } from '../src/lib/competitorCollection.js'
import { comparisonResult, shouldResumeComparison } from '../src/lib/comparisonJobs.js'
import { interruptRestoredCollections } from '../src/lib/dashboardSession.js'
import { readFileSync } from 'node:fs'
import { foregroundCollection } from '../src/lib/collectionPhases.js'
import { createSerialTaskQueue, runSharedTask } from '../src/lib/sharedTask.js'

test('source logo marquee includes a bundled official Endata mark in both looping tracks', () => {
  const source = readFileSync(new URL('../src/components/SourceCoverageSection.jsx', import.meta.url), 'utf8')
  assert.match(source, /import sourceEndata from ['"]\.\.\/assets\/logos\/source-endata\.webp['"]/)
  assert.match(source, /\{ src: sourceEndata, name: ['"]艺恩['"] \}/)
  assert.match(source, /<SourceLogoTrack \/>[\s\S]*<SourceLogoTrack duplicate \/>/)
  const png = readFileSync(new URL('../src/assets/logos/source-endata.webp', import.meta.url))
  assert.equal(png.subarray(8, 12).toString(), 'WEBP')
})

// Exercise the actual hook callbacks with deterministic network/state seams,
// without introducing a second implementation of their business logic.
function hookCallback(name, bindings) {
  bindings = { preloadDramaPosters: async () => [], foregroundCollection, ...bindings }
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
  let releaseCore, finishBackground
  let backgroundComplete = false
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
    collectProject: async (project, quiet, force, progress, onCoreReady) => {
      started.push('web')
      releaseCore = onCoreReady
      await new Promise(resolve => { finishBackground = resolve })
      backgroundComplete = true
      return 0
    }, collectTvForProject: async () => { started.push('tv'); return 0 },
    updateCollection: noOp, tvCollectAttempts: { current: new Set() },
    setRecommendations: noOp, setRecommendationWindow: noOp, setRecommendationFor: noOp, setRecommendationError: noOp,
  })
  let complete = false
  const pending = add(main).then((value) => { complete = true; return value })
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual([...started].sort(), ['recommendations', 'tv', 'web'])
  assert.equal(complete, false, 'do not enter the dashboard before candidate preparation has settled')
  finishPreparation([])
  await Promise.resolve()
  assert.equal(complete, false, 'core source work must also settle before entering')
  releaseCore()
  const project = await pending
  assert.deepEqual(stateRef.current.competitors[project.id], [])
  assert.equal(backgroundComplete, false, 'dashboard is ready while Endata continues')
  finishBackground()
  await Promise.resolve()
  assert.equal(backgroundComplete, true)
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
    restoredProjectIds: { current: new Set() }, competitorIdentityAttempts: { current: new Set() },
    competitorCollectionAttempts: { current: new Set() }, clearCompetitorAttemptMarkers: () => {},
    recommendationCacheRef: { current: new Map([[main.id, { results: [prepared] }]]) },
    getDramaDetails: () => { throw new Error('unexpected network request') },
    makeProject: monitor.makeProject, sameDramaIdentity: monitor.sameDramaIdentity, sharedDimensions: monitor.sharedDimensions,
    commit: (update) => { stateRef.current = update(stateRef.current) }, appendLog: monitor.appendLog, setRecommendations() {},
  })
  await add(prepared)
  assert.equal(stateRef.current.competitors[main.id][0].title, '狂飙')
  assert.deepEqual(stateRef.current.competitors[main.id][0].cast, ['张译'])
})

function comparisonHarness(stateRef, collectProject, collectTvForProject, extra = {}) {
  const bindings = {
    stateRef, collectProject, collectTvForProject, comparisonResult, runSharedTask,
    comparisonTasksRef: { current: new Map() }, activeRef: { current: true },
    pageSuspendedRef: { current: false }, backgroundPausedRef: { current: false },
    competitorCollectionAttempts: { current: new Set() }, clearCompetitorAttemptMarkers() {},
    todayInShanghai: () => '2026-10-25', writeState() {}, readableError: error => error.message,
    competitorCollectionQueue: { current: createSerialTaskQueue() },
    commit: update => { stateRef.current = update(stateRef.current) }, ...extra,
  }
  const enqueueComparison = hookCallback('enqueueComparison', bindings)
  return { bindings, enqueueComparison, refresh: hookCallback('refreshSelected', {
    stateRef, appendActivity() {}, enqueueComparison, hasDimension: monitor.hasDimension,
  }) }
}
const comparable = id => ({ id, title: id, premiered: '2026-10-16', platforms: [{ dimension: 'web' }, { dimension: 'tv' }] })

test('manual refresh reads only four comparisons serially, retains main and continues after source failure', async () => {
  const main = comparable('main'), competitors = Array.from({ length: 4 }, (_, i) => comparable(`c${i}`))
  const original = [{ date: '2026-10-25', values: { 猫眼热度: 0 } }]
  const stateRef = { current: { projects: [main], selectedId: main.id, competitors: { main: competitors }, liveHeat: { main: original } } }
  const started = [], active = new Set()
  let maximum = 0
  const collect = dimension => async (item, ...args) => {
    assert.equal(args.at(-1), true)
    started.push(`${item.id}:${dimension}`); active.add(item.id); maximum = Math.max(maximum, active.size)
    await new Promise(resolve => setImmediate(resolve))
    if (dimension === 'tv') active.delete(item.id)
    if (item.id === 'c1') throw new Error('source unavailable')
    return 1
  }
  const { refresh } = comparisonHarness(stateRef, collect('web'), collect('tv'))
  assert.equal(await refresh(), 6)
  assert.equal(maximum, 1)
  assert.deepEqual(started, competitors.flatMap(({ id }) => [`${id}:web`, `${id}:tv`]))
  assert.equal(stateRef.current.liveHeat.main, original)
  assert.equal(stateRef.current.comparisonJobs.c1.state, 'partial')
})

test('manual refresh with no comparisons does not re-read an interrupted main', async () => {
  const main = comparable('main')
  const stateRef = { current: { projects: [main], selectedId: 'main', competitors: {}, collection: { main: { state: 'error' } } } }
  const fail = () => { throw new Error('unexpected read') }
  assert.equal(await comparisonHarness(stateRef, fail, fail).refresh(), 0)
})

test('interrupted comparison queue resumes all pending titles and deduplicates repeated enqueue', async () => {
  const main = comparable('main'), c0 = comparable('c0'), c1 = comparable('c1')
  const observed = [{ date: '2026-10-24', values: { 猫眼热度: 0 } }]
  const stateRef = { current: { projects: [main], selectedId: 'main', competitors: { main: [c0, c1] }, collection: {}, sourceSync: {}, liveHeat: { c0: observed } } }
  const paused = { current: false }, reads = []
  const first = comparisonHarness(stateRef, async p => { reads.push(p.id); paused.current = true; return 1 }, async () => 1, { pageSuspendedRef: paused })
  await Promise.all([first.enqueueComparison('main', c0, { web: true, tv: true }), first.enqueueComparison('main', c0, { web: true, tv: true }), first.enqueueComparison('main', c1, { web: true, tv: true })])
  assert.deepEqual(reads, ['c0'])
  stateRef.current = interruptRestoredCollections(stateRef.current)
  assert.ok([c0, c1].every(p => shouldResumeComparison(stateRef.current, p)))
  assert.equal(stateRef.current.liveHeat.c0, observed)
  const second = comparisonHarness(stateRef, async p => { reads.push(p.id); return 1 }, async () => 1)
  await Promise.all([c0, c1].map(p => second.enqueueComparison('main', p, { web: true, tv: true })))
  assert.deepEqual(reads, ['c0', 'c0', 'c1'])
  assert.ok([c0, c1].every(p => !shouldResumeComparison(stateRef.current, p)))
})

test('legacy restored comparisons resume missing and failed sources without asserting no data', () => {
  const p = comparable('x')
  assert.equal(shouldResumeComparison({ sourceSync: {} }, p), true)
  assert.equal(shouldResumeComparison({ sourceSync: { x: { maoyan: { state: 'error' } } } }, p), true)
  assert.equal(comparisonResult({ sourceSync: {} }, p, { web: true }), 'partial')
  assert.equal(shouldResumeComparison({ comparisonJobs: { x: { state: 'complete', steps: { tv: true } } } }, p), false)
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

function runComparisonEffect(bindings) {
  const source = readFileSync(new URL('../src/hooks/useDramaMonitor.js', import.meta.url), 'utf8')
  const marker = "    if (!hydrated || !selectedProject || !selectedCompetitors.length || backgroundPausedRef.current || pageSuspendedRef.current) return"
  const start = source.lastIndexOf('  useEffect(() => {', source.indexOf(marker))
  const end = source.indexOf('\n\n', source.indexOf('  }, [enqueueComparison', start))
  return new Function('useEffect', ...Object.keys(bindings), source.slice(start, end))((callback) => callback(), ...Object.values(bindings))
}

const webLabelled = id => ({ ...comparable(id), distribution: { firstRelease: 'web-first' }, platforms: [{ name: '爱奇艺', dimension: 'web' }], provider: 'catalog', primaryIdentitySource: { name: '猫眼' }, poster: '/poster.jpg' })
function comparisonEffectHarness(stateRef, { restored = false } = {}) {
  const calls = []
  const main = stateRef.current.projects[0]
  const competitors = stateRef.current.competitors[main.id]
  const bindings = {
    hydrated: true, selectedProject: main, selectedCompetitors: competitors, stateRef,
    backgroundPausedRef: { current: false }, pageSuspendedRef: { current: false },
    restoredProjectIds: { current: new Set(restored ? competitors.map(p => p.id) : []) },
    shouldResumeComparison, competitorIdentityAttempts: { current: new Set() },
    competitorCollectionAttempts: { current: new Set() }, collectingTvRef: { current: new Set() },
    refreshIdentity: async () => {}, todayInShanghai: () => '2026-10-25', resumeRevision: 0,
    hasDimension: monitor.hasDimension, shouldAutoCollectTvRatings: monitor.shouldAutoCollectTvRatings,
    PLATFORM_METRIC_PATTERN: /平台表现$/, EFFECTIVE_PLATFORM_METRIC_PATTERN: /有效播放$/,
    EFFECTIVE_CUMULATIVE_MAPPING_VERSION: 1, hasStoredMetric: () => false,
    enqueueComparison: async (mainId, project, options) => { calls.push({ mainId, id: project.id, ...options }) },
  }
  return { calls, bindings, run: () => runComparisonEffect(bindings) }
}

test('fresh web-labelled comparisons still probe TV without requiring a TV label on the main', () => {
  const main = webLabelled('main'), competitor = webLabelled('小城良方')
  const stateRef = { current: { ...monitor.createEmptyState(), projects: [main], selectedId: main.id, competitors: { main: [competitor] } } }
  const harness = comparisonEffectHarness(stateRef)
  harness.run()
  assert.deepEqual(harness.calls, [{ mainId: 'main', id: '小城良方', web: true, tv: true }])
  harness.run()
  assert.equal(harness.calls.length, 1, 're-renders must not enqueue another TV probe')
})

test('refresh probes web-labelled TV for every comparison while leaving the main untouched', async () => {
  const main = webLabelled('main'), competitor = webLabelled('小城良方')
  const stateRef = { current: { ...monitor.createEmptyState(), projects: [main], selectedId: main.id, competitors: { main: [competitor] } } }
  const reads = []
  await comparisonHarness(stateRef, async p => { reads.push(`${p.id}:web`); return 1 }, async p => { reads.push(`${p.id}:tv`); return 1 }).refresh()
  assert.deepEqual(reads, ['小城良方:web', '小城良方:tv'])
})

test('saved completed and partial web-only jobs receive one missing-TV repair without repeating web collection', () => {
  const main = webLabelled('main'), a = webLabelled('a'), b = webLabelled('b')
  const stateRef = { current: { ...monitor.createEmptyState(), projects: [main], selectedId: main.id, competitors: { main: [a,b] }, comparisonJobs: {
    a: { state: 'complete', steps: { web: true } }, b: { state: 'partial', steps: { web: true } },
  } } }
  const harness = comparisonEffectHarness(stateRef, { restored: true })
  harness.run()
  assert.deepEqual(harness.calls, [{ mainId:'main', id:'a', web:false, tv:true }, { mainId:'main', id:'b', web:false, tv:true }])
  harness.run()
  assert.equal(harness.calls.length, 2)
  for (const p of [a,b]) {
    stateRef.current.comparisonJobs[p.id] = { state: 'partial', steps: { web: true, tv: true } }
    stateRef.current.sourceSync[p.id] = { tvRatings: { state: 'error', complete: false } }
    assert.equal(shouldResumeComparison(stateRef.current, p), false, 'failed attempts stay failed until a manual retry')
  }
  const restoredAgain = comparisonEffectHarness(stateRef, { restored: true })
  restoredAgain.run()
  assert.equal(restoredAgain.calls.length, 0, 'reopening must not create endless automatic retries')
})


test('missing-TV repair preserves unresolved web status and verified TV empty is not retried', async () => {
  const main = webLabelled('main'), competitor = webLabelled('c')
  const stateRef = { current: { ...monitor.createEmptyState(), projects:[main], selectedId:main.id, competitors:{main:[competitor]}, comparisonJobs:{c:{state:'partial',steps:{web:true}}}, sourceSync:{c:{maoyan:{state:'error',complete:false},guduo:{state:'success'},ky:{state:'success'}}} } }
  let reads = 0
  const { enqueueComparison } = comparisonHarness(stateRef, () => { throw new Error('must not repeat web') }, async () => {
    reads++
    stateRef.current.sourceSync.c.tvRatings = {state:'empty',complete:true,verification:{verified:true}}
    return 0
  })
  await enqueueComparison('main', competitor, {web:false,tv:true})
  assert.equal(reads,1)
  assert.equal(stateRef.current.comparisonJobs.c.state,'partial')
  assert.equal(stateRef.current.sourceSync.c.maoyan.state,'error')
  assert.equal(shouldResumeComparison(stateRef.current,competitor),false)
  const restored = comparisonEffectHarness(stateRef,{restored:true})
  restored.run()
  assert.deepEqual(restored.calls,[])
})

test('TV-only repair retains earlier web step across interruption and checks its failures after resume', async () => {
  const main = webLabelled('main'), competitor = webLabelled('c')
  const stateRef = { current: { ...monitor.createEmptyState(), projects:[main], selectedId:main.id, competitors:{main:[competitor]}, comparisonJobs:{c:{state:'partial',steps:{web:true},from:competitor.premiered,to:'2026-10-25'}}, sourceSync:{c:{maoyan:{state:'error',complete:false},guduo:{state:'success'},ky:{state:'success'}}} } }
  const paused = {current:false}
  const failWeb = () => { throw new Error('must not repeat completed web step') }
  const first = comparisonHarness(stateRef, failWeb, async () => { paused.current=true; return 0 }, {pageSuspendedRef:paused})
  await first.enqueueComparison('main',competitor,{web:false,tv:true})
  assert.equal(stateRef.current.comparisonJobs.c.state,'interrupted')
  assert.equal(stateRef.current.comparisonJobs.c.steps.web,true)
  const second = comparisonHarness(stateRef, failWeb, async () => {
    stateRef.current.sourceSync.c.tvRatings={state:'empty',complete:true,verification:{verified:true}}
    return 0
  })
  await second.enqueueComparison('main',competitor,{web:true,tv:true})
  assert.equal(stateRef.current.comparisonJobs.c.state,'partial')
  assert.equal(stateRef.current.sourceSync.c.maoyan.state,'error')
  assert.deepEqual(stateRef.current.comparisonJobs.c.steps,{web:true,tv:true})
})
