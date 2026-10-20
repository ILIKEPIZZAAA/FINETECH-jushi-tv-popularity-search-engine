import { useCallback, useEffect, useRef, useState } from 'react'
import { dashboardIdleStatus, readDashboardSession, saveDashboardSession } from '../lib/dashboardSession.js'

export function useDashboardIdle(enabled, onExpire) {
  const [secondsLeft, setSecondsLeft] = useState(null)
  const resumeRef = useRef(() => {})
  const expireRef = useRef(onExpire)
  expireRef.current = onExpire

  useEffect(() => {
    if (!enabled) { setSecondsLeft(null); return undefined }
    const saved = Number(readDashboardSession().lastActivityAt)
    let lastActivity = saved > 0 && saved <= Date.now() ? saved : Date.now()
    let timer, warning = false, disposed = false
    saveDashboardSession({ lastActivityAt: lastActivity })
    const check = () => {
      window.clearTimeout(timer)
      if (disposed) return
      const status = dashboardIdleStatus(lastActivity, Date.now())
      if (status.expired) { disposed = true; expireRef.current(); return }
      warning = status.warning
      setSecondsLeft(warning ? status.secondsLeft : null)
      timer = window.setTimeout(check, status.nextCheckMs)
    }
    const resume = () => {
      lastActivity = Date.now()
      saveDashboardSession({ lastActivityAt: lastActivity })
      check()
    }
    const activity = () => {
      if (dashboardIdleStatus(lastActivity, Date.now()).warning) { check(); return }
      if (warning || Date.now() - lastActivity < 1000) return
      resume()
    }
    // Checking before an activity prevents a sleeping/hidden tab from reviving
    // an expired session when its first event is delivered after the deadline.
    const visibility = () => { if (!document.hidden) check() }
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']
    for (const name of events) window.addEventListener(name, activity, { passive: true })
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pageshow', check)
    resumeRef.current = resume
    check()
    return () => {
      disposed = true
      window.clearTimeout(timer)
      for (const name of events) window.removeEventListener(name, activity)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pageshow', check)
      resumeRef.current = () => {}
    }
  }, [enabled])

  const continueViewing = useCallback(() => resumeRef.current(), [])
  return { secondsLeft, continueViewing }
}
