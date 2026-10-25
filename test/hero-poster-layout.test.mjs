import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { buildHeroPosterRows, heroPosterRowFrame, posterForCycle } from '../src/lib/heroPosterLayout.js'

const manifest = JSON.parse(readFileSync(new URL('../src/data/hero-poster-manifest.json', import.meta.url)))
const rows = buildHeroPosterRows(manifest.items)

test('approved library contains exactly the retained 40 posters and versioned local WebP files', () => {
  assert.equal(manifest.items.length, 40)
  assert.deepEqual(manifest.excludedNumbers, [6, 17, 23, 30, 32, 40, 41, 45, 49, 50])
  for (const poster of manifest.items) {
    assert.ok(!manifest.excludedNumbers.includes(Number(poster.number)))
    assert.match(poster.image, /^\/hero-posters\/selected\/hero-\d{2}-[a-f0-9]{12}\.webp$/)
    assert.equal(poster.width, 240)
    assert.equal(poster.originalPresentation.width, 360)
    assert.equal(statSync(new URL(`../public${poster.image}`, import.meta.url)).size, poster.bytes)
  }
  assert.equal(new Set(manifest.items.map(item => item.sourceSha256)).size, 40)
})

test('all seasons of a show share one slot, with no repeated show or artwork across either row', () => {
  const groups = rows.flat()
  assert.equal(groups.length, 39)
  assert.equal(new Set(groups.map(group => group[0].showId)).size, 39)
  assert.deepEqual(groups.find(group => group[0].showId === 45302).map(item => item.number), ['02', '26'])
  const duplicate = buildHeroPosterRows([...manifest.items, manifest.items[0]])
  assert.equal(duplicate.flat().flat().length, 40)
})

test('ordinary, mobile and 4K windows retain card coordinates and unique identities through repeated wraps', () => {
  for (const [width, scale] of [[390, 0.39], [1672, 0.77], [3840, 0.9]]) {
    for (let elapsed = 0; elapsed < 1800; elapsed += 13) {
      const visible = []
      rows.forEach((row, rowIndex) => {
        const frame = heroPosterRowFrame(row.length, width, scale, elapsed, rowIndex)
        frame.forEach(({ x, cycle, pitch }, index) => {
          assert.ok(pitch >= 176 * scale)
          assert.ok(Number.isFinite(x) && Number.isFinite(cycle))
          if (x + 160 * scale > 0 && x < width) visible.push(posterForCycle(row[index], cycle))
        })
      })
      assert.equal(new Set(visible.map(item => item.showId)).size, visible.length)
      assert.equal(new Set(visible.map(item => item.sourceSha256)).size, visible.length)
    }
  }
})

test('both scroll directions rotate through approved seasons without changing the show identity', () => {
  const versions = rows.flat().find(group => group.length > 1)
  assert.equal(posterForCycle(versions, 0).number, '02')
  assert.equal(posterForCycle(versions, 1).number, '26')
  assert.equal(posterForCycle(versions, -1).number, '26')
  assert.equal(posterForCycle(versions, 2).number, '02')
})

test('a hidden or detached wall cannot produce NaN cycle indices during resize and page exit', () => {
  for (const [count, width, scale] of [[20, 0, 0], [20, 1672, 0], [0, 1672, 0.9], [20, NaN, 0.9]]) {
    assert.deepEqual(heroPosterRowFrame(count, width, scale, 120, 0), [])
  }
})
