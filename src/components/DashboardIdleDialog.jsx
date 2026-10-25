import { useEffect, useRef } from 'react'

export function DashboardIdleDialog({ secondsLeft, onContinue, onPause }) {
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
        <p id="dashboard-idle-description">已连续 15 分钟未操作。{secondsLeft} 秒后将停止后台连接，看板和已采集数据会保留。需要更新时可点击刷新数据。</p>
        <div className="dashboard-idle-actions">
          <button type="button" onClick={onPause}>停止后台连接</button>
          <button type="button" className="is-primary" ref={continueButton} onClick={onContinue}>继续查看</button>
        </div>
      </section>
    </div>
  )
}
