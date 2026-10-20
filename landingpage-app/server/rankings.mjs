import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { chinaDate, rankingSources, supplementalRankingSources, readRanking } from './ranking-sources.mjs'

// The schedule is Asia/Shanghai 12:00, independent of the server's timezone.
export const rankingPeriod = (now = Date.now()) => chinaDate(Number(now) - 12 * 3_600_000)
const isCurrentRanking = (snapshot, today) => snapshot.dataDate === today || snapshot.dateBasis === 'current-observation' && snapshot.observedDate === today
export function rankingAgreement(first, later, today) {
  if (first.requestedDate !== later.requestedDate || first.dataDate !== later.dataDate || first.observedDate !== later.observedDate || first.dateBasis !== later.dateBasis || first.metric !== later.metric || first.rankOnly !== later.rankOnly || first.identityBasis !== later.identityBasis || first.sourceCategory !== later.sourceCategory || JSON.stringify(first.checkedDates) !== JSON.stringify(later.checkedDates) || first.rows.length !== later.rows.length) return false
  return first.rows.every((row, index) => {
    const other = later.rows[index]
    for (const key of ['id', 'title', 'rank', 'unit', 'poster', 'url', 'director', 'actors', 'vid']) if (row[key] !== other[key]) return false
    if (row.value === null || other.value === null) return row.value === other.value
    if (!isCurrentRanking(first, today) || row.value === 0) return row.value === other.value
    return Math.abs(other.value - row.value) / Math.abs(row.value) < 0.01
  })
}

export async function verifyRanking(source, date, reader = readRanking) {
  const started = Date.now()
  const stamp = result => ({ ...result, startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), elapsedMs: Date.now() - started })
  const candidates = []
  const failures = []
  for (let pass = 1; pass <= 3; pass += 1) {
    try {
      const result = await reader(source, date)
      if (!Array.isArray(result.rows) || result.rows.some(row => !row.id || !row.title || !Number.isInteger(row.rank) || row.rank < 1 || row.rank > source.limit || !(row.value === null || (Number.isFinite(row.value) && row.value >= 0)))) throw new Error('榜单条目结构无效')
      if (new Set(result.rows.map(row => row.id)).size !== result.rows.length || new Set(result.rows.map(row => row.rank)).size !== result.rows.length) throw new Error('榜单包含重复身份或排名')
      candidates.push({ ...result, pass })
      if (candidates.length >= 2) {
        // Today's values always compare to the FIRST successful snapshot;
        // historical reads may use a strict two-of-three majority.
        const baseline = isCurrentRanking(result, date) ? candidates[0] : candidates.slice(0, -1).find(item => rankingAgreement(item, result, date))
        if (baseline !== result && baseline && rankingAgreement(baseline, result, date)) return stamp({ ...baseline, status: baseline.rows.length === 0 ? 'empty' : baseline.rows.length === source.limit && !baseline.partialReason ? 'verified' : 'partial', passCount: pass, candidates, failures })
      }
    } catch (error) { failures.push({ pass, at: new Date().toISOString(), message: error.message, sourceUrl: error.sourceUrl || source.url, audit: error.audit || [] }) }
  }
  // Preserve individual rows that reached consensus even when the whole list
  // did not. A changed rank/identity cannot borrow a value from another row.
  const verifiedRows = new Map()
  for (const candidate of candidates) {
    for (const row of candidate.rows) {
      if (verifiedRows.has(row.rank)) continue
      const firstAtRank = candidates.find(item => item.rows.some(value => value.rank === row.rank))
      if (isCurrentRanking(candidate, date) && candidate !== firstAtRank) continue
      const match = candidates.find(other => other !== candidate && rankingAgreement({ ...candidate, rows: [row] }, { ...other, rows: other.rows.filter(value => value.rank === row.rank) }, date))
      if (match) verifiedRows.set(row.rank, { row, candidate })
    }
  }
  if (verifiedRows.size) {
    const baseline = verifiedRows.values().next().value.candidate
    const rows = [...verifiedRows.values()].filter(item => item.candidate.dataDate === baseline.dataDate).map(item => item.row).sort((a, b) => a.rank - b.rank)
    return stamp({ ...baseline, rows, ...(baseline.returnedRanks ? { returnedRanks: rows.map(row => row.rank) } : {}), status: 'partial', partialReason: '部分名次或数值未达两次读取共识，仅保留已核验条目', passCount: candidates.length + failures.length, candidates, failures })
  }
  return stamp({ status: candidates.length ? 'unresolved' : 'unavailable', rows: [], dataDate: null, requestedDate: date, passCount: candidates.length + failures.length, candidates, failures })
}

