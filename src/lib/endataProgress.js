export function endataProgressText(detail, now) {
  const parts = []
  if (detail.pass) parts.push(detail.pass === 3 ? '差异补核' : `第 ${detail.pass}/2 轮独立读取`)
  if (detail.state === 'queued') parts.push(`等待浏览器 · 队列 ${detail.waitingTasks ?? '?'} 项`)
  if (Number.isFinite(detail.readDays)) parts.push(`本轮已处理 ${detail.readDays}/${detail.totalDays} 天`)
  if (detail.currentDate) parts.push(`当前 ${detail.currentDate}`)
  if (detail.state === 'incomplete') parts.push('核验未完成，未核实日期已保留')
  if (detail.state === 'complete') parts.push('双轮核验完成')
  if (detail.state === 'failed') parts.push(`失败：${detail.error || '请查看日志'}`)
  const terminal = ['complete', 'incomplete', 'failed'].includes(detail.state)
  const elapsed = terminal && Number.isFinite(detail.elapsedMs) ? detail.elapsedMs : now - detail.startedAt
  if (Number.isFinite(elapsed)) parts.push(`总耗时 ${Math.max(0, Math.floor(elapsed / 1000))} 秒`)
  return parts.join(' · ')
}
