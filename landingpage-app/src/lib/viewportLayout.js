export const DESIGN_VIEWPORT = Object.freeze({ width: 1920, height: 1080 })
// Frozen from the live online dashboard's landscape reference on 2026-10-16.
// Scale the whole canvas; its internal geometry must never follow the viewport.
export const DASHBOARD_CANVAS = Object.freeze({ width: 1643, height: 905 })

export function desktopLayoutScale(width, height) {
  if (width <= 1024) return 1
  const headerHeight = Math.max(56, 83 * heroLayoutScale(width, height))
  const contentHeight = DASHBOARD_CANVAS.height - 83
  return Math.min(width / DASHBOARD_CANVAS.width, height / DASHBOARD_CANVAS.height, (height - headerHeight) / contentHeight)
}

export function heroLayoutScale(width, height) {
  return width <= 1024 ? 1 : Math.min(width / 1920, height / 1080, 1) * 0.9
}

// The landing poster wall and device preview share width-based coordinates.
// Window height must not insert extra space between these two illustrations.
export function landingHeroScale(width) {
  return width <= 1024 ? 1 : Math.min(width / 1920, 1) * 0.9
}
