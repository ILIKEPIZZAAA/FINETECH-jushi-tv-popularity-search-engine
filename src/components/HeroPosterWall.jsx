import { memo, useEffect, useRef } from 'react'
import atmosphere from '../assets/hero-atmosphere-v2.webp'
import orbitLight from '../assets/hero-orbit-light-light.webp'
import { heroPosters } from '../data/hero-posters.js'
import { createAnimationPaintGate, loadPosterWhenNearViewport } from '../lib/posterLoading.js'
import { buildHeroPosterRows, heroPosterRowFrame, posterForCycle } from '../lib/heroPosterLayout.js'

const rows = buildHeroPosterRows(heroPosters)

// Positions are evaluated on a fixed, shallow screen-space arc. Depth never
// enlarges the cards, so both complete rows remain behind the hero content.
export const HeroPosterWall = memo(function HeroPosterWall() {
  const wallRef = useRef(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    const wall = wallRef.current
    const canvas = canvasRef.current
    const context = canvas.getContext('2d')
    const cards = [...wall.querySelectorAll('.hero-cinema-row')].map((row, rowIndex) => [...row.children].map((card, index) => ({
      element: card, image: card.querySelector('img'), versions: rows[rowIndex][index], number: rows[rowIndex][index][0].number,
    })))
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let width = 0
    let height = 0
    let scale = 1
    let elapsed = 0
    let previous = 0
    let frame = 0
    let visible = true
    let disposed = false
    const shouldPaint = createAnimationPaintGate(30)

    const layout = () => {
      if (disposed || width <= 0 || height <= 0 || scale <= 0) return
      const cardWidth = 160 * scale
      cards.forEach((row, rowIndex) => {
        const positions = heroPosterRowFrame(row.length, width, scale, elapsed, rowIndex)
        row.forEach((entry, index) => {
          const { x, cycle, pitch } = positions[index]
          const card = entry.element
          const poster = posterForCycle(entry.versions, cycle)
          if (entry.number !== poster.number) {
            entry.number = poster.number
            entry.image.removeAttribute('src')
            entry.image.setAttribute('data-poster-src', poster.image)
            card.dataset.title = poster.title
            card.dataset.year = poster.year
          }
          if (x >= -pitch && x <= width + pitch) loadPosterWhenNearViewport(entry.image)
          if (x < -pitch || x > width + pitch) {
            if (card.style.visibility !== 'hidden') card.style.visibility = 'hidden'
            return
          }
          const normalized = (x + cardWidth / 2 - width / 2) / (width / 2)
          const edge = Math.min(1, Math.abs(normalized))
          const curve = 1 - edge * edge
          const y = width <= 1024
            ? (rowIndex === 0 ? 12 + 18 * curve : 286 + 10 * curve) * scale
            : (rowIndex === 0 ? 48 + 66 * curve : 354 + 18 * curve) * scale
          const depthScale = rowIndex === 0 ? 0.88 + edge * 0.12 : 0.82 + edge * 0.18
          if (card.style.visibility !== 'visible') card.style.visibility = 'visible'
          card.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${depthScale})`
          card.style.filter = `blur(${Math.max(0, edge - 0.78) * 14}px)`
        })
      })
    }

    const drawStars = () => {
      if (!context) return
      context.clearRect(0, 0, width, height)
      for (let index = 0; index < 24; index += 1) {
        const x = ((index * 317 + 151) % 1920) / 1920 * width
        const y = ((index * 131 + 27) % 610) * scale
        const opacity = 0.26 + (Math.sin(elapsed * 1.2 + index * 2.7) + 1) * 0.22
        const radius = (index % 5 === 0 ? 3 : 1.5) * scale
        const glow = context.createRadialGradient(x, y, 0, x, y, radius * 6)
        glow.addColorStop(0, `rgba(255,255,242,${opacity})`)
        glow.addColorStop(0.18, `rgba(255,250,217,${opacity * 0.7})`)
        glow.addColorStop(1, 'rgba(255,255,255,0)')
        context.fillStyle = glow
        context.beginPath()
        context.arc(x, y, radius * 6, 0, Math.PI * 2)
        context.fill()
      }
    }

    const tick = time => {
      if (!shouldPaint(time, reducedMotion.matches)) {
        if (visible && !document.hidden && !reducedMotion.matches) frame = requestAnimationFrame(tick)
        return
      }
      if (previous && !reducedMotion.matches) elapsed += Math.min((time - previous) / 1000, 0.05)
      previous = time
      layout()
      drawStars()
      if (visible && !document.hidden && !reducedMotion.matches) frame = requestAnimationFrame(tick)
    }
    const restart = () => {
      cancelAnimationFrame(frame)
      previous = 0
      if (disposed) return
      if (visible && !document.hidden) frame = requestAnimationFrame(tick)
    }
    const resize = () => {
      if (disposed) return
      width = wall.clientWidth
      height = wall.clientHeight
      if (width <= 0 || height <= 0) return
      // Read the CSS-sized card once per resize so animation geometry follows
      // the same 1920 × 1080 fit rule as the rest of the page.
      scale = cards[0][0].element.offsetWidth / 160
      const density = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * density)
      canvas.height = Math.round(height * density)
      context?.setTransform(density, 0, 0, density, 0, 0)
      layout()
      drawStars()
    }
    const resizeObserver = new ResizeObserver(resize)
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      restart()
    })
    resizeObserver.observe(wall)
    intersectionObserver.observe(wall)
    document.addEventListener('visibilitychange', restart)
    reducedMotion.addEventListener('change', restart)
    resize()
    restart()
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      document.removeEventListener('visibilitychange', restart)
      reducedMotion.removeEventListener('change', restart)
    }
  }, [])

  return (
    <>
      <img className="hero-cinema-atmosphere" src={atmosphere} alt="" draggable="false" fetchpriority="high" decoding="async" />
      <div className="hero-cinema-wall" ref={wallRef} aria-hidden="true">
        {rows.map((items, row) => (
          <div className="hero-cinema-row" data-direction={row === 0 ? 'right' : 'left'} key={row}>
            {items.map(versions => (
              <figure className="hero-cinema-poster" data-show-id={versions[0].showId} data-title={versions[0].title} data-year={versions[0].year} key={versions[0].showId}>
                <img data-poster-src={versions[0].image} width={versions[0].width} height={versions[0].height} alt="" draggable="false" decoding="async" fetchpriority="low" />
              </figure>
            ))}
          </div>
        ))}
        <div className="hero-cinema-focus-blur" />
        <div className="hero-cinema-haze" />
        <img className="hero-cinema-orbits" src={orbitLight} alt="" draggable="false" />
        <canvas className="hero-cinema-stars" ref={canvasRef} />
      </div>
    </>
  )
})
