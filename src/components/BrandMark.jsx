import scriptWordmarkImage from '../assets/finetech-wordmark.png'

export function BrandMark({ className = '', variant = 'script' }) {
  if (variant === 'sans') {
    return <span className={`brand-mark brand-mark-text-sans ${className}`.trim()}>FINETECH</span>
  }

  const image = scriptWordmarkImage
  return (
    <span className={`brand-mark ${className}`.trim()} role="img" aria-label="FINETECH">
      <img className={`brand-mark-image${variant === 'serif' ? ' brand-mark-image-serif' : ''}`} src={image} alt="" aria-hidden="true" />
    </span>
  )
}
