import assert from 'node:assert/strict'
import test from 'node:test'
import { combinedSourceStatus, guduoHistoryPageRanges, guduoHistoryResumeFrom, hasDimension, isoDatesInRange, kyHistoryWindow, replaceVerifiedSourceHistory, safeReadState, sourceHistoryRefreshNeeds, sourceStatusClass, withVerifiedTvAvailability, writeState } from '../src/lib/dramaMonitor.js'

test('酷云仅核验含截止日在内的30天，新剧从首播日开始', () => {
  assert.deepEqual(kyHistoryWindow('2023-01-14', '2026-10-13'), { from: '2026-09-14', to: '2026-10-13' })
  assert.deepEqual(kyHistoryWindow('2026-10-01', '2026-10-13'), { from: '2026-10-01', to: '2026-10-13' })
})

test('已有逐日台端数据的网首播项目可进入台端对比，目录首播端口径保持不变', () => {
  const webFirst = { id: 'catalog-1', title: '示例剧', platforms: [{ name: '网端', dimension: 'web' }], distribution: { firstRelease: 'web-first' } }
  assert.equal(hasDimension(webFirst, 'tv'), false)
  const verified = withVerifiedTvAvailability(webFirst, [{ date: '2026-01-01', channel: '示例频道' }])
  assert.equal(hasDimension(verified, 'tv'), true)
  assert.equal(hasDimension(verified, 'web'), true)
  assert.equal(verified.distribution.firstRelease, 'web-first')
  assert.equal(withVerifiedTvAvailability(verified, [{ date: '2026-01-02' }]), verified)
})

