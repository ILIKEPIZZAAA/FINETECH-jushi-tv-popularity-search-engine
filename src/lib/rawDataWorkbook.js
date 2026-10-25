import { parseChineseCount, platformDisplayName, isoDatesInRange } from './dramaMonitor.js'
import { endataDimensions, ENDATA_SOURCE_URL, ENDATA_ENABLED } from './endataMetrics.js'

function escapeExcelXml(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function excelCell(value, header = false) {
  const isNumber = typeof value === 'number' && Number.isFinite(value)
  const text = value && typeof value === 'object' ? JSON.stringify(value) : value ?? ''
  const style = header ? ' ss:StyleID="HeaderCenter"' : ' ss:StyleID="Center"'
  return `<Cell${style}><Data ss:Type="${isNumber ? 'Number' : 'String'}">${escapeExcelXml(text)}</Data></Cell>`
}

function excelRow(values, header = false) {
  return `<Row>${values.map((value) => excelCell(value, header)).join('')}</Row>`
}

function excelWorksheet(name, headers, rows) {
  const columns = headers.map((header) => {
    const displayWidth = [...String(header)].reduce((width, character) => width + (/[^\u0000-\u00ff]/.test(character) ? 2 : 1), 0)
    return `<Column ss:Width="${Math.max(12, Math.min(44, displayWidth + 3)) * 7}"/>`
  }).join('')
  return `<Worksheet ss:Name="${escapeExcelXml(name)}"><Table>${columns}${excelRow(headers, true)}${rows.map((values) => excelRow(values)).join('')}</Table></Worksheet>`
}

function tvPeriodLabel(value) {
  const text = String(value ?? '').trim()
  if (/非黄金|non[-\s]?golden|regular|普通/i.test(text)) return '非黄金时段'
  if (/黄金|prime|golden/i.test(text)) return '黄金时段'
  return '未标明'
}

export function buildRawDataWorkbook(state) {
  const mainProjects = Array.isArray(state.projects) ? state.projects : []
  const selectedProject = mainProjects.find((project) => project.id === state.selectedId) || null
  const selectedCompetitors = selectedProject ? (state.competitors?.[selectedProject.id] || []) : []
  const exportProjectIds = new Set([selectedProject?.id, ...selectedCompetitors.map((project) => project.id)].filter(Boolean))
  const allProjects = [...new Map([
    ...(selectedProject ? [[selectedProject.id, selectedProject]] : []),
    ...selectedCompetitors.map((project) => [project.id, project]),
  ]).values()]
  const titleById = new Map(allProjects.map((project) => [project.id, project.title]))
  const projectById = new Map(allProjects.map((project) => [project.id, project]))
  const readValue = (values, names) => {
    for (const name of names) {
      const parsed = parseChineseCount(values?.[name])
      if (parsed !== null) return parsed
    }
    return ''
  }
  const sourceUnavailable = (projectId, name) => {
    const summaryItems = state.sourceSync?.[projectId]?.maoyan?.summary?.subItems
    if (!Array.isArray(summaryItems)) return false
    const aliases = {
      '猫眼全网曝光': ['全网曝光', '全网总曝光'],
      '猫眼全网转评赞': ['全网转评赞', '全网总转评赞'],
      '猫眼全网发布': ['全网发布', '全网总发布'],
      '猫眼全网弹幕': ['全网弹幕', '全网总弹幕'],
    }
    const item = summaryItems.find((entry) => (aliases[name] || [name]).includes(entry?.mainTitle))
    return item ? ['--', '-', '暂无', '无'].includes(String(item.mainData).trim()) : false
  }
  const sourceMetricUnavailable = (projectId, name) => sourceUnavailable(projectId, name)
    && !allLiveRows.some(({ projectId: rowProjectId, record }) => rowProjectId === projectId && readValue(record.values, [name]) !== '')
  const dateParts = (date) => {
    const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : ['', '', '']
  }
  const tagProjectRow = (projectId, values) => Object.defineProperty(values, 'projectId', { value: projectId })
  const normalizeExportPlatform = (value) => /平台(?:播放)?量/.test(String(value || '')) ? '芒果TV' : platformDisplayName(value)
  const configuredWebPlatforms = (projectId) => new Set((projectById.get(projectId)?.platforms || [])
    .filter((platform) => !platform?.dimension || platform.dimension === 'web')
    .map((platform) => normalizeExportPlatform(platform?.name || platform))
    .filter((name) => ['优酷', '爱奇艺', '腾讯视频', '芒果TV'].includes(name)))
  const allLiveRows = Object.entries(state.liveHeat || {})
    .filter(([projectId]) => exportProjectIds.has(projectId))
    .flatMap(([projectId, records]) => (Array.isArray(records) ? records : []).map((record) => ({ projectId, record })))
  const verifications = (projectId, source, kind) => {
    const sync = state.sourceSync?.[projectId]?.[source]
    return [kind ? sync?.metricVerification?.[kind] : source === 'maoyan' ? sync?.historyVerification : sync?.verification].filter(Boolean)
  }
  const includesDate = (items, date) => (items || []).some((item) => (typeof item === 'string' ? item : item?.date) === date)
  const blockedDate = (projectId, source, verification, date) => [
    verification.failedDates, verification.unresolvedDates, verification.gapDates,
    state.sourceSync?.[projectId]?.[source]?.failedDates,
  ].some((items) => includesDate(items, date))
  const emptyCell = (projectId, date, source, metric, { kind, field, platform = '' } = {}) => {
    const verifiedEmpty = verifications(projectId, source, kind).some((verification) => {
      if (blockedDate(projectId, source, verification, date)) return false
      return (verification.noDataDates || []).includes(date)
        || (verification.noDataByMetric?.[metric] || []).includes(date)
        || (field && (verification.noDataByMetric?.[field] || []).includes(date))
        || Object.entries(verification.noDataByMetric || {}).some(([key, dates]) => dates.includes(date)
          && kind && key.split(':')[0] === kind && normalizeExportPlatform(key.split(':')[1] || '') === platform)
        || (verification.noDataFields || []).some((item) => item.date === date && item.field === field
          && normalizeExportPlatform(item.platform || '') === platform)
        || (verification.verified === true && (verification.checkedDates || []).includes(date))
    })
    return verifiedEmpty ? '无数据' : ''
  }
  const observedValue = (projectId, record, names, source, options = {}) => {
    const value = readValue(record.values, names)
    return value !== '' ? value : emptyCell(projectId, record.date, source, names[0], options)
  }
  // Keep explicitly verified empty dates in the workbook even when no source
  // has produced a numeric chart row on that date.
  for (const project of allProjects) {
    const sync = state.sourceSync?.[project.id] || {}
    const checks = [sync.maoyan?.historyVerification, ...Object.values(sync.maoyan?.metricVerification || {}), sync.guduo?.verification, sync.ky?.verification, sync.endata?.verification].filter(Boolean)
    const dates = new Set(checks.flatMap((check) => [...(check.noDataDates || []), ...Object.values(check.noDataByMetric || {}).flat(), ...(check.noDataFields || []).map((item) => item.date)]))
    for (const date of dates) if (!allLiveRows.some((item) => item.projectId === project.id && item.record.date === date)) allLiveRows.push({ projectId: project.id, record: { date, values: {} } })
  }
  allLiveRows.sort((a, b) => a.record.date.localeCompare(b.record.date))

  const sourceRows = allProjects.flatMap((project) => {
    const seriesId = Number(project.maoyanSeriesId)
    const maoyanBase = Number.isInteger(seriesId) && seriesId > 0 ? `https://piaofang.maoyan.com/i/tv-datainfo/${seriesId}` : ''
    const firstSourceUrl = project.sourceUrl || project.primaryIdentitySource?.url || ''
    return [
      ['猫眼', project.title, maoyanBase ? `${maoyanBase}/maoyan?barTheme=424242` : firstSourceUrl],
      ['猫眼', project.title, maoyanBase ? `${maoyanBase}/effective?barTheme=424242` : ''],
      ['猫眼', project.title, maoyanBase ? `${maoyanBase}/platform?barTheme=424242` : ''],
      ['猫眼', project.title, maoyanBase ? `${maoyanBase}/tvinfo?barTheme=424242` : ''],
      ['骨朵', project.title, 'https://d2.guduomedia.com/'],
      ['酷云', project.title, 'https://www.ky.live/pc.html'],
    ]
  })
  const maoyanRows = allLiveRows.map(({ projectId, record }) => {
    const [year, month, day] = dateParts(record.date)
    const interaction = observedValue(projectId, record, ['猫眼全网转评赞'], 'maoyan', { field: 'interaction' })
    const publish = observedValue(projectId, record, ['猫眼全网发布'], 'maoyan', { field: 'publish' })
    const danmaku = observedValue(projectId, record, ['猫眼全网弹幕'], 'maoyan', { field: 'bulletScreen' })
    return tagProjectRow(projectId, [titleById.get(projectId) || projectId, year, month, day,
      observedValue(projectId, record, ['猫眼热度', '猫眼实时热度'], 'maoyan', { field: 'heat' }),
      observedValue(projectId, record, ['猫眼全网曝光'], 'maoyan', { field: 'exposure' }),
      interaction !== '' ? interaction : (sourceMetricUnavailable(projectId, '猫眼全网转评赞') ? '源未提供' : ''),
      publish !== '' ? publish : (sourceMetricUnavailable(projectId, '猫眼全网发布') ? '源未提供' : ''),
      danmaku !== '' ? danmaku : (sourceMetricUnavailable(projectId, '猫眼全网弹幕') ? '源未提供' : '')])
  })
  const effectiveRows = allLiveRows.flatMap(({ projectId, record }) => {
    const [year, month, day] = dateParts(record.date)
    const values = record.values || {}
    const platforms = new Set([
      ...configuredWebPlatforms(projectId),
      ...Object.keys(values).filter((name) => /有效播放$/.test(name) && !/有效播放量$/.test(name) && !/累计有效播放$/.test(name))
        .map((name) => normalizeExportPlatform(name.replace(/有效播放$/, ''))),
    ])
    const platformEffectiveRows = [...platforms].map((platform) => tagProjectRow(projectId, [
        titleById.get(projectId) || projectId,
        year,
        month,
        day,
        platform,
        observedValue(projectId, record, [`${platform}累计有效播放`], 'maoyan', { kind: 'effective', field: 'cumulativeEffectivePlay', platform }),
        observedValue(projectId, record, [`${platform}有效播放`], 'maoyan', { kind: 'effective', field: 'effectivePlay', platform }),
      ]))
    const aggregateRow = tagProjectRow(projectId, [titleById.get(projectId) || projectId, year, month, day, '全网',
      observedValue(projectId, record, ['有效播放量', '累计有效播放'], 'maoyan', { kind: 'effective', field: 'cumulativeEffectivePlay' }),
      ''])
    return [aggregateRow, ...platformEffectiveRows]
  })
  const platformRows = allLiveRows.flatMap(({ projectId, record }) => {
    const [year, month, day] = dateParts(record.date)
    const values = record.values || {}
    const platforms = new Set([
      ...configuredWebPlatforms(projectId),
      ...Object.keys(values).filter((name) => /平台表现$/.test(name)).map((name) => normalizeExportPlatform(name.replace(/平台表现$/, ''))),
    ])
    return [...platforms].map((platform) => {
      const amount = parseChineseCount(values[`${platform}平台表现`])
      return tagProjectRow(projectId, [
        titleById.get(projectId) || projectId,
        year,
        month,
        day,
        platform,
        platform === '芒果TV' ? '' : (amount ?? emptyCell(projectId, record.date, 'maoyan', `${platform}平台表现`, { kind: 'platform', field: 'value', platform })),
        platform === '芒果TV' ? (amount ?? emptyCell(projectId, record.date, 'maoyan', `${platform}平台表现`, { kind: 'platform', field: 'value', platform })) : '',
      ])
    })
  })
  // Keep each source date/channel/slot/episode observation independent. The
  // single share column belongs to this row, never to a different time slot.
  const tvRows = []
  const tvNumber = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : null
  for (const [projectId, records] of Object.entries(state.tvRatings || {}).filter(([projectId]) => exportProjectIds.has(projectId))) {
    for (const record of Array.isArray(records) ? records : []) {
      const platform = record.channel || record.platform || ''
      const period = tvPeriodLabel(record.slot ?? record.period ?? '')
      const rawPeriod = String(record.slot ?? record.period ?? '').trim()
      const periodDisplay = !rawPeriod ? '未标明' : /^(regular|golden|non[-\s]?golden|prime)$/i.test(rawPeriod) ? period : rawPeriod
      // National values have a separate source scope. They must not fill absent
      // city/source fields, because the dashboard uses csmCityRating/Share.
      const scopes = [
        { label: '源站收视率', rating: tvNumber(record.csmCityRating ?? record.rating), share: tvNumber(record.csmCityShare ?? record.share), ratingField: 'csmCityRating', shareField: 'csmCityShare' },
        { label: '全国收视率', rating: tvNumber(record.nationalRating), share: tvNumber(record.nationalShare), ratingField: 'nationalRating', shareField: 'nationalShare' },
      ]
      for (const scope of scopes) {
        if (scope.label === '全国收视率' && scope.rating === null && scope.share === null) continue
        const rating = scope.rating ?? emptyCell(projectId, record.date, 'tvRatings', scope.ratingField, { field: scope.ratingField, platform })
        const share = scope.share ?? emptyCell(projectId, record.date, 'tvRatings', scope.shareField, { field: scope.shareField, platform })
        tvRows.push(tagProjectRow(projectId, [
          titleById.get(projectId) || projectId, ...dateParts(record.date), platform,
          period === '黄金时段' ? '' : rating,
          period === '黄金时段' ? rating : '',
          share, periodDisplay, record.episodes ?? '', scope.label,
        ]))
      }
    }
  }
  const guduoRows = allLiveRows.map(({ projectId, record }) => {
    const [year, month, day] = dateParts(record.date)
    return tagProjectRow(projectId, [titleById.get(projectId) || projectId, year, month, day, observedValue(projectId, record, ['骨朵热度'], 'guduo', { field: 'heat' }), observedValue(projectId, record, ['骨朵热度排名', '骨朵排名', '骨朵榜内排名'], 'guduo', { field: 'rank' })])
  })
  const kuYunRows = allLiveRows.map(({ projectId, record }) => {
    const [year, month, day] = dateParts(record.date)
    return tagProjectRow(projectId, [titleById.get(projectId) || projectId, year, month, day, observedValue(projectId, record, ['酷云全端热度'], 'ky', { field: 'heat' }), observedValue(projectId, record, ['酷云增长指数'], 'ky', { field: 'growth' })])
  })

  // Bound each source/platform/channel independently by its actual observations.
  // Keep interior gaps and relevant failed/unverified reads; unrelated sources'
  // dates must not create blank rows in this sheet.
  const prepareSourceRows = (rows, metricIndexesForRow, source, kind, byPlatform = false) => {
    const groups = new Map()
    const rowDate = (row) => `${String(row[1]).padStart(4, '0')}-${String(row[2]).padStart(2, '0')}-${String(row[3]).padStart(2, '0')}`
    const hasNumber = (row) => metricIndexesForRow(row).some((index) => typeof row[index] === 'number' && Number.isFinite(row[index]))
    const allEmpty = (row) => metricIndexesForRow(row).every((index) => ['无数据', '源未提供'].includes(row[index]))
    const inScope = (row) => verifications(row.projectId, source, kind).some((check) => {
      const date = rowDate(row)
      return (check.from && check.to && date >= check.from && date <= check.to)
        || [check.checkedDates, check.noDataDates, check.failedDates, check.unresolvedDates, check.gapDates,
          ...Object.values(check.noDataByMetric || {}), check.noDataFields,
        ].some((items) => includesDate(items, date))
    })
    for (const row of rows) {
      const key = JSON.stringify([row.projectId, byPlatform ? row[4] : ''])
      const group = groups.get(key) || []
      group.push(row)
      groups.set(key, group)
    }
    const retained = new Set()
    for (const group of groups.values()) {
      const dates = group.filter(hasNumber).map(rowDate).sort()
      for (const row of group) {
        const date = rowDate(row)
        if (hasNumber(row)
          || (dates.length && date >= dates[0] && date <= dates.at(-1))
          || (!allEmpty(row) && inScope(row))) retained.add(row)
      }
    }
    let result = rows.filter((row) => retained.has(row))
    // A source with no numeric observations gets one honest status row per title.
    // Keep dated gaps/failures when numeric observations exist; zero is data.
    const compactEmptySource = source === 'ky' || source === 'tvRatings' || (source === 'maoyan' && kind)
    if (compactEmptySource) {
      for (const project of allProjects) {
        if (rows.some(row => row.projectId === project.id && hasNumber(row))) continue
        const sync = state.sourceSync?.[project.id]?.[source] || {}
        const checks = verifications(project.id, source, kind)
        const hasFailures = [sync.failedDates, ...checks.flatMap(check => [check.failedDates, check.unresolvedDates, check.gapDates, check.uncheckedDates])]
          .some(items => items?.length)
        const hasUnmappedTvValues = source === 'tvRatings' && (state.tvRatings?.[project.id] || []).some(record => [record.csmCityRating, record.nationalRating, record.rating, record.csmCityShare, record.nationalShare, record.share].some(value => typeof value === 'number' && Number.isFinite(value)))
        const confirmedEmpty = !hasUnmappedTvValues && !hasFailures && sync.complete !== false && !['loading', 'failed', 'error', 'partial'].includes(sync.state) && checks.some(check => check.verified === true)
        const status = hasUnmappedTvValues ? '暂无可导出数据' : confirmedEmpty ? (source === 'ky' ? '暂无数据' : '源为空') : sync.state === 'loading' ? '数据更新中' : '暂未获取数据'
        const columnCount = source === 'tvRatings' ? 11 : byPlatform ? 7 : 6
        const row = Array(columnCount).fill('')
        row[0] = project.title
        for (let index = byPlatform ? 5 : 4; index < (source === 'tvRatings' ? 8 : columnCount); index += 1) row[index] = status
        result = result.filter(item => item.projectId !== project.id)
        result.push(tagProjectRow(project.id, row))
      }
    }
    for (const project of allProjects) {
      if (result.some((row) => row.projectId === project.id)) continue
      if (source === 'tvRatings' && state.tvRatings?.[project.id]?.length) continue
      const checks = verifications(project.id, source, kind)
      const confirmedEmpty = checks.some((check) => check.verified === true
        && ![...(check.failedDates || []), ...(check.unresolvedDates || []), ...(check.gapDates || []),
          ...(state.sourceSync?.[project.id]?.[source]?.failedDates || []),
        ].length)
      if (confirmedEmpty) {
        const columnCount = source === 'tvRatings' ? 11 : source === 'maoyan' && !kind ? 9 : byPlatform ? 7 : 6
        const row = Array.from({ length: columnCount }, () => '')
        row[0] = project.title
        row[byPlatform ? 5 : 4] = '源端无数据'
        result.push(tagProjectRow(project.id, row))
      }
    }
    return source === 'ky' ? result.map(row => row.map(value => value === '无数据' ? '暂无数据' : value)) : result
  }

  const endataRows = allProjects.flatMap(project => {
    const sync = state.sourceSync?.[project.id]?.endata || {}, check = sync.verification || {}
    const byDate = new Map(allLiveRows.filter(item => item.projectId === project.id).map(item => [item.record.date, item.record]))
    const requestedDates = isoDatesInRange(check.from || sync.requestedFrom, check.to || sync.requestedTo)
    const dates = new Set([...requestedDates, ...[...byDate.values()].filter(row => endataDimensions.some(item => readValue(row.values, [item.metric]) !== '')).map(row => row.date)])
    if (!ENDATA_ENABLED && ![...byDate.values()].some(row => endataDimensions.some(item => readValue(row.values, [item.metric]) !== ''))) {
      return [[project.title, '', '', '', ...endataDimensions.map(() => '开发中'), '开发中', '', '', '']]
    }
    return [...dates].sort().map(date => {
      const record = byDate.get(date) || { date, values: {} }
      const passed = !blockedDate(project.id, 'endata', check, date) && includesDate(check.checkedDates, date) && (check.passes >= 2 || check.verified === true)
      const status = sync.state === 'loading' ? '采集中（本轮核验未完成）' : passed ? includesDate(check.inferredNoDataDates, date) ? '通过（规则推定，未逐日请求）' : '通过' : '未核实'
      return [project.title, ...dateParts(date), ...endataDimensions.map(item => observedValue(project.id, record, [item.metric], 'endata', { field: item.metric })), status, sync.sourceUrl || ENDATA_SOURCE_URL, check.passes || '', sync.fetchedAt || '']
    })
  })
  const trimmedMaoyanRows = prepareSourceRows(maoyanRows, () => [4, 5, 6, 7, 8], 'maoyan')
  const trimmedEffectiveRows = prepareSourceRows(effectiveRows, (row) => row[4] === '全网' ? [5] : [5, 6], 'maoyan', 'effective', true)
  const trimmedPlatformRows = prepareSourceRows(platformRows, (row) => row[4] === '芒果TV' ? [6] : [5], 'maoyan', 'platform', true)
  const trimmedTvRows = prepareSourceRows(tvRows, () => [5, 6, 7], 'tvRatings', undefined, true)
  const trimmedGuduoRows = prepareSourceRows(guduoRows, () => [4, 5], 'guduo')
  const trimmedKuYunRows = prepareSourceRows(kuYunRows, () => [4, 5], 'ky')
  // Match the provider's categories: drama heat is NETWORK_DRAMA/TV_DRAMA,
  // drama rank is DRAMA; variety heat and rank both use VARIETY (platformId=0).
  const hasVariety = allProjects.some(project => project.contentType === 'variety')
  const hasDrama = allProjects.some(project => project.contentType !== 'variety')
  const guduoHeatHeader = hasVariety && hasDrama
    ? '全网热度（剧：电视剧/网络剧分类；综：全部综艺；全平台）'
    : hasVariety ? '全网热度（全部综艺，全平台）' : '全网热度（电视剧/网络剧分类，全平台）'
  const guduoRankHeader = hasVariety && hasDrama
    ? '排名（剧：全部剧集；综：全部综艺；全平台）'
    : hasVariety ? '排名（全部综艺，全平台）' : '排名（全部剧集，全平台）'

  const titleHeader = hasVariety && hasDrama ? '剧综名称' : hasVariety ? '综艺名称' : '剧集名称'
  const sheets = [
    excelWorksheet('数据来源', ['数据源平台', titleHeader, '链接'], sourceRows),
    excelWorksheet('猫眼热度', [titleHeader, '年份', '月份', '日期', '当日热度值', '全网曝光', '全网转评赞', '全网发布', '全网弹幕'], trimmedMaoyanRows),
    excelWorksheet('猫眼-有效播放', [titleHeader, '年份', '月份', '日期', '播出平台', '累计有效播放', '当日有效播放'], trimmedEffectiveRows),
    excelWorksheet('猫眼-平台表现', [titleHeader, '年份', '月份', '日期', '播出平台', '热度值', '平台播放量'], trimmedPlatformRows),
    excelWorksheet('猫眼-收视率', [titleHeader, '年份', '月份', '日期', '播出频道', '收视率', '黄金时段收视率', '市占率', '播出时段', '集数', '收视口径'], trimmedTvRows),
    excelWorksheet('骨朵数据', [titleHeader, '年份', '月份', '日期', guduoHeatHeader, guduoRankHeader], trimmedGuduoRows),
    excelWorksheet('酷云数据', [titleHeader, '年份', '月份', '日期', '全端热度', '增长指数'], trimmedKuYunRows),
    excelWorksheet('艺恩数据', [titleHeader, '年份', '月份', '日期', ...endataDimensions.map(item => item.unit === '%' ? `${item.label}（%）` : item.label), '核验状态', '来源链接', '独立读取轮数', '采集时间'], endataRows),
  ].join('')

  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Center"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style><Style ss:ID="HeaderCenter"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Interior ss:Color="#0F243E" ss:Pattern="Solid"/></Style></Styles>${sheets}</Workbook>`
}

const crc32Table = (() => {
  const table = new Uint32Array(256)
  for (let value = 0; value < table.length; value += 1) {
    let crc = value
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1)
    table[value] = crc >>> 0
  }
  return table
})()

