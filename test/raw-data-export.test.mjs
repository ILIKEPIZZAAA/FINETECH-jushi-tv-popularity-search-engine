import test from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { buildRawDataWorkbook, buildRawDataXlsx } from '../src/hooks/useDramaMonitor.js'

const workbookRows = (xml, name) => {
  const content = xml.match(new RegExp(`<Worksheet ss:Name="${name}">([\\s\\S]*?)<\\/Worksheet>`))?.[1] || ''
  return [...content.matchAll(/<Row>([\s\S]*?)<\/Row>/g)].slice(1).map((row) =>
    [...row[1].matchAll(/<Data ss:Type="([^"]+)">([\s\S]*?)<\/Data>/g)].map((cell) => cell[1] === 'Number' ? Number(cell[2]) : cell[2]))
}

async function zipTextEntry(bytes, targetName) {
  const data = new Uint8Array(bytes)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let endOffset = data.length - 22
  while (endOffset >= 0 && view.getUint32(endOffset, true) !== 0x06054b50) endOffset -= 1
  assert.ok(endOffset >= 0, 'XLSX 文件应包含 ZIP 目录')
  const count = view.getUint16(endOffset + 10, true)
  let directoryOffset = view.getUint32(endOffset + 16, true)
  for (let index = 0; index < count; index += 1) {
    const method = view.getUint16(directoryOffset + 10, true)
    const compressedSize = view.getUint32(directoryOffset + 20, true)
    const nameLength = view.getUint16(directoryOffset + 28, true)
    const extraLength = view.getUint16(directoryOffset + 30, true)
    const commentLength = view.getUint16(directoryOffset + 32, true)
    const localOffset = view.getUint32(directoryOffset + 42, true)
    const name = new TextDecoder().decode(data.subarray(directoryOffset + 46, directoryOffset + 46 + nameLength))
    const dataOffset = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true)
    if (name === targetName) {
      const compressed = data.subarray(dataOffset, dataOffset + compressedSize)
      const content = method === 8
        ? await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()
        : compressed
      return new TextDecoder().decode(content)
    }
    directoryOffset += 46 + nameLength + extraLength + commentLength
  }
  return null
}

test('整段无值的酷云只显示暂无数据，不借用其他来源历史日期', () => {
  const xml = buildRawDataWorkbook({
    projects: [{ id: 'p', title: '三体' }], selectedId: 'p',
    liveHeat: { p: [{ date: '2023-01-15', values: { '猫眼热度': 7000 } }] },
    sourceSync: { p: { ky: { state: 'empty', complete: true, verification: {
      verified: true, from: '2026-10-01', to: '2026-10-02', checkedDates: ['2026-10-01', '2026-10-02'],
      noDataByMetric: { heat: ['2026-10-01', '2026-10-02'], growth: ['2026-10-01', '2026-10-02'] },
    } } } },
  })
  const rows = workbookRows(xml, '酷云数据')
  assert.equal(rows.filter((row) => typeof row[1] === 'number').length, 0)
  assert.ok(rows.some((row) => row.includes('暂无数据')))
})

