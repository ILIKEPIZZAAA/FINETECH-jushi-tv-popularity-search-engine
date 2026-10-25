import { lazy, Suspense, useEffect, useState } from 'react'
import { fallbackFeatures, fallbackSite } from './data/fallback.js'
import { HeroSection } from './components/HeroSection.jsx'
import { FeatureGrid } from './components/FeatureGrid.jsx'
import { Footer } from './components/Footer.jsx'
import { DisclaimerModal } from './components/DisclaimerModal.jsx'
import { FetchingScreen } from './components/FetchingScreen.jsx'
import { useDramaMonitor } from './hooks/useDramaMonitor.js'
import { trackPage } from './lib/analytics.js'
import { resetBusinessStorage } from './lib/dramaMonitor.js'
import { landingHeroScale } from './lib/viewportLayout.js'
import { useRankings } from './hooks/useRankings.js'
import { useDashboardIdle } from './hooks/useDashboardIdle.js'
import { DashboardIdleDialog } from './components/DashboardIdleDialog.jsx'

const loadDashboard = () => import('./components/WebHeatPage.jsx').then(module => ({ default: module.WebHeatPage }))
const WebHeatPage = lazy(loadDashboard)

export default function App() {
  const [session, setSession] = useState(0)
  return <MonitorApp key={session} onReset={() => {
    resetBusinessStorage()
    window.history.replaceState(null, '', '/')
    setSession((current) => current + 1)
  }} />
}

