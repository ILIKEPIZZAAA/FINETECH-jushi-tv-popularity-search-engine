export function programType(value) {
  return value === 'variety' ? 'variety' : 'drama'
}

export function knownProgramType(item) {
  if (item?.contentType === 'variety' || item?.contentType === 'drama') return item.contentType
  const category = [...(item?.genres || []), item?.categoryDesc || ''].join(' ')
  if (/综艺|真人秀|脱口秀|Reality|Talk Show|Game Show/i.test(category)) return 'variety'
  if (/电视剧|网剧|电视连续剧|Scripted/i.test(category)) return 'drama'
  return null
}

export function searchResultsForType(results, type) {
  const contentType = programType(type)
  return results.filter((item) => !knownProgramType(item) || knownProgramType(item) === contentType)
    .map((item) => ({ ...item, contentType }))
}