test('有效播放全网与分平台分别裁掉前后无数据，收视率不生成无频道的占位日期', () => {
  const xml = buildRawDataWorkbook({
    projects: [{ id: 'p', title: '三体', platforms: [{ name: '腾讯视频', dimension: 'web' }] }], selectedId: 'p',
    liveHeat: { p: [
      { date: '2023-01-15', values: { '腾讯视频有效播放': 10, '腾讯视频累计有效播放': 100 } },
      { date: '2023-10-01', values: { '有效播放量': 1000, '腾讯视频有效播放': 20, '腾讯视频累计有效播放': 200 } },
      { date: '2023-10-02', values: {} },
      { date: '2023-10-03', values: { '有效播放量': 2000, '腾讯视频有效播放': 30, '腾讯视频累计有效播放': 300 } },
    ] },
    tvRatings: { p: [
      { date: '2023-01-15', channel: 'CCTV-8', slot: 'golden', csmCityRating: 0.5, csmCityShare: 1 },
      { date: '2023-10-03', channel: 'CCTV-8', slot: 'regular', csmCityRating: 0.6, csmCityShare: 2 },
    ] },
    sourceSync: { p: {
      maoyan: { metricVerification: { effective: { verified: true,
        checkedDates: ['2023-01-15', '2023-10-01', '2023-10-02', '2023-10-03'],
        noDataByMetric: { effective: ['2023-01-15'], 'effective:腾讯视频': ['2023-10-02'] },
      } } },
      tvRatings: { verification: { verified: true, checkedDates: ['2023-01-15', '2023-01-16', '2023-10-03'], noDataDates: ['2023-01-16'] } },
    } },
  })
  const effective = workbookRows(xml, '猫眼-有效播放')
  assert.equal(effective.some((row) => row[2] === 1 && row[4] === '全网'), false)
  assert.equal(effective.some((row) => row[2] === 1 && row[4] === '腾讯视频' && row[5] === 100), true)
  assert.equal(effective.some((row) => row[3] === 2 && row[4] === '全网' && row[5] === '无数据'), true)
  const tv = workbookRows(xml, '猫眼-收视率')
  assert.equal(tv.length, 2)
  assert.equal(tv[0][5], '')
  assert.equal(tv[1][6], '')
})

test('骨朵已完成双轮核验的热度日缺排名时显示无数据，失败日期保持未核实', () => {
  const state = {
    projects: [{ id: 'p', title: '三体' }], selectedId: 'p',
    liveHeat: { p: [{ date: '2023-03-06', values: { '骨朵热度': 55.23 } }] },
    sourceSync: { p: { guduo: { verification: { verified: true, checkedDates: ['2023-03-06'] } } } },
  }
  assert.equal(workbookRows(buildRawDataWorkbook(state), '骨朵数据')[0][5], '无数据')
  state.sourceSync.p.guduo.verification = { verified: false, checkedDates: ['2023-03-06'], unresolvedDates: ['2023-03-06'] }
  assert.equal(workbookRows(buildRawDataWorkbook(state), '骨朵数据')[0][5], '')
})

test('骨朵50天未命中停止后，Excel未查日期保持空白且不宣称源端全周期无数据', async () => {
  const state = {
    projects: [{ id: 'p', title: '未收录测试剧' }], selectedId: 'p',
    liveHeat: { p: [{ date: '2023-02-20', values: { 猫眼热度: 7000 } }] },
    sourceSync: { p: { guduo: { state: 'partial', complete: false, truncated: true, verification: {
      version: 1, verified: false, from: '2023-01-01', to: '2023-02-20',
      checkedDates: ['2023-01-01'], noDataDates: ['2023-01-01'], uncheckedDates: ['2023-02-20'],
      termination: { reason: '50-day-unmatched-probe', confirmedBy: 2 },
    } } } },
  }
  const rows = workbookRows(buildRawDataWorkbook(state), '骨朵数据')
  assert.deepEqual(rows, [['未收录测试剧', 2023, 2, 20, '', '']])
  const workbook = XLSX.read(await buildRawDataXlsx(state), { type: 'array' })
  const exported = XLSX.utils.sheet_to_json(workbook.Sheets['骨朵数据'], { header: 1, defval: '' })
  assert.deepEqual(exported[1], rows[0])
  assert.ok(!JSON.stringify(exported).includes('源端无数据'))
})

test('Rawdata逐日逐口径显示已核验无数据，失败日保持未核实且零值不变', () => {
  const xml = buildRawDataWorkbook({ projects: [{ id: 'p', title: '测试剧' }], selectedId: 'p',
    liveHeat: { p: [{ date: '2026-10-12', values: { 酷云增长指数: 0 } }, { date: '2026-10-13', values: {} }] },
    sourceSync: { p: { ky: { verification: { noDataByMetric: { 酷云全端热度: ['2026-10-12'] }, failedDates: ['2026-10-13'], noDataDates: [] } } } },
  })
  const sheet = xml.match(/<Worksheet ss:Name="酷云数据">([\s\S]*?)<\/Worksheet>/)[1]
  assert.match(sheet, /<Data ss:Type="String">暂无数据<\/Data>[\s\S]*?<Data ss:Type="Number">0<\/Data>/)
  assert.equal([...sheet.matchAll(/>暂无数据</g)].length, 1)
});

