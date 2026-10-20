// 酷云数娱公开网页端采集器。
// 当前只接入两个用户明确要求的维度：平台实时热度、增长指数。
// 页面是一个 iframe 应用，优先读取渲染后的文本，避免依赖易变的内部接口。
import { getPage, refreshLastUse } from "../browser.js";
import { waitForDate } from "../date-readiness.js";

const KY_URL = "https://www.ky.live/pc.html";
const KY_RECENT_HISTORY_DAYS = 30;

function normalize(value = "") {
  return String(value).replace(/[《》\s]/g, "").toLowerCase();
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("酷云采集请求已取消");
  error.name = "AbortError";
  throw error;
}

function dateFromText(text) {
  const match = String(text).match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/);
  if (!match) return null;
  return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
}

function findValue(lines, title, mode) {
  const key = normalize(title);
  const indexes = lines.map((line, index) => ({ line, index })).filter(({ line }) => normalize(line) === key || normalize(line).includes(key)).map(({ index }) => index);
  const candidates = [];
  for (const index of indexes) {
    for (const line of lines.slice(index + 1, index + 13)) {
      const value = line.replace(/,/g, "").trim();
      const numeric = Number(value);
      if (mode === "growth" ? /^\d+(?:\.\d+)?$/.test(value) : /^\d[\d]*(?:\.\d+)?$/.test(value) && numeric >= 1000) candidates.push(numeric);
    }
  }
  return candidates.length ? (mode === "growth" ? candidates[0] : Math.max(...candidates)) : null;
}

async function getKyFrame(page, signal) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    // 页面版本会在 `/?`、`/pc` 和带 query 的地址之间切换，不能把
    // iframe URL 写死成单一路径；排除主页面后取酷云域名下的内容框架。
    const frame = page.frames().find((item) => item !== page.mainFrame() && /ky\.live/i.test(item.url()));
    if (frame) return frame;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("酷云网页端未加载数据框架");
}

async function clickText(frame, text, occurrence = "first", waitMs = 800, signal) {
  throwIfAborted(signal);
  const locator = frame.getByText(text, { exact: true });
  const target = occurrence === "last" ? locator.last() : locator.first();
  await target.click({ timeout: 10_000 });
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  throwIfAborted(signal);
}

async function clickKyText(page, text, occurrence = "first", waitMs = 800, signal) {
  // 酷云页面会在切换指标/日期时重建 iframe。每次操作前重新取 frame，
  // 避免复用已经 detached 的 FrameLocator。
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const frame = await getKyFrame(page, signal);
      await clickText(frame, text, occurrence, waitMs, signal);
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/frame was detached|execution context was destroyed|target page, context or browser has been closed/i.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
  throw lastError;
}

async function ensureKyMode(page, mode, signal) {
  const tabText = mode === "growth" ? "增长指数" : "全端热度";
  const columnPattern = mode === "growth" ? /节目\s+增长指数/ : /节目\s+热度/;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    throwIfAborted(signal);
    try {
      const frame = await getKyFrame(page, signal);
      const text = await frame.locator("body").innerText();
      if (columnPattern.test(text)) return;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
    }
    try { await clickKyText(page, tabText, "first", 1200, signal); } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
    }
  }
  throwIfAborted(signal);
}

async function collectHistory(page, title, mode, maxDays = 30, signal) {
  const rows = [];
  let previousDate = null;
  for (let index = 0; index < maxDays; index += 1) {
    throwIfAborted(signal);
    const frame = await getKyFrame(page, signal);
    let text;
    try {
      text = await frame.locator("body").innerText();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/frame was detached|execution context was destroyed/i.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600));
      index -= 1;
      continue;
    }
    const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const date = dateFromText(text);
    const value = findValue(lines, title, mode);
    if (date && value != null) rows.push({ date, value });
    if (!date || date === previousDate) break;
    previousDate = date;
    try {
      await clickText(frame, "前一天", "first", 350, signal);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/frame was detached|execution context was destroyed/i.test(message)) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        continue;
      }
      break;
    }
  }
  return rows;
}

function addDays(iso, amount) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dateList(from, to) {
  const out = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "") || from > to) return out;
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) out.push(cursor);
  return out;
}

