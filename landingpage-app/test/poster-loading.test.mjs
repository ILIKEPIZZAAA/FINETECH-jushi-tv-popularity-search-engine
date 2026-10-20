import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadPosterWhenNearViewport, createAnimationPaintGate } from '../src/lib/posterLoading.js'

test('priority hint uses the lowercase native attribute supported by the installed React version', () => {
  const component = readFileSync(new URL('../src/components/HeroPosterWall.jsx', import.meta.url), 'utf8')
  assert.match(component, /fetchpriority="high"/)
  assert.doesNotMatch(component, /fetchPriority=/)
})

test('near-viewport poster is requested once, without replacing its existing image', () => {
  const attributes = new Map([['data-poster-src', '/hero-posters/original.jpg']])
  let changes = 0
  const image = { getAttribute: key => attributes.get(key), setAttribute: (key, value) => { changes++; attributes.set(key, value) } }
  assert.equal(loadPosterWhenNearViewport(image), true)
  assert.equal(loadPosterWhenNearViewport(image), false)
  assert.equal(changes, 1)
  assert.equal(attributes.get('src'), '/hero-posters/original.jpg')
})

test('animation keeps at most 30 paints per second and supports forced reduced-motion paint', () => {
  const gate = createAnimationPaintGate()
  let paints = 0
  for (let frame = 0; frame < 60; frame++) if (gate(frame * 1000 / 60)) paints++
  assert.equal(paints, 30)
  assert.equal(gate(1000, true), true)
})
