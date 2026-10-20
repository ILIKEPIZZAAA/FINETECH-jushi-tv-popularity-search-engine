import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createPosterImages, posterFetchSource, publicImageAddress } from '../server/poster-images.mjs'
import { posterUrl, supportedPosterSource } from '../src/lib/posterUrl.js'

const source = 'https://p0.pipi.cn/example.jpg?imageMogr2/thumbnail/2500x2500%3E'

test('poster requests allow only known image sources and block internal or credential-bearing URLs', () => {
  for (const value of ['http://p0.pipi.cn/a.jpg', 'https://p0.pipi.cn.evil.com/a.jpg', 'https://user:pass@p0.pipi.cn/a.jpg', 'https://127.0.0.1/a.jpg', 'file:///etc/passwd', 'https://p0.pipi.cn:8443/a.jpg']) assert.equal(supportedPosterSource(value), false, value)
  for (const value of [source, 'https://image.meituan.net/a.jpg', 'https://img1.doubanio.com/a.jpg', 'https://static.tvmaze.com/a.jpg']) assert.equal(supportedPosterSource(value), true)
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.19.216.255', '192.168.1.1', '::1', '::ffff:127.0.0.1']) assert.equal(publicImageAddress(address), false)
  assert.equal(posterUrl('/assets/local.jpg'), '/assets/local.jpg')
  assert.equal(new URL(posterUrl(source), 'http://localhost').searchParams.get('src'), source)
  assert.equal(posterFetchSource(source), source.replace('2500x2500', '384x576'))
  assert.equal(posterFetchSource(`${source}&token=signed`), `${source}&token=signed`)
})

test('concurrent poster views share one small WebP and reuse a persistent disk cache', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'poster-cache-'))
  try {
    const input = await sharp({ create: { width: 1000, height: 1500, channels: 3, background: '#224466' } }).jpeg().toBuffer()
    let calls = 0
    const service = createPosterImages({ directory, readSource: async () => { calls++; return input } })
    const [first, second] = await Promise.all([service.image(source), service.image(source)])
    assert.equal(calls, 1)
    assert.deepEqual(first.bytes, second.bytes)
    const meta = await sharp(first.bytes).metadata()
    assert.equal(meta.format, 'webp')
    assert.equal(meta.width, 192)
    assert.equal(meta.height, 288)
    assert.ok(first.bytes.length < input.length)
    const restarted = createPosterImages({ directory, readSource: () => { throw new Error('must use cache') } })
    const cached = await restarted.image(source)
    assert.equal(cached.cached, true)
    assert.deepEqual(cached.bytes, first.bytes)
    let status
    await restarted.handle({ method: 'GET', headers: { 'if-none-match': `"${cached.key}"` } }, { writeHead: code => { status = code }, end() {} }, new URL(posterUrl(source), 'http://localhost'))
    assert.equal(status, 304)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('failed poster reads stay retryable and never create an asserted image', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'poster-failure-'))
  try {
    let calls = 0
    const service = createPosterImages({ directory, readSource: async () => { calls++; throw new Error('unavailable') } })
    await assert.rejects(service.image(source))
    await assert.rejects(service.image(source))
    assert.equal(calls, 2)
    await assert.rejects(service.image('https://localhost/a.jpg'), { status: 400 })
    assert.equal(calls, 2)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
