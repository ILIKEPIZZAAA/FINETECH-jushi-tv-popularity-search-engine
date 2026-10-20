import { BrandMark } from './BrandMark.jsx'
import { XIAOHONGSHU_PROFILE_WEB } from '../lib/xiaohongshuLink.js'
import xiaohongshuLogo from '../assets/logos/xiaohongshu.svg'
import githubLogo from '../assets/logos/github.svg'
import { resetBusinessStorage } from '../lib/dramaMonitor.js'

export function Header() {
  return (
    <header className="site-header global-header" data-analytics-component="顶部导航">
      <a className="header-home" href="/" aria-label="返回主页" title="主页" onClick={() => resetBusinessStorage()}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7" /><path d="M5 9v11h5v-6h4v6h5V9" /></svg>
      </a>
      <BrandMark className="header-brand" variant="sans" />
      <nav className="header-social-links" aria-label="社交媒体链接">
        <a href={XIAOHONGSHU_PROFILE_WEB} target="_blank" rel="noreferrer" aria-label="小红书" title="小红书"><img src={xiaohongshuLogo} alt="" /></a>
        <a href="https://github.com/" target="_blank" rel="noreferrer" aria-label="GitHub" title="GitHub"><img src={githubLogo} alt="" /></a>
      </nav>
    </header>
  )
}
