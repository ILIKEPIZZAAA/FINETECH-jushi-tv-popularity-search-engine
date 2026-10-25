import { posterUrl } from './posterUrl.js'

// Keep decoded images alive for this tab. Failed images remain retryable and
// never change drama metadata, collection status, or source verification.
export function createPosterPreloader({ createImage = () => typeof Image === 'function' ? new Image() : null, timeoutMs = 8000, maxEntries = 64 } = {}) {
  const cache = new Map()
  const load = (src) => {
    if (cache.has(src)) return cache.get(src).promise
    let image
    try { image = createImage() } catch { return Promise.resolve({ src, state: 'error' }) }
    if (!image) return Promise.resolve({ src, state: 'unavailable' })
    let complete
    const promise = new Promise(resolve => { complete = resolve })
    const entry = { image, promise, settled: false }
    cache.set(src, entry)
    const finish = (state) => {
      if (entry.settled) return
      entry.settled = true
      clearTimeout(timer)
      image.onload = null
      image.onerror = null
      if (state !== 'ready' && cache.get(src) === entry) cache.delete(src)
      for (const [key, candidate] of cache) {
        if (cache.size <= maxEntries) break
        if (candidate.settled) cache.delete(key)
      }
      complete({ src, state })
    }
    const timer = setTimeout(() => finish('timeout'), timeoutMs)
    image.onload = () => {
      Promise.resolve().then(() => image.decode?.()).then(() => finish('ready'), () => finish('error'))
    }
    image.onerror = () => finish('error')
    try { image.src = src } catch { finish('error') }
    return promise
  }
  return (items = []) => {
    const urls = [...new Set(items.map(item => item?.poster).filter(src => typeof src === 'string' && /^(?:https?:|data:|\/assets\/)/.test(src)).map(posterUrl))]
    return Promise.all(urls.map(load))
  }
}

export const preloadDramaPosters = createPosterPreloader()
