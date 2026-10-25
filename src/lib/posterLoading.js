export function loadPosterWhenNearViewport(image) {
  if (!image || image.getAttribute('src')) return false
  const source = image.getAttribute('data-poster-src')
  if (!source) return false
  image.setAttribute('src', source)
  return true
}

export function createAnimationPaintGate(fps = 30) {
  let previous = -Infinity
  return (time, force = false) => {
    if (!force && time - previous < 1000 / fps - 0.1) return false
    previous = time
    return true
  }
}