test('Rawdata 表头以当前工作簿为准，数据来源表使用人工核对入口', () => {
  const xml = buildRawDataWorkbook({
    projects: [{ id: 'lanxiang', title: '兰香如故', maoyanSeriesId: 1500399 }],
    selectedId: 'lanxiang',
    liveHeat: {
      lanxiang: [{ date: '2026-09-27', values: { '骨朵热度': 76.68, '酷云全端热度': 16663 } }],
    },
    sourceSync: { lanxiang: { guduo: { sourceUrl: 'https://d2.guduomedia.com/m/v3/billboard/list?category=1' } } },
  })
  const sheet = (name) => xml.match(new RegExp(`<Worksheet ss:Name="${name}">([\\s\\S]*?)<\\/Worksheet>`))?.[1]
  const sourceSheet = sheet('数据来源')
  const effectiveSheet = sheet('猫眼-有效播放')
  const headers = (content) => [...content.match(/<Row>([\s\S]*?)<\/Row>/)[1].matchAll(/<Data ss:Type="String">([\s\S]*?)<\/Data>/g)].map((match) => match[1])

  assert.deepEqual(headers(sourceSheet), ['数据源平台', '剧集名称', '链接'])
  assert.deepEqual(headers(sheet('猫眼热度')), ['剧集名称', '年份', '月份', '日期', '当日热度值', '全网曝光', '全网转评赞', '全网发布', '全网弹幕'])
  assert.deepEqual(headers(effectiveSheet), ['剧集名称', '年份', '月份', '日期', '播出平台', '累计有效播放', '当日有效播放'])
  assert.deepEqual(headers(sheet('猫眼-平台表现')), ['剧集名称', '年份', '月份', '日期', '播出平台', '热度值', '平台播放量'])
  assert.deepEqual(headers(sheet('猫眼-收视率')), ['剧集名称', '年份', '月份', '日期', '播出频道', '收视率', '黄金时段收视率', '市占率', '播出时段', '集数', '收视口径'])
  assert.deepEqual(headers(sheet('骨朵数据')), ['剧集名称', '年份', '月份', '日期', '全网热度（电视剧/网络剧分类，全平台）', '排名（全部剧集，全平台）'])
  assert.deepEqual(headers(sheet('酷云数据')), ['剧集名称', '年份', '月份', '日期', '全端热度', '增长指数'])

  assert.match(sourceSheet, /https:\/\/piaofang\.maoyan\.com\/i\/tv-datainfo\/1500399\/maoyan\?barTheme=424242/)
  assert.match(sourceSheet, /https:\/\/d2\.guduomedia\.com\//)
  assert.match(sourceSheet, /https:\/\/www\.ky\.live\/pc\.html/)
  assert.doesNotMatch(sourceSheet, /d2\.guduomedia\.com\/m\/v3\/billboard/)

  assert.doesNotMatch(effectiveSheet, /核验状态|待复核|已核验|未完成核验|源端确认无数据/)
})

test('骨朵XLSX表头区分剧分类热度、全剧排名及全部综艺，混合竞品保持6列与原值', async () => {
  const drama = { id: 'd', title: '剧样本', contentType: 'drama' }
  const variety = { id: 'v', title: '综样本', contentType: 'variety' }
  for (const [main, competitors, heatHeader, rankHeader] of [
    [drama, [], '全网热度（电视剧/网络剧分类，全平台）', '排名（全部剧集，全平台）'],
    [variety, [], '全网热度（全部综艺，全平台）', '排名（全部综艺，全平台）'],
    [drama, [variety], '全网热度（剧：电视剧/网络剧分类；综：全部综艺；全平台）', '排名（剧：全部剧集；综：全部综艺；全平台）'],
  ]) {
    const state = { projects: [main], selectedId: main.id, competitors: { [main.id]: competitors }, liveHeat: {
      d: [{ date: '2026-10-22', values: { 骨朵热度: 73.21, 骨朵热度排名: 3 } }],
      v: [{ date: '2026-10-22', values: { 骨朵热度: 0, 骨朵热度排名: 1 } }],
    } }
    const workbook = XLSX.read(await buildRawDataXlsx(state), { type: 'array' })
    assert.deepEqual(workbook.SheetNames, ['数据来源', '猫眼热度', '猫眼-有效播放', '猫眼-平台表现', '猫眼-收视率', '骨朵数据', '酷云数据', '艺恩数据'])
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['骨朵数据'], { header: 1 })
    assert.deepEqual(rows[0], [competitors.length ? '剧综名称' : main.contentType === 'variety' ? '综艺名称' : '剧集名称', '年份', '月份', '日期', heatHeader, rankHeader])
    assert.equal(rows.length, 2 + competitors.length)
    for (const row of rows.slice(1)) {
      assert.equal(row.length, 6)
      assert.deepEqual(row.slice(4), row[0] === drama.title ? [73.21, 3] : [0, 1])
    }
  }
})

