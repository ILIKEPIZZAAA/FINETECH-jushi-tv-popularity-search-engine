import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const app = fileURLToPath(new URL('..', import.meta.url))
const manifestPath = `${app}/src/data/hero-poster-manifest.json`
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
for (const item of manifest.items) {
  const original = item.originalPresentation || { image: item.image, width: item.width, height: item.height, bytes: item.bytes }
  const { data, info } = await sharp(`${app}/public${original.image}`)
    .resize({ width: 240, withoutEnlargement: true })
    .webp({ quality: 62, effort: 6 }).toBuffer({ resolveWithObject: true })
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 12)
  const image = `/hero-posters/selected/hero-${item.number}-${hash}.webp`
  await writeFile(`${app}/public${image}`, data)
  Object.assign(item, { originalPresentation: original, image, width: info.width, height: info.height, bytes: data.length })
}
manifest.optimizedBytes = manifest.items.reduce((sum, item) => sum + item.bytes, 0)
manifest.presentationVersion = 2
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
await sharp(`${app}/src/assets/hero-orbit-light-v2.png`)
  .resize({ width: 1920, withoutEnlargement: true })
  .webp({ quality: 76, alphaQuality: 70, effort: 6 })
  .toFile(`${app}/src/assets/hero-orbit-light-light.webp`)
console.log(JSON.stringify({ posters: manifest.items.length, before: manifest.items.reduce((sum, item) => sum + item.originalPresentation.bytes, 0), after: manifest.optimizedBytes }))
