import { useEffect, useRef, useState } from 'react'
import { createScrollCheckpoint } from '../lib/scrollCheckpoint.js'
import solutionIntegrations from '../assets/story-solution-integrations-v3.webp'

const problems = [
  ['查一部剧，要打开好几个网站？', '热度、播放、收视分散在不同平台，来回查找费时费力'],
  ['热度 8000，到底是什么水平？', '缺少同期剧集作参照，单看一个数字，很难判断表现'],
  ['最近是在升温，还是开始回落？', '零散的每日数据，看不清一部剧的完整走势'],
  ['查完数据，还得自己整理？', '手动记录、制作图表、整理对比，重复工作占去太多时间'],
]

const solutions = [
  ['多源数据，集中查看', '汇集主流平台热度、播放与收视数据，减少来回切换'],
  ['同期对比，看清差距', '推荐同期剧集，最多加入 4 部竞品，用同一来源的指标比较表现'],
  ['历史走势，按天看清', '将每日数据连成趋势，直观看到热度高点、持续升温与阶段回落'],
  ['自动采集，省去搬运', '采集结果直接呈现为图表，数据来源可查，原始明细可导出'],
]

const clamp = (value) => Math.min(1, Math.max(0, value))

function fadeProgress(progress, start, duration) {
  const value = clamp((progress - start) / duration)
  return value * value * (3 - 2 * value)
}

function SolutionDemo() {
  return (
    <div className="content-story-solution-demo">
      <img
        src={solutionIntegrations}
        width="1254"
        height="1254"
        alt="剧势看板连接猫眼、骨朵、酷云，并支持 Rawdata Download 原始明细导出"
        loading="lazy"
        decoding="async"
      />
    </div>
  )
}

