# 前端 API 接入约定

本文件描述前端调用契约，不包含生产 API、来源适配器或服务端核验实现。默认开发模式不连接真实服务；用 `VITE_API_PROXY_TARGET` 显式配置你维护的后端。

## 通用规则

响应使用 JSON 和正确的 `Content-Type`。失败使用非 2xx 状态与 `{ "error": "可读错误" }`，不能通过成功空数组隐藏错误。前端 API 客户端见 `src/lib/dramaApi.js`，它是当前请求参数和轮询协议的直接依据。

## 路由分组

| 路径 | 用途 |
| --- | --- |
| `GET /api/rankings` | 首页榜单，返回 `{ boards: [] }` 形态 |
| `GET /api/dramas/search?q=...&contentType=drama` | 搜索作品；类型为 `drama` 或 `variety` |
| `GET /api/dramas/:id` | 作品详情 |
| `GET /api/dramas/recommend` | 同期或同系列候选 |
| `POST /api/collect/cross` | 多来源请求协调 |
| `GET /api/collect/maoyan-history` | 热度等历史明细 |
| `GET /api/collect/maoyan-metric` | 有效播放、平台表现 |
| `GET /api/collect/guduo-history` | 骨朵区间数据 |
| `GET /api/collect/ky-history` | 酷云区间数据 |
| `GET /api/collect/tv-ratings` | 台端收视明细 |
| `GET /api/collect/jobs/:jobId` | 异步任务结果 |
| `POST /api/collect/release` | 释放当前标签页订阅 |

统计界面及其 API 客户端保留在前端中，但对应服务与认证实现未公开。未连接 API 时显示未配置状态，不会收集或发送真实访问统计。

## 异步约定

前端可携带 `Prefer: respond-async` 及 `X-Collection-Client`。服务若返回 HTTP 202 与 `{ "jobId": "...", "status": "running" }`，客户端会轮询任务路由。成功返回结果，失败保留可读错误；页面离开时释放订阅。

## 作品与看板状态

作品需有稳定 `id`、`title`、`contentType`、首播日期及可用的平台信息。展示状态由 `projects`、`competitors`、`liveHeat`、`tvRatings` 和 `sourceSync` 等结构组成，映射见 `src/lib/dramaMonitor.js`。

图表记录按日期保存 `values`；台端记录还需区分频道、时段和集数。缺失使用空值并保留来源状态，不能填入 0。不同来源指标不能互相替代，实际导出需与看板使用相同的记录和单位。

## 演示数据

`test/fixtures/dashboard-demo.html` 生成明确标注的合成记录，在标签页 sessionStorage 中建立演示看板。它不调用第三方源，不包含生产采集结果，也不模拟来源已经完成真实核验。

## 前端环境与凭据

Vite 代理只用于本地开发。生产静态站点需自行提供同源 `/api` 服务或配置网关。不要把生产密钥放进 Vite 环境、浏览器存储、示例文件或公开 Issue。