test('Rawdata 下载产物是现代 XLSX 压缩工作簿并保留现有 sheet 与值', async () => {
  const XLSX = await import('xlsx')
  const bytes = await buildRawDataXlsx({
    projects: [{ id: 'p', title: '三体' }], selectedId: 'p',
    liveHeat: { p: [{ date: '2026-10-14', values: { '猫眼热度': 7200, '猫眼全网曝光': 123456 } }] },
    tvRatings: { p: [{ date: '2026-10-14', channel: 'CCTV-8', slot: 'golden', csmCityRating: 0.6, csmCityShare: 1.2 }] },
  })
  const signature = new Uint8Array(bytes)
  assert.equal(signature[0], 0x50)
  assert.equal(signature[1], 0x4b)
  const workbook = XLSX.read(signature, { type: 'array' })
  assert.deepEqual(workbook.SheetNames, ['数据来源', '猫眼热度', '猫眼-有效播放', '猫眼-平台表现', '猫眼-收视率', '骨朵数据', '酷云数据', '艺恩数据'])
  const heatRows = XLSX.utils.sheet_to_json(workbook.Sheets['猫眼热度'], { header: 1 })
  assert.deepEqual(heatRows[0], ['剧集名称', '年份', '月份', '日期', '当日热度值', '全网曝光', '全网转评赞', '全网发布', '全网弹幕'])
  assert.equal(heatRows[1][0], '三体')
  assert.equal(heatRows[1][4], 7200)
  assert.equal(heatRows[1][5], 123456)

  const styledWorkbook = XLSX.read(signature, { type: 'array', cellStyles: true })
  const tvSheet = styledWorkbook.Sheets['猫眼-收视率']
  for (const name of workbook.SheetNames) {
    const fill = styledWorkbook.Sheets[name].A1.s.fgColor
    assert.equal(fill.theme, 3)
    assert.equal(fill.tint, -0.5)
  }
  assert.ok(tvSheet['!cols'][6].wpx >= 100, '黄金时段收视率列应留出完整表头宽度')
  assert.ok(styledWorkbook.Sheets['骨朵数据']['!cols'][4].wpx >= 180, '较长的骨朵指标表头应完整显示')
  const styleXml = await zipTextEntry(signature, 'xl/styles.xml')
  const tvSheetXml = await zipTextEntry(signature, 'xl/worksheets/sheet5.xml')
  assert.match(styleXml, /horizontal="center" vertical="center"/)
  assert.match(styleXml, /wrapText="1"/)
  assert.match(styleXml, /fgColor theme="3" tint="-0.5"/)
  const themeXml = await zipTextEntry(signature, 'xl/theme/theme1.xml')
  assert.match(themeXml, /<a:dk2>\s*<a:srgbClr val="1F497D"\/>\s*<\/a:dk2>/)
  assert.match(tvSheetXml, /<c r="F1"[^>]*s="2"/)
  assert.match(tvSheetXml, /<c r="F2"[^>]*s="1"/)
})

