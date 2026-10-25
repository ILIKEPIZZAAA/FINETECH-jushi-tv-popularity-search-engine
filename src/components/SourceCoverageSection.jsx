import iqiyiLogo from '../assets/logos/iqiyi.webp'
import tencentLogo from '../assets/logos/tencent.webp'
import sourceEmblem from '../assets/logos/source-emblem-gold.webp'
import sourceMaoyan from '../assets/logos/source-maoyan.webp'
import sourceKuyun from '../assets/logos/source-kuyun.webp'
import sourceEndata from '../assets/logos/source-endata.webp'
import youkuLogo from '../assets/logos/youku-logo.webp'
import mangoLogo from '../assets/logos/mgtv-logo.webp'

const sourceMarks = [
  { src: sourceMaoyan, name: '猫眼' },
  { src: sourceEmblem, name: '骨朵' },
  { src: sourceKuyun, name: '酷云' },
  { src: sourceEndata, name: '艺恩' },
  { src: tencentLogo, name: '腾讯视频' },
  { src: iqiyiLogo, name: '爱奇艺' },
  { src: youkuLogo, name: '优酷' },
  { src: mangoLogo, name: '芒果TV' },
]

function SourceLogoTrack({ duplicate = false }) {
  return (
    <ul className="data-source-logos" aria-hidden={duplicate || undefined}>
      {sourceMarks.map((source, index) => (
        <li className="data-source-logo" key={`${duplicate ? 'copy-' : ''}${source.name}`}>
          <span className="data-source-logo-frame">
            <img src={source.src} alt={duplicate ? '' : source.name} loading="lazy" />
          </span>
          <span className="data-source-logo-caption" aria-hidden="true">{source.name}</span>
        </li>
      ))}
    </ul>
  )
}

export function SourceCoverageSection() {
  return (
    <section className="data-source-showcase" aria-labelledby="data-source-title">
      <div className="data-source-copy">
        <h2 id="data-source-title">多源数据聚合，全景洞察剧集表现</h2>
        <p>覆盖主流视频平台与第三方行业数据源，多维呈现剧集表现</p>
      </div>
      <div className="data-source-marquee" role="region" aria-label="数据来源平台" tabIndex={0}>
        <div className="data-source-track">
          <SourceLogoTrack />
          <SourceLogoTrack duplicate />
        </div>
      </div>
    </section>
  )
}
