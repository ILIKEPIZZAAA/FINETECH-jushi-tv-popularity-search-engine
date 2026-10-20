const POINTER_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'click', 'wheel']

export function installEchartsPointerCoordinates(chart, container) {
  const normalizeCoordinates = (event) => {
    if (!(event.target instanceof HTMLCanvasElement)) return

    const rect = container.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    // The dashboard canvas is CSS-zoomed to fit the viewport. ECharts reads
    // offsetX/Y in its unzoomed coordinate space, so translate viewport
    // coordinates before ZRender handles slider drags and wheel zooms.
    event.zrX = (event.clientX - rect.left) * (chart.getWidth() / rect.width)
    event.zrY = (event.clientY - rect.top) * (chart.getHeight() / rect.height)
  }

  POINTER_EVENTS.forEach((type) => container.addEventListener(type, normalizeCoordinates, true))
  return () => POINTER_EVENTS.forEach((type) => container.removeEventListener(type, normalizeCoordinates, true))
}