test('平台表现导出将芒果平台播放量与其他平台热度分列', () => {
  const xml = buildRawDataWorkbook({
    projects: [{ id: 'mango-only', title: '韶华若锦' }],
    selectedId: 'mango-only',
    liveHeat: {
      'mango-only': [{
        date: '2025-05-19',
        values: {
          '芒果TV平台表现': 115000,
          '爱奇艺平台表现': 6400,
        },
      }],
    },
  })
  const platformSheet = xml.match(/<Worksheet ss:Name="猫眼-平台表现">([\s\S]*?)<\/Worksheet>/)?.[1]

  assert.ok(platformSheet, '应包含平台表现工作表')
  assert.match(platformSheet, /<Data ss:Type="String">热度值<\/Data>/)
  assert.match(platformSheet, /<Data ss:Type="String">平台播放量<\/Data>/)
  assert.match(platformSheet, /<Data ss:Type="String">芒果TV<\/Data>[\s\S]*?<Data ss:Type="String"><\/Data><\/Cell><Cell ss:StyleID="Center"><Data ss:Type="Number">115000<\/Data>/)
  assert.match(platformSheet, /<Data ss:Type="String">爱奇艺<\/Data>[\s\S]*?<Data ss:Type="Number">6400<\/Data><\/Cell><Cell ss:StyleID="Center"><Data ss:Type="String"><\/Data>/)
})

test('猫眼汇总指标显示未提供时，导出仍保留已有逐日值且不把缺失日期判为源未提供', () => {
  const xml = buildRawDataWorkbook({
    projects: [{ id: 'target', title: '这都不是事儿' }],
    selectedId: 'target',
    sourceSync: {
      target: {
        maoyan: {
          summary: {
            subItems: [
              { mainTitle: '全网转评赞', mainData: '--' },
              { mainTitle: '全网发布', mainData: '--' },
            ],
          },
        },
      },
    },
    liveHeat: {
      target: [
        { date: '2026-09-23', values: { '猫眼全网转评赞': 128.5, '猫眼全网发布': 36 } },
        { date: '2026-09-24', values: { '猫眼热度': 6000 } },
      ],
    },
  })
  const maoyanSheet = xml.match(/<Worksheet ss:Name="猫眼热度">([\s\S]*?)<\/Worksheet>/)?.[1]

  assert.ok(maoyanSheet, '应包含猫眼热度工作表')
  assert.match(maoyanSheet, /<Data ss:Type="Number">128\.5<\/Data><\/Cell><Cell ss:StyleID="Center"><Data ss:Type="Number">36<\/Data>/)
  assert.doesNotMatch(maoyanSheet, /源未提供/)
})

test('猫眼某指标全周期均无逐日值且汇总页明确无数据时才标记源未提供', () => {
  const xml = buildRawDataWorkbook({
    projects: [{ id: 'target', title: '这都不是事儿' }],
    selectedId: 'target',
    sourceSync: {
      target: {
        maoyan: {
          summary: {
            subItems: [
              { mainTitle: '全网转评赞', mainData: '--' },
              { mainTitle: '全网发布', mainData: '--' },
            ],
          },
        },
      },
    },
    liveHeat: {
      target: [{ date: '2026-09-24', values: { '猫眼热度': 6000 } }],
    },
  })
  const maoyanSheet = xml.match(/<Worksheet ss:Name="猫眼热度">([\s\S]*?)<\/Worksheet>/)?.[1]

  assert.ok(maoyanSheet, '应包含猫眼热度工作表')
  assert.match(maoyanSheet, /<Data ss:Type="Number">6000<\/Data>[\s\S]*?<Data ss:Type="String">源未提供<\/Data><\/Cell><Cell ss:StyleID="Center"><Data ss:Type="String">源未提供<\/Data>/)
})

