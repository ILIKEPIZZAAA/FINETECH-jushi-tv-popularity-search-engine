import { useEffect, useRef } from 'react'

export function DashboardIdleDialog({ secondsLeft, onContinue, onExit }) {
  const continueButton = useRef(null)
  useEffect(() => { continueButton.current?.focus() }, [])
  return (
    <div className="dashboard-idle-overlay">
      <section className="dashboard-idle-dialog" role="alertdialog" aria-modal="true" aria-labelledby="dashboard-idle-title" aria-describedby="dashboard-idle-description" onKeyDown={event => {
        if (event.key === 'Escape') onContinue()
        if (event.key === 'Tab') {
          const buttons = [...event.currentTarget.querySelectorAll('button')]
          const next = buttons[(buttons.indexOf(document.activeElement) + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]
          event.preventDefault()
          next.focus()
        }
      }}>
        <h2 id="dashboard-idle-title">还在查看看板吗？</h2>
        <p id="dashboard-idle-description">已连续 15 分钟未操作。{secondsLeft} 秒后将返回首页，清理本次看板数据并结束相关采集任务。</p>
        <div className="dashboard-idle-actions">
          <button type="button" onClick={onExit}>返回首页并清理</button>
          <button type="button" className="is-primary" ref={continueButton} onClick={onContinue}>继续查看</button>
        </div>
      </section>
    </div>
  )
}
