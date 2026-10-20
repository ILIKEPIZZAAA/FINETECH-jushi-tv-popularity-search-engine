// 猫眼专业版采集器（浏览器型）。
//
// seriesId 来自官方 MDB 搜索；指标数据来自对应官方详情页的页面接口。
//
//   口径: 官方剧集详情页 /maoyan 的每日 currHeat，避免依赖全站热榜是否收录该剧。

import { getPage, refreshLastUse } from "../browser.js";
import { resolveSeriesId } from "./maoyan-resolver.js";

export async function collectMaoyan(title, requestedSeriesId = 0) {
  const resolved = requestedSeriesId ? { seriesId: requestedSeriesId } : await resolveSeriesId(title);
  if (!resolved?.seriesId) throw new Error(`无法解析《${title}》的猫眼 seriesId，已停止按剧名模糊匹配热榜条目。`);
  const detail = await maoyanDetail(resolved.seriesId);
  const latest = detail.series?.filter((row) => Number.isFinite(Number(row.heat))).at(-1);
  if (!latest) throw new Error(`猫眼详情页 seriesId=${resolved.seriesId} 未返回可用的当前热度值。`);
  return {
    platform: "maoyan", title, date: latest.date, heat: Number(latest.heat), rank: latest.rank == null ? null : Number(latest.rank),
    sourceUrl: DETAIL_URL(resolved.seriesId), fetchedAt: detail.fetchedAt, seriesId: resolved.seriesId,
  };
}

// 猫眼详情页：通过 seriesId 拉取开播以来的全量历史（热度/排名/曝光/转评赞/发布量/弹幕）。
// 原理：Playwright 打开详情页，监听页面自己发出的 getAllData XHR，读其响应。
// 页面：https://piaofang.maoyan.com/i/tv-datainfo/{seriesId}/maoyan
const DETAIL_URL = (seriesId) => `https://piaofang.maoyan.com/i/tv-datainfo/${seriesId}/maoyan?barTheme=424242`;
const METRIC_URL = (seriesId, metric) => `https://piaofang.maoyan.com/i/tv-datainfo/${seriesId}/${metric}?barTheme=424242`;

const PLATFORM_API_PATH = "/i/api/netWorkPlatFrom/getPlatData";
const PLATFORM_LABELS = [
  { pattern: /优酷/i, key: "优酷" },
  { pattern: /爱奇艺/i, key: "爱奇艺" },
  { pattern: /腾讯(?:视频)?/i, key: "腾讯视频" },
  { pattern: /芒果(?:TV)?/i, key: "芒果TV" },
];

function normalizePlatformName(label) {
  const text = String(label || "").trim();
  // 韶华若锦的猫眼平台表现页把芒果的每日播放量展示为“平台播放量/平台量”。
  // 这是该页唯一的平台播放序列，统一落到芒果TV，前端才能与固定的平台卡片对齐。
  if (/平台(?:播放)?量/i.test(text)) return "芒果TV";
  return PLATFORM_LABELS.find(({ pattern }) => pattern.test(text))?.key || text.replace(/热度|播放/g, "").trim();
}

function platformMetricValue(row, platformName) {
  const platform = normalizePlatformName(platformName);
  const candidates = platform === "芒果TV"
    ? [
        // 芒果平台表现页的口径是每日播放量；不同页面版本使用过这些字段名。
        row?.playCount,
        row?.playCountNum,
        row?.playNum,
        row?.playNumValue,
        row?.dailyPlay,
        row?.dailyPlayCount,
        row?.videoPlay,
        row?.platformPlay,
        row?.platformPlayCount,
        row?.platformValue,
        row?.maxHeat,
        row?.heat,
        row?.value,
      ]
    : [row?.maxHeat, row?.heat, row?.platformHeat, row?.platformHeatNum, row?.platformValue, row?.value];
  return candidates.find((value) => value !== null && value !== undefined);
}