async function scanDateRange(page, title, mode, from, to, signal, onProgress) {
  const expectedDates = dateList(from, to);
  const rows = [];
  const scannedDates = [];
  const noDataDates = [];
  const failedDates = [];
  let sourceLatestDate = null;
  let previousDate = null;
  let currentDate = null;

  // 先读取源站当前页日期，再逐日点“前一天”直到首播日；超出源站最新日期的尾段按无数据保留。
  for (let index = 0; index < expectedDates.length + 2; index += 1) {
    throwIfAborted(signal);
    const frame = await getKyFrame(page, signal);
    let text;
    try { text = await frame.locator("body").innerText(); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/frame was detached|execution context was destroyed/i.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600));
      index -= 1;
      continue;
    }
    const date = dateFromText(text);
    if (!date) throw new Error(`酷云${mode === "growth" ? "增长指数" : "全端热度"}页面没有可解析日期，不能确认每日覆盖`);
    currentDate = date;
    sourceLatestDate ||= date;
    if (date <= to) break;
    await clickKyText(page, "前一天", "first", 0, signal);
    await waitForDate(async () => {
      const nextFrame = await getKyFrame(page, signal);
      return dateFromText(await nextFrame.locator("body").innerText());
    }, addDays(date, -1), { signal });
  }

  while (currentDate && currentDate >= from && currentDate <= to) {
    throwIfAborted(signal);
    if (previousDate === currentDate) {
      failedDates.push(currentDate);
      break;
    }
    const frame = await getKyFrame(page, signal);
    const text = await frame.locator("body").innerText();
    const visibleDate = dateFromText(text);
    if (visibleDate !== currentDate) {
      failedDates.push(currentDate);
      break;
    }
    const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const value = findValue(lines, title, mode);
    scannedDates.push(currentDate);
    if (value == null) noDataDates.push(currentDate);
    else rows.push({ date: currentDate, value });
    onProgress?.({
      metric: mode === "growth" ? "酷云增长指数" : "酷云全端热度",
      state: "scanning",
      checkedDays: scannedDates.length,
      totalDays: expectedDates.length,
      currentDate,
      hitDays: rows.length,
      noDataDays: noDataDates.length,
    });
    previousDate = currentDate;
    if (currentDate === from) break;
    const expectedPrevious = addDays(currentDate, -1);
    try {
      await clickKyText(page, "前一天", "first", 0, signal);
      currentDate = await waitForDate(async () => {
        const nextFrame = await getKyFrame(page, signal);
        return dateFromText(await nextFrame.locator("body").innerText());
      }, expectedPrevious, { signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      failedDates.push(expectedPrevious);
      break;
    }
  }

  const scanned = new Set(scannedDates);
  const unscannedDates = expectedDates.filter((date) => !scanned.has(date) && !(sourceLatestDate && date > sourceLatestDate));
  const sourceUnavailableDates = expectedDates.filter((date) => sourceLatestDate && date > sourceLatestDate);
  const allNoDataDates = [...new Set([...noDataDates, ...sourceUnavailableDates])].sort();
  return {
    rows,
    scannedDates: [...new Set(scannedDates)].sort(),
    noDataDates: allNoDataDates,
    failedDates: [...new Set([...failedDates, ...unscannedDates])].sort(),
    sourceLatestDate,
    complete: failedDates.length === 0 && unscannedDates.length === 0,
  };
}

async function collectKyHistoryOnce(title, from, to, { signal, onProgress } = {}) {
  throwIfAborted(signal);
  if (!dateList(from, to).length) throw new Error("酷云历史采集需要有效首播日和截止日");
  onProgress?.({ metric: "酷云全端热度", state: "loading", checkedDays: 0, totalDays: dateList(from, to).length });
  const page = await getPage();
  try { await page.goto(KY_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }); } catch {}
  await ensureKyMode(page, "realtime", signal);
  const realtime = await scanDateRange(page, title, "realtime", from, to, signal, onProgress);

  onProgress?.({ metric: "酷云增长指数", state: "loading", checkedDays: 0, totalDays: dateList(from, to).length });
  try { await page.goto(KY_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }); } catch {}
  await ensureKyMode(page, "growth", signal);
  const growth = await scanDateRange(page, title, "growth", from, to, signal, onProgress);
  refreshLastUse();

  const series = [
    ...realtime.rows.map((row) => ({ name: "酷云全端热度", ...row, sourceUrl: KY_URL })),
    ...growth.rows.map((row) => ({ name: "酷云增长指数", ...row, sourceUrl: KY_URL })),
  ];
  const expectedDates = dateList(from, to);
  const scannedDates = [...new Set([...realtime.scannedDates, ...growth.scannedDates])].sort();
  const failedDates = [...new Set([...realtime.failedDates, ...growth.failedDates])].sort();
  return {
    title,
    source: "ky",
    sourceUrl: KY_URL,
    from,
    to,
    series,
    complete: realtime.complete && growth.complete && failedDates.length === 0,
    attemptedDates: scannedDates.length,
    checkedDates: expectedDates,
    scannedDates,
    noDataByMetric: {
      "酷云全端热度": realtime.noDataDates,
      "酷云增长指数": growth.noDataDates,
    },
    failedDates,
    sourceLatestDate: [realtime.sourceLatestDate, growth.sourceLatestDate].filter(Boolean).sort()[0] || null,
    coverageNote: `从 ${from} 到 ${to} 逐日查询酷云两个指标`,
    fetchedAt: new Date().toISOString(),
  };
}

