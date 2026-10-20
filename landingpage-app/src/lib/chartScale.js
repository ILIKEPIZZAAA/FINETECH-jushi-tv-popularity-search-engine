export function visibleDataMaximum(extent) {
  const max = Number(extent?.max)
  if (!Number.isFinite(max)) return undefined
  return max
}
