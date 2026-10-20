import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/WebHeatPage.jsx', import.meta.url), 'utf8')
test('every web chart starts at the complete view and new dimensions get their own default', () => {
  assert.match(source, /const \[rangeMode, setRangeMode\] = useState\('all'\)/)
  const boardStack = source.slice(source.indexOf('function BoardStack'), source.indexOf('function RawDataModule'))
  assert.doesNotMatch(boardStack, /useState\(['"]all['"]\)/)
  assert.doesNotMatch(source, /end: rangeMode === 'initial' \? 35/)
  assert.match(source, /\['all', '完整视图'\]/)
  assert.doesNotMatch(source, /最小视图/)
  assert.match(source, /<BoardStack key=\{`\$\{platform\}:\$\{activeDimension.key\}`\}/)
})

test('competitor content stays mounted, hidden accessibly outside its active view, keyed by main project', () => {
  assert.match(source, /key=\{`competitor-view-\$\{project\?\.id \|\| 'demo'\}`\}/)
  assert.match(source, /hidden=\{activeView !== 'competitor'\}/)
  assert.match(source, /style=\{\{ display: activeView === 'competitor' \? undefined : 'none' \}\}/)
  assert.match(source, /startViewTransition\(\(\) => setActiveView\(view\)\)/)
  assert.match(source, /selectedView === 'competitor' \? 'is-active' : ''/)
})
