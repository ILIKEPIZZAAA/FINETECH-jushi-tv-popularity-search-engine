import * as XLSX from 'xlsx'
import { analyticsPageName, reportControlRows } from '../src/lib/analyticsCatalog.js'

const maxDataRows = 1_048_575
const chinaTime = time => new Date(time + 8 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ')

export function analyticsWorkbook({ report, events, generatedAt }) {
  const workbook = XLSX.utils.book_new()
  const append = (name, headers, rows, widths, percentageColumn) => {
    const count = Math.max(1, Math.ceil(rows.length / maxDataRows))
    for (let part = 0; part < count; part++) {
      const values = rows.slice(part * maxDataRows, (part + 1) * maxDataRows)
      const sheet = XLSX.utils.aoa_to_sheet([headers, ...values])
      sheet['!cols'] = widths.map(wch => ({ wch }))
      sheet['!autofilter'] = { ref: sheet['!ref'] }
      if (percentageColumn !== undefined) {
        for (let row = 1; row <= values.length; row++) {
          const cell = sheet[XLSX.utils.encode_cell({ r: row, c: percentageColumn })]
          if (cell?.t === 'n') cell.z = '0.00%'
        }
      }
      XLSX.utils.book_append_sheet(workbook, sheet, count === 1 ? name : `${name}${part + 1}`)
    }
  }

  append('统计说明', ['项目', '内容'], [
    ['导出范围', '后台当前留存的全部历史数据，不受页面日期、分类、关键词筛选影响'],
    ['记录开始日期', report.startedAt || '暂无记录'],
    ['导出开始日期', report.from], ['导出结束日期', report.to],
    ['导出时间（北京时间）', chinaTime(generatedAt)], ['时区', report.timezone],
    ['原始事件条数', events.length], ['数据保留天数', report.retentionDays],
    ['UV', '按匿名浏览器标识去重；区间 UV 不等于每日 UV 之和'],
    ['PV', '页面进入及刷新次数'],
    ['点击次数', '已记录的按钮、链接、提交及图表交互事件次数'],
    ['页面点击率', '访问过所属页面且点击过该控件的去重 UV ÷ 所属页面访问 UV；没有页面访问时单元格留空'],
    ['分类按钮点击率', '同一页面分类跨子页面去重后计算，分母为该分类访问 UV'],
    ['原始事件明细', '保留事件 ID、服务器保存的时间、来源页面及匿名访客哈希；不含密码、IP 地址或搜索输入'],
    ['未记录的数据', '历史未接入的点击无法补算；拦截、网络失败等会造成漏计'],
    ['大表处理', '单个 Sheet 超过 Excel 行数上限时自动拆分，保留全部记录'],
  ], [28, 110])

  const clickUv = new Set(events.filter(event => event.kind === 'click').map(event => event.visitor)).size
  append('访问总览', ['统计范围', '页面访问 PV', '访问人数 UV', '点击次数', '点击人数 UV'], [
    ['全站（跨页面去重）', report.totals.pv, report.totals.uv, report.totals.clicks, clickUv],
    ...report.groups.map(group => [group.label, group.pv, group.uv, group.clicks, group.clickUv]),
  ], [28, 18, 18, 18, 18])
  append('每日趋势', ['日期', 'UV', 'PV', '点击次数'],
    report.daily.map(row => [row.day, row.uv, row.pv, row.clicks]), [16, 18, 18, 18])
  append('页面访问', ['页面', '页面标识', 'PV', 'UV', '点击次数', '点击人数 UV'],
    report.pages.map(row => [analyticsPageName(row.page), row.page, row.pv, row.uv, row.clicks, row.clickUv]), [26, 26, 16, 16, 18, 18])
  append('组件点击', ['页面', '页面标识', '组件', '点击次数', '点击人数 UV'],
    report.components.map(row => [analyticsPageName(row.page), row.page, row.component, row.clicks, row.uv]), [26, 26, 30, 18, 18])

  const actionRows = report.pages.flatMap(page => reportControlRows(report.actions.filter(row => row.page === page.page), [page.page], page.uv)
    .map(row => [analyticsPageName(page.page), page.page, row.component, row.action, row.clicks, row.uv, row.matchedUv ?? 0, page.uv, row.ctr]))
  append('按钮点击', ['页面', '页面标识', '组件', '按钮或操作', '点击次数', '点击人数 UV', '访问匹配点击 UV', '所属页面 UV', '页面点击率'],
    actionRows, [26, 26, 30, 42, 18, 18, 22, 18, 18], 8)
  append('分类按钮点击', ['页面分类', '组件', '按钮或操作', '发生页面', '点击次数', '点击人数 UV', '访问匹配点击 UV', '所属分类 UV', '分类点击率'],
    report.groups.flatMap(group => reportControlRows(group.actions, group.pages, group.uv).map(row => [group.label, row.component, row.action,
      (row.sources?.length ? row.sources : group.pages).map(analyticsPageName).join('、'), row.clicks, row.uv, row.matchedUv ?? 0, group.uv, row.ctr])),
    [20, 30, 42, 54, 18, 18, 22, 18, 18], 8)
  append('原始事件明细', ['事件 ID', '记录日期', '时间（北京时间）', '时间戳（毫秒）', '事件类型', '页面', '页面标识', '组件', '操作', '匿名访客哈希'],
    events.map(row => [row.id, row.day, chinaTime(row.at), row.at, row.kind, analyticsPageName(row.page), row.page, row.component, row.action, row.visitor]),
    [40, 16, 24, 22, 16, 26, 26, 30, 42, 68])
  workbook.Props = { Title: 'FINETECH 全部访问与交互统计', CreatedDate: new Date(generatedAt) }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true })
}
