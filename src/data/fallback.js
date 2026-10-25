import zhuYuPoster from '../assets/posters/zhu-yu.svg'
import lanXiangPoster from '../assets/posters/lan-xiang-ru-gu.svg'
import zaoChunPoster from '../assets/posters/zao-chun-qing-lang.svg'

export const fallbackSite = {
  brand: 'FINETECH',
  hero: {
    title: '聚势 PERSPECTIVE',
    tagline: '剧综热度搜索引擎',
    searchPlaceholder: '输入剧名以创建看板',
  },
  footer: {
    statement: 'Creative thinking inspires ideas. Ideas inspire change.',
    copyright: '@FINETECH 2026',
    disclaimer: '免责声明',
  },
}

export const fallbackFeatures = [
  { title: '免费开源使用' },
  { title: '自动化采集数据' },
]

export const fallbackSearchResults = [
  {
    title: '逐玉',
    poster: zhuYuPoster,
    year: '2025',
    actors: '张凌赫、田曦薇、王瑞昌',
    director: '谢泽',
    firstAired: '待定',
    platform: '优酷',
  },
  {
    title: '兰香如故',
    poster: lanXiangPoster,
    year: '2025',
    actors: '鞠婧祎、曾舜晞、陈都灵',
    director: '刘国楠',
    firstAired: '待定',
    platform: '腾讯视频',
  },
  {
    title: '早春晴朗',
    poster: zaoChunPoster,
    year: '2025',
    actors: '白敬亭、章若楠、丁勇岱',
    director: '张开宙',
    firstAired: '待定',
    platform: '爱奇艺',
  },
]