function zipCrc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

async function transformZipEntry(bytes, streamType) {
  const stream = new Blob([bytes]).stream().pipeThrough(new globalThis[streamType]('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function concatBytes(parts) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

async function styleRawDataXlsx(bytes) {
  const source = new Uint8Array(bytes)
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength)
  let endOffset = source.length - 22
  const minimumOffset = Math.max(0, source.length - 65_557)
  while (endOffset >= minimumOffset && view.getUint32(endOffset, true) !== 0x06054b50) endOffset -= 1
  if (endOffset < minimumOffset) throw new Error('导出文件无法读取：缺少 XLSX 压缩目录')

  const entryCount = view.getUint16(endOffset + 10, true)
  let directoryOffset = view.getUint32(endOffset + 16, true)
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const entries = []

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(directoryOffset, true) !== 0x02014b50) throw new Error('导出文件无法读取：XLSX 文件目录无效')
    const method = view.getUint16(directoryOffset + 10, true)
    const compressedSize = view.getUint32(directoryOffset + 20, true)
    const nameLength = view.getUint16(directoryOffset + 28, true)
    const extraLength = view.getUint16(directoryOffset + 30, true)
    const commentLength = view.getUint16(directoryOffset + 32, true)
    const localOffset = view.getUint32(directoryOffset + 42, true)
    const name = decoder.decode(source.subarray(directoryOffset + 46, directoryOffset + 46 + nameLength))
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength
    const compressed = source.subarray(dataOffset, dataOffset + compressedSize)
    const content = method === 0 ? compressed.slice()
      : method === 8 ? await transformZipEntry(compressed, 'DecompressionStream')
        : (() => { throw new Error(`导出文件无法读取：不支持 ZIP 压缩方式 ${method}`) })()
    entries.push({ name, nameBytes: encoder.encode(name), content })
    directoryOffset += 46 + nameLength + extraLength + commentLength
  }

  const sheetNames = entries.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))
  for (const entry of sheetNames) {
    let rowNumber = 0
    entry.content = encoder.encode(decoder.decode(entry.content).replace(/<row\b([^>]*)>([\s\S]*?)<\/row>/g, (row, attributes, cells) => {
      rowNumber += 1
      const isHeader = rowNumber === 1
      const rowAttributes = isHeader && !/\bht=/.test(attributes) ? `${attributes} ht="34" customHeight="1"` : attributes
      const styleId = isHeader ? 2 : 1
      const styledCells = cells.replace(/<c\b([^>]*)>/g, (cell, cellAttributes) => {
        const cleanAttributes = cellAttributes.replace(/\s+s="[^"]*"/g, '')
        return `<c${cleanAttributes} s="${styleId}">`
      })
      return `<row${rowAttributes}>${styledCells}</row>`
    }))
  }

  const styleEntry = entries.find((entry) => entry.name === 'xl/styles.xml')
  if (!styleEntry) throw new Error('导出文件无法设置样式：缺少工作簿样式表')
  let styles = decoder.decode(styleEntry.content)
  styles = styles.replace(/<fonts count="(\d+)">([\s\S]*?)<\/fonts>/, (_, count, body) => `<fonts count="${Number(count) + 1}">${body}<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="等线"/><family val="2"/></font></fonts>`)
  // Match the reference workbook: Dark 2 theme color, darkened by 50%.
  styles = styles.replace(/<fills count="(\d+)">([\s\S]*?)<\/fills>/, (_, count, body) => `<fills count="${Number(count) + 1}">${body}<fill><patternFill patternType="solid"><fgColor theme="3" tint="-0.5"/><bgColor indexed="64"/></patternFill></fill></fills>`)
  styles = styles.replace(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/, (_, count, body) => `<cellXfs count="${Number(count) + 2}">${body}<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs>`)
  styleEntry.content = encoder.encode(styles)

  const localParts = []
  const centralParts = []
  let localOffset = 0
  for (const entry of entries) {
    const compressed = await transformZipEntry(entry.content, 'CompressionStream')
    const checksum = zipCrc32(entry.content)
    const localHeader = new Uint8Array(30 + entry.nameBytes.length)
    const localView = new DataView(localHeader.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0x0800, true)
    localView.setUint16(8, 8, true)
    localView.setUint32(14, checksum, true)
    localView.setUint32(18, compressed.length, true)
    localView.setUint32(22, entry.content.length, true)
    localView.setUint16(26, entry.nameBytes.length, true)
    localHeader.set(entry.nameBytes, 30)
    localParts.push(localHeader, compressed)

    const centralHeader = new Uint8Array(46 + entry.nameBytes.length)
    const centralView = new DataView(centralHeader.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0x0800, true)
    centralView.setUint16(10, 8, true)
    centralView.setUint32(16, checksum, true)
    centralView.setUint32(20, compressed.length, true)
    centralView.setUint32(24, entry.content.length, true)
    centralView.setUint16(28, entry.nameBytes.length, true)
    centralView.setUint32(42, localOffset, true)
    centralHeader.set(entry.nameBytes, 46)
    centralParts.push(centralHeader)
    localOffset += localHeader.length + compressed.length
  }

  const centralDirectory = concatBytes(centralParts)
  const endRecord = new Uint8Array(22)
  const endView = new DataView(endRecord.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralDirectory.length, true)
  endView.setUint32(16, localOffset, true)
  return concatBytes([...localParts, centralDirectory, endRecord])
}

export async function buildRawDataXlsx(state) {
  const XLSX = await import('xlsx')
  const sourceWorkbook = XLSX.read(buildRawDataWorkbook(state), { type: 'string' })
  const bytes = XLSX.write(sourceWorkbook, { bookType: 'xlsx', type: 'array', compression: true })
  return styleRawDataXlsx(bytes)
}
