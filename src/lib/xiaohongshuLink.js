export const XIAOHONGSHU_PROFILE_WEB = 'https://xhslink.cn/o/A0Cfs7v04sJ'
export const XIAOHONGSHU_PROFILE_APP = 'xhsdiscover://user/5fb93d4a000000000100648a'

// The app's official user-profile scheme is launched inside the click gesture.
// A successful app switch hides the page; cancel the web fallback at that point.
export function openXiaohongshuApp(browserWindow, browserDocument) {
  let timer
  const cleanup = () => {
    browserWindow.clearTimeout(timer)
    browserWindow.removeEventListener('pagehide', cleanup)
    browserDocument.removeEventListener('visibilitychange', handleVisibility)
  }
  const handleVisibility = () => {
    if (browserDocument.visibilityState === 'hidden') cleanup()
  }
  browserWindow.addEventListener('pagehide', cleanup)
  browserDocument.addEventListener('visibilitychange', handleVisibility)
  timer = browserWindow.setTimeout(() => {
    cleanup()
    if (browserDocument.visibilityState !== 'hidden') browserWindow.location.assign(XIAOHONGSHU_PROFILE_WEB)
  }, 1800)
  try {
    browserWindow.location.assign(XIAOHONGSHU_PROFILE_APP)
  } catch {
    cleanup()
    browserWindow.location.assign(XIAOHONGSHU_PROFILE_WEB)
  }
  return cleanup
}