export async function collectKyHistory(title, from, to, { signal, onProgress } = {}) {
  try {
    return await collectKyHistoryOnce(title, from, to, { signal, onProgress });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/frame was detached|execution context was destroyed|target page, context or browser has been closed/i.test(message)) throw error;
    return collectKyHistoryOnce(title, from, to, { signal, onProgress });
  }
}

async function collectKyOnce(title, _platform = "全端", { signal } = {}) {
  throwIfAborted(signal);
  const page = await getPage();
  try { await page.goto(KY_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }); } catch {}
  throwIfAborted(signal);

  // 酷云“全端热度”本身就是统一口径；这里不再切换到项目所属平台。
  await ensureKyMode(page, "realtime", signal);
  const realtimeSeries = await collectHistory(page, title, "realtime", KY_RECENT_HISTORY_DAYS, signal);
  const realtime = realtimeSeries[0]?.value ?? null;
  const realtimeDate = realtimeSeries[0]?.date ?? null;

  // collectHistory 会连续翻到历史日期。增长指数必须从重新加载后的当日页开始，
  // 否则两个维度会被错误地错位约 30 天。
  try { await page.goto(KY_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }); } catch {}
  throwIfAborted(signal);
  // 增长指数是酷云全端热度页的独立指标，保留它自己的日期口径。
  let growthSeries = [];
  try {
    await ensureKyMode(page, "growth", signal);
    growthSeries = await collectHistory(page, title, "growth", KY_RECENT_HISTORY_DAYS, signal);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    // 增长指数是附加维度，页面改版或 iframe 尚未恢复时不阻断全端热度。
    growthSeries = [];
  }
  const growth = growthSeries[0]?.value ?? null;
  const growthDate = growthSeries[0]?.date ?? null;
  refreshLastUse();

  return {
    title,
    platform: "全端",
    source: "ky",
    sourceUrl: KY_URL,
    historyDays: KY_RECENT_HISTORY_DAYS,
    coverageNote: `按酷云网页端当前日期向前读取 ${KY_RECENT_HISTORY_DAYS} 天`,
    fetchedAt: new Date().toISOString(),
    metrics: [
      { name: "酷云全端热度", value: realtime, date: realtimeDate, sourceUrl: KY_URL },
      { name: "酷云增长指数", value: growth, date: growthDate, sourceUrl: KY_URL },
    ],
    series: [
      ...realtimeSeries.map((row) => ({ name: "酷云全端热度", ...row, sourceUrl: KY_URL })),
      ...growthSeries.map((row) => ({ name: "酷云增长指数", ...row, sourceUrl: KY_URL })),
    ],
    notices: [
      realtime == null ? "酷云全端热度页面未找到该剧" : null,
      growth == null ? "酷云增长指数榜当前未找到该剧" : null,
    ].filter(Boolean),
  };
}

// 串行由 server 的共享浏览器队列统一负责，避免在这里再叠一层不可见等待。
export async function collectKy(title, platform = "优酷", { signal } = {}) {
  try {
    return await collectKyOnce(title, platform, { signal });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/frame was detached|execution context was destroyed|target page, context or browser has been closed/i.test(message)) throw error;
    // 公网页刷新偶尔会重建 iframe；共享队列已保证没有并发导航，重建后安全重试一次。
    return collectKyOnce(title, platform, { signal });
  }
}
