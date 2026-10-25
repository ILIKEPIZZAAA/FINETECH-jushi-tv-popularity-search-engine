import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MAX_COMPARABLE_COMPETITORS,
  DAILY_HISTORY_VERIFICATION_VERSION,
  appendLog,
  combinedSourceStatus,
  createEmptyState,
  dedupeTvRecords,
  hasDimension,
  guduoHistoryPageRanges,
  guduoHistoryResumeFrom,
  isoDatesInRange,
  isConfirmedNoDataDate,
  kyHistoryWindow,
  makeProject,
  mergeMetricHistory,
  normalizeProject,
  parseChineseCount,
  platformDisplayName,
  replaceVerifiedSourceHistory,
  safeReadState,
  sameDramaIdentity,
  sharedDimensions,
  sourceHistoryRefreshNeeds,
  shouldAutoCollectTvRatings,
  shouldRefreshMaoyanHistory,
  sourceStatusClass,
  tvCollectionStatus,
  todayInShanghai,
  writeState,
  withVerifiedTvAvailability,
} from '../lib/dramaMonitor.js'
import { runSharedTask, createSerialTaskQueue } from '../lib/sharedTask.js'
import { foregroundCollection, settleCollectionPhases } from '../lib/collectionPhases.js'
import { clearCompetitorAttemptMarkers } from '../lib/competitorCollection.js'
import { shouldResumeComparison, comparisonResult } from '../lib/comparisonJobs.js'
import { EFFECTIVE_PLAYBACK_MAPPING_VERSION, effectivePlaybackSourceMetrics, mapEffectivePlayback } from '../lib/effectivePlayback.js'
import { mapMaoyanPlatformRows } from '../lib/maoyanMetrics.js'
import { maoyanHistoryNumericValues } from '../lib/maoyanHistoryValues.js'
import { createDramaApiSession } from '../lib/dramaApi.js'
import { consolidateSearchResults } from '../lib/searchResults.js'
import { prepareRecommendedCandidates } from '../lib/recommendationPreparation.js'
import { preloadDramaPosters } from '../lib/posterPreload.js'
import { createRawDataExportTask, generateWorkbookInWorker, saveRawDataFile } from '../lib/rawDataExport.js'
import { interruptRestoredCollections, readDashboardSession, saveDashboardSession } from '../lib/dashboardSession.js'
import { ENDATA_ENABLED, endataDimensions, endataVerifiedDates, mapEndataObservations, mergeEndataVerification, preserveEndataObservedHistory } from '../lib/endataMetrics.js'

const MAOYAN_HISTORY_METRIC = '猫眼全网曝光'
const GUDUO_HISTORY_PAGE_DAYS = 7
const EFFECTIVE_CUMULATIVE_MAPPING_VERSION = EFFECTIVE_PLAYBACK_MAPPING_VERSION
const PLATFORM_METRIC_PATTERN = /^(优酷|爱奇艺|腾讯视频|芒果TV)平台表现$/
const EFFECTIVE_PLATFORM_METRIC_PATTERN = /^(优酷|爱奇艺|腾讯视频|芒果TV|平台量|平台播放量)有效播放$/

function maoyanMetricSyncPatch(result) {
  return {
    ...(result.effectiveCumulativeChecked ? { effectiveSummary: result.effectiveSummary || null } : {}),
    ...(result.platformFetchedAt ? { platformFetchedAt: result.platformFetchedAt } : {}),
    ...(result.effectiveFetchedAt ? { effectiveFetchedAt: result.effectiveFetchedAt } : {}),
    ...(result.effectiveCumulativeChecked ? {
      effectiveCumulativeMappingVersion: EFFECTIVE_CUMULATIVE_MAPPING_VERSION,
      effectiveCumulativePlatforms: result.effectiveCumulativePlatforms,
      effectiveHeadline: result.effectiveHeadline,
      effectiveLatestDate: result.effectiveLatestDate,
    } : {}),
    ...(Object.keys(result.availabilityByMetric || {}).length ? { metricAvailability: { ...(result.previousMetricAvailability || {}), ...result.availabilityByMetric } } : {}),
    ...(Object.keys(result.verificationByMetric || {}).length ? { metricVerification: { ...(result.previousMetricVerification || {}), ...result.verificationByMetric } } : {}),
  }
}

function addIsoDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function hasStoredMetric(records, metric) {
  return records.some((record) => {
    const value = record?.values?.[metric]
    return value !== null && value !== undefined && Number.isFinite(Number(value))
  })
}

function metricPlatformName(value) {
  const normalized = platformDisplayName(value)
  return /^(平台量|平台播放量)$/.test(normalized) ? '芒果TV' : normalized
}

function expectedWebPlatforms(project) {
  return new Set((project?.platforms || [])
    .filter((platform) => !platform?.dimension || platform.dimension === 'web')
    .map((platform) => metricPlatformName(platform?.name || platform))
    .filter((platform) => /^(优酷|爱奇艺|腾讯视频|芒果TV)$/.test(platform)))
}

function detailProject(project, details) {
  return withVerifiedTvAvailability(makeProject({
    ...details,
    id: project.id,
    title: project.title || details.title,
    contentType: project.contentType || details.contentType || 'drama',
    createdAt: project.createdAt,
    maoyanSeriesId: project.maoyanSeriesId || details.maoyanSeriesId,
  }), (project.platforms || []).filter((platform) => platform?.dimension === 'tv' && platform?.verified === true))
}

function sourceName(source) {
  return ({ guduo: '骨朵', maoyan: '猫眼', ky: '酷云', endata: '艺恩', tvRatings: '台端收视' })[source] || source
}

export { buildRawDataWorkbook, buildRawDataXlsx } from '../lib/rawDataWorkbook.js'

function readableError(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback
}

function maoyanMetricAvailability(payload) {
  if (payload.error || payload.availability === 'error') return 'error'
  if (payload.verification?.verified !== true) return 'unverified'
  if (payload.availability === 'not-published') return 'not-published'
  return payload.availability === 'available' || payload.series?.length ? 'available' : 'unverified'
}

