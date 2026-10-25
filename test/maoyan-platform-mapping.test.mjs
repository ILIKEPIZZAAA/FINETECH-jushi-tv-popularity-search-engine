import test from 'node:test'
import assert from 'node:assert/strict'
import { mapMaoyanPlatformRows } from '../src/lib/maoyanMetrics.js'

test('猫眼平台表现按源端实际返回平台映射，不受搜索元数据平台集合限制', () => {
  const mapped = mapMaoyanPlatformRows([
    { date: '2026-09-26', platform: '爱奇艺', platformHeat: '8,123.45' },
    { date: '2026-09-26', platform: '腾讯视频', platformHeat: '7,987.65' },
  ], { sourceUrl: 'https://piaofang.maoyan.com/i/tv-datainfo/1/platform' })

  assert.deepEqual(mapped.map((row) => row.values), [
    { '爱奇艺平台表现': 8123.45 },
    { '腾讯视频平台表现': 7987.65 },
  ])
  assert.equal(mapped[0].sourceUrl, 'https://piaofang.maoyan.com/i/tv-datainfo/1/platform')
})
