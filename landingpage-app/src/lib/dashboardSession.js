export const DASHBOARD_SESSION_KEY = 'drama-signal-web-session-v1'
export const DASHBOARD_IDLE_MS = 15 * 60 * 1000
export const DASHBOARD_IDLE_GRACE_MS = 60 * 1000

export function readDashboardSession() {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(DASHBOARD_SESSION_KEY) || 'null')
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
  } catch { return {} }
}

export function saveDashboardSession(patch) {
  try {
    window.sessionStorage.setItem(DASHBOARD_SESSION_KEY, JSON.stringify({ ...readDashboardSession(), ...patch }))
  } catch { /* The existing dashboard data warning covers unavailable storage. */ }
}

export function dashboardView(projectId) {
  const saved = readDashboardSession()
  if (saved.projectId !== projectId) return {}
  return {
    view: ['heat', 'tv', 'competitor', 'logs'].includes(saved.view) ? saved.view : 'heat',
    platform: ['maoyan', 'guduo', 'kuyun'].includes(saved.platform) ? saved.platform : 'maoyan',
    dimension: typeof saved.dimension === 'string' ? saved.dimension : 'heat',
  }
}

// A reload ends the old HTTP subscriptions. Keep every observation and audit
// field; an interrupted source must remain unverified until an explicit retry.
export function interruptRestoredCollections(state, now = new Date().toISOString()) {
  const interrupt = value => value?.state === 'loading' ? {
    ...value, state: 'error', interruptedAt: now,
    message: '上次采集已中断，已保留收到的数据；点击刷新数据可重新核验。',
  } : value
  return {
    ...state,
    collection: Object.fromEntries(Object.entries(state.collection || {}).map(([id, value]) => [id, interrupt(value)])),
    sourceSync: Object.fromEntries(Object.entries(state.sourceSync || {}).map(([id, sources]) => [id,
      Object.fromEntries(Object.entries(sources || {}).map(([source, value]) => [source, interrupt(value)])),
    ])),
  }
}

export function dashboardIdleStatus(lastActivity, now) {
  const warningAt = lastActivity + DASHBOARD_IDLE_MS
  const expiresAt = warningAt + DASHBOARD_IDLE_GRACE_MS
  return {
    warning: now >= warningAt,
    expired: now >= expiresAt,
    secondsLeft: Math.max(0, Math.ceil((expiresAt - now) / 1000)),
    nextCheckMs: now < warningAt ? warningAt - now : 1000,
  }
}
