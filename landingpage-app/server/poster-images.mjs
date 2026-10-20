import { createHash } from 'node:crypto'
import { lookup } from 'node:dns'
import { get } from 'node:https'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { supportedPosterSource } from '../src/lib/posterUrl.js'

const MAX_INPUT_BYTES = 4 * 1024 * 1024
const MAX_CACHE_BYTES = 64 * 1024 * 1024
const MAX_AGE = 7 * 86400_000

export function publicImageAddress(address) {
  if (address.includes(':')) return /^2[0-9a-f]{3}:/i.test(address)
  const [a, b] = address.split('.').map(Number)
  return a > 0 && a < 224 && a !== 10 && a !== 127 && !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0)) &&
    !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && (b === 18 || b === 19))
}

function publicLookup(host, options, callback) {
  lookup(host, { all: true }, (error, addresses) => {
    if (error) return callback(error)
    if (!addresses.length || addresses.some(entry => !publicImageAddress(entry.address))) return callback(new Error('Invalid image host address'))
    if (options.all) callback(null, addresses)
    else callback(null, addresses[0].address, addresses[0].family)
  })
}

export function readSourceImage(source, redirects = 0) {
  if (!supportedPosterSource(source)) return Promise.reject(new Error('Unsupported poster source'))
  return new Promise((resolve, reject) => {
    const request = get(source, { lookup: publicLookup, headers: { 'user-agent': 'Mozilla/5.0', accept: 'image/avif,image/webp,image/*' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume()
        if (redirects >= 2 || !response.headers.location) return reject(new Error('Poster redirect limit'))
        const target = new URL(response.headers.location, source).href
        return readSourceImage(target, redirects + 1).then(resolve, reject)
      }
      if (response.statusCode !== 200 || !/^image\/(?:jpeg|png|webp|avif|gif)(?:;|$)/i.test(response.headers['content-type'] || '') || Number(response.headers['content-length']) > MAX_INPUT_BYTES) {
        response.resume()
        return reject(new Error('Poster source unavailable'))
      }
      let length = 0
      const chunks = []
      response.on('data', chunk => {
        length += chunk.length
        if (length > MAX_INPUT_BYTES) response.destroy(new Error('Poster exceeds size limit'))
        else chunks.push(chunk)
      })
      response.on('end', () => resolve(Buffer.concat(chunks)))
      response.on('error', reject)
    })
    const deadline = setTimeout(() => request.destroy(new Error('Poster source timeout')), 6000)
    request.on('close', () => clearTimeout(deadline))
    request.on('error', reject)
  })
}

export function posterFetchSource(source) {
  const url = new URL(source)
  // The catalog already returns this CDN's imageMogr2 thumbnail URL. Request
  // a bounded rendition for a 192px output instead of downloading its 2500px image.
  if (/^p\d+\.pipi\.cn$/.test(url.hostname) && !/[?&](?:token|sign|signature)=/i.test(url.search)) {
    return source.replace(/(\/thumbnail\/)\d+x\d+(?:%3e|>)/i, '$1384x576%3E')
  }
  return source
}

export function createPosterImages({ directory, readSource = readSourceImage, now = Date.now } = {}) {
  const pending = new Map()
  let lastPrune = 0
  async function prune() {
    if (now() - lastPrune < 3600_000) return
    lastPrune = now()
    const files = await readdir(directory)
    const entries = (await Promise.all(files.filter(file => /^[a-f0-9]{64}\.webp$/.test(file)).map(async file => {
      const path = join(directory, file)
      return { path, ...await stat(path) }
    }))).sort((a, b) => b.mtimeMs - a.mtimeMs)
    let bytes = 0
    for (const entry of entries) {
      bytes += entry.size
      if (bytes > MAX_CACHE_BYTES || now() - entry.mtimeMs > MAX_AGE) await unlink(entry.path).catch(() => {})
    }
  }
  async function image(source) {
    if (!supportedPosterSource(source)) throw Object.assign(new Error('Unsupported poster source'), { status: 400 })
    if (pending.has(source)) return pending.get(source)
    if (pending.size >= 8) throw Object.assign(new Error('Poster queue busy'), { status: 429 })
    const task = (async () => {
      const key = createHash('sha256').update(`webp-192-v1:${source}`).digest('hex')
      const path = join(directory, `${key}.webp`)
      try {
        if (now() - (await stat(path)).mtimeMs < MAX_AGE) return { bytes: await readFile(path), key, cached: true }
      } catch {}
      const input = await readSource(posterFetchSource(source))
      const bytes = await sharp(input, { limitInputPixels: 16_000_000, animated: false })
        .rotate().resize({ width: 192, withoutEnlargement: true }).webp({ quality: 78, effort: 4 }).toBuffer()
      await mkdir(directory, { recursive: true })
      const temporary = `${path}.tmp`
      await writeFile(temporary, bytes, { mode: 0o600 })
      await rename(temporary, path)
      void prune().catch(() => {})
      return { bytes, key, cached: false }
    })().finally(() => pending.delete(source))
    pending.set(source, task)
    return task
  }
  return { image, async handle(request, response, url) {
    if (request.method !== 'GET') { response.writeHead(405); return response.end() }
    try {
      const result = await image(url.searchParams.get('src') || '')
      const etag = `"${result.key}"`
      const headers = { 'content-type': 'image/webp', 'cache-control': 'public, max-age=604800', etag, 'x-content-type-options': 'nosniff' }
      if (request.headers['if-none-match'] === etag) { response.writeHead(304, headers); return response.end() }
      response.writeHead(200, { ...headers, 'content-length': result.bytes.length, 'x-poster-cache': result.cached ? 'HIT' : 'MISS' })
      response.end(result.bytes)
    } catch (error) {
      response.writeHead(error.status || 502, { 'cache-control': 'no-store' })
      response.end('Poster unavailable')
    }
  } }
}
