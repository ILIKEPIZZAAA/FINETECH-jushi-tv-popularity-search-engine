import { useEffect, useId, useRef, useState } from 'react'

function sourceProgressText(detail, now) {
  const secondsSinceUpdate = detail.updatedAt ? Math.max(0, Math.floor((now - Date.parse(detail.updatedAt)) / 1000)) : 0
  if (detail.state === 'queued') return `${detail.pass ? `第 ${detail.pass}/2 遍 · ` : ''}等待采集浏览器 · 队列 ${detail.waitingTasks ?? '?'} 项 · 已等 ${secondsSinceUpdate} 秒`
  if (detail.state === 'failed') return `采集失败：${detail.error || '请查看日志'}`
  if (detail.state === 'incomplete') return `已返回，部分日期未通过核验：${detail.error || '请查看日志'}`
  if (detail.state === 'complete' || detail.state === 'returned') {
    const count = Number.isFinite(detail.checkedDays) && Number.isFinite(detail.totalDays) ? ` · 已核对 ${detail.checkedDays}/${detail.totalDays} 天` : ''
    return `已返回，正在整理结果${count}`
  }
  const parts = []
  if (detail.pass) parts.push(`第 ${detail.pass}/2 遍`)
  if (detail.metric) parts.push(detail.metric)
  if (Number.isFinite(detail.checkedDays) && Number.isFinite(detail.totalDays)) parts.push(`已核对 ${detail.checkedDays}/${detail.totalDays} 天`)
  if (detail.currentDate) parts.push(`当前 ${detail.currentDate}`)
  if (Number.isFinite(detail.hitDays)) parts.push(`有值 ${detail.hitDays} 天`)
  if (Number.isFinite(detail.noDataDays)) parts.push(`无值 ${detail.noDataDays} 天`)
  if (secondsSinceUpdate >= 30) parts.push(`${secondsSinceUpdate} 秒未推进`)
  return parts.join(' · ') || `正在读取来源页面 · 已等 ${secondsSinceUpdate} 秒`
}

export function CollectionProgressLog({ sources = {}, logs = [], browserQueue = null, completedTasks = 0, totalTasks = 0, isLive = false }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!isLive) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isLive])
  const entries = Object.entries(sources)
  return <section className="collection-progress-log" aria-label="采集详细日志">
    {totalTasks > 0 ? <p className="collection-log-summary">已完成采集任务 {completedTasks}/{totalTasks}</p> : null}
    {browserQueue?.active ? <p className="fetching-queue-status">采集浏览器正在处理：{browserQueue.active} · 排队任务 {browserQueue.pending} 项</p> : null}
    {entries.length > 0 ? <div className="fetching-source-progress" aria-label="各来源采集进度">
      {entries.map(([source, detail]) => <div className="fetching-source-row" key={source}>
        <strong>{source}</strong><span>{sourceProgressText(detail, now)}</span>
      </div>)}
    </div> : null}
    <div className="collection-log-messages" aria-label="采集消息">
      {logs.map((entry) => <p key={entry.id}>{entry.message}</p>)}
      {!entries.length && !logs.length ? <p>等待采集日志</p> : null}
    </div>
  </section>
}

export function CollectionLogDialog({ onClose, ...progress }) {
  const dialogRef = useRef(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = dialogRef.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  const close = () => {
    dialogRef.current.close()
    onClose()
  }
  return <dialog ref={dialogRef} className="collection-log-dialog" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); close() }}
    onClick={(event) => { if (event.target === event.currentTarget) close() }}>
    <div className="collection-log-dialog-content">
      <header><h2 id={titleId}>日志</h2><button type="button" autoFocus data-analytics-component="采集进度" data-analytics-action="关闭采集日志" aria-label="关闭日志" onClick={close}>×</button></header>
      <CollectionProgressLog {...progress} isLive />
    </div>
  </dialog>
}
