export const analyticsPages = [
  { id: 'home', label: '首页', group: 'home' },
  { id: 'fetching', label: '数据采集页', group: 'fetching' },
  { id: 'dashboard.heat', label: '看板 · 网端数据', group: 'dashboard' },
  { id: 'dashboard.tv', label: '看板 · 台端数据', group: 'dashboard' },
  { id: 'dashboard.competitor', label: '看板 · 剧综分析', group: 'dashboard' },
  { id: 'dashboard.logs', label: '看板 · 日志', group: 'dashboard' },
]

export const analyticsGroups = [
  { id: 'home', label: '首页' },
  { id: 'dashboard', label: '看板内页' },
  { id: 'fetching', label: '数据采集页' },
].map(group => ({ ...group, pages: analyticsPages.filter(page => page.group === group.id).map(page => page.id) }))

const allPages = analyticsPages.map(page => page.id)
const dashboardPages = allPages.filter(page => page.startsWith('dashboard.'))
const controls = (pages, component, actions) => actions.map(action => ({ pages, component, action }))

// Stable control names also let the report show controls that have no clicks yet.
export const analyticsControls = [
  ...controls(allPages, '顶部导航', ['返回主页', '小红书', 'GitHub']),
  ...controls(['home'], '首页剧集搜索', ['点击搜索框', '点击搜索按钮', '提交搜索', '选择剧集', '展开待核实条目', '切换搜索类型 电视剧', '切换搜索类型 综艺']),
  ...controls(['home'], '骨朵综合剧集榜搜索推荐', ['选择近期热剧']),
  ...['腾讯视频', '爱奇艺', '优酷', '芒果TV'].flatMap(name => controls(['home'], `${name}首页榜单`, [name === '优酷' ? '查看聚云录来源' : '查看官方来源', '图表交互'])),
  ...controls(['home'], '页脚', ['小红书', 'GitHub', '打开免责声明', '查看备案信息']),
  ...controls(allPages, '免责声明', ['关闭免责声明']),
  ...controls(dashboardPages, '看板导航', ['网端数据', '台端数据', '剧综对比']),
  ...controls(dashboardPages, '看板辅助入口', ['日志', '打开免责声明', '打开使用说明']),
  ...controls(['dashboard.heat'], '网端数据筛选', ['切换平台 猫眼', '切换平台 骨朵', '切换平台 酷云', '切换平台 艺恩',
    ...['热度值', '全网曝光', '全网转评赞', '全网发布', '全网弹幕', '有效播放', '平台表现'].map(label => `猫眼 ${label}`),
    '骨朵 骨朵热度', '骨朵 骨朵排名', '酷云 酷云全端热度', '酷云 酷云增长指数', ...['播放量指数', '播放市占率', '播映指数', '媒体热度', '用户热度', '好评度', '观看度'].map(label => `艺恩 ${label}`)]),
  ...controls(dashboardPages, '看板工具', ['导出原始数据', '刷新数据', '切换深色背景', '切换浅色背景']),
  ...controls(dashboardPages, '使用说明', ['关闭使用说明', '放大查看', '适应窗口', '上一张', '下一张']),
  ...controls(['dashboard.heat'], '有效播放平台切换', ['选择 全网', ...['爱奇艺', '腾讯视频', '优酷', '芒果TV'].map(label => `选择 ${label}`)]),
  ...controls(['dashboard.heat'], '平台表现平台切换', ['爱奇艺', '腾讯视频', '优酷', '芒果TV'].map(label => `选择 ${label}`)),
  ...controls(['dashboard.tv'], '台端筛选', ['东方卫视', 'CCTV-1', 'CCTV-8', '湖南卫视', '浙江卫视', '江苏卫视', '北京卫视', '广东卫视'].map(label => `切换播出频道 ${label}`)),
  ...controls(['dashboard.heat'], '网端趋势图', ['近7天', '近30天', '完整视图', '图表交互']),
  ...controls(['dashboard.heat'], '有效播放对比饼图', ['图表交互']),
  ...controls(['dashboard.competitor'], '同期竞品管理', ['添加对比作品', '重新匹配', '推荐候选 加入看板', '移除竞品', '综艺候选 全部', '综艺候选 同期节目', '综艺候选 同系列往季']),
  ...controls(['dashboard.competitor'], '竞品搜索弹窗', ['点击竞品搜索框', '提交竞品搜索', '搜索结果 加入看板', '关闭竞品搜索']),
  ...controls(['dashboard.logs'], '日志', ['查看已下载数据']),
  ...controls(['fetching'], '采集进度', ['打开采集日志', '关闭采集日志']),
]

export const analyticsPageName = id => analyticsPages.find(page => page.id === id)?.label || id

export function reportControlRows(actions, pageIds, pageUv) {
  const rows = new Map()
  for (const control of analyticsControls) {
    if (control.pages.some(page => pageIds.includes(page))) rows.set(`${control.component}\0${control.action}`, { ...control, clicks: 0, uv: 0, ctr: pageUv ? 0 : null, sources: [] })
  }
  for (const action of actions) rows.set(`${action.component}\0${action.action}`, action)
  return [...rows.values()].sort((a, b) => b.clicks - a.clicks || a.component.localeCompare(b.component, 'zh-CN') || a.action.localeCompare(b.action, 'zh-CN'))
}

// Keep stored event keys stable; present the current product wording.
export const analyticsControlLabel = value => String(value || '').replaceAll('同期竞品管理', '剧综对比管理').replaceAll('竞品搜索弹窗', '对比作品搜索').replaceAll('搜索竞品', '添加对比作品').replaceAll('竞品搜索', '对比作品搜索').replaceAll('移除竞品', '移除对比作品').replaceAll('同期竞品', '剧综对比').replaceAll('网端热度', '网端数据').replaceAll('台端热度', '台端数据').replaceAll('对比', '分析')