export function createRankingsService({ directory, now = Date.now, reader = readRanking } = {}) {
  let state = { version: 1, boards: {}, period: null, attempts: 0, lastAttemptAt: null }
  let running = null
  let timer
  const ready = readFile(join(directory, 'current.json'), 'utf8').then(text => {
    const saved = JSON.parse(text)
    if (saved.version === 1 && saved.boards && typeof saved.boards === 'object') state = saved
  }).catch(error => { if (error.code !== 'ENOENT') console.warn('Rankings cache could not be read:', error.message) })
  const view = () => ({ schedule: '每日 12:00（北京时间）', boards: rankingSources.map(source => {
    const board = state.boards[source.id] || { status: 'pending', rows: [], dataDate: null, requestedDate: null }
    const freshPeriod = rankingPeriod(now())
    const stale = Boolean(board.rows.length && (board.period !== freshPeriod || board.lastAttemptStatus && !['verified', 'partial', 'empty'].includes(board.lastAttemptStatus)))
    const publicBoard = { ...source, ...board, stale, candidates: undefined, audit: undefined, failures: undefined }
    if (source.id === 'youku') {
      const heatSource = supplementalRankingSources.find(item => item.id === 'youku-heat-reference')
      const heatBoard = state.boards[heatSource.id] || { status: 'pending', rows: [], requestedDate: null }
      const heatStale = Boolean(heatBoard.rows.length && (heatBoard.period !== freshPeriod || heatBoard.lastAttemptStatus && !['verified', 'partial', 'empty'].includes(heatBoard.lastAttemptStatus)))
      publicBoard.heatReference = {
        name: heatSource.name, title: heatSource.title, metric: '当前热度', url: heatSource.url,
        status: heatBoard.status, stale: heatStale, requestedDate: heatBoard.requestedDate,
        observedDate: heatBoard.observedDate, passCount: heatBoard.passCount || 0,
        rows: heatBoard.rows || [], partialReason: heatBoard.partialReason || '',
        lastAttemptAt: heatBoard.lastAttemptAt || heatBoard.finishedAt || null,
      }
    }
    return publicBoard
  }) })
  async function run() {
    await ready
    await mkdir(directory, { recursive: true })
    let lock
    const lockPath = join(directory, 'update.lock')
    try { lock = await open(lockPath, 'wx') } catch (error) {
      if (error.code !== 'EEXIST') throw error
      // A terminated process may leave a lock behind. Never remove a lock
      // belonging to a live or recently starting updater.
      const owner = await readFile(lockPath, 'utf8').then(JSON.parse).catch(() => null)
      let alive = true
      if (Number.isInteger(owner?.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0) } catch (cause) { alive = cause.code !== 'ESRCH' }
      }
      if (alive || !owner || now() - owner.at < 120_000) return { skipped: 'locked' }
      await unlink(lockPath)
      try { lock = await open(lockPath, 'wx') } catch (cause) { if (cause.code === 'EEXIST') return { skipped: 'locked' }; throw cause }
    }
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, at: now() }))
      const date = chinaDate(now())
      const period = rankingPeriod(now())
      const sources = [...rankingSources, ...supplementalRankingSources]
      const results = await Promise.all(sources.map(async source => [source.id, await verifyRanking(source, date, reader)]))
      const boards = { ...state.boards }
      for (const [id, result] of results) {
        const prior = boards[id]
        const valid = ['verified', 'partial', 'empty'].includes(result.status)
        boards[id] = valid || !prior?.rows?.length ? { ...result, period } : { ...prior, lastAttemptStatus: result.status, lastAttemptAt: new Date(now()).toISOString(), lastAttemptFailures: result.failures }
      }
      const samePeriod = state.period === period && state.lastAttemptAt !== null && rankingPeriod(state.lastAttemptAt) === period
      const next = { version: 1, boards, period, attempts: samePeriod ? state.attempts + 1 : 1, lastAttemptAt: now() }
      // Persist full independent-read candidates for source traceability. The
      // public API strips these large internal audit records.
      const temporary = join(directory, 'current.json.tmp')
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 })
      await rename(temporary, join(directory, 'current.json'))
      state = next
      return view()
    } finally { await lock.close(); await unlink(join(directory, 'update.lock')).catch(() => {}) }
  }
  const update = () => running || (running = run().finally(() => { running = null }))
  const tick = async () => {
    await ready
    const sources = [...rankingSources, ...supplementalRankingSources]
    const missingSource = sources.some(source => !state.boards[source.id])
    const due = missingSource || state.period !== rankingPeriod(now()) || state.lastAttemptAt !== null && rankingPeriod(state.lastAttemptAt) !== rankingPeriod(now()) || (state.attempts < 3 && now() - state.lastAttemptAt >= 15 * 60_000 && Object.values(state.boards).some(board => !['verified', 'empty'].includes(board.lastAttemptStatus || board.status)))
    if (due) await update()
  }
  return {
    read: async () => { await ready; return view() }, update, refreshIfDue: tick,
    start() { const check = () => tick().catch(error => console.warn('Rankings update failed:', error.message)); void check(); timer = setInterval(check, 60_000); timer.unref() },
    stop() { clearInterval(timer) },
  }
}