test('Rawdata 保留对应来源请求失败日期的空行，避免将失败当成无数据删除', () => {
  const xml = buildRawDataWorkbook({
    projects: [{ id: 'target', title: '逐日测试剧', platforms: [{ name: '爱奇艺', dimension: 'web' }] }],
    selectedId: 'target',
    sourceSync: { target: {
      maoyan: { historyVerification: { failedDates: ['2026-09-02'] }, metricVerification: {
        effective: { failedDates: ['2026-09-02'] }, platform: { failedDates: ['2026-09-02'] },
      } },
      guduo: { verification: { failedDates: ['2026-09-02'] } },
      ky: { verification: { failedDates: ['2026-09-02'] } },
    } },
    liveHeat: {
      target: [
        { date: '2026-09-01', values: { '猫眼热度': 7000, '有效播放量': 100000, '爱奇艺有效播放': 100000, '爱奇艺累计有效播放': 100000, '爱奇艺平台表现': 6100, '骨朵热度': 70, '酷云全端热度': 5000 } },
        { date: '2026-09-02', values: {} },
      ],
    },
  })
  const sheet = (name) => xml.match(new RegExp(`<Worksheet ss:Name="${name}">([\\s\\S]*?)<\\/Worksheet>`))?.[1]
  const maoyanSheet = sheet('猫眼热度')
  const effectiveSheet = sheet('猫眼-有效播放')
  const platformSheet = sheet('猫眼-平台表现')
  const guduoSheet = sheet('骨朵数据')
  const kySheet = sheet('酷云数据')

  for (const content of [maoyanSheet, effectiveSheet, platformSheet, guduoSheet, kySheet]) {
    assert.ok(content, '应保留对应工作表')
    assert.match(content, /<Data ss:Type="Number">2026<\/Data><\/Cell><Cell ss:StyleID="Center"><Data ss:Type="Number">9<\/Data><\/Cell><Cell ss:StyleID="Center"><Data ss:Type="Number">2<\/Data>/)
  }
  assert.match(maoyanSheet, /<Data ss:Type="String"><\/Data><\/Cell><Cell ss:StyleID="Center"><Data ss:Type="String"><\/Data>/)
})

test('Rawdata按各来源单独裁掉连续的已核实无数据尾段，保留中间无数据和其他维度状态', () => {
  const xml = buildRawDataWorkbook({
    projects: [{ id: 'three-body', title: '三体', platforms: [{ name: '爱奇艺', dimension: 'web' }] }],
    selectedId: 'three-body',
    liveHeat: {
      'three-body': [
        { date: '2026-04-24', values: { '猫眼热度': 7200, '猫眼全网曝光': 500, '有效播放量': 1000, '爱奇艺有效播放': 10, '爱奇艺累计有效播放': 1000, '爱奇艺平台表现': 6000, '酷云全端热度': 1000, '酷云增长指数': 5, '骨朵热度': 70 } },
        { date: '2026-04-25', values: { '猫眼热度': 7100, '酷云全端热度': 990, '酷云增长指数': 4, '骨朵热度': 69 } },
        { date: '2026-04-26', values: {} },
        { date: '2026-04-27', values: {} },
      ],
    },
    tvRatings: {
      'three-body': [{ date: '2026-04-24', platform: 'CCTV-8', slot: 'golden', csmCityRating: 0.7, csmCityShare: 2.1 }],
    },
    sourceSync: {
      'three-body': {
        maoyan: {
          historyVerification: { noDataDates: ['2026-04-26', '2026-04-27'], noDataByMetric: { '猫眼全网曝光': ['2026-04-25'] } },
          metricVerification: {
            effective: { noDataDates: ['2026-04-26', '2026-04-27'] },
            platform: { noDataDates: ['2026-04-26', '2026-04-27'] },
          },
        },
        guduo: { verification: { noDataDates: ['2026-04-26', '2026-04-27'] } },
        ky: { verification: { noDataDates: ['2026-04-26', '2026-04-27'] } },
        tvRatings: { verification: { noDataDates: ['2026-04-26', '2026-04-27'] } },
      },
    },
  })
  const sheet = (name) => xml.match(new RegExp(`<Worksheet ss:Name="${name}">([\\s\\S]*?)<\\/Worksheet>`))?.[1]
  const dateRow = (content, day) => content.includes(`<Data ss:Type="Number">${day}</Data></Cell>`)

  for (const name of ['猫眼热度', '骨朵数据', '酷云数据']) {
    const content = sheet(name)
    assert.ok(content)
    assert.equal(dateRow(content, '24'), true, `${name}保留有效数据日期`)
    assert.equal(dateRow(content, '25'), true, `${name}保留空值尾段前的日期`)
    assert.equal(dateRow(content, '26'), false, `${name}裁掉连续无数据尾段`)
    assert.equal(dateRow(content, '27'), false, `${name}裁掉连续无数据尾段`)
  }
  for (const name of ['猫眼-有效播放', '猫眼-平台表现', '猫眼-收视率']) {
    const content = sheet(name)
    assert.equal(dateRow(content, '24'), true, `${name}保留有效数据日期`)
    assert.equal(dateRow(content, '26'), false, `${name}裁掉该来源连续无数据尾段`)
    assert.equal(dateRow(content, '27'), false, `${name}裁掉该来源连续无数据尾段`)
  }
  const maoyanSheet = sheet('猫眼热度')
  assert.match(maoyanSheet, /<Data ss:Type="Number">25<\/Data>[\s\S]*?<Data ss:Type="String">无数据<\/Data>/)
  const tvSheet = sheet('猫眼-收视率')
  assert.match(tvSheet, /<Data ss:Type="String">黄金时段收视率<\/Data>/)
  assert.match(tvSheet, /<Data ss:Type="String">市占率<\/Data>/)
})


