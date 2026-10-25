// First-party, best-effort telemetry. No input values, URLs, IPs or user-agent data.
export const ANALYTICS_OPT_OUT = 'finetech.analytics.optOut'
const visitorKey = 'finetech.analytics.visitor'
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export const analyticsName = (value) => String(value || '').replace(/[^\p{L}\p{N} .:_-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)

export function createTracker({ win, doc, send = (body) => win.fetch('/api/analytics/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }) }) {
  let visitor, page = '', pageDay = '', timer, running = false, inFlight = false
  let queue = []
  const allowed = () => {
    try { if (win.localStorage.getItem(ANALYTICS_OPT_OUT) === '1') return false } catch { /* storage can be unavailable in private mode */ }
    return win.navigator.doNotTrack !== '1' && !win.navigator.globalPrivacyControl
  }
  const identity = () => {
    if (visitor) return visitor
    try { visitor = win.localStorage.getItem(visitorKey) } catch { /* per-page identity fallback */ }
    if (!uuid.test(visitor || '')) {
      visitor = win.crypto.randomUUID()
      try { win.localStorage.setItem(visitorKey, visitor) } catch { /* keep in memory only */ }
    }
    return visitor
  }
  const flush = async () => {
    win.clearTimeout(timer)
    timer = undefined
    if (!allowed()) { queue = []; return }
    if (inFlight || !queue.length) return
    const batch = queue.splice(0, 30)
    inFlight = true
    try {
      const response = await send(JSON.stringify({ visitor: identity(), events: batch }))
      if (!response.ok && response.status >= 500) queue = [...batch, ...queue].slice(-90)
    } catch { queue = [...batch, ...queue].slice(-90) }
    finally { inFlight = false; if (queue.length) timer = win.setTimeout(flush, 10000) }
  }
  const currentDay = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
  const record = (kind, component, action) => {
    if (!page || !allowed()) return
    if (kind === 'click' && pageDay !== currentDay()) { pageDay = currentDay(); record('pageview', 'page', 'view') }
    queue.push({ id: win.crypto.randomUUID(), at: Date.now(), kind, page, component: analyticsName(component) || 'page', action: analyticsName(action) || 'click' })
    queue = queue.slice(-90)
    if (queue.length >= 20) void flush()
    else if (!timer) timer = win.setTimeout(() => { timer = undefined; void flush() }, 3000)
  }
  const click = (event) => {
    const target = event.target?.closest?.('button,a,input,select,[role="button"],canvas,[data-analytics-action]')
    if (!target || target.disabled || target.closest('[data-analytics-ignore]')) return
    const root = target.closest('[data-analytics-component]')
    const component = root?.getAttribute('data-analytics-component') || 'page'
    if (target.tagName === 'SELECT') return // Count a selected preset in change, not opening the menu.
    const isInput = /^(INPUT|SELECT)$/.test(target.tagName)
    if (target.tagName === 'INPUT' && !['button', 'submit', 'checkbox', 'radio', 'range'].includes(target.type) && !target.getAttribute('data-analytics-action')) return
    const action = target.getAttribute('data-analytics-action') || target.getAttribute('aria-label') || (isInput ? target.name || target.type : target.tagName === 'CANVAS' ? '图表交互' : target.textContent) || 'click'
    record('click', component, action)
  }
  const change = (event) => {
    const target = event.target
    if (target?.tagName !== 'SELECT' || target.closest('[data-analytics-ignore]')) return
    // Only authored option labels are recorded; arbitrary input values never leave the browser.
    const action = target.selectedOptions?.[0]?.getAttribute?.('data-analytics-action')
    if (action) record('click', target.closest('[data-analytics-component]')?.getAttribute('data-analytics-component') || 'page', action)
  }
  const submit = (event) => {
    const form = event.target
    const action = form?.getAttribute?.('data-analytics-submit')
    if (!action || form.closest('[data-analytics-ignore]')) return
    record('click', form.closest('[data-analytics-component]')?.getAttribute('data-analytics-component') || 'page', action)
  }
  const enter = (event) => {
    if (event.key !== 'Enter' || event.isComposing || event.repeat) return
    const target = event.target
    const action = target?.getAttribute?.('data-analytics-enter')
    if (!action || target.closest('[data-analytics-ignore]')) return
    record('click', target.closest('[data-analytics-component]')?.getAttribute('data-analytics-component') || 'page', action)
  }
  const hidden = () => {
    if (doc.visibilityState === 'hidden') void flush()
    else if (doc.visibilityState === 'visible' && page && pageDay !== currentDay()) {
      pageDay = currentDay(); record('pageview', 'page', 'view')
    }
  }
  return {
    start() {
      if (running) return
      running = true
      doc.addEventListener('click', click, true)
      doc.addEventListener('submit', submit, true)
      doc.addEventListener('change', change, true)
      doc.addEventListener('keydown', enter, true)
      doc.addEventListener('visibilitychange', hidden)
      win.addEventListener('pagehide', flush)
    },
    page(next) {
      if (page === next && pageDay === currentDay()) return // React StrictMode must not double-count entry.
      page = next; pageDay = currentDay()
      record('pageview', 'page', 'view')
    },
    flush,
    stop() {
      running = false; win.clearTimeout(timer)
      doc.removeEventListener('click', click, true)
      doc.removeEventListener('submit', submit, true)
      doc.removeEventListener('change', change, true)
      doc.removeEventListener('keydown', enter, true)
      doc.removeEventListener('visibilitychange', hidden)
      win.removeEventListener('pagehide', flush)
    },
  }
}

let tracker
export function startAnalytics() {
  try { tracker ||= createTracker({ win: window, doc: document }); tracker.start() } catch { /* telemetry must never block the app */ }
}
export function trackPage(page) {
  try { tracker?.page(page) } catch { /* telemetry must never block the app */ }
}