function platformTabNames(page, metric = "platform") {
  const targetDesc = metric === "effective" ? "有效播放" : "平台表现";
  return page.evaluate((desc) => {
    const script = Array.from(document.scripts).map((node) => node.textContent || "").find((text) => new RegExp("\"desc\"\\s*:\\s*\"" + desc + "\"").test(text)) || "";
    const escaped = desc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const scoped = script.match(new RegExp("\"desc\"\\s*:\\s*\"" + escaped + "\"\\s*,\\s*\"id\"\\s*:\\s*\\d+\\s*,\\s*\"items\"\\s*:\\s*\\[([\\s\\S]*?)\\]\\s*,\\s*\"showItem\"", "s"))?.[1] || "";
    const configured = [...scoped.matchAll(/"desc"\s*:\s*"([^"]+)"\s*,\s*"id"\s*:\s*(\d+)/g)].map((match) => ({ name: match[1], id: Number(match[2]) }));
    const dom = Array.from(document.querySelectorAll(".cm-switch-button-rect .cm-switch-tab, .cm-switch-tab"))
      .map((node) => ({ name: (node.textContent || "").replace(/\s+/g, " ").trim(), id: null }))
      .filter(({ name }) => desc === "有效播放"
        ? /(?:累计)?有效播放|优酷|爱奇艺|腾讯|芒果/i.test(name)
        : /优酷|爱奇艺|腾讯|芒果|平台(?:播放)?量/i.test(name));
    const seen = new Set();
    return [...configured, ...dom].filter(({ name }) => name && !seen.has(name) && seen.add(name));
  }, targetDesc);
}

function rowsFromPlatformResponse(payload, platformName, metric = "platform") {
  const rows = Array.isArray(payload?.data?.rows) ? payload.data.rows : [];
  const isCumulativeEffective = metric === "effective" && /累计有效播放/.test(String(platformName || ""));
  return rows.map((row) => ({
    date: String(row?.dateTimeDesc || "").replace(/\./g, "-"),
    value: metric === "effective" ? (row?.effectivePlay ?? row?.effectivePlayNum ?? row?.validPlayNum ?? row?.effectiveViewNum ?? row?.value ?? null) : platformMetricValue(row, platformName),
    platform: isCumulativeEffective ? "" : normalizePlatformName(row?.platformName || row?.platform || platformName),
    platformLabel: isCumulativeEffective ? "" : (row?.platformName || row?.platform || platformName),
  })).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.value != null);
}

export function isHeatOnlyPlatformPayload(payload) {
  const rows = Array.isArray(payload?.data?.rows) ? payload.data.rows : [];
  const platformMetricFields = ["maxHeat", "heat", "platformHeat", "platformHeatNum", "platformValue", "playCount", "playCountNum", "playNum", "playNumValue", "dailyPlay", "dailyPlayCount", "videoPlay", "platformPlay", "platformPlayCount", "value"];
  return rows.length > 0
    && rows.every((row) => row?.currHeat !== null && row?.currHeat !== undefined)
    && rows.every((row) => platformMetricFields.every((field) => row?.[field] === null || row?.[field] === undefined));
}

// The rendered table is only a fallback when the API does not expose a platform
// response. A heat-only payload means the visible rows may belong to CatEye's
// general heat curve, so never label those rows with whichever tab was clicked.
export function safeRenderedPlatformFallback(payloads, renderedSeries) {
  const hasHeatOnlyPayload = payloads.some(isHeatOnlyPlatformPayload);
  return {
    series: hasHeatOnlyPayload ? [] : renderedSeries,
    mappingWarnings: hasHeatOnlyPayload && renderedSeries.length
      ? [`${renderedSeries.length} 条页面表格回退行因同时出现猫眼总热度响应而被排除；仅保留接口确认的平台行。`]
      : [],
  };
}

