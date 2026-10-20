import { posterUrl } from '../lib/posterUrl.js'

export function PosterImage({ src, onError, ...props }) {
  const optimized = posterUrl(src)
  return <img {...props} src={optimized} decoding="async" referrerPolicy="no-referrer" onError={event => {
    if (optimized !== src && event.currentTarget.getAttribute('src') === optimized) {
      event.currentTarget.src = src
      return
    }
    onError?.(event)
  }} />
}
