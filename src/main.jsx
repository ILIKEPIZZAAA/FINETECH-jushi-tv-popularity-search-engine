import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { Header } from './components/Header.jsx'
import { startAnalytics } from './lib/analytics.js'
import './styles/tokens.css'
import './styles/global.css'
import './styles/landing-page-final.css'
import './styles/hero-poster-wall.css'
import './styles/responsive.css'
import './styles/dashboard-redesign.css'

const isStats = window.location.pathname.replace(/\/$/, '') === '/stats'
const AnalyticsPage = lazy(() => import('./components/AnalyticsPage.jsx'))
if (!isStats) {
  startAnalytics()
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Header />
    {isStats ? <Suspense fallback={<p role="status">正在打开统计看板…</p>}><AnalyticsPage /></Suspense> : <App />}
  </StrictMode>,
)