function MonitorApp({ onReset }) {
  const [heroScale, setHeroScale] = useState(() => landingHeroScale(window.innerWidth))
  useEffect(() => {
    const resize = () => setHeroScale(landingHeroScale(window.innerWidth))
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  // These local values mirror the future site-config/features API shape.
  // The API can be wired in here later without changing the page modules.
  const site = fallbackSite
  const features = fallbackFeatures
  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [isFetchingExiting, setIsFetchingExiting] = useState(false)
  const [isDataReady, setIsDataReady] = useState(false)
  const [fetchProgress, setFetchProgress] = useState({ percent: 0, logs: [], sources: {}, completedTasks: 0, totalTasks: 0 })
  const [isDashboard, setIsDashboard] = useState(false)
  const [selectedTitle, setSelectedTitle] = useState('')
  const monitor = useDramaMonitor()
  const isDashboardFlow = new URLSearchParams(window.location.search).get('flow') === 'dashboard' && Boolean(monitor.selectedProject)
  const showDashboard = !isFetching && Boolean(monitor.selectedProject) && (isDashboard || isDashboardFlow || monitor.isRestoredSession)
  const rankings = useRankings(monitor.hydrated && !showDashboard)
  const exitDashboard = () => {
    monitor.endSession()
    onReset()
  }
  const idle = useDashboardIdle(monitor.hydrated && showDashboard, monitor.pauseBackground)

  useEffect(() => {
    if (!showDashboard) return
    const url = new URL(window.location.href)
    url.searchParams.set('flow', 'dashboard')
    url.hash = ''
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }, [showDashboard])

  useEffect(() => {
    if (monitor.hydrated && !showDashboard) trackPage(isFetching ? 'fetching' : 'home')
  }, [monitor.hydrated, showDashboard, isFetching])

  useEffect(() => {
    if (!isFetching || !isDataReady) return undefined

    const exitTimer = window.setTimeout(() => setIsFetchingExiting(true), 260)
    const dashboardTimer = window.setTimeout(() => {
      setIsFetching(false)
      setIsFetchingExiting(false)
      setIsDashboard(true)
    }, 880)

    return () => {
      window.clearTimeout(exitTimer)
      window.clearTimeout(dashboardTimer)
    }
  }, [isDataReady, isFetching])

  if (!monitor.hydrated) return <p className="dashboard-session-loading" role="status">正在恢复页面…</p>

  if (showDashboard) {
    return (
      <>
      <Suspense fallback={<FetchingScreen progress={fetchProgress.percent} logs={fetchProgress.logs} sources={fetchProgress.sources} completedTasks={fetchProgress.completedTasks} totalTasks={fetchProgress.totalTasks} />}>
      <WebHeatPage
        onBack={exitDashboard}
        title={monitor.selectedProject?.title || selectedTitle || '逐玉'}
        project={monitor.selectedProject}
        projectState={monitor.projectState}
        collectionProgress={fetchProgress}
        storageWarning={monitor.storageWarning}
        recommendations={monitor.recommendations}
        recommendationWindow={monitor.recommendationWindow}
        recommendationLoading={monitor.recommendationLoading}
        recommendationError={monitor.recommendationError}
        onAddCompetitor={monitor.addCompetitor}
        onRemoveCompetitor={monitor.removeCompetitor}
        onLoadRecommendations={monitor.loadRecommendations}
        onLoadEndata={monitor.loadEndataHistory}
        onRefresh={async () => { await monitor.resumeBackground(); idle.continueViewing(); return monitor.refreshSelected() }}
        onDownloadRawData={monitor.downloadRawData}
        isExporting={monitor.isExporting}
        exportError={monitor.exportError}
        collectingProjectIds={monitor.collectingProjectIds}
        collectingTvRatingsById={monitor.collectingTvRatingsById}
      />
      </Suspense>
      {idle.secondsLeft !== null ? <DashboardIdleDialog secondsLeft={idle.secondsLeft} onContinue={idle.continueViewing} onPause={idle.pauseNow} /> : null}
      </>
    )
  }

  return (
    <main className={`landing-page ${isFetching ? 'is-transitioning' : ''}`} style={{ '--hero-design-px': heroScale }}>
      <HeroSection
        brand={site.brand}
        title={site.hero.title}
        tagline={site.hero.tagline}
        searchPlaceholder={site.hero.searchPlaceholder}
        onSearch={monitor.search}
        rankings={rankings}
        onResultSelected={async (result) => {
          // Load chart code during collection while the fetching screen stays visible.
          void loadDashboard().catch(() => {})
          setIsFetching(true)
          setIsDataReady(false)
          setFetchProgress({ percent: null, logs: [{ id: `${Date.now()}-start`, message: '正在读取剧集详情与数据源' }], sources: {}, completedTasks: 0, totalTasks: 0 })
          try {
            const project = await monitor.addProject(result, (update) => {
              setFetchProgress((current) => ({
                percent: Object.hasOwn(update, 'percent') ? update.percent : current.percent,
                completedTasks: Number.isFinite(update.completedTasks) ? update.completedTasks : current.completedTasks,
                totalTasks: Number.isFinite(update.totalTasks) ? update.totalTasks : current.totalTasks,
                sources: update.source ? { ...current.sources, [update.source]: { ...(current.sources[update.source] || {}), ...(update.detail || {}) } } : current.sources,
                logs: update.message ? [{ id: `${Date.now()}-${Math.random()}`, message: update.message }, ...current.logs].slice(0, 12) : current.logs,
              }))
            })
            setSelectedTitle(project?.title ?? result?.title ?? '')
            setIsDataReady(true)
          } catch (error) {
            setIsFetching(false)
            setIsFetchingExiting(false)
            throw error
          }
        }}
      />
      <FeatureGrid features={features} rankings={rankings} />
      <Footer footer={site.footer} onOpenDisclaimer={() => setIsDisclaimerOpen(true)} />
      {isFetching ? <FetchingScreen isExiting={isFetchingExiting} progress={fetchProgress.percent} logs={fetchProgress.logs} sources={fetchProgress.sources} completedTasks={fetchProgress.completedTasks} totalTasks={fetchProgress.totalTasks} /> : null}
      {isDisclaimerOpen ? <DisclaimerModal onClose={() => setIsDisclaimerOpen(false)} /> : null}
    </main>
  )
}
