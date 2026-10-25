import { useReveal } from '../hooks/useReveal.js'
import { SourceCoverageSection } from './SourceCoverageSection.jsx'
import productDemoHardware from '../assets/product-demo-hardware-v1.webp'
import productDemoLaptop from '../assets/product-demo-laptop-v1.webp'
import productDemoDesktop from '../assets/product-demo-desktop-v3.png'
import productDemoMobile from '../assets/product-demo-mobile-v3.png'
import { HotRankings } from './HotRankings.jsx'
import { ProblemSolutionStory } from './ProblemSolutionStory.jsx'

function BenefitIcon({ download }) {
  return (
    <svg className="feature-benefit-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {download ? <><path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5" /><path d="M5 17v4h14v-4" /></> : <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16.5 9" /></>}
    </svg>
  )
}

export function ProductPreview() {
  return (
      <div className="home-chart-demo" aria-label="聚势桌面端与移动端产品使用预览">
        <div className="product-device-scene">
          <img className="product-demo-hardware is-laptop" src={productDemoLaptop} width="1584" height="993" fetchpriority="high" decoding="async" alt="" aria-hidden="true" />
          <div className="product-demo-browser">
            <div className="product-demo-browser-chrome" aria-hidden="true">
              <div className="product-demo-browser-tabs">
                <span className="product-demo-browser-tab"><img className="product-demo-browser-favicon" src="/finetech-favicon.svg?v=2" width="16" height="16" alt="" />聚势 · 剧综热度看板<span className="product-demo-browser-close">×</span></span>
                <span className="product-demo-browser-new-tab">+</span>
                <span className="product-demo-browser-window-actions">− &nbsp; □ &nbsp; ×</span>
              </div>
              <div className="product-demo-browser-toolbar">
                <svg viewBox="0 0 72 20" fill="none"><path d="m10 5-5 5 5 5M5 10h13m14-5 5 5-5 5m5-5H24M57 5a6 6 0 1 0 3 8m-3-8h5m0 0v5" /></svg>
                <span className="product-demo-browser-address"><svg viewBox="0 0 16 16" fill="none"><rect x="4" y="7" width="8" height="7" rx="1.5" /><path d="M5.5 7V4.5a2.5 2.5 0 0 1 5 0V7" /></svg>glintscore.com<span>☆</span></span>
                <span className="product-demo-browser-menu">⋮</span>
              </div>
            </div>
            <img className="product-demo-screen is-desktop" src={productDemoDesktop} width="1584" height="920" fetchpriority="high" decoding="async" alt="新版聚势桌面看板实拍：许我耀眼与芬芳喜事、围猎、绝命法官、赴山海的猫眼热度走势" />
          </div>
          <img className="product-demo-hardware is-phone" src={productDemoHardware} width="1584" height="993" decoding="async" alt="" aria-hidden="true" />
          <div className="product-demo-phone-screen">
            <img className="product-demo-screen is-mobile" src={productDemoMobile} width="600" height="1280" decoding="async" alt="新版聚势手机看板实拍：许我耀眼与四部分析作品的猫眼热度走势、关键指标及累计有效播放量分析" />
          </div>
        </div>
        <div className="hero-scroll-cue" aria-hidden="true">
          <svg viewBox="0 0 32 40">
            <path className="scroll-cue-chevron" d="m7 10 9 9 9-9" />
            <path className="scroll-cue-chevron" d="m7 20 9 9 9-9" />
          </svg>
        </div>
      </div>
  )
}

export function FeatureGrid({ features, rankings }) {
  const [sectionRef, isVisible] = useReveal()
  const [usageFlowRef, isUsageFlowVisible] = useReveal()
  const steps = [
    { title: '搜索并确认剧集', description: '输入名称，核对信息' },
    { title: '自动采集数据', description: '汇集信息，建立看板' },
    { title: '添加作品分析', description: '最多添加四部作品分析' },
    { title: '核对来源并导出明细', description: '下载原始数据明细，查看数据源' },
  ]
  return (
    <section ref={sectionRef} className={`feature-section ${isVisible ? 'is-visible' : ''}`} aria-label="产品介绍">
      <ProductPreview />
      <HotRankings rankings={rankings} />
      <ProblemSolutionStory />
      <div ref={usageFlowRef} className={`usage-flow ${isUsageFlowVisible ? 'is-visible' : ''}`}>
        <div className="usage-flow-content">
          <header className="usage-flow-heading">
            <h2>四步建立你的看板</h2>
          </header>
          <ol className="usage-flow-steps">
            {steps.map((step, index) => (
              <li className="usage-flow-step" key={step.title} style={{ '--usage-step-delay': `${index * 300}ms` }}>
                <span className="usage-flow-node" aria-hidden="true">{index + 1}</span>
                <h3>{step.title}</h3>
                <p className="usage-flow-description"><span>{step.description}</span></p>
                {index < steps.length - 1 ? <span className="usage-flow-connector" aria-hidden="true" /> : null}
              </li>
            ))}
          </ol>
          <div className="usage-flow-benefits">
            <div className="usage-flow-benefit">
              <BenefitIcon />
              <span>免费开源使用</span>
            </div>
            <div className="usage-flow-benefit">
              <BenefitIcon download />
              <span>自动化采集数据</span>
            </div>
          </div>
        </div>
      </div>
      <SourceCoverageSection />
      <div className="feature-grid">
        {features.map((feature, index) => (
          <article className="feature-item" style={{ '--reveal-delay': `${index * 140}ms` }} key={`${feature.title}-${index}`}>
            <BenefitIcon download={index === 1} />
            <div className="feature-item-copy">
              <h2>{feature.title}</h2>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
