import { mkdir, writeFile, access, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { heroPosters } from '../src/data/hero-posters.js'

const output = resolve(process.argv[2] || '')
if (!process.argv[2] || !output.endsWith('/海报候选库')) throw new Error('Explicit 海报候选库 output directory required')
try {
  if ((await readdir(output)).length) throw new Error('Candidate directory is not empty; refusing to overwrite an existing review library')
} catch (error) { if (error.code !== 'ENOENT') throw error }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let lastApi = 0
async function json(path) {
  await sleep(Math.max(0, 550 - (Date.now() - lastApi)))
  lastApi = Date.now()
  const response = await fetch(`https://api.tvmaze.com${path}`, { signal: AbortSignal.timeout(25_000), headers: { 'User-Agent': 'FINETECH-candidate-review/1.0' } })
  if (!response.ok) throw new Error(`TVmaze ${response.status}: ${path}`)
  return response.json()
}
const normalize = value => String(value || '').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '')
function dimensions(bytes) {
  if (bytes.subarray(1, 4).toString() === 'PNG') return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
  let at = 2
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 255) break
    const marker = bytes[at + 1], size = bytes.readUInt16BE(at + 2)
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) return [bytes.readUInt16BE(at + 7), bytes.readUInt16BE(at + 5)]
    at += 2 + size
  }
  return [0, 0]
}
const extra = [
  ['一念关山', 2023, 'A Journey to Love'], ['去有风的地方', 2023, 'Meet Yourself'],
  ['追风者', 2024, 'War of Faith'], ['繁花', 2023, 'Blossoms Shanghai'],
  ['永夜星河', 2024, 'Love Game in Eastern Fantasy'], ['大奉打更人', 2024, 'Guardians of the Dafeng'],
  ['雪迷宫', 2024, 'The First Shot'], ['白夜追凶', 2017, 'Day and Night'],
  ['人世间', 2022, 'A Lifelong Journey'], ['仙台有树', 2025, 'Love of the Divine Tree'],
  ['南来北往', 2024, 'Always on the Move'], ['宁安如梦', 2023, 'Story of Kunning Palace'],
  ['知否知否应是绿肥红瘦', 2018, 'The Story of Ming Lan'], ['甄嬛传', 2011, 'Empresses in the Palace'],
  ['琅琊榜', 2015, 'Nirvana in Fire'], ['锦绣安宁', 2024, 'The Rise of Ning'],
].map(([title, year, query]) => ({ title, year, query }))

