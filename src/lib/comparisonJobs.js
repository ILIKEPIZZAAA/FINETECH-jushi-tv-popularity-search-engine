// Transport progress is separate from source verification. A returned job can
// still contain unresolved source dates; it must never be labelled verified.
export const comparisonJobActive = job => ['queued', 'running'].includes(job?.state)

export function shouldResumeComparison(state, project) {
  const job = state.comparisonJobs?.[project.id]
  // Older jobs could complete their web step without ever probing TV because
  // catalogue labels excluded them. Repair that omission once, including saved
  // completed jobs; an attempted/failed TV read remains an explicit failure.
  if (job) return ['queued', 'running', 'interrupted'].includes(job.state)
    || (!job.steps?.tv && !state.sourceSync?.[project.id]?.tvRatings)
  // Migration for saved dashboards created before durable comparison jobs.
  const sources = state.sourceSync?.[project.id] || {}
  const expected = ['tvRatings', 'maoyan', 'guduo', ...(project.contentType === 'variety' ? [] : ['ky'])]
  const sync = Object.values(sources)
  return expected.some(name => !sources[name]) || sync.some(source => ['loading', 'error', 'partial'].includes(source?.state) || source?.interruptedAt)
}

export function comparisonResult(state, project, { web, tv }) {
  const sync = state.sourceSync?.[project.id] || {}
  const sources = [...(web ? ['maoyan', 'guduo', ...(project.contentType === 'variety' ? [] : ['ky'])] : []), ...(tv ? ['tvRatings'] : [])]
  return sources.length && sources.every(source => ['success', 'empty'].includes(sync[source]?.state) && sync[source]?.complete !== false && sync[source]?.historyVerification?.verified !== false && sync[source]?.verification?.verified !== false) ? 'complete' : 'partial'
}

export function comparisonJobLabel(job) {
  return ({ queued: '等待采集', running: '数据采集中', interrupted: '采集中断，待恢复', complete: '采集完成', partial: '', error: '采集失败，请重试' })[job?.state] || ''
}
