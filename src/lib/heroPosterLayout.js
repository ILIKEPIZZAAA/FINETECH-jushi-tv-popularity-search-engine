export function buildHeroPosterRows(posters) {
  const groups = new Map()
  const hashes = new Set()
  for (const poster of posters) {
    if (hashes.has(poster.sourceSha256)) continue
    hashes.add(poster.sourceSha256)
    if (!groups.has(poster.showId)) groups.set(poster.showId, [])
    groups.get(poster.showId).push(poster)
  }
  const rows = [[], []]
  ;[...groups.values()].forEach((group, index) => rows[index % 2].push(group))
  return rows
}

export function heroPosterRowFrame(count, width, scale, elapsed, rowIndex) {
  if (!Number.isFinite(width) || !Number.isFinite(scale) || count <= 0 || width <= 0 || scale <= 0) return []
  const basePitch = 176 * scale
  // Wider windows use the available unique cards with more spacing. Card size,
  // arc, direction and speed continue to use the approved design coordinates.
  const pitch = Math.max(basePitch, width / Math.max(1, count - 4))
  const span = count * pitch
  const direction = rowIndex === 0 ? 1 : -1
  const offset = elapsed * (rowIndex === 0 ? 22 : 25) * scale * direction + rowIndex * pitch * 2.3
  return Array.from({ length: count }, (_, index) => {
    const raw = index * pitch + offset + pitch * 2
    return { x: ((raw % span) + span) % span - pitch * 2, cycle: Math.floor(raw / span), pitch }
  })
}

export function posterForCycle(versions, cycle) {
  return versions[((cycle % versions.length) + versions.length) % versions.length]
}