test('旧版持久化状态有台端记录时自动恢复台端可比能力', () => {
  const previousWindow = globalThis.window
  try {
    globalThis.window = { sessionStorage: { getItem: () => JSON.stringify({
      projects: [{ id: 'catalog-1', title: '示例剧', platforms: [{ name: '网端', dimension: 'web' }], distribution: { firstRelease: 'web-first' } }],
      selectedId: 'catalog-1',
      competitors: { 'catalog-1': [{ id: 'catalog-2', title: '竞品剧', platforms: [{ name: '网端', dimension: 'web' }], distribution: { firstRelease: 'web-first' } }] },
      tvRatings: {
        'catalog-1': [{ date: '2026-01-01', channel: '示例频道' }],
        'catalog-2': [{ date: '2026-01-01', channel: '示例频道' }],
      },
    }) } }
    const state = safeReadState()
    assert.equal(hasDimension(state.projects[0], 'tv'), true)
    assert.equal(hasDimension(state.competitors['catalog-1'][0], 'tv'), true)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('跨源抓取有单源无数据提示时按部分完成标记', () => {
  assert.equal(combinedSourceStatus([{ name: '猫眼热度', value: 7000 }], [], ['骨朵：近期无榜单']), 'partial')
  assert.equal(combinedSourceStatus([{ name: '骨朵热度', value: 52 }], [], ['骨朵：较新日期请求失败，当前返回最近命中值']), 'partial')
  assert.equal(combinedSourceStatus([{ name: '猫眼热度', value: 7000 }], [{ source: '猫眼', message: '请求超时' }], []), 'partial')
  assert.equal(combinedSourceStatus([], [], ['猫眼：暂无公开数据']), 'empty')
  assert.equal(combinedSourceStatus([{ name: '猫眼热度', value: 7000 }], [], [], ['骨朵：今日已有快照，跳过重复抓取']), 'success')
  assert.equal(combinedSourceStatus([], [], [], ['骨朵：今日已有快照，跳过重复抓取']), 'success')
  assert.equal(combinedSourceStatus([], [{ source: '猫眼', message: '请求超时' }], []), 'error')
  assert.equal(combinedSourceStatus([], [], []), 'error')
})

test('部分完成状态使用可区分的状态样式', () => {
  assert.equal(sourceStatusClass({ state: 'partial' }), 'is-partial')
})

test('骨朵历史按连续日期分页，尾页可不足整页', () => {
  assert.deepEqual(guduoHistoryPageRanges('2026-01-01', '2026-01-31', 30), [
    { from: '2026-01-01', to: '2026-01-30' },
    { from: '2026-01-31', to: '2026-01-31' },
  ])
  assert.deepEqual(guduoHistoryPageRanges('2026-02-28', '2026-03-02', 2), [
    { from: '2026-02-28', to: '2026-03-01' },
    { from: '2026-03-02', to: '2026-03-02' },
  ])
  assert.deepEqual(guduoHistoryPageRanges('2026-02-31', '2026-03-02', 7), [])
})

test('骨朵历史只在完整覆盖到最新可查日时跳过，并能续跑失败区间', () => {
  const oldCoverage = { complete: true, scannedFrom: '2020-01-01', scannedThrough: '2026-01-30' }
  assert.equal(guduoHistoryResumeFrom('2020-01-01', '2026-01-31', oldCoverage), '2026-01-31')
  assert.equal(guduoHistoryResumeFrom('2020-01-01', '2026-01-30', oldCoverage), null)
  assert.equal(guduoHistoryResumeFrom('2020-01-01', '2026-01-31', { complete: true, attemptedDates: 365 }), '2020-01-01')
  assert.equal(guduoHistoryResumeFrom('2020-01-01', '2026-01-31', { complete: false, scannedFrom: '2020-01-01', resumeFrom: '2025-10-01' }), '2025-10-01')
  assert.equal(guduoHistoryResumeFrom('2019-01-01', '2026-01-31', { complete: false, scannedFrom: '2020-01-01', resumeFrom: '2025-10-01' }), '2019-01-01')
})

test('已有旧数据也会续抓骨朵和酷云，手动刷新会复查最近日期', () => {
  const input = {
    premiere: '2026-09-11', historyEnd: '2026-09-26', today: '2026-09-27',
    guduoSync: { complete: true, scannedFrom: '2026-09-11', scannedThrough: '2026-09-23' },
    kySync: { state: 'success', fetchedAt: '2026-09-23T10:00:00Z', lastDate: '2026-09-23' },
    hasGuduoData: true, hasGuduoRank: true, hasKyHeat: true, hasKyGrowth: true,
  }
  assert.deepEqual(sourceHistoryRefreshNeeds(input), { guduo: true, ky: true })
  const complete = {
    ...input,
    guduoSync: {
      ...input.guduoSync,
      scannedThrough: '2026-09-26',
      verification: { version: 1, verified: true, from: '2026-09-11', to: '2026-09-26' },
    },
    kySync: {
      ...input.kySync,
      fetchedAt: '2026-09-27T04:00:00Z',
      lastDate: '2026-09-26',
      verification: { version: 1, verified: true, from: '2026-09-11', to: '2026-09-26' },
    },
  }
  assert.deepEqual(sourceHistoryRefreshNeeds(complete), { guduo: false, ky: false })
  assert.deepEqual(sourceHistoryRefreshNeeds({ ...complete, force: true }), { guduo: true, ky: true })
})

test('来源覆盖按首播至截止日生成每天一行，空值清旧但不动其它来源指标', () => {
  const metrics = ['骨朵热度', '骨朵热度排名']
  const merged = replaceVerifiedSourceHistory([
    { date: '2026-09-01', values: { 骨朵热度: 70, 猫眼热度: 8000 } },
    { date: '2026-09-02', values: { 骨朵热度: 71, 骨朵热度排名: 12, 猫眼热度: 8100 } },
  ], [
    { date: '2026-09-01', values: { 骨朵热度: 70.2, 骨朵热度排名: 11 } },
  ], { from: '2026-09-01', to: '2026-09-03', metrics })

  assert.deepEqual(isoDatesInRange('2026-09-01', '2026-09-03'), ['2026-09-01', '2026-09-02', '2026-09-03'])
  assert.equal(merged.length, 3)
  assert.deepEqual(merged[0].values, { 猫眼热度: 8000, 骨朵热度: 70.2, 骨朵热度排名: 11 })
  assert.deepEqual(merged[1].values, { 猫眼热度: 8100 })
  assert.deepEqual(merged[2].values, {})
})

test('未收敛日期保留最新待复核源值，不抹掉或宣称已核验', () => {
  const merged = replaceVerifiedSourceHistory([
    { date: '2026-09-26', values: { '有效播放量': 920000000, '猫眼热度': 6500 } },
    { date: '2026-09-27', values: { '有效播放量': 930000000 } },
  ], [
    { date: '2026-09-26', values: { '有效播放量': 926000000 }, verificationStatus: 'pending' },
  ], { from: '2026-09-26', to: '2026-09-27', metrics: ['有效播放量'], unresolvedDates: ['2026-09-26', '2026-09-27'] })

  assert.equal(merged.find((row) => row.date === '2026-09-26').values['有效播放量'], 926000000)
  assert.equal(merged.find((row) => row.date === '2026-09-26').verificationStatus, 'pending')
  assert.equal(merged.find((row) => row.date === '2026-09-26').values['猫眼热度'], 6500)
  assert.equal(merged.find((row) => row.date === '2026-09-27').values['有效播放量'], 930000000)
})

test('本地存储写入失败会返回失败信号供界面提示', () => {
  const previousWindow = globalThis.window
  try {
    globalThis.window = { sessionStorage: { setItem() { throw new Error('quota exceeded') } } }
    assert.equal(writeState({ projects: [] }), false)
    globalThis.window.sessionStorage.setItem = () => {}
    assert.equal(writeState({ projects: [] }), true)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('关闭标签页的会话结束后不读取旧的永久项目与日志', () => {
  const previousWindow = globalThis.window
  const legacy = new Map([['drama-signal-web-projects-v1', JSON.stringify({ projects: [{ id: 'old', title: '旧项目' }], logs: [{ message: '旧日志' }] })]])
  const session = new Map()
  globalThis.window = {
    localStorage: { getItem: (key) => legacy.get(key), removeItem: (key) => legacy.delete(key) },
    sessionStorage: { getItem: (key) => session.get(key), setItem: (key, value) => session.set(key, value) },
  }
  try {
    assert.deepEqual(safeReadState().projects, [])
    assert.deepEqual(safeReadState().logs, [])
    assert.equal(legacy.size, 0)
    assert.equal(writeState({ projects: [{ id: 'new', title: '新项目' }], logs: [] }), true)
    assert.equal(safeReadState().projects[0].id, 'new')
    session.clear()
    assert.deepEqual(safeReadState().projects, [])
  } finally { globalThis.window = previousWindow }
})
