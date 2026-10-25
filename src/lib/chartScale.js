export function visibleDataMaximum(extent) {
  const max = Number(extent?.max)
  if (!Number.isFinite(max)) return undefined
  return max
}

// A constant rank of 1 must retain a non-degenerate integer extent.
export function visibleRankMaximum(extent) {
  const max = Number(extent?.max)
  return Number.isFinite(max) ? Math.max(2, Math.ceil(max)) : 2
}
