export function supportedPosterSource(source) {
  try {
    const url = new URL(source)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && (
      /^(?:[a-z0-9-]+\.)?meituan\.net$/.test(url.hostname) ||
      /^p\d+\.pipi\.cn$/.test(url.hostname) ||
      /^img\d*\.doubanio\.com$/.test(url.hostname) ||
      url.hostname === 'static.tvmaze.com'
    )
  } catch { return false }
}

// Presentation only: retain the original source URL on every drama record.
export function posterUrl(source) {
  return supportedPosterSource(source) ? `/api/poster?src=${encodeURIComponent(source)}` : source
}
