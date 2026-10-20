import test from 'node:test'
import assert from 'node:assert/strict'
import { createPosterPreloader } from '../src/lib/posterPreload.js'

test('preparation loads and decodes each actual poster once, sharing concurrent work', async () => {
  const images = []
  let decode
  const preload = createPosterPreloader({ createImage: () => {
    const image = { decode: () => new Promise(resolve => { decode = resolve }) }
    images.push(image)
    return image
  } })
  const items = [{ poster: 'https://example.com/one.jpg' }, { poster: 'https://example.com/one.jpg' }, { poster: '剧' }]
  let done = false
  const first = preload(items).then(value => { done = true; return value })
  const second = preload(items)
  assert.equal(images.length, 1)
  assert.equal(images[0].src, items[0].poster)
  images[0].onload()
  await Promise.resolve()
  assert.equal(done, false)
  decode()
  assert.deepEqual(await first, [{ src: items[0].poster, state: 'ready' }])
  assert.deepEqual(await second, await first)
  await preload(items)
  assert.equal(images.length, 1)
})

test('failed and timed-out posters remain retryable without asserting successful preparation', async () => {
  const images = []
  const preload = createPosterPreloader({ timeoutMs: 10, createImage: () => { const image = {}; images.push(image); return image } })
  const items = [{ poster: '/assets/poster.jpg' }]
  const first = preload(items)
  images[0].onerror()
  assert.equal((await first)[0].state, 'error')
  assert.equal((await preload(items))[0].state, 'timeout')
  assert.equal(images.length, 2)
  const third = preload(items)
  images[2].onload()
  assert.equal((await third)[0].state, 'ready')
})

test('server-side rendering has an explicit unavailable state and a bounded image cache', async () => {
  const missing = createPosterPreloader({ createImage: () => null })
  assert.equal((await missing([{ poster: 'https://example.com/x.jpg' }]))[0].state, 'unavailable')
  let count = 0
  const preload = createPosterPreloader({ maxEntries: 1, createImage: () => {
    count++
    return { set src(value) { queueMicrotask(() => this.onload()) } }
  } })
  await preload([{ poster: '/assets/a.jpg' }])
  await preload([{ poster: '/assets/b.jpg' }])
  await preload([{ poster: '/assets/a.jpg' }])
  assert.equal(count, 3)
})
