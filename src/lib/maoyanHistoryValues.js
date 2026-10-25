// Preserve explicit source zero without coercing an absent heat/rank to zero.
export function maoyanHistoryNumericValues(row = {}) {
  const values = {}
  for (const [field, metric] of [['heat', '猫眼热度'], ['rank', '猫眼热度排名']]) {
    const value = row[field]
    if ((typeof value !== 'number' && typeof value !== 'string')
      || (typeof value === 'string' && !value.trim())) continue
    const number = Number(value)
    if (Number.isFinite(number)) values[metric] = number
  }
  return values
}
