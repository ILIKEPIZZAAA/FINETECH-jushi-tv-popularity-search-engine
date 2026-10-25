import { useEffect, useId, useRef, useState } from 'react'

const dramaPages = [
  '猫眼 · 每日热度值',
  '猫眼 · 全网曝光', '猫眼 · 全网转评赞', '猫眼 · 全网发布', '猫眼 · 全网弹幕',
  '猫眼 · 总播放与分平台有效播放', '猫眼 · 平台表现',
  '猫眼 · 台端收视率与市占率', '骨朵 · 热度与排名',
  '酷云 · 全端热度', '酷云 · 增长指数',
]

const varietyPages = [
  '猫眼 · 综艺每日热度值',
  '猫眼 · 综艺全网曝光', '猫眼 · 综艺全网转评赞', '猫眼 · 综艺全网发布', '猫眼 · 综艺全网弹幕',
  '猫眼 · 综艺有效播放的适用范围', '猫眼 · 综艺平台表现',
  '猫眼 · 综艺台端收视率与市占率', '骨朵 · 全部综艺、全平台热度与排名',
]

const guideFiles = ['01', 'exposure', 'interaction', 'publish', 'danmaku', '03', '04', '05', '06', '07', '08']

export function UsageGuideModal({ contentType = 'drama', onClose }) {
  const isVariety = contentType === 'variety'
  const pages = isVariety ? varietyPages : dramaPages
  const dialogRef = useRef(null)
  const titleId = useId()
  const [page, setPage] = useState(0)
  const [zoomed, setZoomed] = useState(false)
  useEffect(() => {
    const focus = document.activeElement
    dialogRef.current.showModal()
    return () => { focus?.focus?.() }
  }, [])
  useEffect(() => { setPage(0); setZoomed(false) }, [contentType])
  const selectPage = value => { setPage(value); setZoomed(false) }
  return <dialog data-analytics-component="使用说明" ref={dialogRef} className="usage-guide-dialog" aria-labelledby={titleId} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="usage-guide-content">
      <header><div><h2 id={titleId}>{isVariety ? '综艺使用说明' : '剧集使用说明'}</h2><p>左侧为聚势看板，右侧为来源页面；红框标出对应字段，红色箭头标明来源方向。</p></div><button type="button" aria-label="关闭使用说明" onClick={onClose}>×</button></header>
      <div className="usage-guide-controls">
        <label>图解<select aria-label="选择数据来源图解" value={page} onChange={e => selectPage(Number(e.target.value))}>{pages.map((name, index) => <option key={name} value={index} data-analytics-action={`查看图解 ${name}`}>{index + 1}. {name}</option>)}</select></label>
        <button type="button" onClick={() => setZoomed(v => !v)} aria-pressed={zoomed}>{zoomed ? '适应窗口' : '放大查看'}</button>
      </div>
      <div className={`usage-guide-image${zoomed ? ' is-zoomed' : ''}`} tabIndex={0} role="region" aria-label="数据来源图解，可滚动查看">
        <img src={`/help/${isVariety ? 'variety-source-map' : 'source-map'}-${guideFiles[page]}.png?v=20261024-tv-source-update`} alt={`${pages[page]}：聚势看板与原始来源指标对应图`} />
      </div>
      <footer><button type="button" disabled={page === 0} onClick={() => selectPage(page - 1)}>上一张</button><span>{page + 1} / {pages.length}</span><button type="button" disabled={page === pages.length - 1} onClick={() => selectPage(page + 1)}>下一张</button></footer>
    </div>
  </dialog>
}
