import { useEffect, useRef } from 'react'
import { openXiaohongshuApp, XIAOHONGSHU_PROFILE_WEB } from '../lib/xiaohongshuLink.js'
import xiaohongshuLogo from '../assets/logos/xiaohongshu-brandlogos.webp'
import githubLogo from '../assets/logos/github.svg'
import codexLogo from '../assets/logos/codex-current.webp'
import figmaLogo from '../assets/logos/figma-official.svg'
import framerLogo from '../assets/logos/framer-official.svg'
import hermesLogo from '../assets/logos/hermes-agent.svg'
import doubaoWorkLogo from '../assets/logos/doubao-work.webp'
import { useReveal } from '../hooks/useReveal.js'

const toolLogos = [
  { label: 'Figma', type: 'figma' },
  { label: 'Framer', type: 'framer' },
  { label: 'Codex', type: 'codex' },
  { label: 'Hermes', type: 'hermes' },
  { label: '豆包Work', type: 'doubao-work' },
]

function ToolLogo({ type }) {
  if (type === 'figma') {
    return <img loading="lazy" decoding="async" src={figmaLogo} alt="" aria-hidden="true" className="footer-logo-svg footer-logo-figma footer-logo-brand" />
  }

  if (type === 'framer') {
    return <img loading="lazy" decoding="async" src={framerLogo} alt="" aria-hidden="true" className="footer-logo-svg footer-logo-brand" />
  }

  if (type === 'codex') {
    return <img loading="lazy" decoding="async" src={codexLogo} alt="" aria-hidden="true" className="footer-logo-svg footer-logo-codex" />
  }

  if (type === 'hermes') {
    return <img loading="lazy" decoding="async" src={hermesLogo} alt="" aria-hidden="true" className="footer-logo-svg footer-logo-brand" />
  }

  if (type === 'doubao-work') {
    return <img loading="lazy" decoding="async" src={doubaoWorkLogo} alt="" aria-hidden="true" className="footer-logo-svg footer-logo-brand" />
  }

  return null
}

export function Footer({ footer, onOpenDisclaimer }) {
  const [footerRef, isVisible] = useReveal()
  const cancelAppLinkRef = useRef(null)
  useEffect(() => () => cancelAppLinkRef.current?.(), [])

  const handleXiaohongshuClick = (event) => {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
    if (!isMobile || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    cancelAppLinkRef.current?.()
    cancelAppLinkRef.current = openXiaohongshuApp(window, document)
  }

  return (
    <footer ref={footerRef} data-analytics-component="页脚" className={`site-footer ${isVisible ? 'is-visible' : ''}`}>
      <div className="footer-topline">
        <div className="footer-copy">
          <p className="footer-statement">{footer.statement}</p>
          <nav className="social-links" aria-label="社交媒体链接">
            <a href={XIAOHONGSHU_PROFILE_WEB} target="_blank" rel="noreferrer" aria-label="小红书" onClick={handleXiaohongshuClick}>
              <img loading="lazy" decoding="async" src={xiaohongshuLogo} alt="" />
            </a>
            <a href="https://github.com/ILIKEPIZZAAA/FINETECH-jushi-tv-popularity-search-engine" target="_blank" rel="noreferrer" aria-label="GitHub">
              <img loading="lazy" decoding="async" src={githubLogo} alt="" />
            </a>
          </nav>
          <span className="footer-contact-link">Contact Me</span>
        </div>
        <div className="footer-logo-wall" aria-label="Tool logos">
          <div className="footer-logo-row">
            {toolLogos.map((tool) => (
              <div className="footer-logo-item" key={tool.label}>
                <ToolLogo type={tool.type} />
                <span>{tool.label}</span>
              </div>
            ))}
          </div>
          <p className="footer-logo-caption">Tools used: Figma · Framer · Codex · Hermes · 豆包Work</p>
        </div>
      </div>
      <div className="footer-bottomline">
        <span>{footer.copyright}</span>
        <div className="footer-filings">
          <a className="footer-icp" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" data-analytics-action="查看备案信息">
            京ICP备2026067514号-1
          </a>
          <a className="footer-icp" href="https://beian.mps.gov.cn/#/query/webSearch?code=11011402057611" target="_blank" rel="noopener noreferrer" data-analytics-action="查看备案信息">
            京公网安备11011402057611号
          </a>
        </div>
        <button type="button" className="disclaimer-trigger" data-analytics-action="打开免责声明" onClick={onOpenDisclaimer}>
          {footer.disclaimer}
        </button>
      </div>
    </footer>
  )
}
