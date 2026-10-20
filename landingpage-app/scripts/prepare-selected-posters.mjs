import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const sharp = require(process.env.SHARP_MODULE || 'sharp')
const library = resolve(process.argv[2] || '')
if (!process.argv[2]) throw new Error('Pass the reviewed poster-library directory')
const app = fileURLToPath(new URL('..', import.meta.url))
const manifestPath = join(library, '来源与核对记录.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const excludedNumbers = [6, 17, 23, 30, 32, 40, 41, 45, 49, 50]
const excluded = new Set(excludedNumbers)
const selected = manifest.items.filter(item => !excluded.has(Number(item.number)))
if (selected.length !== 40) throw new Error('The approved selection must contain exactly 40 posters')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const output = join(app, 'public/hero-posters/selected')
await mkdir(output, { recursive: true })
const items = []
for (const item of selected) {
  const input = await readFile(join(library, item.file))
  if (sha(input) !== item.sha256) throw new Error(`Source image changed: ${item.number}`)
  const { data, info } = await sharp(input).rotate().resize({ width: 360, withoutEnlargement: true }).webp({ quality: 82, effort: 5 }).toBuffer({ resolveWithObject: true })
  const file = `hero-${item.number}-${sha(data).slice(0, 12)}.webp`
  await writeFile(join(output, file), data)
  items.push({ number: item.number, title: item.title, year: item.year, showId: item.showId, seasonId: item.seasonId, image: `/hero-posters/selected/${file}`, width: info.width, height: info.height, bytes: info.size, sourceUrl: item.sourceUrl, sourceImageUrl: item.imageUrl, sourceSha256: item.sha256 })
}
await writeFile(join(app, 'src/data/hero-poster-manifest.json'), JSON.stringify({ excludedNumbers, originalBytes: selected.reduce((sum, item) => sum + item.bytes, 0), optimizedBytes: items.reduce((sum, item) => sum + item.bytes, 0), items }, null, 2) + '\n')

if (process.argv.includes('--apply-selection')) {
  const removed = manifest.items.filter(item => excluded.has(Number(item.number)))
  const excludedDir = join(library, '用户排除')
  await mkdir(excludedDir, { recursive: true })
  const gallery = await readFile(join(library, 'index.html'), 'utf8')
  if (removed.length) {
    const backup = join(excludedDir, '筛选前-index.html')
    try { await stat(backup) } catch { await writeFile(backup, gallery) }
  }
  for (const item of removed) {
    const destination = join(excludedDir, item.file.split('/').at(-1))
    try { await stat(destination); throw new Error(`Exclusion destination already exists: ${destination}`) } catch (error) { if (error.code !== 'ENOENT') throw error }
    await rename(join(library, item.file), destination)
    item.file = `用户排除/${item.file.split('/').at(-1)}`
  }
  manifest.items = selected
  manifest.excludedItems = [...(manifest.excludedItems || []), ...removed]
  manifest.retained = selected.length
  manifest.uniqueShows = new Set(selected.map(item => item.showId)).size
  manifest.uniqueVersions = selected.length
  manifest.uniqueImageHashes = new Set(selected.map(item => item.sha256)).size
  manifest.selection = 'user-approved: retain all except 06,17,23,30,32,40,41,45,49,50; local website connected'
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  const updated = gallery.replace(/<article>[\s\S]*?<\/article>/g, article => {
    const number = Number(article.match(/<h2>(\d+)/)?.[1])
    return excluded.has(number) ? '' : article
  }).replace('50张海报候选', '40张已选海报')
    .replace(/<header>[\s\S]*?<\/header>/, '<header><h1>40张已选海报</h1><p>已按用户选择排除06、17、23、30、32、40、41、45、49、50。保留40个季版本、39个剧集ID；02与26两季轮换，同屏不重复。</p><p>下方保留原编号，原图未压缩；网站使用单独生成的360px WebP。排除项移入“用户排除”文件夹，可恢复。图片来源与版本详见核对记录。</p></header>')
  await writeFile(join(library, 'index.html'), updated)
}
console.log(JSON.stringify({ retained: items.length, uniqueShows: new Set(items.map(item => item.showId)).size, originalBytes: selected.reduce((sum, item) => sum + item.bytes, 0), webpBytes: items.reduce((sum, item) => sum + item.bytes, 0) }))
