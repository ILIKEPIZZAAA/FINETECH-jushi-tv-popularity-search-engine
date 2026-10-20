import { useEffect, useRef, useState } from 'react'
import { collectorHealth } from '../lib/dramaApi.js'
import { CollectionLogDialog } from './CollectionProgressLog.jsx'

function FetchingParticles() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d', { alpha: true })
    if (!canvas || !context) return undefined
    const primaryRgb = getComputedStyle(canvas).getPropertyValue('--c-primary-rgb').trim() || '21, 35, 61'

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let particles = []
    let frameId = 0
    let lastFrameAt = 0
    let width = 0
    let height = 0
    let pixelRatio = 1

    const random = (() => {
      let seed = 92731
      return () => {
        seed = (seed * 16807) % 2147483647
        return (seed - 1) / 2147483646
      }
    })()

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = Math.max(1, rect.width)
      height = Math.max(1, rect.height)
      pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.round(width * pixelRatio)
      canvas.height = Math.round(height * pixelRatio)
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)

      const count = Math.min(260, Math.max(120, Math.round((width * height) / 12500)))
      particles = Array.from({ length: count }, () => {
        const angle = random() * Math.PI * 2
        const speed = (0.12 + random() * 0.28) * 2
        return {
          x: random() * width,
          y: random() * height,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          radius: (1.1 + random() * 2.1) * 1.2,
          phase: random() * Math.PI * 2,
          pulse: 1.8 + random() * 2.8,
          color: primaryRgb,
        }
      })
      draw(0, true)
    }

    const draw = (time, staticFrame = false) => {
      context.clearRect(0, 0, width, height)
      const linkDistance = Math.max(92, Math.min(152, width * 0.045))
      const linkDistanceSquared = linkDistance * linkDistance

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index]
        const pulse = 0.64 + Math.sin(time / (particle.pulse * 280) + particle.phase) * 0.22

        if (!staticFrame) {
          particle.x += particle.vx
          particle.y += particle.vy
          if (particle.x < -12) particle.x = width + 12
          if (particle.x > width + 12) particle.x = -12
          if (particle.y < -12) particle.y = height + 12
          if (particle.y > height + 12) particle.y = -12
        }

        for (let nextIndex = index + 1; nextIndex < particles.length; nextIndex += 1) {
          const other = particles[nextIndex]
          const dx = other.x - particle.x
          const dy = other.y - particle.y
          const distanceSquared = dx * dx + dy * dy
          if (distanceSquared >= linkDistanceSquared) continue
          const distance = Math.sqrt(distanceSquared)
          const opacity = (1 - distance / linkDistance) * 0.18
          context.beginPath()
          context.moveTo(particle.x, particle.y)
          context.lineTo(other.x, other.y)
          context.strokeStyle = `rgba(${particle.color}, ${opacity})`
          context.lineWidth = 0.8
          context.stroke()
        }

        context.beginPath()
        context.arc(particle.x, particle.y, particle.radius * (0.92 + pulse * 0.12), 0, Math.PI * 2)
        context.fillStyle = `rgba(${particle.color}, ${pulse * 0.58})`
        context.fill()
        if (particle.radius > 2.7) {
          context.beginPath()
          context.arc(particle.x, particle.y, particle.radius * 2.6, 0, Math.PI * 2)
          context.strokeStyle = `rgba(${particle.color}, ${pulse * 0.11})`
          context.lineWidth = 1
          context.stroke()
        }
      }
    }

    const animate = (time) => {
      frameId = window.requestAnimationFrame(animate)
      if (motionPreference.matches || document.hidden || time - lastFrameAt < 33) return
      lastFrameAt = time
      draw(time)
    }

    const handleMotionPreference = () => {
      if (motionPreference.matches) {
        window.cancelAnimationFrame(frameId)
        draw(0, true)
      } else {
        lastFrameAt = 0
        frameId = window.requestAnimationFrame(animate)
      }
    }

    const handleVisibility = () => {
      if (document.hidden) window.cancelAnimationFrame(frameId)
      else if (!motionPreference.matches) frameId = window.requestAnimationFrame(animate)
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    motionPreference.addEventListener?.('change', handleMotionPreference)
    document.addEventListener('visibilitychange', handleVisibility)
    resize()
    if (!motionPreference.matches) frameId = window.requestAnimationFrame(animate)

    return () => {
      resizeObserver.disconnect()
      motionPreference.removeEventListener?.('change', handleMotionPreference)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.cancelAnimationFrame(frameId)
    }
  }, [])

  return <canvas ref={canvasRef} className="fetching-particle-canvas" aria-hidden="true" />
}

export function FetchingScreen({ isExiting = false, progress = 0, logs = [], sources = {}, completedTasks = 0, totalTasks = 0 }) {
  const [isLogOpen, setIsLogOpen] = useState(false)
  const [browserQueue, setBrowserQueue] = useState(null)
  useEffect(() => {
    if (!isLogOpen) return undefined
    let cancelled = false
    let timer
    const poll = async () => {
      try {
        const health = await collectorHealth()
        if (!cancelled) setBrowserQueue(health.collector?.browserQueue || null)
      } catch {
        if (!cancelled) setBrowserQueue(null)
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 3000)
      }
    }
    void poll()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [isLogOpen])
  const isCollecting = progress === null
  const percent = isCollecting ? null : Math.max(0, Math.min(100, Math.round(progress)))

  return (
    <section className={`fetching-screen${isExiting ? ' is-exiting' : ''}`} aria-live="polite" aria-label="正在读取剧集信息" aria-busy="true">
      <div className="fetching-particle-backdrop" aria-hidden="true">
        <FetchingParticles />
      </div>
      <div className="fetching-content">
        <h1>正在读取剧集信息</h1>
        <p className="fetching-description">正在整理热度信息、播放量和收视情况</p>
        <p className="fetching-duration-estimate">预计总采集时间约 3–5 分钟，实际时长视数据源响应而定</p>
        <div className="fetching-progress-row">
          <div className={`fetching-progress${isCollecting ? ' is-indeterminate' : ''}`} role="progressbar" aria-label="正在整理剧集资料" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={isCollecting ? `已完成 ${completedTasks}/${totalTasks} 项采集任务` : `正在整理剧集资料 ${percent}%`}>
            <span style={isCollecting ? undefined : { width: `${percent}%` }} />
          </div>
          {!isCollecting ? <div className="fetching-progress-readout"><strong className="fetching-progress-percent">{percent}%</strong></div> : null}
        </div>
        <p className="fetching-hint">
          {isCollecting ? <>已完成采集任务：<strong className="fetching-task-count">{completedTasks}/{totalTasks}</strong></> : '正在汇总公开信息，请稍候'}
        </p>
      </div>
      <button type="button" data-analytics-component="采集进度" data-analytics-action="打开采集日志" className="fetching-log-entry" aria-haspopup="dialog" onClick={() => setIsLogOpen(true)}>日志</button>
      {isLogOpen ? <CollectionLogDialog onClose={() => setIsLogOpen(false)} sources={sources} logs={logs} browserQueue={browserQueue} completedTasks={completedTasks} totalTasks={totalTasks} /> : null}
    </section>
  )
}