export function useDramaMonitor() {
  const activeRef = useRef(true)
  const backgroundPausedRef = useRef(Boolean(readDashboardSession().backgroundPaused))
  const pageSuspendedRef = useRef(false)
  const [resumeRevision, setResumeRevision] = useState(0)
  const apiRef = useRef(null)
  const { collectCross, collectGuduoHistory, collectEndataHistory, collectKyHistory, collectMaoyanHistory, collectMaoyanMetric, readTvRatings, getDramaDetails, recommendDramas, searchDramas } = useMemo(() => {
    const names = ['collectCross', 'collectGuduoHistory', 'collectEndataHistory', 'collectKyHistory', 'collectMaoyanHistory', 'collectMaoyanMetric', 'readTvRatings', 'getDramaDetails', 'recommendDramas', 'searchDramas']
    return Object.fromEntries(names.map((name) => [name, (...args) => {
      if (!activeRef.current || pageSuspendedRef.current) return Promise.reject(new DOMException('本次会话已结束', 'AbortError'))
      if (backgroundPausedRef.current && !['recommendDramas', 'searchDramas', 'getDramaDetails'].includes(name)) return Promise.reject(new DOMException('后台连接已暂停，已保留看板数据；点击刷新数据可重新核验。', 'AbortError'))
      if (!apiRef.current || apiRef.current.aborted) apiRef.current = createDramaApiSession()
      return apiRef.current[name](...args)
    }]))
  }, [])
  const exportController = useRef(null)
  const exportTask = useRef(null)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [projectState, setProjectState] = useState(createEmptyState)
  const [hydrated, setHydrated] = useState(false)
  const [storageWarning, setStorageWarning] = useState(false)
  const [collectingProjectIds, setCollectingProjectIds] = useState({})
  const [collectingTvRatingsById, setCollectingTvRatingsById] = useState({})
  const [recommendations, setRecommendations] = useState([])
  const [recommendationWindow, setRecommendationWindow] = useState(null)
  const [recommendationFor, setRecommendationFor] = useState('')
  const [recommendationLoading, setRecommendationLoading] = useState(false)
  const [recommendationError, setRecommendationError] = useState('')

  const stateRef = useRef(projectState)
  const autoCollectAttempts = useRef(new Set())
  const tvCollectAttempts = useRef(new Set())
  const collectingProjectRef = useRef(new Set())
  const collectingTvRef = useRef(new Set())
  const collectingProjectTasksRef = useRef(new Map())
  const collectingTvTasksRef = useRef(new Map())
  const endataTasksRef = useRef(new Map())
  const maoyanHistoryInFlight = useRef(new Set())
  const identityRefreshAttempts = useRef(new Set())
  const competitorIdentityAttempts = useRef(new Set())
  const competitorCollectionAttempts = useRef(new Set())
  const kyMigrationAttempts = useRef(new Set())
  const comparisonTasksRef = useRef(new Map())
  const competitorAddQueue = useRef(createSerialTaskQueue())
  const competitorCollectionQueue = useRef(createSerialTaskQueue())
  const recommendationRequestRef = useRef(null)
  const recommendationCacheRef = useRef(new Map())
  const restoredProjectIds = useRef(new Set())
  const restoredSession = useRef(false)

  const endSession = useCallback(() => {
    activeRef.current = false
    apiRef.current?.abort()
    exportController.current?.abort()
  }, [])

  const commit = useCallback((updater) => {
    if (!activeRef.current) return
    const next = updater(stateRef.current)
    stateRef.current = next
    setProjectState(next)
  }, [])

  const pauseBackground = useCallback(() => {
    if (!activeRef.current || backgroundPausedRef.current) return
    backgroundPausedRef.current = true
    saveDashboardSession({ backgroundPaused: true })
    apiRef.current?.abort()
    // Keep all observations, source candidates and the selected view. Only
    // unfinished reads lose their loading status; they have not been verified.
    commit((current) => interruptRestoredCollections(current))
  }, [commit])

  const resumeBackground = useCallback(async () => {
    if (!activeRef.current || !backgroundPausedRef.current) return
    // Drain aborted source work before an explicit refresh can create a fresh
    // session. This prevents a late stage of an old job from reconnecting.
    await Promise.allSettled([
      ...collectingProjectTasksRef.current.values(),
      ...collectingTvTasksRef.current.values(),
      ...endataTasksRef.current.values(),
      competitorCollectionQueue.current(async () => {}),
      competitorAddQueue.current(async () => {}),
    ])
    if (!activeRef.current) return
    backgroundPausedRef.current = false
    competitorCollectionAttempts.current.clear()
    setResumeRevision(value => value + 1)
    saveDashboardSession({ backgroundPaused: false, lastActivityAt: Date.now() })
  }, [])

  useEffect(() => {
    activeRef.current = true
    apiRef.current = createDramaApiSession()
    const restored = interruptRestoredCollections(safeReadState())
    restoredSession.current = Boolean(restored.selectedId)
    restoredProjectIds.current = new Set([...restored.projects, ...Object.values(restored.competitors).flat()].map(project => project.id))
    stateRef.current = restored
    setProjectState(restored)
    setHydrated(true)
    return endSession
  }, [endSession])

  useEffect(() => {
    const suspend = () => {
      pageSuspendedRef.current = true
      const interrupted = interruptRestoredCollections(stateRef.current)
      commit(() => interrupted)
      writeState(interrupted)
      apiRef.current?.abort()
    }
    const resume = async () => {
      if (!pageSuspendedRef.current) return
      await competitorCollectionQueue.current(async () => {})
      if (!activeRef.current) return
      pageSuspendedRef.current = false
      competitorCollectionAttempts.current.clear()
      setResumeRevision(value => value + 1)
    }
    window.addEventListener('pagehide', suspend)
    window.addEventListener('pageshow', resume)
    return () => {
      window.removeEventListener('pagehide', suspend)
      window.removeEventListener('pageshow', resume)
    }
  }, [commit])

  useEffect(() => {
    if (hydrated) setStorageWarning(!writeState(projectState))
  }, [hydrated, projectState])

  const selectedProject = useMemo(
    () => projectState.projects.find((project) => project.id === projectState.selectedId) || null,
    [projectState.projects, projectState.selectedId],
  )
  const selectedCompetitors = useMemo(
    () => selectedProject ? projectState.competitors[selectedProject.id] || [] : [],
    [projectState.competitors, selectedProject],
  )

  const search = useCallback(async (query, options = {}) => {
    const payload = await searchDramas(query, options)
    const results = consolidateSearchResults(Array.isArray(payload.results) ? payload.results : [], query)
    void preloadDramaPosters(results.slice(0, 6))
    return results
  }, [searchDramas])

  const appendActivity = useCallback((source, message, level = 'info') => {
    commit((current) => appendLog(current, source, message, level))
  }, [commit])

  const updateSourceSync = useCallback((projectId, source, patch, { silent = false } = {}) => {
    commit((current) => {
      const next = {
        ...current,
        sourceSync: {
          ...current.sourceSync,
          [projectId]: {
            ...(current.sourceSync[projectId] || {}),
            [source]: { ...(current.sourceSync[projectId]?.[source] || {}), ...patch },
          },
        },
      }
      const level = patch.state === 'error' ? 'error' : patch.state === 'success' ? 'success' : 'info'
      return silent ? next : appendLog(next, sourceName(source), patch.message || '采集状态已更新', level)
    })
  }, [commit])

  const updateCollection = useCallback((projectId, patch) => {
    commit((current) => {
      const next = {
        ...current,
        collection: { ...current.collection, [projectId]: { ...(current.collection[projectId] || {}), ...patch } },
      }
      return appendLog(next, '网端热度', patch.message || '网端采集状态已更新', patch.state === 'error' ? 'error' : patch.state === 'success' ? 'success' : 'info')
    })
  }, [commit])

  const mergeLiveHeat = useCallback((projectId, incoming) => {
    commit((current) => ({
      ...current,
      liveHeat: { ...current.liveHeat, [projectId]: mergeMetricHistory(current.liveHeat[projectId] || [], incoming) },
    }))
  }, [commit])

  const rememberMaoyanSeriesId = useCallback((projectId, seriesId) => {
    const numeric = Number(seriesId)
    if (!Number.isInteger(numeric) || numeric <= 0) return
    commit((current) => {
      const merge = (project) => project.id === projectId ? { ...project, maoyanSeriesId: numeric } : project
      return {
        ...current,
        projects: current.projects.map(merge),
        competitors: Object.fromEntries(Object.entries(current.competitors).map(([ownerId, pool]) => [ownerId, (pool || []).map(merge)])),
      }
    })
  }, [commit])

  const replaceProject = useCallback((project) => {
    const normalized = normalizeProject(project)
    if (!normalized) return
    commit((current) => {
      const merge = (item) => item.id === normalized.id ? withVerifiedTvAvailability(normalized, current.tvRatings[normalized.id]) : item
      return {
        ...current,
        projects: current.projects.map(merge),
        competitors: Object.fromEntries(Object.entries(current.competitors).map(([ownerId, pool]) => [ownerId, (pool || []).map(merge)])),
      }
    })
  }, [commit])

  const resolvePremiereForHistory = useCallback(async (project) => {
    if (project?.premiered) return project.premiered
    try {
      const payload = await getDramaDetails(project)
      const details = payload.result
      if (!details?.premiered) return null
      replaceProject(detailProject(project, details))
      return details.premiered
    } catch {
      return null
    }
  }, [replaceProject])

  const collectTvForProject = useCallback((project, quiet = false, reportProgress = null) => runSharedTask(collectingTvTasksRef.current, project?.id, async () => {
    if (!project || backgroundPausedRef.current) return 0
    reportProgress?.({ source: '台端数据', detail: { state: 'loading', updatedAt: new Date().toISOString() }, message: '台端收视数据抓取中' })
    collectingTvRef.current.add(project.id)
    setCollectingTvRatingsById((current) => ({ ...current, [project.id]: true }))
    const existingRows = stateRef.current.tvRatings[project.id] || []
    updateSourceSync(project.id, 'tvRatings', {
      state: 'loading',
      message: '正在读取公开逐日收视表',
      fetchedAt: new Date().toISOString(),
      count: existingRows.length,
    })
    try {
      const premiere = await resolvePremiereForHistory(project)
      const today = todayInShanghai()
      if (!premiere) throw new Error('缺少已确认首播日期，无法核验台端首播至今天的逐日数据')
      const fetchRows = async () => {
        const payload = await readTvRatings({ ...project, premiered: premiere })
        const source = payload.result || {}
        const rows = source.series || source.data?.series || source.result?.series || []
        const seriesId = source.seriesId || source.data?.seriesId || payload.result?.seriesId
        if (seriesId) rememberMaoyanSeriesId(project.id, seriesId)
        return {
          rows: Array.isArray(rows) ? rows : [],
          skippedChannels: Array.isArray(source.skippedChannels) ? [...new Set(source.skippedChannels.filter(Boolean))] : [],
          verification: source.verification || source.data?.verification || payload.verification || null,
        }
      }
      const result = await fetchRows()
      const verification = result.verification
      if (verification?.version !== DAILY_HISTORY_VERIFICATION_VERSION
        || verification?.verified !== true
        || verification?.from !== premiere
        || verification?.to !== today) {
        throw new Error(verification?.message || '台端逐日数据没有通过首播至今天的双轮核验')
      }
      const { rows, skippedChannels } = result
      const normalized = dedupeTvRecords(rows)
      const outOfRangeRows = existingRows.filter((row) => row.date < premiere || row.date > today)
      commit((current) => {
        const enrich = (item) => item.id === project.id ? withVerifiedTvAvailability(item, normalized) : item
        return {
          ...current,
          projects: current.projects.map(enrich),
          competitors: Object.fromEntries(Object.entries(current.competitors).map(([ownerId, pool]) => [ownerId, (pool || []).map(enrich)])),
          tvRatings: { ...current.tvRatings, [project.id]: dedupeTvRecords([...outOfRangeRows, ...normalized]) },
        }
      })
      const status = tvCollectionStatus(normalized.length, skippedChannels)
      const complete = skippedChannels.length === 0
      const dates = normalized.map((row) => row.date).sort()
      updateSourceSync(project.id, 'tvRatings', {
        ...status,
        state: complete ? status.state : 'partial',
        message: `${status.message}；首播至今天核验 ${verification.checkedDates?.length || 0} 天，${verification.noDataDates?.length || 0} 天无记录${complete ? '' : '；来源覆盖不完整，待重试'}`,
        fetchedAt: new Date().toISOString(),
        count: normalized.length,
        firstDate: dates[0],
        lastDate: dates.at(-1),
        complete,
        verification: { ...verification, verified: complete, state: complete ? 'verified' : 'incomplete', from: premiere, to: today },
      })
      reportProgress?.({ source: '台端数据', detail: {
        state: complete ? 'complete' : 'incomplete',
        checkedDays: verification.checkedDates?.length || 0,
        totalDays: isoDatesInRange(premiere, today).length,
        error: complete ? null : '存在未覆盖频道', updatedAt: new Date().toISOString(),
      }, message: complete ? `台端完成双轮核验，收到 ${normalized.length} 条记录` : '台端数据存在未覆盖频道，已提示并安排重试' })
      return complete ? normalized.length : 0
    } catch (error) {
      reportProgress?.({ source: '台端数据', detail: { state: 'failed', error: readableError(error, '台端收视率采集失败'), updatedAt: new Date().toISOString() } })
      updateSourceSync(project.id, 'tvRatings', { state: 'error', message: readableError(error, '台端收视率采集失败'), fetchedAt: new Date().toISOString(), count: existingRows.length, complete: false })
      reportProgress?.({ message: '台端抓取遇到异常，已记录来源状态' })
      return 0
    } finally {
      collectingTvRef.current.delete(project.id)
      setCollectingTvRatingsById((current) => {
        const next = { ...current }
        delete next[project.id]
        return next
      })
    }
  }), [commit, rememberMaoyanSeriesId, resolvePremiereForHistory, updateSourceSync])

  const backfillEndataHistory = useCallback((project, reportProgress = null) => runSharedTask(endataTasksRef.current, project?.id, async () => {
    if (!ENDATA_ENABLED) return 0
    const premiere = await resolvePremiereForHistory(project)
    if (!premiere || premiere > todayInShanghai()) {
      updateSourceSync(project.id, 'endata', { state: 'partial', message: '需要确认首播日期后读取艺恩历史', complete: false })
      return 0
    }
    const previous = stateRef.current.sourceSync[project.id]?.endata
    const to = todayInShanghai(), dates = isoDatesInRange(premiere, to)
    // Recheck the calendar-ordered stop boundary from the confirmed premiere.
    // A saved inferred tail alone cannot justify extending the policy window.
    const from = premiere
    updateSourceSync(project.id, 'endata', { state: 'loading', complete: false, requestedFrom: from, requestedTo: to, message: '艺恩七项指标后台逐日双轮核验中' })
    try {
      const result = await collectEndataHistory({ ...project, premiered: premiere }, from, to, detail => {
        updateSourceSync(project.id, 'endata', { progress: detail }, { silent: true })
        reportProgress?.({ source: '艺恩历史', detail })
      })
      if (previous?.sourceId && result.sourceId && String(previous.sourceId) !== String(result.sourceId)) throw new Error('艺恩源 ID 与已保存数据不同，需重新确认身份')
      const verification = preserveEndataObservedHistory(mergeEndataVerification(previous?.verification, result.verification, premiere, to, dates), stateRef.current.liveHeat[project.id] || [])
      const records = mapEndataObservations(result.series, result.fetchedAt)
      const checkedDates = new Set(endataVerifiedDates(verification))
      // Replace only confirmed dates; an unfinished/failed read cannot erase saved history.
      commit(state => ({ ...state, liveHeat: { ...state.liveHeat, [project.id]: mergeMetricHistory(
        (state.liveHeat[project.id] || []).map(row => checkedDates.has(row.date) ? { ...row, values: Object.fromEntries(Object.entries(row.values || {}).filter(([name]) => !endataDimensions.some(item => item.metric === name))) } : row), records,
      ) } }))
      const inferredDays = verification?.inferredNoDataDates?.length || 0
      const message = verification.inferenceConflicts?.length
        ? `艺恩按连续15天空值停止；${verification.inferenceConflicts.length} 天已有实测值与推定结果冲突，已保留原值并标为待复核`
        : verification?.termination?.reason === '15-consecutive-empty-after-hit'
        ? `艺恩实际核查 ${verification.observedDates?.length || 0} 天；命中后连续15天成功空值，于 ${verification.termination.date} 停止；后续 ${inferredDays} 天按规则推定无数据${verification.verified ? '' : '；另有日期待核查'}`
        : verification?.termination?.reason === '50-day-unmatched-probe'
          ? `艺恩前50天未命中有效指标，已停止本轮探测；后续 ${result.uncheckedDates?.length || 0} 天未检查，节目身份与失败日期保持待核查`
          : verification?.verified ? `艺恩 ${records.length} 天通过双轮核验` : '艺恩已保存通过核验的值；未发布、失败或未收敛日期保持待核查'
      updateSourceSync(project.id, 'endata', { state: verification?.verified ? records.length ? 'success' : 'empty' : 'partial', contentType: project.contentType || 'drama', sourceId: result.sourceId, sourceUrl: result.sourceUrl, fetchedAt: result.fetchedAt, complete: verification?.verified === true, count: records.length, coverage: result.coverage, verification, failedDates: result.failedDates || [], message })
      reportProgress?.({ source: '艺恩历史', detail: { state: verification?.verified ? 'complete' : 'incomplete', checkedDays: checkedDates.size, updatedAt: new Date().toISOString() } })
      return records.length
    } catch (error) {
      updateSourceSync(project.id, 'endata', { state: 'error', complete: false, message: readableError(error, '艺恩读取失败'), fetchedAt: new Date().toISOString() })
      reportProgress?.({ source: '艺恩历史', detail: { kind: 'endata', state: 'failed', error: readableError(error, '艺恩读取失败') } })
      return 0
    }
  }), [collectEndataHistory, commit, resolvePremiereForHistory, updateSourceSync])

  const backfillGuduoHistory = useCallback(async (project, forceRecent = false, reportProgress = null) => {
    if (!project) return 0
    const premiere = await resolvePremiereForHistory(project)
    if (!premiere) {
      updateSourceSync(project.id, 'guduo', { state: 'empty', message: '缺少首播日期，无法确定历史回填范围', fetchedAt: new Date().toISOString(), count: 0 })
      return 0
    }
    const today = todayInShanghai()
    const historyEnd = today
    if (premiere > today) {
      updateSourceSync(project.id, 'guduo', { state: 'empty', message: '首播日期晚于今天，暂无历史日期可抓取', fetchedAt: new Date().toISOString(), count: 0 })
      return 0
    }
    const current = stateRef.current
    const existingGuduoRecords = (current.liveHeat[project.id] || []).filter((row) => ['骨朵热度', '骨朵热度排名'].some((metric) => row.values?.[metric] !== null && row.values?.[metric] !== undefined))
    const existingDates = new Set(existingGuduoRecords.map((row) => row.date))
    const hasStoredRank = existingGuduoRecords.some((row) => Number.isFinite(Number(row.values?.['骨朵热度排名'])))
    const previous = current.sourceSync[project.id]?.guduo
    const contentType = project.contentType || 'drama'
    const categoryChanged = (previous?.contentType || 'drama') !== contentType
    const needsRankBackfill = existingDates.size > 0 && !hasStoredRank && previous?.rankAvailable !== false
    const legacyCoverage = categoryChanged || previous?.verification?.version !== DAILY_HISTORY_VERIFICATION_VERSION
    const previousRangeEnd = previous?.verification?.to || ''
    const newlyExtendedRange = previousRangeEnd !== historyEnd
    const storedResumeFrom = legacyCoverage || newlyExtendedRange || forceRecent
      ? premiere
      : guduoHistoryResumeFrom(premiere, historyEnd, previous, needsRankBackfill)
    const resumeFrom = forceRecent
      ? premiere
      : storedResumeFrom
    if (!resumeFrom) {
      if (previous?.verification?.termination?.reason === '50-day-unmatched-probe') return 0
      if (!['success', 'empty'].includes(previous?.state)) updateSourceSync(project.id, 'guduo', { state: 'success', message: '首播至今天的骨朵历史逐日核验已完整覆盖，跳过重复抓取', fetchedAt: previous.fetchedAt || new Date().toISOString(), count: existingDates.size, complete: true })
      return 0
    }
    let cursor = resumeFrom
    let contiguousThrough = cursor > premiere ? addIsoDays(cursor, -1) : addIsoDays(premiere, -1)
    let firstFailedFrom = ''
    let attemptedDates = 0
    const history = new Map()
    const finalHitDates = new Set(existingDates)
    const failedDates = []
    const verifiedDates = new Set()
    const noDataDates = new Set()
    const gapDates = new Set()
    const unresolvedDates = new Set()
    const reusablePriorDates = legacyCoverage ? [] : previous?.verification?.checkedDates || []
    for (const date of reusablePriorDates) {
      if (date >= premiere && date < resumeFrom && date <= historyEnd) verifiedDates.add(date)
    }
    const reusablePriorNoData = legacyCoverage ? [] : previous?.verification?.noDataDates || []
    for (const date of reusablePriorNoData) {
      if (date >= premiere && date < resumeFrom && date <= historyEnd) noDataDates.add(date)
    }
    let verificationPasses = legacyCoverage ? 0 : Number(previous?.verification?.passes) || 0
    let continuity = { hadData: resumeFrom > premiere && existingGuduoRecords.some((row) => row.date < resumeFrom), emptyStreak: 0 }
    if (continuity.hadData) for (let date = addIsoDays(resumeFrom, -1); date >= premiere && noDataDates.has(date) && continuity.emptyStreak < 14; date = addIsoDays(date, -1)) continuity.emptyStreak += 1
    let termination = null
    const inferredNoDataDates = new Set()
    const observedDates = new Set()
    updateSourceSync(project.id, 'guduo', { state: 'loading', contentType, message: `正在双轮逐日扫描骨朵公开榜单（${cursor} 至 ${historyEnd}）`, fetchedAt: new Date().toISOString(), count: existingDates.size, resumeFrom: cursor, scannedFrom: premiere, scannedThrough: contiguousThrough, complete: false })
    try {
      const pages = guduoHistoryPageRanges(cursor, historyEnd, GUDUO_HISTORY_PAGE_DAYS, { unmatchedProbe: existingDates.size === 0 && !continuity.hadData })
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        const page = pages[pageIndex]
        cursor = page.from
        const pageEnd = page.to
        const payload = await collectGuduoHistory(project, cursor, pageEnd, continuity)
        attemptedDates += Number(payload.attemptedDates) || 0
        const pageFailedDates = Array.isArray(payload.failedDates) ? payload.failedDates : []
        const pageVerification = payload.verification
        verificationPasses += Number(pageVerification?.passes) || 0
        for (const date of pageVerification?.gapDates || []) gapDates.add(date)
        const pageHasSourceFailures = payload.complete === false || pageFailedDates.length > 0 || pageVerification?.version !== DAILY_HISTORY_VERIFICATION_VERSION || pageVerification?.verified !== true
        const pageRankFailedDates = Array.isArray(payload.rankFailedDates) ? payload.rankFailedDates : []
        const pageHasFailures = pageHasSourceFailures || pageRankFailedDates.length > 0
        if (pageHasFailures) continuity = { ...continuity, emptyStreak: 0 }
        else if (payload.continuity) continuity = payload.continuity
        for (const date of pageVerification?.observedDates || []) observedDates.add(date)
        if (pageHasFailures) {
          if (!firstFailedFrom) firstFailedFrom = cursor
          const unresolved = new Set([...(pageVerification?.unresolvedDates || []), ...pageFailedDates.map((item) => item?.date).filter(Boolean)])
          for (const failure of pageRankFailedDates) {
            if (failure?.date) unresolved.add(failure.date)
          }
          for (const date of unresolved.size ? unresolved : isoDatesInRange(cursor, pageEnd)) {
            unresolvedDates.add(date)
            failedDates.push({ date, reason: pageRankFailedDates.some((item) => item.date === date) ? `${contentType === 'variety' ? '全部综艺' : '全部剧集'}全平台排名接口读取失败` : pageVerification?.message || '该日期未通过重复抓取核验' })
          }
        }
        if (!pageHasSourceFailures) {
          for (const date of pageVerification.checkedDates || isoDatesInRange(cursor, pageEnd)) verifiedDates.add(date)
          for (const date of pageVerification.noDataDates || []) noDataDates.add(date)
          if (cursor === addIsoDays(contiguousThrough, 1)) contiguousThrough = pageEnd
        }
        const pageRows = Array.isArray(payload.series) ? payload.series.filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row?.date || '') && ((row.heat !== null && row.heat !== undefined && Number.isFinite(Number(row.heat))) || (row?.rank !== null && row?.rank !== undefined && Number.isFinite(Number(row.rank))))) : []
        if (!pageHasSourceFailures) {
          for (const date of isoDatesInRange(cursor, pageEnd)) finalHitDates.delete(date)
          for (const row of pageRows) {
            history.set(row.date, row)
            finalHitDates.add(row.date)
          }
          const incoming = pageRows.map((row) => ({
            date: row.date,
            values: {
              ...(row.heat !== null && row.heat !== undefined && Number.isFinite(Number(row.heat)) ? { '骨朵热度': Number(row.heat) } : {}),
              ...(row.rank !== null && row.rank !== undefined && Number.isFinite(Number(row.rank)) ? { '骨朵热度排名': Number(row.rank) } : {}),
            },
            metricSources: {
              ...(row.heat !== null && row.heat !== undefined && Number.isFinite(Number(row.heat)) ? { '骨朵热度': row.sourceUrl } : {}),
              ...(row.rank !== null && row.rank !== undefined && Number.isFinite(Number(row.rank)) ? { '骨朵热度排名': row.rankSourceUrl || row.sourceUrl } : {}),
            },
            sourceUrl: row.sourceUrl,
            fetchedAt: new Date().toISOString(),
          }))
          commit((state) => {
            const existing = state.liveHeat[project.id] || []
            const liveHeat = replaceVerifiedSourceHistory(existing, incoming, { from: cursor, to: pageEnd, metrics: ['骨朵热度', '骨朵热度排名'] })
            return { ...state, liveHeat: { ...state.liveHeat, [project.id]: liveHeat } }
          })
        }
        updateSourceSync(project.id, 'guduo', { state: 'loading', message: `已完成 ${verifiedDates.size} 天双轮核验；${noDataDates.size} 天源端无记录，继续检查`, fetchedAt: new Date().toISOString(), count: finalHitDates.size, attemptedDates, resumeFrom: firstFailedFrom || addIsoDays(pageEnd, 1), scannedFrom: premiere, scannedThrough: contiguousThrough, verification: { version: DAILY_HISTORY_VERIFICATION_VERSION, verified: false, from: premiere, to: historyEnd, passes: verificationPasses, checkedDates: [...verifiedDates].sort(), noDataDates: [...noDataDates].sort(), gapDates: [...gapDates].sort(), unresolvedDates: [...unresolvedDates].sort() } })
        reportProgress?.({ source: '骨朵历史', detail: {
          state: 'scanning', checkedDays: verifiedDates.size,
          totalDays: isoDatesInRange(premiere, historyEnd).length,
          currentDate: pageEnd, hitDays: finalHitDates.size,
          noDataDays: noDataDates.size, updatedAt: new Date().toISOString(),
        } })
        cursor = addIsoDays(pageEnd, 1)
        // Discovery has succeeded: lift the initial 50-day budget, keeping the
        // existing independently verified post-hit stopping rule below.
        if (pageIndex === pages.length - 1 && cursor <= historyEnd && finalHitDates.size > 0) {
          pages.push(...guduoHistoryPageRanges(cursor, historyEnd, GUDUO_HISTORY_PAGE_DAYS))
        }
        if (!pageHasFailures && !firstFailedFrom && pageVerification.termination?.reason === '15-consecutive-empty-after-hit') {
          termination = pageVerification.termination
          const tailFrom = addIsoDays(termination.date, 1)
          for (const date of isoDatesInRange(tailFrom, historyEnd)) {
            noDataDates.add(date)
            inferredNoDataDates.add(date)
            verifiedDates.add(date)
            finalHitDates.delete(date)
          }
          commit((state) => ({ ...state, liveHeat: { ...state.liveHeat,
            [project.id]: replaceVerifiedSourceHistory(state.liveHeat[project.id] || [], [], { from: tailFrom, to: historyEnd, metrics: ['骨朵热度', '骨朵热度排名'] }),
          } }))
          contiguousThrough = historyEnd
          cursor = addIsoDays(historyEnd, 1)
          break
        }
      }
      const rows = [...history.values()].sort((a, b) => a.date.localeCompare(b.date))
      const expectedDates = isoDatesInRange(premiere, historyEnd)
      const complete = failedDates.length === 0 && cursor > historyEnd && contiguousThrough >= historyEnd && verifiedDates.size === expectedDates.length
      const probeLimited = !finalHitDates.size && cursor <= historyEnd && pages.at(-1)?.to === addIsoDays(resumeFrom, 49)
      if (probeLimited && !firstFailedFrom && failedDates.length === 0 && verifiedDates.size >= 50) {
        termination = { date: pages.at(-1).to, reason: '50-day-unmatched-probe', confirmedBy: 2 }
      }
      const allKnownGuduoDates = finalHitDates
      const verification = { version: DAILY_HISTORY_VERIFICATION_VERSION, state: complete ? 'verified' : 'incomplete', verified: complete, from: premiere, to: historyEnd, passes: verificationPasses, checkedDates: [...verifiedDates].sort(), observedDates: [...observedDates].sort(), inferredNoDataDates: [...inferredNoDataDates].sort(), termination, noDataDates: [...noDataDates].sort(), gapDates: [...gapDates].sort(), unresolvedDates: [...unresolvedDates].sort(), message: complete ? termination ? `实际检查 ${observedDates.size} 天；双轮确认连续15天空值，于 ${termination.date} 停止；其后 ${inferredNoDataDates.size} 天按连续性规则推定无数据` : `逐日数据已完成 ${verificationPasses} 轮交叉核验` : '仍有日期没有通过重复抓取核验' }
      if (probeLimited) verification.uncheckedDates = expectedDates.filter((date) => !verifiedDates.has(date))
      if (termination?.reason === '50-day-unmatched-probe') {
        verification.message = `首轮探测区间 ${resumeFrom}—${termination.date}：50 天均通过双轮核查，未找到榜单数据；已停止继续扫描，后续 ${verification.uncheckedDates.length} 天未检查`
        updateSourceSync(project.id, 'guduo', { state: 'partial', message: verification.message, fetchedAt: new Date().toISOString(), count: 0, attemptedDates, scannedFrom: premiere, scannedThrough: termination.date, resumeFrom: '', complete: false, truncated: true, verification })
        return 0
      }
      if (!allKnownGuduoDates.size && complete) {
        updateSourceSync(project.id, 'guduo', { state: 'empty', message: `首播至今天逐日核验 ${expectedDates.length} 天；榜单没有命中日期，空值已保留`, fetchedAt: new Date().toISOString(), count: 0, attemptedDates: expectedDates.length, scannedFrom: premiere, scannedThrough: historyEnd, resumeFrom: '', complete: true, truncated: false, verification })
        return 0
      }
      const fresh = rows.filter((row) => !existingDates.has(row.date))
      const rankAvailable = hasStoredRank || rows.some((row) => row.rank !== null && row.rank !== undefined && Number.isFinite(Number(row.rank)))
      const dates = [...allKnownGuduoDates].sort()
      updateSourceSync(project.id, 'guduo', complete
        ? { state: 'success', message: termination ? verification.message : `首播至今天逐日双轮核验 ${expectedDates.length} 天；榜单命中 ${allKnownGuduoDates.size} 天，未上榜日期保持空白${rankAvailable ? '；排名已返回' : '；接口未返回排名'}`, fetchedAt: new Date().toISOString(), count: allKnownGuduoDates.size, attemptedDates, scannedFrom: premiere, scannedThrough: termination?.date || historyEnd, resumeFrom: '', firstDate: dates[0], lastDate: dates.at(-1), complete: true, truncated: false, rankAvailable, verification, sourceUrl: rows.find((row) => row.sourceUrl)?.sourceUrl || '' }
        : { state: 'error', message: `${verifiedDates.size}/${expectedDates.length} 天通过双轮核验；${unresolvedDates.size || failedDates.length} 天未收敛，下次从 ${firstFailedFrom || cursor} 续跑`, fetchedAt: new Date().toISOString(), count: allKnownGuduoDates.size, attemptedDates, scannedFrom: premiere, scannedThrough: contiguousThrough, resumeFrom: firstFailedFrom || cursor, firstDate: dates[0], lastDate: dates.at(-1), complete: false, truncated: probeLimited, failedDates, verification, rankAvailable, sourceUrl: rows.find((row) => row.sourceUrl)?.sourceUrl || '' })
      return fresh.length
    } catch (error) {
      const savedCount = (stateRef.current.liveHeat[project.id] || []).filter((row) => row.values?.['骨朵热度'] !== null && row.values?.['骨朵热度'] !== undefined).length
      updateSourceSync(project.id, 'guduo', { state: 'error', message: `骨朵历史分段回填中断；已逐页提交 ${savedCount} 天数据，${readableError(error, '骨朵历史回填失败')}`, fetchedAt: new Date().toISOString(), count: savedCount, scannedFrom: premiere, scannedThrough: contiguousThrough, resumeFrom: firstFailedFrom || cursor, complete: false })
      return 0
    }
  }, [commit, resolvePremiereForHistory, updateSourceSync])

  const refreshMaoyanMetricDetails = useCallback(async (project, quiet = true, force = false) => {
    const records = stateRef.current.liveHeat[project.id] || []
    const allowedPlatforms = expectedWebPlatforms(project)
    const previousSync = stateRef.current.sourceSync?.[project.id]?.maoyan
    const historyFrom = await resolvePremiereForHistory(project)
    const historyTo = todayInShanghai()
    const fetchedToday = (value) => value && todayInShanghai(new Date(value)) === todayInShanghai()
    if (!historyFrom) throw new Error('缺少已确认首播日期，无法校验猫眼指标的逐日覆盖范围')
    const hasPlatformBreakdown = records.some((record) => Object.keys(record.values || {}).some((name) => PLATFORM_METRIC_PATTERN.test(name) && record.values[name] !== null && record.values[name] !== undefined))
    const hasMangoPlatformBreakdown = !allowedPlatforms.has('芒果TV') || hasStoredMetric(records, '芒果TV平台表现')
    const hasEffectiveTotal = records.some((record) => record.values?.['有效播放量'] !== null && record.values?.['有效播放量'] !== undefined)
    const hasEffectiveBreakdown = records.some((record) => Object.keys(record.values || {}).some((name) => EFFECTIVE_PLATFORM_METRIC_PATTERN.test(name) && record.values[name] !== null && record.values[name] !== undefined))
    const hasEffectiveSummary = Boolean(stateRef.current.sourceSync?.[project.id]?.maoyan?.effectiveSummary?.items?.length)
    const previouslyUnavailable = previousSync?.effectiveUnavailable === true
    const needsEffectiveCumulative = !previouslyUnavailable
      && previousSync?.effectiveCumulativeMappingVersion !== EFFECTIVE_CUMULATIVE_MAPPING_VERSION
    const verifiedRange = (metric) => {
      const verification = previousSync?.metricVerification?.[metric]
      return verification?.version === DAILY_HISTORY_VERIFICATION_VERSION
        && verification?.verified === true
        && verification?.from === historyFrom
        && verification?.to === historyTo
    }
    const platformCurrent = !force && fetchedToday(previousSync?.platformFetchedAt) && verifiedRange('platform') && !previousSync?.partialMetricCoverage
      && (!hasPlatformBreakdown || (hasPlatformBreakdown && hasMangoPlatformBreakdown))
    const effectiveCurrent = !force && fetchedToday(previousSync?.effectiveFetchedAt) && verifiedRange('effective') && !previousSync?.partialMetricCoverage
      && (previouslyUnavailable || (hasEffectiveTotal && hasEffectiveBreakdown && !needsEffectiveCumulative))
    const metricKinds = [...(platformCurrent ? [] : ['platform']), ...(effectiveCurrent ? [] : ['effective'])]
    if (!hasEffectiveSummary && !metricKinds.includes('effective')) metricKinds.push('effective')
    const completedKinds = []
    const failedKinds = []
    const failureDetails = []
    const partialKinds = []
    const unavailableKinds = []
    let effectiveUnavailable = false
    let effectiveCumulativeChecked = false
    let effectiveSummary = previousSync?.effectiveSummary || null
    let effectiveHeadline = null
    let effectiveLatestDate = null
    const effectiveCumulativePlatforms = new Set()
    const metricFetchedAt = {}
    const verificationByMetric = {}
    const availabilityByMetric = {}

    for (const metric of metricKinds) {
      try {
        const payload = await collectMaoyanMetric(project, metric)
        availabilityByMetric[metric] = maoyanMetricAvailability(payload)
        if (payload.verification) verificationByMetric[metric] = payload.verification
        const hasStablePartialRows = payload.verification?.verified === false
          && Array.isArray(payload.series)
          && payload.series.length > 0
        if (payload.verification?.version !== DAILY_HISTORY_VERIFICATION_VERSION || (payload.verification?.verified !== true && !hasStablePartialRows)) {
          throw new Error(payload.error || payload.verification?.message || `猫眼${metric === 'platform' ? '平台表现' : '有效播放'}未通过逐日重复核验`)
        }
        if (payload.seriesId) rememberMaoyanSeriesId(project.id, payload.seriesId)
        if (metric === 'effective' && payload.summary && payload.verification?.summaryVerified !== false) effectiveSummary = payload.summary
        if (availabilityByMetric[metric] === 'not-published') {
          const mappingWarnings = Array.isArray(payload.mappingWarnings) ? payload.mappingWarnings : []
          if (mappingWarnings.length) partialKinds.push({ metric, missingPlatforms: mappingWarnings, coverageAnomalies: [] })
          if (metric === 'effective') effectiveUnavailable = true
          unavailableKinds.push(metric)
          const sourceMetrics = metric === 'platform'
            ? [...new Set([
              ...['平台表现', ...allowedPlatforms].flatMap((platform) => platform === '平台表现' ? [platform] : [`${platform}平台表现`]),
              ...records.flatMap((record) => Object.keys(record.values || {}).filter((name) => PLATFORM_METRIC_PATTERN.test(name))),
            ])]
            : effectivePlaybackSourceMetrics(allowedPlatforms, records)
          commit((current) => ({
            ...current,
            liveHeat: {
              ...current.liveHeat,
              [project.id]: replaceVerifiedSourceHistory(current.liveHeat[project.id] || [], [], { from: historyFrom, to: historyTo, metrics: sourceMetrics }),
            },
          }))
          metricFetchedAt[metric] = new Date().toISOString()
          continue
        }
        const rows = Array.isArray(payload.series) ? payload.series : []
        if (!rows.length) throw new Error('接口没有返回两轮一致的明细，也未明确标记源端无数据')
        const mappedEffective = metric === 'effective' ? mapEffectivePlayback(payload, allowedPlatforms) : null
        const incoming = mappedEffective ? mappedEffective.records.map((record) => ({
          ...record,
          sourceUrl: payload.sourceUrl || project.sourceUrl,
          fetchedAt: new Date().toISOString(),
        })) : metric === 'platform' ? mapMaoyanPlatformRows(rows, { sourceUrl: payload.sourceUrl || project.sourceUrl }).map((record) => ({
          ...record,
          fetchedAt: new Date().toISOString(),
        })) : rows.map((row) => {
          const date = String(row?.date || '')
          const rawPlatform = String(row?.platform || row?.platformLabel || '')
          const platform = rawPlatform ? metricPlatformName(rawPlatform) : ''
          if (platform && !/^(优酷|爱奇艺|腾讯视频|芒果TV)$/.test(platform)) return null
          const value = parseChineseCount(row?.value ?? (metric === 'platform' ? row?.platformHeat : row?.effectivePlay))
          const cumulativeEffectivePlay = metric === 'effective' ? parseChineseCount(row?.cumulativeEffectivePlay) : null
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (value === null && cumulativeEffectivePlay === null)) return null
          const metricName = metric === 'platform'
            ? (platform ? `${platform}平台表现` : '平台表现')
            : (platform ? `${platform}有效播放` : '有效播放量')
          const values = {}
          if (value !== null) values[metricName] = value
          if (metric === 'effective' && platform && cumulativeEffectivePlay !== null) {
            values[`${platform}累计有效播放`] = cumulativeEffectivePlay
            effectiveCumulativePlatforms.add(platform)
          }
          return { date, values, sourceUrl: payload.sourceUrl || project.sourceUrl, fetchedAt: new Date().toISOString() }
        }).filter(Boolean)
        if (!incoming.length) throw new Error('指标明细没有可保存的数值')
        const sourceMetrics = metric === 'platform'
          ? [...new Set([
            ...['平台表现', ...allowedPlatforms].flatMap((platform) => platform === '平台表现' ? [platform] : [`${platform}平台表现`]),
            ...incoming.flatMap((record) => Object.keys(record.values || {}).filter((name) => PLATFORM_METRIC_PATTERN.test(name))),
            ...records.flatMap((record) => Object.keys(record.values || {}).filter((name) => PLATFORM_METRIC_PATTERN.test(name))),
          ])]
          : effectivePlaybackSourceMetrics(allowedPlatforms, incoming, records)
        if (metric === 'effective') {
          for (const name of incoming.flatMap((record) => Object.keys(record.values || {}))) {
            if (/有效播放/.test(name) && !sourceMetrics.includes(name)) sourceMetrics.push(name)
          }
        }
        commit((current) => ({
          ...current,
          liveHeat: {
            ...current.liveHeat,
            [project.id]: replaceVerifiedSourceHistory(current.liveHeat[project.id] || [], incoming, {
              from: historyFrom,
              to: historyTo,
              metrics: sourceMetrics,
              unresolvedDates: payload.verification?.unresolvedDates || [],
            }),
          },
        }))
        if (mappedEffective) {
          effectiveCumulativeChecked = true
          effectiveHeadline = mappedEffective.headline
          effectiveLatestDate = mappedEffective.latestDate
          for (const platform of mappedEffective.platforms) effectiveCumulativePlatforms.add(platform)
        }
        const returnedPlatforms = new Set(mappedEffective?.platforms || incoming.flatMap((record) => Object.keys(record.values || {}).map((name) => metricPlatformName(name.replace(/(?:平台表现|有效播放)$/, ''))).filter((name) => allowedPlatforms.has(name))))
        const noValueConfirmed = (date, platform) => isConfirmedNoDataDate(payload.verification, date, metric, platform)
        const missingPlatforms = [...allowedPlatforms].filter((platform) => !returnedPlatforms.has(platform)
          && !(payload.verification?.checkedDates?.length && payload.verification.checkedDates.every((date) => noValueConfirmed(date, platform))))
        const datesByPlatform = new Map()
        for (const record of incoming) {
          for (const name of Object.keys(record.values || {})) {
            const platform = metricPlatformName(name.replace(/(?:平台表现|有效播放)$/, ''))
            if (!platform) continue
            if (!datesByPlatform.has(platform)) datesByPlatform.set(platform, new Set())
            datesByPlatform.get(platform).add(record.date)
          }
        }
        const coverageAnomalies = []
        for (const [platform, dateSet] of datesByPlatform) {
          const dates = [...dateSet].sort()
          let gapDays = 0
          for (let index = 1; index < dates.length; index += 1) {
            const previousDate = new Date(`${dates[index - 1]}T12:00:00Z`)
            const currentDate = new Date(`${dates[index]}T12:00:00Z`)
            const distance = Math.round((currentDate - previousDate) / 86400000)
            if (distance > 1) gapDays += isoDatesInRange(addIsoDays(dates[index - 1], 1), addIsoDays(dates[index], -1)).filter((date) => !noValueConfirmed(date, platform)).length
          }
          if (gapDays > 0) coverageAnomalies.push(`${platform}中间缺 ${gapDays} 天`)
        }
        const mappingWarnings = Array.isArray(payload.mappingWarnings) ? payload.mappingWarnings : []
        const verificationWarnings = payload.verification?.verified === false
          ? [payload.verification.message || `${metric}双轮结果未收敛`]
          : []
        const partialReasons = [...missingPlatforms, ...coverageAnomalies, ...mappingWarnings, ...(mappedEffective?.warnings || []), ...verificationWarnings]
        if (partialReasons.length) partialKinds.push({ metric, missingPlatforms: partialReasons, coverageAnomalies })
        else completedKinds.push(metric)
        metricFetchedAt[metric] = new Date().toISOString()
      } catch (error) {
        if (!availabilityByMetric[metric]) availabilityByMetric[metric] = 'error'
        failedKinds.push(metric)
        const detail = readableError(error, '指标采集失败')
        failureDetails.push({ metric, message: detail })
        if (!quiet) appendActivity(metric === 'platform' ? '平台表现' : '有效播放', detail, 'error')
      }
    }
    return {
      requestedKinds: metricKinds,
      completedKinds,
      failedKinds,
      failureDetails,
      partialKinds,
      unavailableKinds,
      effectiveUnavailable,
      effectiveSummary,
      effectiveHeadline,
      effectiveLatestDate,
      verificationByMetric,
      previousMetricVerification: previousSync?.metricVerification || {},
      availabilityByMetric,
      previousMetricAvailability: previousSync?.metricAvailability || {},
      platformFetchedAt: metricFetchedAt.platform,
      effectiveFetchedAt: metricFetchedAt.effective,
      effectiveCumulativeChecked,
      effectiveCumulativePlatforms: [...effectiveCumulativePlatforms],
    }
  }, [appendActivity, commit, mergeLiveHeat, rememberMaoyanSeriesId, resolvePremiereForHistory])

  const backfillMaoyanHistory = useCallback(async (project, quiet = true, force = false) => {
    if (!project || maoyanHistoryInFlight.current.has(project.id)) return 0
    maoyanHistoryInFlight.current.add(project.id)
    let attemptedVerification = null
    try {
      if (project.distribution?.maoyanCoverage === 'unavailable') {
        const fetchedAt = new Date().toISOString()
        updateSourceSync(project.id, 'maoyan', { state: 'empty', message: '项目身份来源已标记为无猫眼历史覆盖', fetchedAt, historyFetchedAt: fetchedAt, count: 0 })
        return 0
      }
      const current = stateRef.current
      const records = current.liveHeat[project.id] || []
      const historyFrom = await resolvePremiereForHistory(project)
      const historyTo = todayInShanghai()
      if (!historyFrom) {
        updateSourceSync(project.id, 'maoyan', { state: 'error', message: '缺少已确认首播日期，无法请求猫眼首播至今天的完整日表', fetchedAt: new Date().toISOString(), complete: false })
        return 0
      }
      const existingDates = new Set(records.filter((record) => record.values?.[MAOYAN_HISTORY_METRIC] !== null && record.values?.[MAOYAN_HISTORY_METRIC] !== undefined).map((record) => record.date))
      const previous = current.sourceSync[project.id]?.maoyan
      const hasSourceSummary = Array.isArray(previous?.summary?.subItems) && previous.summary.subItems.length > 0
      const historyVerificationCurrent = previous?.historyVerification?.version === DAILY_HISTORY_VERIFICATION_VERSION
        && previous?.historyVerification?.verified === true
        && previous?.historyVerification?.from === historyFrom
        && previous?.historyVerification?.to === historyTo
      const fetchHistory = force || !historyVerificationCurrent
        || shouldRefreshMaoyanHistory(existingDates.size, previous?.historyFetchedAt, historyTo, force)
        || !hasSourceSummary
      const hasPlatformBreakdown = records.some((record) => Object.keys(record.values || {}).some((name) => PLATFORM_METRIC_PATTERN.test(name) && record.values[name] !== null && record.values[name] !== undefined))
      const hasMangoPlatformBreakdown = hasStoredMetric(records, '芒果TV平台表现')
      const hasEffectiveTotal = records.some((record) => record.values?.['有效播放量'] !== null && record.values?.['有效播放量'] !== undefined)
      const hasEffectiveBreakdown = records.some((record) => Object.keys(record.values || {}).some((name) => EFFECTIVE_PLATFORM_METRIC_PATTERN.test(name) && record.values[name] !== null && record.values[name] !== undefined))
      const effectiveUnavailable = previous?.effectiveUnavailable === true || /有效播放.*(?:暂无明细|暂无数据)/.test(previous?.message || '')
      const metricFetchedToday = (value) => value && todayInShanghai(new Date(value)) === todayInShanghai()
      const metricVerificationCurrent = (metric) => previous?.metricVerification?.[metric]?.version === DAILY_HISTORY_VERIFICATION_VERSION
        && previous?.metricVerification?.[metric]?.verified === true
        && previous?.metricVerification?.[metric]?.from === historyFrom
        && previous?.metricVerification?.[metric]?.to === historyTo
      const needsMetricDetails = previous?.partialMetricCoverage === true
        || force
        || !metricVerificationCurrent('platform')
        || !metricVerificationCurrent('effective')
        || (previous?.metricAvailability?.platform !== 'not-published' && !(hasPlatformBreakdown && (!expectedWebPlatforms(project).has('芒果TV') || hasMangoPlatformBreakdown)))
        || (!previous?.effectiveSummary && !effectiveUnavailable)
        || (!hasEffectiveTotal && !effectiveUnavailable)
        || (!hasEffectiveBreakdown && !effectiveUnavailable)
        || (previous?.effectiveCumulativeMappingVersion !== EFFECTIVE_CUMULATIVE_MAPPING_VERSION && !effectiveUnavailable)
        || !metricFetchedToday(previous?.platformFetchedAt)
        || !metricFetchedToday(previous?.effectiveFetchedAt)

      if (!fetchHistory) {
        if (!needsMetricDetails) return 0
        const result = await refreshMaoyanMetricDetails(project, quiet, force)
        const names = (kinds) => kinds.map((kind) => kind === 'platform' ? '平台表现' : '有效播放').join('、')
        const partialText = result.partialKinds.map(({ metric, missingPlatforms }) => `${metric === 'platform' ? '平台表现' : '有效播放'}缺少${missingPlatforms.join('、')}`).join('；')
        const unavailableText = result.unavailableKinds.filter((kind) => kind !== 'effective').length
          ? `${names(result.unavailableKinds.filter((kind) => kind !== 'effective'))}源端明确暂无数据`
          : ''
        const failureText = result.failureDetails.map(({ metric, message }) => `${names([metric])}读取异常：${message}`).join('；')
        const parts = [result.completedKinds.length ? `${names(result.completedKinds)}已读取` : '', partialText, unavailableText, result.effectiveUnavailable ? '有效播放源端明确暂无数据' : '', failureText].filter(Boolean)
        updateSourceSync(project.id, 'maoyan', { ...previous, ...maoyanMetricSyncPatch(result), state: result.failedKinds.length || result.partialKinds.length ? 'error' : 'success', message: `${existingDates.size} 天猫眼历史已保存；${parts.join('；') || '平台明细已有保存记录'}`, fetchedAt: new Date().toISOString(), count: previous?.count || existingDates.size, partialMetricCoverage: result.partialKinds.length > 0, effectiveUnavailable: result.effectiveCumulativeChecked ? result.effectiveUnavailable === true : previous?.effectiveUnavailable === true })
        return 0
      }

      updateSourceSync(project.id, 'maoyan', { state: 'loading', message: '正在解析猫眼剧集并读取详情页历史', fetchedAt: new Date().toISOString(), count: existingDates.size })
      const payload = await collectMaoyanHistory({ ...project, premiered: historyFrom })
      attemptedVerification = payload.verification || null
      if (payload.seriesId) rememberMaoyanSeriesId(project.id, payload.seriesId)
      const historyVerified = payload.verification?.version === DAILY_HISTORY_VERIFICATION_VERSION
        && payload.verification?.verified === true
      const rows = Array.isArray(payload.series) ? payload.series : []
      const coverage = payload.coverage || {}
      const coverageIncomplete = payload.complete === false || payload.truncated === true || !historyVerified
      const coverageText = coverage.actualFrom && coverage.actualTo
        ? `实际覆盖 ${coverage.actualFrom}—${coverage.actualTo}${coverage.sourceLatestBeforeRequestedTo ? '；源站最新日期早于本次请求截止日' : ''}`
        : '未返回可核验的历史日期范围'
      if (!rows.length) {
        const fetchedAt = new Date().toISOString()
        commit((state) => ({
          ...state,
          liveHeat: {
            ...state.liveHeat,
            [project.id]: replaceVerifiedSourceHistory(state.liveHeat[project.id] || [], [], {
              from: historyFrom,
              to: historyTo,
              metrics: ['猫眼热度', '猫眼热度排名', '猫眼全网曝光', '猫眼全网转评赞', '猫眼全网发布', '猫眼全网弹幕'],
              unresolvedDates: payload.verification?.unresolvedDates || [],
            }),
          },
        }))
        const result = await refreshMaoyanMetricDetails(project, quiet, force)
        const hasMetricData = result.completedKinds.length || result.effectiveUnavailable
        const historyVerification = { ...payload.verification, from: historyFrom, to: historyTo }
        const failureText = result.failureDetails.map(({ metric, message }) => `${metric === 'platform' ? '平台表现' : '有效播放'}读取异常：${message}`).join('；')
        updateSourceSync(project.id, 'maoyan', { ...previous, summary: payload.verification?.summaryVerified === false ? previous?.summary || null : payload.summary || previous?.summary || null, ...maoyanMetricSyncPatch(result), state: coverageIncomplete || result.failedKinds.length || result.partialKinds.length ? 'error' : hasMetricData ? 'success' : 'empty', message: coverageIncomplete ? `猫眼历史尚未通过双轮核验：${payload.verification?.message || coverageText}；${failureText || '稳定日期与指标已单独保留'}` : failureText ? `猫眼历史逐日复核无命中；${failureText}` : result.effectiveUnavailable ? '猫眼历史逐日复核无命中；平台表现已核对，有效播放源端明确无数据' : result.partialKinds.length ? '猫眼历史逐日复核无命中；平台明细仅返回部分已确认播出平台，待补采' : '猫眼热度历史逐日复核无命中；已核对平台表现与有效播放明细', fetchedAt, historyFetchedAt: fetchedAt, count: 0, partialMetricCoverage: result.partialKinds.length > 0, effectiveUnavailable: result.effectiveUnavailable === true, coverage, complete: !coverageIncomplete, truncated: false, historyVerification })
        return 0
      }
      const fetchedAt = new Date().toISOString()
      const incoming = rows.map((row) => {
        const date = String(row?.date || '')
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
        const values = {}
        Object.assign(values, maoyanHistoryNumericValues(row))
        const exposure = parseChineseCount(row?.exposure)
        const interaction = parseChineseCount(row?.interaction)
        const publish = parseChineseCount(row?.publish)
        const bullet = parseChineseCount(row?.bulletScreen)
        if (exposure !== null) values['猫眼全网曝光'] = exposure
        if (interaction !== null) values['猫眼全网转评赞'] = interaction
        if (publish !== null) values['猫眼全网发布'] = publish
        if (bullet !== null) values['猫眼全网弹幕'] = bullet
        return { date, values, sourceUrl: project.sourceUrl || 'https://piaofang.maoyan.com/i/tv-datainfo', fetchedAt }
      }).filter(Boolean)
      const beforeDates = new Set((stateRef.current.liveHeat[project.id] || []).filter((record) => record.values?.[MAOYAN_HISTORY_METRIC] !== null && record.values?.[MAOYAN_HISTORY_METRIC] !== undefined).map((record) => record.date))
      commit((state) => ({
        ...state,
        liveHeat: {
          ...state.liveHeat,
          [project.id]: replaceVerifiedSourceHistory(state.liveHeat[project.id] || [], incoming, {
            from: historyFrom,
            to: historyTo,
            metrics: ['猫眼热度', '猫眼热度排名', '猫眼全网曝光', '猫眼全网转评赞', '猫眼全网发布', '猫眼全网弹幕'],
            unresolvedDates: payload.verification?.unresolvedDates || [],
          }),
        },
      }))
      updateSourceSync(project.id, 'maoyan', {
        ...previous, state: 'loading', message: '猫眼历史已保存，继续核验平台表现与有效播放',
        summary: payload.verification?.summaryVerified === false ? previous?.summary || null : payload.summary || previous?.summary || null,
        historyFetchedAt: fetchedAt, coverage,
        historyVerification: { ...payload.verification, from: historyFrom, to: historyTo },
        complete: !coverageIncomplete,
      })
      const result = await refreshMaoyanMetricDetails(project, quiet, force)
      const dates = incoming.map((record) => record.date).sort()
      const historyMessage = coverageIncomplete
        ? `猫眼已保存 ${rows.length} 天双轮一致数据；${payload.verification?.message || coverageText}；未核验日期保持空白并待补采`
        : `猫眼详情页已返回 ${rows.length} 天；${coverageText}；${result.partialKinds.length ? '平台明细仅返回部分已确认播出平台，待补采' : result.completedKinds.length ? '平台明细已核验' : '历史数据已保存'}`
      const failureText = result.failureDetails.map(({ metric, message }) => `${metric === 'platform' ? '平台表现' : '有效播放'}读取异常：${message}`).join('；')
      updateSourceSync(project.id, 'maoyan', {
        ...previous,
        summary: payload.verification?.summaryVerified === false ? previous?.summary || null : payload.summary || previous?.summary || null,
        ...maoyanMetricSyncPatch(result),
        state: result.failedKinds.length || result.partialKinds.length || coverageIncomplete ? 'error' : 'success',
        message: failureText ? `${historyMessage}；${failureText}` : historyMessage,
        fetchedAt,
        historyFetchedAt: fetchedAt,
        count: dates.length,
        firstDate: dates[0],
        lastDate: dates.at(-1),
        coverage,
        historyVerification: { ...payload.verification, from: historyFrom, to: historyTo },
        complete: !coverageIncomplete,
        truncated: payload.truncated === true,
        missingDates: Array.isArray(payload.missingDates) ? payload.missingDates : [],
        partialMetricCoverage: result.partialKinds.length > 0,
        effectiveUnavailable: result.effectiveUnavailable === true,
      })
      return incoming.filter((record) => !beforeDates.has(record.date)).length
    } catch (error) {
      const current = stateRef.current
      const existingCount = (current.liveHeat[project.id] || []).filter((record) => record.values?.[MAOYAN_HISTORY_METRIC] !== null && record.values?.[MAOYAN_HISTORY_METRIC] !== undefined).length
      const rawMessage = readableError(error, '猫眼历史回填失败')
      const message = /seriesId|series id/i.test(rawMessage) ? `猫眼 resolver 未匹配到《${project.title}》的剧集 ID；当前没有可核验的猫眼历史，图表与明细保持空白` : rawMessage
      updateSourceSync(project.id, 'maoyan', { ...(current.sourceSync[project.id]?.maoyan || {}), state: 'error', message, fetchedAt: new Date().toISOString(), count: existingCount, complete: false, ...(attemptedVerification ? { historyVerification: attemptedVerification } : {}) })
      return 0
    } finally {
      maoyanHistoryInFlight.current.delete(project.id)
    }
  }, [commit, refreshMaoyanMetricDetails, rememberMaoyanSeriesId, resolvePremiereForHistory, updateSourceSync])

  const backfillKyHistory = useCallback(async (project, quiet = true, force = false, reportProgress = null) => {
    if (!project || !hasDimension(project, 'web')) return 0
    const current = stateRef.current
    const records = current.liveHeat[project.id] || []
    const previous = current.sourceSync[project.id]?.ky
    const premiere = await resolvePremiereForHistory(project)
    const today = todayInShanghai()
    const rows = records.filter((record) => Number.isFinite(Number(record.values?.['酷云全端热度'])) || Number.isFinite(Number(record.values?.['酷云增长指数'])))
    const existingDates = new Set(rows.map((record) => record.date))
    if (!premiere) {
      updateSourceSync(project.id, 'ky', { ...previous, state: 'error', message: '缺少已确认首播日期，无法请求酷云首播至今天的完整历史', fetchedAt: new Date().toISOString(), complete: false })
      return 0
    }
    if (premiere > today) {
      updateSourceSync(project.id, 'ky', { ...previous, state: 'empty', message: '首播日期晚于今天，暂无历史日期可抓取', fetchedAt: new Date().toISOString(), count: 0, complete: true })
      return 0
    }
    const scanFrom = kyHistoryWindow(premiere, today).from
    const verificationCurrent = previous?.verification?.version === DAILY_HISTORY_VERIFICATION_VERSION
      && previous?.verification?.verified === true
      && previous?.verification?.from === scanFrom
      && previous?.verification?.to === today
      && previous?.state !== 'error'
      && previous?.fetchedAt
      && todayInShanghai(new Date(previous.fetchedAt)) === today
    if (!force && verificationCurrent) return 0
    try {
      updateSourceSync(project.id, 'ky', { ...previous, state: 'loading', message: `正在逐日读取酷云最近30天范围（${scanFrom} 至 ${today}），每轮分别核查全端热度与增长指数`, fetchedAt: new Date().toISOString(), complete: false })
      const payload = await collectKyHistory(project, scanFrom, today, (progress) => {
        reportProgress?.({ source: '酷云历史', detail: progress })
      })
      const verification = payload.verification
      reportProgress?.({ source: '酷云历史', detail: {
        state: verification?.verified === true && payload.complete !== false ? 'complete' : 'incomplete',
        error: verification?.verified === true ? null : verification?.message,
        updatedAt: new Date().toISOString(),
      } })
      if (verification?.version !== DAILY_HISTORY_VERIFICATION_VERSION) {
        updateSourceSync(project.id, 'ky', {
          ...previous,
          state: 'error',
          message: verification?.message || `酷云逐日结果未通过重复核验；${payload.failedDates?.length || 0} 个日期仍有请求失败`,
          fetchedAt: payload.fetchedAt || new Date().toISOString(),
          count: existingDates.size,
          complete: false,
          verification,
          failedDates: payload.failedDates || [],
        })
        return 0
      }
      const series = Array.isArray(payload.series) ? payload.series : []
      const incoming = series.filter((row) => row?.date && ['酷云全端热度', '酷云增长指数'].includes(row.name) && Number.isFinite(Number(row.value))).map((row) => ({
        date: row.date,
        values: { [row.name]: Number(row.value) },
        sourceUrl: row.sourceUrl || payload.sourceUrl || 'https://www.ky.live/pc.html',
        fetchedAt: payload.fetchedAt || new Date().toISOString(),
      }))
      commit((state) => ({
        ...state,
        liveHeat: {
          ...state.liveHeat,
          [project.id]: replaceVerifiedSourceHistory(state.liveHeat[project.id] || [], incoming, {
            from: scanFrom,
            to: today,
            metrics: ['酷云全端热度', '酷云增长指数'],
            unresolvedDates: verification.unresolvedDates || [],
          }),
        },
      }))
      const hitDates = new Set(incoming.map((row) => row.date))
      const noDataCount = (verification.noDataDates || []).length
      const checkedCount = (verification.checkedDates || []).length
      const sourceLatestDate = payload.sourceLatestDate || null
      const unresolvedDates = verification.unresolvedDates || []
      const complete = verification.verified === true && payload.complete !== false
      const resolvedCount = Math.max(0, checkedCount - unresolvedDates.length)
      const status = !complete ? 'error' : incoming.length ? 'success' : 'empty'
      updateSourceSync(project.id, 'ky', {
        ...previous,
        state: status,
        needsDateBindingRefresh: (verification.observations || []).filter(check => check.coverage?.dateBindingVersion === 1).length < 2,
        message: complete
          ? `酷云已对 ${checkedCount} 天完成双轮核验，命中 ${hitDates.size} 天、${noDataCount} 天无日值${sourceLatestDate && sourceLatestDate < today ? `；源站最新数据到 ${sourceLatestDate}` : ''}`
          : `酷云已保存两轮一致的 ${hitDates.size} 天明细；${resolvedCount} 天已收敛，${unresolvedDates.length} 天或指标仍未核实，未核实项保持空白。${verification.message || ''}`,
        fetchedAt: payload.fetchedAt || new Date().toISOString(),
        count: hitDates.size,
        firstDate: [...hitDates].sort()[0] || null,
        lastDate: [...hitDates].sort().at(-1) || null,
        complete,
        verification: { ...verification, from: scanFrom, to: today },
        checkedDates: verification.checkedDates || [],
        noDataDates: verification.noDataDates || [],
        failedDates: verification.failedDates || [],
        sourceLatestDate,
        coverageNote: `最近30天范围逐日双轮核验 ${scanFrom}—${today}`,
      })
      return incoming.filter((row) => !existingDates.has(row.date)).length
    } catch (error) {
      reportProgress?.({ source: '酷云历史', detail: { state: 'failed', error: readableError(error, '酷云网页端采集失败'), updatedAt: new Date().toISOString() } })
      updateSourceSync(project.id, 'ky', { ...previous, state: 'error', message: readableError(error, '酷云网页端采集失败'), fetchedAt: new Date().toISOString(), count: existingDates.size, complete: false })
      return 0
    }
  }, [commit, resolvePremiereForHistory, updateSourceSync])

  useEffect(() => {
    if (!hydrated || !selectedProject || backgroundPausedRef.current || pageSuspendedRef.current) return
    let cancelled = false
    const subjects = [selectedProject, ...selectedCompetitors].filter(project =>
      stateRef.current.sourceSync[project.id]?.ky?.needsDateBindingRefresh && !kyMigrationAttempts.current.has(project.id))
    void (async () => {
      for (const project of subjects) {
        if (cancelled || backgroundPausedRef.current || pageSuspendedRef.current) break
        kyMigrationAttempts.current.add(project.id)
        await backfillKyHistory(project, true, true)
      }
    })()
    return () => { cancelled = true }
  }, [hydrated, selectedProject, selectedCompetitors, backfillKyHistory, resumeRevision])

  const collectProject = useCallback((project, quiet = false, allowDailyMissingRetry = false, reportProgress = null, onCoreReady = null) => runSharedTask(collectingProjectTasksRef.current, project?.id, async () => {
    if (!project || backgroundPausedRef.current) return 0
    reportProgress?.({ message: '检查猫眼、骨朵与酷云的数据缺口' })
    if (!hasDimension(project, 'web')) {
      updateCollection(project.id, { state: 'success', message: '当前项目按台端收视率管理，网端热度采集已跳过。', fetchedAt: new Date().toISOString(), sourceUrl: project.sourceUrl })
      return 0
    }
    collectingProjectRef.current.add(project.id)
    setCollectingProjectIds((current) => ({ ...current, [project.id]: true }))
    try {
      const current = stateRef.current
      const today = todayInShanghai()
      const historyEnd = today
      const records = current.liveHeat[project.id] || []
      const cached = records.find((record) => record.date === today)
      const hasGuduoHistory = records.some((record) => record.values?.['骨朵热度'] !== null && record.values?.['骨朵热度'] !== undefined)
      const hasGuduoRank = records.some((record) => Number.isFinite(Number(record.values?.['骨朵热度排名'])))
      const maoyanExposureDays = new Set(records.filter((record) => record.values?.[MAOYAN_HISTORY_METRIC] !== null && record.values?.[MAOYAN_HISTORY_METRIC] !== undefined).map((record) => record.date))
      const hasKyHeat = records.some((record) => record.values?.['酷云全端热度'] !== null && record.values?.['酷云全端热度'] !== undefined)
      const hasKyGrowth = records.some((record) => record.values?.['酷云增长指数'] !== null && record.values?.['酷云增长指数'] !== undefined)
      const hasPlatformBreakdown = records.some((record) => Object.keys(record.values || {}).some((name) => PLATFORM_METRIC_PATTERN.test(name) && record.values[name] !== null && record.values[name] !== undefined))
      const hasMangoPlatformBreakdown = hasStoredMetric(records, '芒果TV平台表现')
      const hasEffectiveTotal = records.some((record) => record.values?.['有效播放量'] !== null && record.values?.['有效播放量'] !== undefined)
      const hasEffectiveBreakdown = records.some((record) => Object.keys(record.values || {}).some((name) => EFFECTIVE_PLATFORM_METRIC_PATTERN.test(name) && record.values[name] !== null && record.values[name] !== undefined))
      const sync = current.sourceSync[project.id] || {}
      const historyRefresh = sourceHistoryRefreshNeeds({ premiere: project.premiered, historyEnd, today, guduoSync: sync.guduo, kySync: sync.ky, hasGuduoData: hasGuduoHistory, hasGuduoRank, hasKyHeat, hasKyGrowth, force: allowDailyMissingRetry })
      const guduoCategoryChanged = (sync.guduo?.contentType || 'drama') !== (project.contentType || 'drama')
      const needGuduoHistory = guduoCategoryChanged || historyRefresh.guduo
      const maoyanHistoryVerified = sync.maoyan?.historyVerification?.version === DAILY_HISTORY_VERIFICATION_VERSION
        && sync.maoyan?.historyVerification?.verified === true
        && sync.maoyan?.historyVerification?.from === project.premiered
        && sync.maoyan?.historyVerification?.to === historyEnd
      const needMaoyanHistory = project.distribution?.maoyanCoverage !== 'unavailable'
        && (allowDailyMissingRetry || !maoyanHistoryVerified || shouldRefreshMaoyanHistory(maoyanExposureDays.size, sync.maoyan?.historyFetchedAt, today, allowDailyMissingRetry))
      const maoyanMetricFresh = (value) => value && todayInShanghai(new Date(value)) === today
      const maoyanMetricVerified = (metric) => {
        const verification = sync.maoyan?.metricVerification?.[metric]
        return verification?.version === DAILY_HISTORY_VERIFICATION_VERSION
          && verification?.verified === true
          && verification?.from === project.premiered
          && verification?.to === historyEnd
      }
      const needMaoyanDetails = allowDailyMissingRetry || sync.maoyan?.partialMetricCoverage === true
        || !maoyanMetricVerified('platform')
        || !maoyanMetricVerified('effective')
        || (sync.maoyan?.metricAvailability?.platform !== 'not-published' && !(hasPlatformBreakdown && (!expectedWebPlatforms(project).has('芒果TV') || hasMangoPlatformBreakdown)))
        || (!(sync.maoyan?.effectiveUnavailable === true) && (!hasEffectiveTotal || !hasEffectiveBreakdown || sync.maoyan?.effectiveCumulativeMappingVersion !== EFFECTIVE_CUMULATIVE_MAPPING_VERSION))
        || !maoyanMetricFresh(sync.maoyan?.platformFetchedAt)
        || !maoyanMetricFresh(sync.maoyan?.effectiveFetchedAt)
      const needKyHistory = project.contentType !== 'variety' && historyRefresh.ky
      const needEndataHistory = ENDATA_ENABLED && (allowDailyMissingRetry || !sync.endata || sync.endata.contentType !== (project.contentType || 'drama')
        || sync.endata.verification?.from !== project.premiered || sync.endata.verification?.to !== historyEnd)
      const needDailyGuduo = cached?.values?.['骨朵热度'] === null || cached?.values?.['骨朵热度'] === undefined
      const needDailyMaoyan = cached?.values?.['猫眼热度'] === null || cached?.values?.['猫眼热度'] === undefined
      const hasMissingWork = needEndataHistory || needGuduoHistory || needMaoyanHistory || needMaoyanDetails || needKyHistory || needDailyGuduo || needDailyMaoyan

      if (cached && !hasMissingWork && !allowDailyMissingRetry) {
        updateCollection(project.id, { state: 'success', message: '已有数据完整，本次跳过重复抓取', fetchedAt: cached.fetchedAt, sourceUrl: cached.sourceUrl })
        return 0
      }

      const historyTasks = []
      if (needGuduoHistory) historyTasks.push({ source: '骨朵历史', run: () => backfillGuduoHistory(project, allowDailyMissingRetry, reportProgress) })
      if (needMaoyanHistory || needMaoyanDetails) historyTasks.push({ source: '猫眼历史与指标', run: () => backfillMaoyanHistory(project, true, allowDailyMissingRetry) })
      if (needKyHistory) historyTasks.push({ source: '酷云历史', run: () => backfillKyHistory(project, true, allowDailyMissingRetry, reportProgress) })
      if (needEndataHistory) historyTasks.push({ source: '艺恩历史', run: () => backfillEndataHistory(project, reportProgress) })

      const historyRuns = historyTasks.map(async ({ source, run }) => {
        reportProgress?.({ source, detail: { state: 'loading', updatedAt: new Date().toISOString() }, message: `${source}已开始` })
        const count = await run()
        if (source !== '酷云历史' && source !== '艺恩历史') reportProgress?.({ source, detail: { state: 'returned', updatedAt: new Date().toISOString() } })
        reportProgress?.({ message: `${source}任务已返回${count ? `，新增 ${count} 条` : ''}` })
        return count
      })
      const settleHistoryTasks = () => settleCollectionPhases(historyRuns.map((promise, index) => ({ promise, background: historyTasks[index].source === '艺恩历史' })), () => onCoreReady?.())

      if (cached && !allowDailyMissingRetry) {
        updateCollection(project.id, { state: 'success', message: '今日数据已保存，正在只补历史或指标缺口', fetchedAt: cached.fetchedAt, sourceUrl: cached.sourceUrl })
        await settleHistoryTasks()
        return 0
      }

      // 手动刷新也应重取当天快照：这既更新数值，也会把各指标自己的来源链接
      // 写入 metricSources，避免多来源同日记录只剩下最后一次写入的链接。
      const crossNeeded = needDailyGuduo || needDailyMaoyan || allowDailyMissingRetry
      if (!crossNeeded) {
        updateCollection(project.id, { state: 'success', message: '今日快照已完整，正在只补历史或指标缺口', fetchedAt: cached?.fetchedAt || new Date().toISOString(), sourceUrl: cached?.sourceUrl || project.sourceUrl })
        await settleHistoryTasks()
        return 0
      }

      let outcome
      try {
        reportProgress?.({ message: '猫眼与骨朵当日数据抓取中' })
        outcome = await collectCross(project, {
          skipMaoyan: !(needDailyMaoyan || allowDailyMissingRetry) || project.distribution?.maoyanCoverage === 'unavailable',
          skipGuduo: !(needDailyGuduo || allowDailyMissingRetry),
        })
        if (outcome.outcome?.seriesId) rememberMaoyanSeriesId(project.id, outcome.outcome.seriesId)
      } catch (error) {
        outcome = { outcome: { metrics: [], problems: [{ source: '采集服务', message: readableError(error, '跨来源热度采集失败') }], fetchedAt: new Date().toISOString(), manualSourceUrl: 'https://piaofang.maoyan.com/mdb/search', date: today, notices: [], informationalNotices: [] } }
      }
      const cross = outcome.outcome || {}
      const metrics = Array.isArray(cross.metrics) ? cross.metrics : []
      const problems = Array.isArray(cross.problems) ? cross.problems : []
      const informationalNotices = Array.isArray(cross.informationalNotices) ? cross.informationalNotices : []
      reportProgress?.({ message: `当日数据请求完成，收到 ${metrics.length} 项指标${problems.length ? `，${problems.length} 项待核查` : ''}` })
      if (metrics.length) {
        const fetchedAt = cross.fetchedAt || new Date().toISOString()
        commit((state) => {
          const map = new Map((state.liveHeat[project.id] || []).map((row) => [row.date, row]))
          for (const metric of metrics) {
            const date = /^\d{4}-\d{2}-\d{2}$/.test(metric.date || '') ? metric.date : cross.date || today
            const existing = map.get(date)
            map.set(date, {
              ...(existing || { date, values: {}, sourceUrl: metric.sourceUrl || cross.manualSourceUrl || project.sourceUrl, fetchedAt }),
              values: {
                ...(existing?.values || {}),
                [metric.name]: Number(metric.value),
                ...(Number.isFinite(Number(metric.rank)) ? { [`${metric.name}排名`]: Number(metric.rank) } : {}),
              },
              sourceUrl: metric.sourceUrl || existing?.sourceUrl || cross.manualSourceUrl || project.sourceUrl,
              fetchedAt,
            })
          }
          const next = { ...state, liveHeat: { ...state.liveHeat, [project.id]: [...map.values()].sort((a, b) => a.date.localeCompare(b.date)) } }
          const problemText = problems.map((problem) => `${problem.source}：${problem.message}`)
          const message = [...metrics.map((metric) => `${metric.name} ${Number(metric.value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`), ...problemText, ...(cross.notices || []), ...informationalNotices].join('；')
          const status = combinedSourceStatus(metrics, problems, cross.notices || [], informationalNotices)
          return appendLog({ ...next, collection: { ...next.collection, [project.id]: { state: status, message, fetchedAt, sourceUrl: metrics.at(-1)?.sourceUrl || cross.manualSourceUrl || project.sourceUrl, code: problems.length ? 'MANUAL_REQUIRED' : undefined } } }, '网端热度', message || '今日数据已更新', problems.length ? 'warning' : 'success')
        })
      } else {
        const message = problems.map((problem) => `${problem.source}：${problem.message}`).join('；') || '今日各来源均未采到数值'
        const hasOnlyKnownEmptySources = combinedSourceStatus(metrics, problems, cross.notices || [], informationalNotices) === 'empty'
        const skippedOnly = !problems.length && !cross.notices?.length && informationalNotices.length > 0
        updateCollection(project.id, { state: hasOnlyKnownEmptySources ? 'empty' : skippedOnly ? 'success' : 'error', message: hasOnlyKnownEmptySources ? cross.notices.join('；') : skippedOnly ? informationalNotices.join('；') : message, fetchedAt: cross.fetchedAt || new Date().toISOString(), sourceUrl: cross.manualSourceUrl || project.sourceUrl, code: hasOnlyKnownEmptySources || skippedOnly ? undefined : 'NO_DATA' })
      }
      await settleHistoryTasks()
      return metrics.length
    } finally {
      collectingProjectRef.current.delete(project.id)
      setCollectingProjectIds((current) => {
        const next = { ...current }
        delete next[project.id]
        return next
      })
    }
  }), [backfillEndataHistory, backfillGuduoHistory, backfillKyHistory, backfillMaoyanHistory, commit, rememberMaoyanSeriesId, updateCollection])

  const loadRecommendations = useCallback(async (project = stateRef.current.projects.find((item) => item.id === stateRef.current.selectedId), force = false, { silent = false } = {}) => {
    if (!project || (!project.premiered && project.contentType !== 'variety')) {
      setRecommendations([])
      setRecommendationError('当前主项目缺少首播日期，无法匹配同期剧')
      return []
    }
    const cached = recommendationCacheRef.current.get(project.id)
    if (!force && cached) {
      const existing = stateRef.current.competitors[project.id] || []
      const results = cached.results.filter((candidate) => !existing.some((item) => sameDramaIdentity(item, candidate)))
      await preloadDramaPosters([project, ...results])
      if (activeRef.current && stateRef.current.selectedId === project.id) {
        setRecommendations(results)
        setRecommendationWindow(cached.window)
        setRecommendationFor(project.id)
        setRecommendationError('')
        setRecommendationLoading(false)
      }
      return results
    }
    const activeRequest = recommendationRequestRef.current
    if (activeRequest?.projectId === project.id) return activeRequest.promise
    if (!silent) setRecommendationLoading(true)
    setRecommendationError('')
    setRecommendations([])
    setRecommendationWindow(null)
    setRecommendationFor(project.id)
    const requestPromise = (async () => {
      const payload = await recommendDramas(project)
      const existing = stateRef.current.competitors[project.id] || []
      const rawResults = (payload.results || []).filter((candidate) => !sameDramaIdentity(project, candidate) && !existing.some((item) => sameDramaIdentity(item, candidate)) && sharedDimensions(project, candidate).length)
      const prepared = project.contentType === 'variety' ? rawResults : await prepareRecommendedCandidates(rawResults, { searchDramas, getDramaDetails })
      const results = prepared.filter((candidate) => sharedDimensions(project, candidate).length)
      if (!activeRef.current || stateRef.current.selectedId !== project.id) return []
      await preloadDramaPosters([project, ...results])
      if (!activeRef.current || stateRef.current.selectedId !== project.id) return []
      recommendationCacheRef.current.set(project.id, { results, window: payload.window || null })
      setRecommendations(results)
      setRecommendationWindow(payload.window || null)
      setRecommendationFor(project.id)
      if (!silent) appendActivity('同期分析', `已匹配 ${results.length} 部${project.contentType === 'variety' ? '综艺候选' : '可比同期剧'}`, 'success')
      return results
    })()
    recommendationRequestRef.current = { projectId: project.id, promise: requestPromise }
    try {
      return await requestPromise
    } catch (error) {
      const message = readableError(error, '同期剧推荐失败')
      if (activeRef.current && stateRef.current.selectedId === project.id) {
        setRecommendationError(message)
        if (!silent) appendActivity('同期分析', message, 'error')
      }
      return []
    } finally {
      if (recommendationRequestRef.current?.promise === requestPromise) {
        recommendationRequestRef.current = null
        setRecommendationLoading(false)
      }
    }
  }, [appendActivity, getDramaDetails, recommendDramas, searchDramas])

  const addProject = useCallback(async (result, reportProgress = null) => {
    setRecommendations([])
    setRecommendationWindow(null)
    setRecommendationFor('')
    setRecommendationError('')
    reportProgress?.({ percent: null, message: '正在读取剧集详情与数据源' })
    const detailPayload = await getDramaDetails(result, { timeoutMs: 45_000 })
    const details = detailPayload.result
    const desired = makeProject({ ...details, title: result.title || details.title, contentType: result.contentType || details.contentType })
    const current = stateRef.current
    const existing = current.projects.find((project) => sameDramaIdentity(project, desired))
    const project = existing ? makeProject({ ...desired, id: existing.id, createdAt: existing.createdAt }) : desired
    commit((state) => {
      const projects = existing ? state.projects.map((item) => item.id === existing.id ? project : item) : [...state.projects, project]
      const next = { ...state, projects, selectedId: project.id, competitors: { ...state.competitors, [project.id]: [] } }
      return appendLog(next, '项目', `《${project.title}》已创建，正在核对可用数据来源`, 'success')
    })
    reportProgress?.({ percent: null, message: '剧集资料已整理，开始核对各数据源' })
    // Prepare selectable candidates alongside the main source work, without
    // adding competitors to the pool or reporting a new visible progress task.
    const recommendationPreparation = loadRecommendations(project, false, { silent: true })
    const collectionTasks = []
    if (hasDimension(project, 'web')) collectionTasks.push({ label: '基础网端数据', run: () => foregroundCollection(ready => collectProject(project, true, false, reportProgress, ready)).ready })
    else updateCollection(project.id, { state: 'success', message: '台端项目已创建，网端猫眼热度不纳入当前主维度。', fetchedAt: new Date().toISOString(), sourceUrl: project.sourceUrl })
    tvCollectAttempts.current.add(`${project.id}:${todayInShanghai()}`)
    collectionTasks.push({ label: '台端数据', run: () => collectTvForProject(project, true, reportProgress) })
    // 等基础来源与台端落状态后进入看板。艺恩仍由原任务持有，继续
    // 双轮核验并保留会话取消、去重和关闭页面释放订阅的生命周期。
    let completed = 0
    await Promise.allSettled([recommendationPreparation, ...collectionTasks.map(async (task) => {
      reportProgress?.({ percent: null, completedTasks: completed, totalTasks: collectionTasks.length, message: `${task.label}开始抓取` })
      await task.run()
      completed += 1
      reportProgress?.({ percent: null, completedTasks: completed, totalTasks: collectionTasks.length, message: `${task.label}处理完成` })
    })])
    reportProgress?.({ percent: 100, message: '基础来源状态已整理，正在打开看板' })
    return project
  }, [collectProject, collectTvForProject, commit, loadRecommendations, updateCollection])

  const selectProject = useCallback((projectId) => {
    commit((state) => state.projects.some((project) => project.id === projectId) ? { ...state, selectedId: projectId } : state)
  }, [commit])

  const removeProject = useCallback((projectId) => {
    commit((state) => {
      const projects = state.projects.filter((project) => project.id !== projectId)
      const compact = (source) => Object.fromEntries(Object.entries(source).filter(([key]) => key !== projectId))
      const competitors = Object.fromEntries(Object.entries(compact(state.competitors)).map(([key, pool]) => [key, (pool || []).filter((project) => project.id !== projectId)]))
      const next = { ...state, projects, selectedId: state.selectedId === projectId ? projects[0]?.id || null : state.selectedId, competitors, liveHeat: compact(state.liveHeat), collection: compact(state.collection), tvRatings: compact(state.tvRatings), sourceSync: compact(state.sourceSync) }
      return appendLog(next, '项目', '已移除监测项目及其关联数据', 'info')
    })
  }, [commit])

  const addCompetitor = useCallback((result) => {
    const requestedMainId = stateRef.current.selectedId
    return competitorAddQueue.current(async () => {
      const main = stateRef.current.projects.find((project) => project.id === stateRef.current.selectedId)
      if (!main || main.id !== requestedMainId) throw new Error('主项目已切换，请重新选择')
      if ((stateRef.current.competitors[main.id] || []).length >= MAX_COMPARABLE_COMPETITORS) throw new Error(`分析列表最多保留 ${MAX_COMPARABLE_COMPETITORS} 部项目`)
      const prepared = recommendationCacheRef.current.get(requestedMainId)?.results.find((item) => item.detailsPrepared && sameDramaIdentity(item, result))
      const details = prepared || (await getDramaDetails(result)).result
      const candidate = makeProject({ ...details, ...(sameDramaIdentity(details, result) ? { poster: details.poster || result.poster } : {}), title: result.title || details.title, contentType: result.contentType || main.contentType || details.contentType })
      if (stateRef.current.selectedId !== requestedMainId) throw new Error('主项目已切换，请重新选择')
      if ((stateRef.current.competitors[main.id] || []).length >= MAX_COMPARABLE_COMPETITORS) throw new Error(`分析列表最多保留 ${MAX_COMPARABLE_COMPETITORS} 部项目`)
      if (sameDramaIdentity(main, candidate)) throw new Error('主项目不能加入自身的分析列表')
      if (!sharedDimensions(main, candidate).length) throw new Error('该剧与主项目没有可比播出端')
      if ((stateRef.current.competitors[main.id] || []).some((project) => sameDramaIdentity(project, candidate))) throw new Error('该剧已经在当前分析列表中')
      commit((state) => {
        const next = { ...state, competitors: { ...state.competitors, [main.id]: [...(state.competitors[main.id] || []), candidate] } }
        return appendLog(next, '同期分析', `《${candidate.title}》已加入《${main.title}》的分析列表`, 'success')
      })
      // A candidate may have been present in the restored session before removal.
      // Treat this add as a new collection lifecycle so the auto-collector can run.
      restoredProjectIds.current.delete(candidate.id)
      competitorIdentityAttempts.current.delete(candidate.id)
      clearCompetitorAttemptMarkers(competitorCollectionAttempts.current, candidate.id)
      setRecommendations((current) => current.filter((item) => !sameDramaIdentity(item, candidate)))
      return candidate
    })
  }, [commit])

  const removeCompetitor = useCallback((id) => {
    const main = stateRef.current.projects.find((project) => project.id === stateRef.current.selectedId)
    if (!main) return
    commit((state) => {
      const next = { ...state, competitors: { ...state.competitors, [main.id]: (state.competitors[main.id] || []).filter((project) => project.id !== id) } }
      return appendLog(next, '同期分析', '已从当前项目的分析列表移除项目', 'info')
    })
    restoredProjectIds.current.delete(id)
    competitorIdentityAttempts.current.delete(id)
    clearCompetitorAttemptMarkers(competitorCollectionAttempts.current, id)
  }, [commit])


  const saveManualSnapshot = useCallback((project, metric, value, rank = null) => {
    const numericValue = Number(value)
    if (!project?.id || !metric || !Number.isFinite(numericValue)) throw new Error('人工补录需要有效项目、指标和数值')
    const date = todayInShanghai()
    const fetchedAt = new Date().toISOString()
    commit((current) => {
      const rows = current.liveHeat[project.id] || []
      const existing = rows.find((row) => row.date === date)
      const values = { ...(existing?.values || {}), [metric]: numericValue }
      if (metric === '优酷电视剧热度榜值' && rank !== null && rank !== undefined && Number.isFinite(Number(rank))) values['优酷电视剧热度榜排名'] = Number(rank)
      const record = {
        ...(existing || { date, values: {}, sourceUrl: project.officialSite || project.sourceUrl, fetchedAt }),
        values,
        sourceUrl: project.officialSite || existing?.sourceUrl || project.sourceUrl,
        fetchedAt,
      }
      const next = {
        ...current,
        liveHeat: { ...current.liveHeat, [project.id]: [...rows.filter((row) => row.date !== date), record].sort((a, b) => a.date.localeCompare(b.date)) },
        collection: { ...current.collection, [project.id]: { state: 'success', message: `已人工核对并保存${metric}今日值`, fetchedAt, sourceUrl: record.sourceUrl } },
      }
      return appendLog(next, '人工补录', `《${project.title}》${metric}今日值已保存`, 'success')
    })
    return true
  }, [commit])

  const enqueueComparison = useCallback((mainId, project, { web, tv, force = false }) => runSharedTask(comparisonTasksRef.current, project.id, async () => {
    const previous = stateRef.current.comparisonJobs?.[project.id]
    const sameRange = previous?.to === todayInShanghai() && previous?.from === project.premiered
    const resumable = ['queued', 'running', 'interrupted'].includes(previous?.state)
    const steps = force || !sameRange || !resumable ? {} : { ...(previous?.steps || {}) }
    // A missing-TV repair must retain the earlier web step across a pause or
    // reload, so recovery neither re-fetches it nor forgets its source errors.
    if (!web && previous?.steps?.web) steps.web = true
    const update = (patch) => {
      commit(state => ({ ...state, comparisonJobs: { ...state.comparisonJobs, [project.id]: {
        ...state.comparisonJobs?.[project.id], mainId, from: project.premiered, to: todayInShanghai(),
        updatedAt: new Date().toISOString(), ...patch,
      } } }))
      writeState(stateRef.current)
    }
    update({ state: 'queued', steps })
    return competitorCollectionQueue.current(async () => {
      const current = stateRef.current
      const target = (current.competitors[mainId] || []).find(item => item.id === project.id)
      if (!target) return 0
      if (!activeRef.current || pageSuspendedRef.current || backgroundPausedRef.current || current.selectedId !== mainId) {
        update({ state: 'interrupted' })
        clearCompetitorAttemptMarkers(competitorCollectionAttempts.current, project.id)
        return 0
      }
      update({ state: 'running' })
      let count = 0
      let failed = false
      try {
        // Each title retains one serial slot; web and TV failures are isolated.
        for (const [name, enabled, run] of [
          ['web', web, () => collectProject(target, true, force)],
          ['tv', tv, () => collectTvForProject(target, force)],
        ]) {
          if (!enabled || steps[name]) continue
          if (pageSuspendedRef.current || backgroundPausedRef.current || !activeRef.current) break
          try { count += Number(await run()) || 0 } catch { failed = true /* Source errors stay in sourceSync. */ }
          if (pageSuspendedRef.current || backgroundPausedRef.current || !activeRef.current) break
          steps[name] = true
          update({ steps: { ...steps } })
        }
        const interrupted = pageSuspendedRef.current || backgroundPausedRef.current || !activeRef.current
        update({ state: interrupted ? 'interrupted' : failed ? 'partial' : comparisonResult(stateRef.current, target, { web: web || Boolean(previous?.steps?.web), tv }) })
        return count
      } catch (error) {
        update({ state: 'error', message: readableError(error, '分析作品采集失败') })
        return count
      }
    })
  }), [collectProject, collectTvForProject, commit])

  const refreshSelected = useCallback(async () => {
    const current = stateRef.current
    const main = current.projects.find((item) => item.id === current.selectedId)
    if (!main) return 0
    const competitors = [...(current.competitors[main.id] || [])]
    if (!competitors.length) return 0
    appendActivity('刷新', `正在重新抓取 ${competitors.length} 部分析作品，保留主剧《${main.title}》的数据`, 'info')
    const results = await Promise.all(competitors.map(project => enqueueComparison(main.id, project, {
      web: hasDimension(main, 'web') && hasDimension(project, 'web'),
      // A web-first catalogue entry can also have TV ratings. The source read
      // establishes availability, just as it does for the main project.
      tv: true,
      force: true,
    })))
    return results.reduce((sum, count) => sum + count, 0)
  }, [appendActivity, enqueueComparison])

  const refreshIdentity = useCallback(async (project = stateRef.current.projects.find((item) => item.id === stateRef.current.selectedId)) => {
    if (!project) return null
    let detailTarget = project
    if (project.provider !== 'catalog') {
      try {
        const candidates = await search(project.title, { contentType: project.contentType || 'drama' })
        const catalogMatch = candidates.find((candidate) => candidate.provider === 'catalog' && sameDramaIdentity({ ...project, provider: undefined, providerId: undefined }, candidate))
          || candidates.find((candidate) => candidate.provider === 'catalog' && candidate.title === project.title)
        if (catalogMatch) detailTarget = { ...project, provider: 'catalog', providerId: catalogMatch.providerId, maoyanSeriesId: catalogMatch.maoyanSeriesId || project.maoyanSeriesId }
      } catch {
        // Retain the currently selected provider when the auxiliary catalog lookup is unavailable.
      }
    }
    const payload = await getDramaDetails(detailTarget)
    const merged = detailProject(project, payload.result)
    replaceProject(merged)
    appendActivity('项目身份', `《${merged.title}》身份信息已重新核验`, 'success')
    return merged
  }, [appendActivity, replaceProject])

  const downloadRawData = useCallback(async () => {
    if (!exportTask.current) exportTask.current = createRawDataExportTask({ build: generateWorkbookInWorker, save: (bytes, snapshot) => {
      if (!activeRef.current) return
      saveRawDataFile(bytes, snapshot)
      appendActivity('Rawdata Download', '已导出生成开始时的主剧、分析作品及来源核验快照', 'success')
    } })
    if (!exportController.current || exportController.current.signal.aborted) exportController.current = new AbortController()
    setIsExporting(true)
    setExportError('')
    try {
      await exportTask.current(stateRef.current, { signal: exportController.current.signal })
    } catch (error) {
      if (activeRef.current && error?.name !== 'AbortError') setExportError(readableError(error, 'Excel导出失败，请重试'))
    } finally {
      if (activeRef.current) setIsExporting(false)
    }
  }, [appendActivity])


  useEffect(() => {
    if (!hydrated || !selectedProject || backgroundPausedRef.current) return
    if (restoredProjectIds.current.has(selectedProject.id)) return
    const credits = [...(selectedProject.directors || []), ...(selectedProject.cast || [])].map((name) => String(name).trim()).filter(Boolean)
    const hasRomanizedCredits = credits.length > 0 && credits.some((name) => !/[\u3400-\u9fff]/.test(name))
    const verification = selectedProject.identityVerification
    const current = (verification?.sources?.length || 0) >= 5
      && verification?.directors?.requiredAgreement === 5
      && !hasRomanizedCredits
      && (selectedProject.provider === 'catalog' || /猫眼/.test(selectedProject.primaryIdentitySource?.name || ''))
    if (current || identityRefreshAttempts.current.has(selectedProject.id)) return
    identityRefreshAttempts.current.add(selectedProject.id)
    void refreshIdentity(selectedProject).catch(() => undefined)
  }, [hydrated, refreshIdentity, selectedProject])

  useEffect(() => {
    if (!hydrated || !selectedProject || !selectedCompetitors.length || backgroundPausedRef.current || pageSuspendedRef.current) return
    for (const competitor of selectedCompetitors) {
      if (restoredProjectIds.current.has(competitor.id) && !shouldResumeComparison(stateRef.current, competitor)) continue
      const credits = [...(competitor.directors || []), ...(competitor.cast || [])].map((name) => String(name).trim()).filter(Boolean)
      const hasRomanizedCredits = credits.length > 0 && credits.some((name) => !/[\u3400-\u9fff]/.test(name))
      const needsIdentity = competitor.provider !== 'catalog'
        || !/猫眼/.test(competitor.primaryIdentitySource?.name || '')
        || hasRomanizedCredits
        || !competitor.poster
        || !(competitor.platforms || []).length
      if (needsIdentity && !competitorIdentityAttempts.current.has(competitor.id)) {
        competitorIdentityAttempts.current.add(competitor.id)
        void refreshIdentity(competitor).catch(() => undefined)
      }

      const pending = shouldResumeComparison(stateRef.current, competitor)
      const previousJob = stateRef.current.comparisonJobs?.[competitor.id]
      const repairMissingTv = ['complete', 'partial', 'error'].includes(previousJob?.state)
        && !previousJob.steps?.tv && !stateRef.current.sourceSync[competitor.id]?.tvRatings
      const webAttempt = `${competitor.id}:web:${todayInShanghai()}`
      const rows = stateRef.current.liveHeat[competitor.id] || []
      const hasPlatform = rows.some((record) => Object.keys(record.values || {}).some((name) => PLATFORM_METRIC_PATTERN.test(name) && record.values[name] !== null && record.values[name] !== undefined))
      const hasMangoPlatform = hasStoredMetric(rows, '芒果TV平台表现')
      const hasEffective = rows.some((record) => record.values?.['有效播放量'] !== null && record.values?.['有效播放量'] !== undefined)
      const hasEffectivePlatforms = rows.some((record) => Object.keys(record.values || {}).some((name) => EFFECTIVE_PLATFORM_METRIC_PATTERN.test(name) && record.values[name] !== null && record.values[name] !== undefined))
      const effectiveCumulativeChecked = stateRef.current.sourceSync[competitor.id]?.maoyan?.effectiveCumulativeMappingVersion === EFFECTIVE_CUMULATIVE_MAPPING_VERSION
      const collection = stateRef.current.collection[competitor.id]
      const checkedToday = collection?.fetchedAt && todayInShanghai(new Date(collection.fetchedAt)) === todayInShanghai()
      const shouldCollectWeb = !repairMissingTv && hasDimension(selectedProject, 'web') && hasDimension(competitor, 'web') && (pending || !checkedToday || !hasPlatform || !hasMangoPlatform || !hasEffective || !hasEffectivePlatforms || !effectiveCumulativeChecked) && !competitorCollectionAttempts.current.has(webAttempt)
      const tvAttempt = `${competitor.id}:tv:${todayInShanghai()}`
      const tvSync = stateRef.current.sourceSync[competitor.id]?.tvRatings
      const shouldCollectTv = !competitorCollectionAttempts.current.has(tvAttempt) && (pending || shouldAutoCollectTvRatings((stateRef.current.tvRatings[competitor.id] || []).length, tvSync?.fetchedAt, todayInShanghai(), collectingTvRef.current.has(competitor.id), false, tvSync?.state))
      if (!shouldCollectWeb && !shouldCollectTv) continue
      if (shouldCollectWeb) competitorCollectionAttempts.current.add(webAttempt)
      if (shouldCollectTv) competitorCollectionAttempts.current.add(tvAttempt)
      void enqueueComparison(selectedProject.id, competitor, { web: shouldCollectWeb, tv: shouldCollectTv })
    }
  }, [enqueueComparison, hydrated, refreshIdentity, selectedCompetitors, selectedProject, resumeRevision])


  useEffect(() => {
    if (!hydrated || !selectedProject || backgroundPausedRef.current) return
    if (restoredProjectIds.current.has(selectedProject.id)) return
    const today = todayInShanghai()
    const collectKey = `${selectedProject.id}:${today}`
    if (hasDimension(selectedProject, 'web') && !autoCollectAttempts.current.has(collectKey)) {
      autoCollectAttempts.current.add(collectKey)
      void collectProject(selectedProject, true)
    }
    const sync = projectState.sourceSync[selectedProject.id]?.tvRatings
    const tvKey = `${selectedProject.id}:${today}`
    if (shouldAutoCollectTvRatings((projectState.tvRatings[selectedProject.id] || []).length, sync?.fetchedAt, today, collectingTvRef.current.has(selectedProject.id), tvCollectAttempts.current.has(tvKey), sync?.state)) {
      tvCollectAttempts.current.add(tvKey)
      void collectTvForProject(selectedProject, true)
    }
  }, [collectProject, collectTvForProject, hydrated, projectState.sourceSync, projectState.tvRatings, selectedProject])

  return {
    hydrated,
    isRestoredSession: restoredSession.current,
    endSession,
    pauseBackground,
    resumeBackground,
    storageWarning,
    isExporting,
    exportError,
    projectState,
    selectedProject,
    collectingProjectIds,
    collectingTvRatingsById,
    recommendations,
    recommendationWindow,
    recommendationLoading,
    recommendationError,
    sourceStatusClass,
    search,
    addProject,
    selectProject,
    removeProject,
    addCompetitor,
    removeCompetitor,
    loadRecommendations,
    saveManualSnapshot,
    collectProject,
    collectTvForProject,
    loadEndataHistory: backfillEndataHistory,
    refreshSelected,
    refreshIdentity,
    downloadRawData,
  }
}