// 平台表现、有效播放使用详情页表格呈现，页面接口经常随版本调整。
// 直接读取页面渲染后的日期列与数值列，避免把某一版私有接口写死。
export async function maoyanMetricDetail(seriesId, metric) {
  if (!['platform', 'effective'].includes(metric)) throw new Error(`不支持的猫眼指标：${metric}`);
  const page = await getPage();
  const captured = new Map();
  const renderedSeries = [];
  const responseObjects = new Map();
  const platformLabelsByType = new Map();
  let effectiveApiUnavailable = false;
  let effectiveSummary = null;
  // Tabs 既用于触发各平台请求，也用于给响应数据补回可读的平台名称。
  // 必须放在指标分支外：采集完成后的统一归并逻辑同样需要访问它。
  let tabs = [];
  const responseHandler = async (response) => {
    if (metric === "effective" && response.url().includes("/i/api/effectivePlay/getAllData")) {
      // 猫眼对没有有效播放口径的剧会返回 HTTP 200 + error.message，页面随后只显示
      // “服务开小差”。把这个明确的源端 400 记下来，避免前端把它误报成采集器故障。
      try {
        const payload = await response.json();
        effectiveApiUnavailable = response.status() >= 400 || Boolean(payload?.error);
        // 初始页签是猫眼的全平台累计（单平台时即该平台）。随后逐一点击
        // 平台页签会触发同一接口，不能让最后一个平台的摘要覆盖初始摘要。
        if (!effectiveSummary && payload?.data?.summary) effectiveSummary = payload.data.summary;
      } catch {
        effectiveApiUnavailable = response.status() >= 400;
      }
      return;
    }
    if (!response.url().includes(PLATFORM_API_PATH)) return;
    const platformType = new URL(response.url()).searchParams.get("platformType");
    if (!platformType) return;
    responseObjects.set(platformType, response);
  };
  page.on("response", responseHandler);
  try { await page.goto(METRIC_URL(seriesId, metric), { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}
  const pageUnavailable = metric === "effective" && await page.evaluate(() => /服务开小差|网络异常/.test(document.body?.innerText || "")).catch(() => false);
  if (pageUnavailable) {
    page.off("response", responseHandler);
    refreshLastUse();
    throw new Error("猫眼有效播放页返回服务异常提示；本次按临时采集失败处理，不能判定为猫眼未发布数据。");
  }

  // 平台表现、有效播放页的每个子项都有独立 platformType。页面默认只请求一个子项，
  // 因此逐一点击子项并监听同源响应，避免把默认平台误当成所有平台。
  if (metric === "platform" || metric === "effective") {
    const tabDeadline = Date.now() + 6_000;
    while (!tabs.length && Date.now() < tabDeadline) {
      try { tabs = await platformTabNames(page, metric); } catch {}
      if (!tabs.length) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    // 等待初始页签的摘要响应，再切换其他页签；否则网络响应乱序时仍可能
    // 把某个分平台摘要误记成全平台摘要。
    if (metric === "effective") {
      const summaryDeadline = Date.now() + 4_000;
      while (!effectiveSummary && !effectiveApiUnavailable && Date.now() < summaryDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    for (const tabName of tabs) {
      try {
        const expectedId = Number.isFinite(tabName.id) ? String(tabName.id) : null;
        if (expectedId) platformLabelsByType.set(expectedId, tabName.name);
        const responseTypesBeforeClick = new Set(responseObjects.keys());
        const responsePromise = expectedId && responseObjects.has(expectedId)
          ? Promise.resolve(responseObjects.get(expectedId))
          : page.waitForResponse((response) => {
              if (!response.url().includes(PLATFORM_API_PATH)) return false;
              const responseType = new URL(response.url()).searchParams.get("platformType");
              return expectedId ? responseType === expectedId : Boolean(responseType && !responseTypesBeforeClick.has(responseType));
            }, { timeout: 4_000 }).catch(() => null);
        const tab = page.locator(".cm-switch-tab").filter({ hasText: tabName.name }).first();
        if (await tab.count() && (!expectedId || !responseObjects.has(expectedId))) {
          await tab.click({ timeout: 5_000 });
        }
        // 猫眼偶尔会切换前端表格但不暴露对应 XHR 给 Playwright。此时直接读取
        // 当前页签渲染后的日期和值，仍然保留真实页签名称，避免分平台数据丢失。
        if (tabName.name) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const visibleRows = await page.evaluate((kind) => {
            const dates = Array.from(document.querySelectorAll('.t-left .t-row .t-date p:first-child')).map((node) => node.textContent?.trim() || '');
            const rows = Array.from(document.querySelectorAll('.t-right .t-row'));
            const values = rows.map((row) => {
              const cells = Array.from(row.querySelectorAll('.t-cell-content'));
              const clean = (node) => (node?.textContent || '').replace(/热度峰值|播放峰值|No\.\s*\d+/g, '').trim();
              return kind === 'effective'
                ? { cumulativeValue: clean(cells[0]), dailyValue: clean(cells[1]) || clean(row.querySelector('.heat-desc-cell .t-cell-content')) }
                : { dailyValue: clean(row.querySelector('.heat-desc-cell .t-cell-content')) || clean(cells[0]) };
            });
            return dates.map((date, index) => ({ date: date.replace(/\./g, '-'), ...values[index] }))
              .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && (row.dailyValue || row.cumulativeValue));
          }, metric).catch(() => []);
          renderedSeries.push(...visibleRows.map((row) => ({
            ...row,
            value: metric === 'effective' && /累计有效播放/.test(tabName.name) ? row.cumulativeValue : row.dailyValue,
            cumulativeEffectivePlay: metric === 'effective' ? row.cumulativeValue : undefined,
            platform: /累计有效播放/.test(tabName.name) ? "" : normalizePlatformName(tabName.name),
            platformLabel: /累计有效播放/.test(tabName.name) ? "" : tabName.name,
          })));
        }
        const response = await responsePromise;
        if (response) {
          const responseType = new URL(response.url()).searchParams.get("platformType");
          if (responseType) {
            responseObjects.set(responseType, response);
            platformLabelsByType.set(responseType, tabName.name);
          }
        }
      } catch {}
    }
    const settleDeadline = Date.now() + 3_000;
    while (responseObjects.size < tabs.length && Date.now() < settleDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    for (const [platformType, response] of responseObjects.entries()) {
      try {
        const payload = await response.json();
        if (payload?.data?.rows) captured.set(platformType, payload);
      } catch {}
    }
  }
  page.off("response", responseHandler);

  // 猫眼无分平台明细时会以 platformType=NaN 返回普通猫眼热度历史；
  // 这些数值虽有效，但指标口径不符，必须作为源端无平台明细提示返回。
  const heatOnlyPayloadTypes = [];
  let renderedFallbackWarnings = [];
  if (metric === "platform") {
    const platformPayloads = [];
    for (const [platformType, response] of responseObjects.entries()) {
      const payload = captured.get(platformType) || await response.json().catch(() => null);
      if (payload) platformPayloads.push(payload);
      if (isHeatOnlyPlatformPayload(payload)) {
        heatOnlyPayloadTypes.push(platformType);
        captured.delete(platformType);
      }
    }
    // Keep API-backed, correctly labelled platform data, while discarding all
    // rendered-table fallback rows if this page also exposed its general heat API.
    if (heatOnlyPayloadTypes.length) {
      const fallback = safeRenderedPlatformFallback(platformPayloads, renderedSeries);
      renderedFallbackWarnings = fallback.mappingWarnings;
      renderedSeries.splice(0, renderedSeries.length, ...fallback.series);
    }
    if (!captured.size && heatOnlyPayloadTypes.length) {
      refreshLastUse();
      return {
        seriesId,
        metric,
        sourceUrl: METRIC_URL(seriesId, metric),
        totalDays: 0,
        series: [],
        availability: "not-published",
        notice: "猫眼平台表现页未返回分平台明细；接口响应为猫眼自身热度历史，已排除，避免误映射成平台表现。",
        ...(renderedFallbackWarnings.length ? { mappingWarnings: renderedFallbackWarnings } : {}),
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  if (captured.size || renderedSeries.length) {
    const series = [];
    const scriptTabLabels = await page.evaluate((desc) => {
      const script = Array.from(document.scripts).map((node) => node.textContent || "").find((text) => new RegExp("\"desc\"\\s*:\\s*\"" + desc + "\"").test(text)) || "";
      const escaped = desc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const scoped = script.match(new RegExp("\"desc\"\\s*:\\s*\"" + escaped + "\"\\s*,\\s*\"id\"\\s*:\\s*\\d+\\s*,\\s*\"items\"\\s*:\\s*\\[([\\s\\S]*?)\\]\\s*,\\s*\"showItem\"", "s"))?.[1] || "";
      return Object.fromEntries([...scoped.matchAll(/"desc"\s*:\s*"([^"]+)"\s*,\s*"id"\s*:\s*(\d+)/g)].map((match) => [match[2], match[1]]));
    }, metric === "effective" ? "有效播放" : "平台表现").catch(() => ({}));
    const tabLabels = { ...scriptTabLabels, ...Object.fromEntries(platformLabelsByType) };
    const tabLabelById = Object.fromEntries(tabs.filter((tab) => Number.isFinite(tab.id)).map((tab) => [String(tab.id), tab.name]));
    for (const [platformType, payload] of captured.entries()) {
      const platformLabel = tabLabels[platformType] || tabLabelById[platformType] || `${metric === "effective" ? "有效播放" : "平台表现"}-${platformType}`;
        series.push(...rowsFromPlatformResponse(payload, platformLabel, metric));
    }
    series.push(...renderedSeries);
    const deduped = [...new Map(series.map((row) => [`${row.platform}:${row.date}`, row])).values()];
    const unmappedRows = metric === "platform"
      ? deduped.filter((row) => !row.platformLabel || /^平台表现[-_]/.test(row.platformLabel))
      : [];
    const mappedRows = metric === "platform" ? deduped.filter((row) => !unmappedRows.includes(row)) : deduped;
    if (metric === "platform" && unmappedRows.length && !mappedRows.length) {
      throw new Error(`猫眼平台表现抓到 ${unmappedRows.length} 条数据，但未能将接口平台类型映射到页面页签名称；本次未写入未标识数据。`);
    }
    if (mappedRows.length) {
      refreshLastUse();
      return {
        seriesId,
        metric,
        sourceUrl: METRIC_URL(seriesId, metric),
        totalDays: mappedRows.length,
        sourceReadSuccessful: renderedFallbackWarnings.length === 0 && unmappedRows.length === 0,
        platforms: [...new Set(mappedRows.map((row) => row.platform).filter(Boolean))],
        ...((renderedFallbackWarnings.length || unmappedRows.length) ? { mappingWarnings: [...renderedFallbackWarnings, ...(unmappedRows.length ? [`${unmappedRows.length} 条数据缺少可识别的平台页签名称，未写入看板`] : [])] } : {}),
        series: mappedRows.map((row) => metric === "effective" ? ({ ...row, effectivePlay: row.value }) : ({ ...row, platformHeat: row.value })),
        ...(metric === "effective" && effectiveSummary ? { summary: effectiveSummary } : {}),
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  const deadline = Date.now() + 25000;
  let result = null;
  while (!result && !effectiveApiUnavailable && Date.now() < deadline) {
    try {
      result = await page.evaluate((kind) => {
        const dates = Array.from(document.querySelectorAll('.t-left .t-row .t-date p:first-child')).map((n) => n.textContent?.trim() || '');
        const valueNodes = kind === 'effective'
          ? document.querySelectorAll('.t-right .t-row .heat-desc-cell .t-cell-content')
          : document.querySelectorAll('.t-right .t-row .t-cell-content');
        const values = Array.from(valueNodes).map((n) => n.textContent?.replace(/热度峰值|播放峰值|No\.\s*\d+/g, '').trim() || '');
        const clean = (v) => v.replace(/,/g, '').trim();
        const rows = dates.map((date, i) => ({ date, value: clean(values[i] || '') })).filter((r) => /^\d{4}[-.]\d{2}[-.]\d{2}$/.test(r.date) && r.value);
        return rows.length ? rows : null;
      }, metric);
    } catch {}
    if (!result) await new Promise((r) => setTimeout(r, 1000));
  }
  refreshLastUse();
  if (!result?.length && metric === "effective") {
    if (effectiveApiUnavailable) {
      return {
        seriesId,
        metric,
        sourceUrl: METRIC_URL(seriesId, metric),
        totalDays: 0,
        series: [],
        availability: "not-published",
        notice: "猫眼有效播放接口明确返回该剧暂无可用数据。",
        ...(effectiveSummary ? { summary: effectiveSummary } : {}),
        fetchedAt: new Date().toISOString(),
      };
    }
    const publishedEmptyState = await page.evaluate(() => /暂无(?:有效播放)?数据|暂无有效播放记录|暂未公开有效播放/.test(document.body?.innerText || "")).catch(() => false);
    if (publishedEmptyState) {
      return {
        seriesId,
        metric,
        sourceUrl: METRIC_URL(seriesId, metric),
        totalDays: 0,
        series: [],
        availability: "not-published",
        notice: "猫眼有效播放页面明确显示暂无数据。",
        ...(effectiveSummary ? { summary: effectiveSummary } : {}),
        fetchedAt: new Date().toISOString(),
      };
    }
    throw new Error("猫眼有效播放页已打开，但未解析到数据且页面没有明确的无数据提示；暂不判定为猫眼未发布，可重试采集。");
  }
  if (!result?.length) {
    const sourceEmpty = await page.evaluate(() => /暂无(?:数据|记录)|无数据/.test(document.body?.innerText || "")).catch(() => false);
    if (sourceEmpty) {
      return {
        seriesId,
        metric,
        sourceUrl: METRIC_URL(seriesId, metric),
        totalDays: 0,
        series: [],
        availability: "not-published",
        notice: `猫眼${metric === 'platform' ? '平台表现' : '有效播放'}页面明确显示暂无数据。`,
        fetchedAt: new Date().toISOString(),
      };
    }
    throw new Error(`猫眼 ${metric === 'platform' ? '平台表现' : '有效播放'} 页没有返回可用明细，可能需要登录或页面结构已变更。`);
  }
  const fallbackPlatformLabel = metric === "platform"
    ? await page.evaluate(() => {
        const active = document.querySelector('.cm-switch-tab.active, .cm-switch-tab.is-active, .cm-switch-tab[aria-selected="true"], .cm-switch-tab[aria-checked="true"]');
        return active?.textContent?.replace(/\s+/g, " ").trim() || "";
      }).catch(() => "") || (tabs.length === 1 ? tabs[0].name : "")
    : "";
  if (metric === "platform" && !fallbackPlatformLabel) {
    throw new Error(`猫眼平台表现抓到 ${result.length} 条页面数据，但当前页签名称无法确认；本次未写入未标识数据。`);
  }
  return {
    seriesId,
    metric,
    sourceUrl: METRIC_URL(seriesId, metric),
    totalDays: result.length,
    sourceReadSuccessful: true,
    series: result.map((row) => ({
      date: row.date.replace(/\./g, '-'),
      value: row.value,
      ...(metric === 'platform' ? { platform: normalizePlatformName(fallbackPlatformLabel), platformLabel: fallbackPlatformLabel, platformHeat: row.value } : { effectivePlay: row.value }),
    })),
    ...(metric === "effective" && effectiveSummary ? { summary: effectiveSummary } : {}),
    fetchedAt: new Date().toISOString(),
  };
}

// 猫眼台端 tvinfo：按页面实际展示的频道、日期、收视率和市占率读取。
// 公开页面使用串行队列并保留冷却间隔，避免多个项目同时刷新造成高频请求。
let tvInfoQueue = Promise.resolve();

export function tvSlotFromLabels(...labels) {
  const value = labels.filter(Boolean).join(' ').replace(/\s+/g, '');
  // 时段归属由猫眼“当前剧 × 当前频道”的实际指标字段决定。频道本身没有
  // 全局固定的黄金/非黄金属性，同一频道在不同剧目的页面可呈现不同口径。
  if (/非黄金时段(?:实时)?收视率?/.test(value)) return '非黄金时段';
  if (/黄金时段(?:实时)?收视率?/.test(value)) return '黄金时段';
  // 猫眼只写“收视率/实时收视率”时，页面表示普通时段口径；显式写出，
  // 让后续同频道对比可以把它和黄金时段数据可靠区分开。
  if (/(?:实时)?收视率/.test(value)) return '非黄金时段';
  return null;
}

async function maoyanTvInfoOnce(seriesId) {
  const page = await getPage();
  const url = `https://piaofang.maoyan.com/i/tv-datainfo/${seriesId}/tvinfo?barTheme=424242`;
  // 有记录的 tvinfo 页面通常会在数秒内出现表格。纯网播剧则常常保持空页；
  // 限定探测时长，避免一个空页阻塞后续剧目的串行采集。
  let navigationError = null;
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 }); } catch (error) { navigationError = error; }
  const deadline = Date.now() + 10000;
  let channelNames = null;
  while (!channelNames && Date.now() < deadline) {
    try {
      channelNames = await page.evaluate(() => {
        const root = document.querySelector('.tvinfo.safe');
        if (!root) return null;
        const channels = Array.from(root.querySelectorAll('.search-content span'))
          .map((node) => node.textContent?.trim())
          .filter(Boolean);
        return channels.length ? [...new Set(channels)] : [];
      });
    } catch {}
    if (!channelNames) await new Promise((resolve) => setTimeout(resolve, 700));
  }
  refreshLastUse();
  // 仅当猫眼页面明确展示空数据提示时才标记为“未发布”；空白 DOM 或导航异常保留为可重试故障。
  if (!channelNames?.length) {
    const pageEvidence = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    if (/服务开小差|网络异常/.test(pageEvidence)) {
      throw new Error("猫眼 tvinfo 页面返回服务异常提示；本次按临时采集失败处理。");
    }
    if (!/暂无(?:频道)?(?:收视|数据)|暂无收视记录|暂无频道数据/.test(pageEvidence)) {
      throw new Error(`猫眼 tvinfo ${navigationError ? "导航未完成" : "已打开"}，但页面没有频道或明确的无数据提示；暂不判定为猫眼未发布。`);
    }
    return {
      seriesId,
      sourceUrl: url,
      totalDays: 0,
      channels: [],
      series: [],
      availability: 'not-published',
      notice: '猫眼 tvinfo 当前未发布该剧的频道逐日收视记录',
      fetchedAt: new Date().toISOString(),
    };
  }
  // 频道名是页面上的切换 tab。此前把所有 tab 名称与同一份当前表格拼接，
  // 导致每个频道看起来都有完全相同的数值。逐个点击 tab 后再读取当前表格，
  // 才能保留“频道 × 日期”的真实关系。
  const result = [];
  const skippedChannels = [];
  for (const channel of channelNames) {
    try {
      const escapedChannel = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const tab = page.locator('.tvinfo.safe .search-content span')
        .filter({ hasText: new RegExp(`^\\s*${escapedChannel}\\s*$`) })
        .first();
      if (await tab.count()) {
        await tab.click({ timeout: 5_000 });
        // 不能只等待一个固定毫秒数：点击后 active 会先切换，表格数据仍可能
        // 保留前一个频道。以 active 和明细标题同时变为当前频道作为读取前置条件。
        await page.waitForFunction((expectedChannel) => {
          const active = Array.from(document.querySelectorAll('.tvinfo.safe .search-content span'))
            .find((node) => node.classList.contains('active'));
          const detailTitle = document.querySelector('.tvinfo.safe p.title')?.textContent?.trim() || '';
          return active?.textContent?.trim() === expectedChannel
            && detailTitle.replace(/\s+/g, '').startsWith(expectedChannel.replace(/\s+/g, ''));
        }, channel, { timeout: 5_000 });
        // 标题先更新、指标卡和右侧列稍后更新是猫眼页面的实际渲染顺序。
        // 这里保留足够的渲染窗口，避免把上一频道的普通/黄金指标写入当前频道。
        await page.waitForTimeout(700);
      } else {
        skippedChannels.push(channel);
        continue;
      }
    } catch {
      // 切换失败时绝不复用前一个频道的表格，避免错误映射。
      skippedChannels.push(channel);
      continue;
    }
    const group = await page.evaluate(() => {
      const root = document.querySelector('.tvinfo.safe');
      if (!root) return null;
      // 猫眼在 tv-card 和表头分别展示同一口径。两个位置一起采集，页面局部
      // 改版时仍能辨认“黄金时段收视率”与普通“收视率”。
      const metricLabel = root.querySelector('.tv-card .tv-card-item')?.textContent?.trim() || '';
      const tableHeaders = Array.from(root.querySelectorAll('.t-right .t-header-cell'))
        .map((node) => node.textContent?.trim() || '')
        .filter(Boolean);
      const detailTitle = root.querySelector('p.title')?.textContent?.trim() || '';
      const dates = Array.from(root.querySelectorAll('.t-left .t-row .t-date p:first-child')).map((node) => node.textContent?.trim() || '');
      const values = Array.from(root.querySelectorAll('.t-right .t-row .t-cell-content')).map((node) => node.textContent?.trim() || '');
      const activeChannel = Array.from(root.querySelectorAll('.search-content span'))
        .find((node) => node.classList.contains('active'))?.textContent?.trim() || '';
      return { activeChannel, metricLabel, tableHeaders, detailTitle, dates, values };
    });
    if (group?.activeChannel === channel && group.detailTitle.replace(/\s+/g, '').startsWith(channel.replace(/\s+/g, ''))) {
      result.push({ channel, ...group });
    }
    else skippedChannels.push(channel);
  }
  const series = result.flatMap((group) => group.dates.map((date, index) => {
    const ratingText = group.values[index * 2] || '';
    const shareText = group.values[index * 2 + 1] || '';
    const rating = Number(String(ratingText).replace(/破\d+/g, '').replace('%', '').trim());
    const share = Number(String(shareText).replace('%', '').trim());
    const slot = tvSlotFromLabels(group.metricLabel, ...group.tableHeaders, group.detailTitle);
    return {
      date: date.replace(/\./g, '-'),
      channel: group.channel,
      platform: group.channel,
      // 只接受猫眼当前页面标题明确给出的时段，未标明时保留空值交给后续映射。
      slot,
      episodes: null,
      csmCityRating: Number.isFinite(rating) ? rating : null,
      csmCityShare: Number.isFinite(share) ? share : null,
      csmCityRank: null,
      nationalRating: null,
      nationalShare: null,
      nationalRank: null,
      sourceUrl: url,
    };
  })).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date));
  return {
    seriesId,
    sourceUrl: url,
    totalDays: series.length,
    channels: [...new Set(series.map((row) => row.channel))],
    skippedChannels,
    series,
    complete: skippedChannels.length === 0,
    fetchedAt: new Date().toISOString(),
  };
}

export function maoyanTvInfo(seriesId) {
  const task = tvInfoQueue.then(async () => {
    return maoyanTvInfoOnce(seriesId);
  });
  tvInfoQueue = task.catch(() => undefined);
  return task;
}

function dateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : "";
}

function dateRange(from, to) {
  if (!from || !to || from > to) return [];
  const dates = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function maoyanHistoryCoverage(series, from, to) {
  const normalizedFrom = dateOnly(from), normalizedTo = dateOnly(to);
  const actualDates = series.map((row) => row.date).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  const actualFrom = actualDates[0] || null, actualTo = actualDates.at(-1) || null;
  const expectedDates = normalizedFrom && normalizedTo ? dateRange(normalizedFrom, normalizedTo) : [];
  const returnedDates = new Set(actualDates);
  // A successfully parsed source response is a read of its published history.
  // Repeated absence at a requested date is verified separately by collectVerified.
  const noDataDates = expectedDates.filter((date) => !returnedDates.has(date));
  return {
    sourceReadSuccessful: true,
    complete: true,
    truncated: false,
    missingDates: [],
    noDataDates,
    coverage: {
      requestedFrom: normalizedFrom || null, requestedTo: normalizedTo || null,
      actualFrom, actualTo, expectedDays: expectedDates.length || null,
      returnedDays: actualDates.length, missingDays: 0, noDataDays: noDataDates.length,
      sourceLatestBeforeRequestedTo: Boolean(normalizedTo && actualTo && actualTo < normalizedTo),
    },
  };
}

export async function maoyanDetail(seriesId, { from = "", to = "" } = {}) {
  const page = await getPage();
  const capturedCandidates = [];
  const handler = async (response) => {
    if (!response.url().includes("maoyanHeat/getAllData")) return;
    if (!response.ok()) return;
    try {
      const json = await response.json();
      if (Array.isArray(json?.data?.tableData)) capturedCandidates.push(json);
    } catch {}
  };
  page.on("response", handler);
  try {
    await page.goto(DETAIL_URL(seriesId), { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch {
    // 超时不致命，继续等 XHR
  }
  const deadline = Date.now() + 25000;
  while (!capturedCandidates.length && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  // 页面可能先发近期窗口请求，再发更长历史请求；取日期行最多的一份。
  if (capturedCandidates.length) await new Promise((r) => setTimeout(r, 3000));
  page.off("response", handler);
  refreshLastUse();

  const captured = capturedCandidates.sort((a, b) => (b.data.tableData.length || 0) - (a.data.tableData.length || 0))[0];
  if (!captured) {
    throw new Error(`猫眼详情页 seriesId=${seriesId} 没有返回 getAllData 数据，可能是页面结构变更或风控。`);
  }

  const rows = captured.data.tableData || [];
  // 标准化输出：每天一行，含所有维度
  const series = rows.map((row) => ({
    date: row.dateTimeDesc,             // "2026-09-06"
    heat: row.currHeat,                 // 猫眼热度（数字）
    heatDesc: row.currHeatDesc,         // "9240.10"
    rank: row.currHeatRank,             // 排名（数字）
    heatPeak: !!row.heatPeak,           // 是否热度峰值
    exposure: row.exposureTodayNum,     // 全网曝光（字符串，含"亿""万"）
    interaction: row.interactionVolumeTodayNum, // 全网转评赞
    publish: row.publishTodayNum,       // 全网发布
    bulletScreen: row.bulletScreenTodayNum,     // 全网弹幕
    // 猫眼不同页面版本字段名会变化；保留已返回的平台表现/有效播放字段，缺失时由前端明确展示无数据。
    platformHeat: row.platformHeat ?? row.platformHeatNum ?? row.videoHeat ?? null,
    effectivePlay: row.effectivePlay ?? row.effectivePlayNum ?? row.validPlayNum ?? row.effectiveViewNum ?? null,
    isReleaseDay: !!row.releaseDay,     // 是否首播日
    releaseInfo: row.releaseInfo || "", // "上线首日" 等
  }));

  return {
    seriesId,
    totalDays: series.length,
    series,
    // 猫眼详情页 summary.subItems 才是看板上的原始累计口径。
    // 逐日 tableData 只覆盖已返回日期，不能在前端重新累加替代它。
    summary: captured.data.summary || null,
    ...maoyanHistoryCoverage(series, from, to),
    fetchedAt: new Date().toISOString(),
  };
}