test('剧集与综艺的全空来源每部只保留一行，来源页不列艺恩，开发中不铺日期', async () => {
  for (const contentType of ['drama', 'variety']) {
    const projects = [{ id: 'a', title: '主作品', contentType }, { id: 'b', title: '对比作品', contentType }]
    const check = { verified: true, from: '2026-10-01', to: '2026-10-03', checkedDates: ['2026-10-01', '2026-10-02', '2026-10-03'] }
    const state = { projects: [projects[0]], selectedId: 'a', competitors: { a: [projects[1]] },
      liveHeat: Object.fromEntries(projects.map(p => [p.id, check.checkedDates.map(date => ({ date, values: { 猫眼热度: 7000 } }))])),
      sourceSync: Object.fromEntries(projects.map(p => [p.id, {
        maoyan: { metricVerification: { effective: check, platform: check } },
        tvRatings: { verification: check }, ky: { verification: check },
      }])),
    }
    const book = XLSX.read(await buildRawDataXlsx(state), { type: 'array' })
    const rows = name => XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: '' })
    for (const name of ['猫眼-有效播放', '猫眼-平台表现', '猫眼-收视率', '酷云数据', '艺恩数据']) {
      const data = rows(name)
      assert.equal(data[0][0], contentType === 'variety' ? '综艺名称' : '剧集名称')
      assert.equal(data.length, 3, name)
      assert.deepEqual(data.slice(1).map(row => row[0]), projects.map(p => p.title))
      for (const row of data.slice(1)) assert.deepEqual(row.slice(1, 4), ['', '', ''])
      const start = ['酷云数据', '艺恩数据'].includes(name) ? 4 : 5
      const status = name === '酷云数据' ? '暂无数据' : name === '艺恩数据' ? '开发中' : '源为空'
      assert.equal(data[1][start], status)
    }
    assert.ok(rows('数据来源').slice(1).every(row => row[0] !== '艺恩'))
  }
})

test('全空但读取失败或覆盖未完成只做一行提示，不宣称源为空；数值零保持逐日数据', () => {
  const base = { projects: [{ id: 'p', title: '测试剧' }], selectedId: 'p', liveHeat: { p: [
    { date: '2026-10-01', values: {} }, { date: '2026-10-02', values: {} },
  ] }, sourceSync: { p: {
    maoyan: { metricVerification: { effective: { verified: true, from: '2026-10-01', to: '2026-10-02', failedDates: ['2026-10-02'] } } },
    ky: { verification: { verified: false, from: '2026-10-01', to: '2026-10-02', uncheckedDates: ['2026-10-02'] } },
  } } }
  for (const name of ['猫眼-有效播放', '猫眼-收视率', '酷云数据']) {
    const rows = workbookRows(buildRawDataWorkbook(base), name)
    assert.equal(rows.length, 1)
    assert.ok(rows[0].includes('暂未获取数据'))
    assert.ok(!rows[0].includes('暂无数据') && !rows[0].includes('源为空'))
  }
  base.liveHeat.p[0].values = { 有效播放量: 0, 酷云全端热度: 0 }
  for (const name of ['猫眼-有效播放', '酷云数据']) {
    const rows = workbookRows(buildRawDataWorkbook(base), name)
    assert.ok(rows.some(row => row[1] === 2026 && row.includes(0)))
  }
})