await mkdir(output, { recursive: true })
const originals = join(output, '原图')
await mkdir(originals, { recursive: true })
const rows = [], skipped = [], hashes = new Set(), identities = new Set()
for (const item of [...heroPosters, ...extra]) {
  if (rows.length >= 50) break
  try {
    let show, season, paths = []
    if (item.query) {
      const path = `/search/shows?q=${encodeURIComponent(item.query)}`
      paths.push(`https://api.tvmaze.com${path}`)
      const matches = await json(path)
      show = matches.map(entry => entry.show).find(candidate => candidate.language === 'Chinese' && candidate.premiered?.startsWith(String(item.year)) && normalize(candidate.name) === normalize(item.query))
      if (!show) throw new Error('No exact title/year/Chinese-language match')
    } else {
      const url = new URL(item.sourceUrl)
      const [, kind, id] = url.pathname.split('/')
      if (kind === 'seasons') {
        season = await json(`/seasons/${id}`)
        paths.push(`https://api.tvmaze.com/seasons/${id}`)
        show = await json('/shows/45302')
      } else show = await json(`/shows/${id}`)
    }
    const year = (season?.premiereDate || show.premiered || '').slice(0, 4)
    if (year !== String(item.year) || show.language !== 'Chinese') throw new Error(`Source identity/year mismatch: ${show.name} ${year}`)
    paths.push(`https://api.tvmaze.com/shows/${show.id}`)
    const aliases = await json(`/shows/${show.id}/akas`)
    paths.push(`https://api.tvmaze.com/shows/${show.id}/akas`)
    const chineseAlias = aliases.map(entry => entry.name).find(name => normalize(item.title).startsWith(normalize(name)) && /\p{Script=Han}/u.test(name))
    const curated = show.id === 32701 ? 'https://static.tvmaze.com/uploads/images/original_untouched/131/328438.jpg' : null
    if (curated) paths.push(`https://api.tvmaze.com/shows/${show.id}/images`)
    const image = curated || season?.image?.original || show.image?.original
    if (!image || new URL(image).hostname !== 'static.tvmaze.com') throw new Error('No original TVmaze poster image')
    const identity = `${show.id}:${season?.id || ''}`
    if (identities.has(identity)) throw new Error('Duplicate show/version')
    const response = await fetch(image, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Image response ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (hashes.has(sha256)) throw new Error('Duplicate image SHA256')
    const [width, height] = dimensions(bytes)
    if (!width || height <= width) throw new Error('Not a decodable portrait poster')
    const number = String(rows.length + 1).padStart(2, '0')
    const ext = response.headers.get('content-type').includes('png') ? 'png' : 'jpg'
    const filename = `${number}-${item.title.replace(/[\\/:*?"<>|]/g, '')}-${item.year}.${ext}`
    try { await access(join(originals, filename)); throw new Error('Existing candidate file; refusing overwrite') } catch (error) { if (error.code !== 'ENOENT') throw error }
    await writeFile(join(originals, filename), bytes, { flag: 'wx' })
    rows.push({ number, title: item.title, year: item.year, sourceTitle: show.name, showId: show.id, seasonId: season?.id || null, sourceUrl: season?.url || show.url, imageUrl: image, apiEvidence: paths, chineseAlias: chineseAlias || null, identityCheck: chineseAlias ? 'Chinese alias + source ID + year' : 'Source ID + year; Chinese label needs visual review', width, height, bytes: bytes.length, sha256, quality: width >= 500 && height >= 700 ? 'full-size' : 'low-resolution-review', file: `原图/${filename}`, downloadedAt: new Date().toISOString() })
    identities.add(identity); hashes.add(sha256)
    process.stdout.write(`${number} ${item.title} ${width}x${height}\n`)
  } catch (error) { skipped.push({ title: item.title, reason: error.message }); process.stdout.write(`SKIP ${item.title}: ${error.message}\n`) }
}
const uniqueShows = new Set(rows.map(item => item.showId)).size
const manifest = { source: 'TVmaze public API / original poster CDN', apiDocumentation: 'https://www.tvmaze.com/api', downloaded: rows.length, uniqueShows, uniqueVersions: identities.size, uniqueImageHashes: hashes.size, selection: 'pending-user-selection; not connected to website', rights: 'API metadata CC BY-SA with attribution; poster artwork rights belong to rights holders, publication review pending', items: rows, skipped }
await writeFile(join(output, '来源与核对记录.json'), JSON.stringify(manifest, null, 2))
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
const cards = rows.map(item => `<article><img loading="lazy" src="${escape(item.file)}" alt="${escape(item.title)}"><h2>${item.number} · ${escape(item.title)}</h2><p>${item.year} · ${item.width}×${item.height}</p><a href="${escape(item.sourceUrl)}" target="_blank" rel="noreferrer">来源 TVmaze</a></article>`).join('')
await writeFile(join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FINETECH 海报候选库</title><style>body{margin:0;padding:32px;font:16px system-ui;background:#f0f8fb;color:#19343c}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:24px}article{background:white;padding:12px;border-radius:12px}img{width:100%;aspect-ratio:2/3;object-fit:contain}h2{font-size:16px}p,a{font-size:13px;color:#536b75}header{margin-bottom:28px}</style><header><h1>${rows.length}张海报候选</h1><p>按编号选择保留项。原图未压缩、未替换现有图库；同屏去重规则将在选定后接入。</p><p>图片来源：TVmaze。保留来源与版本记录；公开展示前仍需核对素材使用条件。</p></header><main>${cards}</main></html>`)
await writeFile(join(output, '筛选说明.md'), `# 海报候选库\n\n已下载 ${rows.length} 张，唯一剧集ID ${uniqueShows} 个，唯一剧集/季版本 ${identities.size} 个，唯一图片SHA256 ${hashes.size} 个。\n\n打开 index.html 或原图文件夹，回复保留编号即可。可保留全部合格唯一候选；同一IP的不同季需要同屏去重。完整循环后再次出现属于正常轮播。图片数量本身不能保证同屏不重复，接入时会按剧集ID和图片哈希双重去重。\n\n图片尚未压缩、上传或接入网站；原有素材未修改。版权和正式公开使用条件需在接入前复核。来源详见 来源与核对记录.json；TVmaze API文档：https://www.tvmaze.com/api 。\n`)
process.stdout.write(JSON.stringify({ downloaded: rows.length, uniqueVersions: identities.size, uniqueImages: hashes.size, output, skipped: skipped.length }) + '\n')
if (rows.length < 50) process.exitCode = 2