export function ProblemSolutionStory() {
  const sectionRef = useRef(null)
  const stageRef = useRef(null)
  const [isPinned, setIsPinned] = useState(false)
  const [isSolution, setIsSolution] = useState(false)

  useEffect(() => {
    const section = sectionRef.current
    const stage = stageRef.current
    if (!section || !stage) return undefined

    const pinQuery = window.matchMedia('(min-width: 901px), (max-width: 900px) and (min-height: 600px)')
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = null
    let checkpointY = null
    const checkpoint = createScrollCheckpoint()

    const setFade = (name, progress) => {
      section.style.setProperty(`--story-${name}-out`, clamp(1 - progress * 2.4).toFixed(4))
      section.style.setProperty(`--story-${name}-in`, clamp((progress - .5) * 2).toFixed(4))
      section.style.setProperty(`--story-${name}-shift`, progress.toFixed(4))
    }

    const update = () => {
      frame = null
      const pinned = pinQuery.matches
      setIsPinned(pinned)
      const stageHeight = stage.getBoundingClientRect().height
      section.style.setProperty('--story-stage-height', `${stageHeight}px`)

      const sectionStyle = getComputedStyle(section)
      const topPadding = parseFloat(sectionStyle.paddingTop) || 0
      const bottomPadding = parseFloat(sectionStyle.paddingBottom) || 0
      const stickyTop = parseFloat(getComputedStyle(stage).top) || 0
      const distance = section.clientHeight - topPadding - bottomPadding - stageHeight
      // The CTA has finished fading in at .86; stop at .9 while the whole
      // composition is still pinned and centered.
      checkpointY = pinned && window.innerWidth > 900 && distance > 0
        ? window.scrollY + section.getBoundingClientRect().top + topPadding - stickyTop + distance * .9
        : null
      if (checkpointY === null) checkpoint.reset()
      const progress = pinned && distance > 0
        ? clamp((stickyTop - section.getBoundingClientRect().top - topPadding) / distance)
        : 0
      const motionProgress = motionQuery.matches ? Number(progress >= .5) : progress

      setFade('heading', fadeProgress(motionProgress, .18, .18))
      problems.forEach((_, index) => {
        setFade(`row-${index}`, fadeProgress(motionProgress, .24 + index * .1, .2))
      })
      section.style.setProperty('--story-cue', fadeProgress(motionProgress, .74, .12).toFixed(4))
      section.dataset.storyProgress = progress.toFixed(3)
      setIsSolution(pinned && progress >= .5)
    }

    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(update)
    }

    const onWheel = (event) => {
      if (checkpointY === null || !event.cancelable || event.defaultPrevented || event.ctrlKey
        || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return

      // Nested lists, dialogs and other scrollable controls retain their own
      // native scrolling. Only intercept the document's downward wheel gesture.
      for (const target of event.composedPath()) {
        if (!(target instanceof Element) || target === document.body || target === document.documentElement) continue
        if (target.scrollHeight > target.clientHeight
          && /^(auto|scroll)$/.test(getComputedStyle(target).overflowY)) return
      }

      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1)
      if (checkpoint.shouldStop({ position: window.scrollY, delta, stop: checkpointY, now: performance.now() })) {
        event.preventDefault()
        window.scrollTo({ top: checkpointY, behavior: 'instant' })
        schedule()
      }
    }

    const observer = new ResizeObserver(schedule)
    observer.observe(stage)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('resize', schedule)
    pinQuery.addEventListener('change', schedule)
    motionQuery.addEventListener('change', schedule)
    update()

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', schedule)
      pinQuery.removeEventListener('change', schedule)
      motionQuery.removeEventListener('change', schedule)
    }
  }, [])

  return (
    <section ref={sectionRef} className="content-layout-demo" aria-labelledby="content-layout-demo-title" data-story-phase={isSolution ? 'solution' : 'problem'}>
      <div ref={stageRef} className="content-layout-demo-stage">
        <header className="content-layout-demo-heading">
          <h2 id="content-layout-demo-title"><span className="content-story-heading-intro">想知道一部剧热度表现</span><span className="content-story-heading-divider">——</span><span>剧势帮你看清楚</span></h2>
          <p>从多源查询到同期对比，从历史走势到数据导出，让剧集表现一目了然</p>
        </header>
        <div className="content-layout-demo-body">
          <div className="content-layout-demo-image">
            <div className="content-story-media is-problem" aria-hidden={isSolution}>
              <img src="/content-layout-demo.webp" alt="双手在键盘上整理数据" loading="lazy" decoding="async" />
            </div>
            <div className="content-story-media is-solution" aria-hidden={!isSolution}>
              <SolutionDemo />
            </div>
          </div>
          <div className="content-layout-demo-copy">
            {[problems, solutions].map((items, phase) => (
              <div
                className={`content-story-panel ${phase === 0 ? 'is-problem' : 'is-solution'}`}
                key={phase}
                aria-hidden={isPinned ? isSolution !== Boolean(phase) : undefined}
                inert={isPinned && isSolution !== Boolean(phase) ? '' : undefined}
              >
                <h3>
                  {phase === 0 ? '你是否也遇到这些问题？' : '这些问题，交给剧势'}
                  <span className={`content-story-mark ${phase === 0 ? 'is-cross' : 'is-check'}`} aria-hidden="true">
                    <svg viewBox="0 0 96 80" fill="none" focusable="false">
                      {phase === 0 ? <>
                        <path pathLength="1" d="M19 15C29 24 36 34 47 43S65 58 76 65" />
                        <path pathLength="1" d="M77 13C66 23 59 33 48 43S30 58 19 66" />
                      </> : <path pathLength="1" d="M13 40C21 46 27 52 35 59C48 44 65 25 84 12" />}
                    </svg>
                  </span>
                </h3>
                {phase === 1 ? <div className="content-story-inline-demo"><SolutionDemo /></div> : null}
                <div className="content-layout-demo-features">
                  <ul>
                    {items.map(([title, description], index) => (
                      <li key={title} style={{
                        '--story-item-out': `var(--story-row-${index}-out, 1)`,
                        '--story-item-in': `var(--story-row-${index}-in, 0)`,
                        '--story-item-shift': `var(--story-row-${index}-shift, 0)`,
                      }}>
                        <h4>{title}</h4>
                        <p>{description}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="story-scroll-cue" aria-hidden="true">
          <svg viewBox="0 0 32 40">
            <path className="scroll-cue-chevron" d="m7 10 9 9 9-9" />
            <path className="scroll-cue-chevron" d="m7 20 9 9 9-9" />
          </svg>
        </div>
      </div>
    </section>
  )
}
