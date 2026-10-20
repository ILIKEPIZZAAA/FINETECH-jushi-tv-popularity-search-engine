// 采集服务入口：一个零框架的 localhost HTTP 服务。
//   方式一 启动：npm install && npm start            （默认 127.0.0.1:8890）
//   方式二 采集：curl 'http://127.0.0.1:8890/collect/all?title=交锋'
//
// 依赖真实客户端工具需要的系统 Chrome（无头自动），所以 maoyan/浏览器型源默认都能跑；
// 只有你不需要浏览器源、只想用 HTTP 直连源时，可设 DISABLE_BROWSER=1 跳过浏览器启动。

import http from "node:http";
import { collectGuduo, guduoHistory } from "./providers/guduo.js";
import { collectMaoyan, maoyanDetail, maoyanMetricDetail, maoyanTvInfo } from "./providers/maoyan.js";
import { collectTvRatings } from "./providers/tv-ratings.js";
import { resolveSeriesId, verifySeriesIdDetailed, getResolutionFailure, getResolutionDiagnostics } from "./providers/maoyan-resolver.js";
import { collectKy, collectKyHistory } from "./providers/ky.js";
import { collectVerified } from "./collection-verification.js";
import { teardown } from "./browser.js";
import { SerialBrowserTaskQueue } from "./browser-task-queue.js";
import { createInFlightTaskRunner } from "./in-flight-tasks.js";

const PORT = Number(process.env.PORT || 8890);
const HOST = process.env.HOST || "127.0.0.1";
const DISABLE_BROWSER = process.env.DISABLE_BROWSER === "1";

// Maoyan 详情与酷云共用同一张 Playwright 页面，实际导航仍要串行，避免 iframe
// 被另一来源导航后失效。队列有容量和最长等待时间：调用方超时后尚未开始的旧任务
// 不会继续占用浏览器。MDB resolver 是 HTTP 请求，不进入这条队列。
const browserTaskQueue = new SerialBrowserTaskQueue({
  maxPending: Number(process.env.BROWSER_QUEUE_MAX_PENDING || 32),
  defaultMaxWaitMs: Number(process.env.BROWSER_QUEUE_MAX_WAIT_MS || 600_000),
  onIdle: teardown,
});
function enqueueBrowserTask(fn, options = {}) {
  return browserTaskQueue.enqueue(fn, options);
}

// 前端切页、自动补采与用户手动点击可能同时抵达同一来源。浏览器任务本来必须串行，
// 这里再按“来源 + 作品 + 指标”合并相同的在途请求，避免重复导航和重复触发风控。
const dedupeInFlight = createInFlightTaskRunner();
const taskProgress = new Map();
function updateTaskProgress(key, update) {
  const previous = taskProgress.get(key) || {};
  taskProgress.set(key, { ...previous, ...update, updatedAt: new Date().toISOString() });
  if (taskProgress.size > 128) {
    const oldest = taskProgress.keys().next().value;
    taskProgress.delete(oldest);
  }
}

const json = (res, status, body) => {
  if (res.destroyed || res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(payload);
};

function kyHistoryTimeoutMs(from, to) {
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
    || start.toISOString().slice(0, 10) !== from
    || end.toISOString().slice(0, 10) !== to
    || from > to) return 600_000;
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  // 酷云只能通过“前一天”逐日翻页；长周期需要放宽 HTTP/队列期限，避免半途取消整段复核。
  return Math.min(43_200_000, 600_000 + days * 5_000);
}

function requestAbortSignal(req, res) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once("aborted", abort);
  res.once("close", () => {
    if (!res.writableEnded) abort();
  });
  return controller.signal;
}

async function runOne(res, label, fn, title, signal, verificationRange = {}) {
  const t0 = Date.now();
  try {
    if (signal?.aborted) return;
    const r = await collectVerified(() => fn(title), verificationRange);
    if (signal?.aborted) return;
    json(res, 200, { ok: true, label, data: r, ms: Date.now() - t0 });
  } catch (e) {
    if (signal?.aborted) return;
    json(res, 502, { ok: false, label, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 });
  }
}

// 猫眼所有详情接口统一由 resolver 产生 ID，调用方必须提供剧名。
async function resolveMaoyanRequestId(title, sourceUrl = "", requestedSeriesId = 0) {
  const directId = Number(requestedSeriesId);
  if (!title) return 0;
  // 旧 ID 只能作为候选，不能跳过 tvinfo 的三项验货。
  if (Number.isInteger(directId) && directId > 0) {
    const checked = await verifySeriesIdDetailed(directId, title, sourceUrl);
    if (checked.ok) return directId;
  }
  const resolved = await resolveSeriesId(title, { sourceUrl });
  return resolved?.seriesId || 0;
}

// 官方 MDB 搜索只走 HTTP，不能与浏览器详情页/酷云任务争用页面队列。
function resolveMaoyanRequestIdQueued(title, sourceUrl = "", requestedSeriesId = 0) {
  return resolveMaoyanRequestId(title, sourceUrl, requestedSeriesId);
}

async function runAll(res, title, skipLabels = [], requestedSeriesId = 0, sourceUrl = "", signal) {
  const results = {};
  const t0 = Date.now();
  const jobs = [];
  if (!skipLabels.includes("guduo")) jobs.push(["guduo", () => dedupeInFlight(`guduo:daily:${title}`, (taskSignal) => collectGuduo(title, { signal: taskSignal }), signal)]);
  if (!DISABLE_BROWSER && !skipLabels.includes("maoyan")) jobs.push(["maoyan", async () => {
    const actualId = await resolveMaoyanRequestIdQueued(title, sourceUrl, requestedSeriesId);
    if (!actualId) throw new Error(`无法解析《${title}》的猫眼 seriesId`);
    return dedupeInFlight(`maoyan:daily:${actualId}`, (taskSignal) => enqueueBrowserTask(() => collectMaoyan(title, actualId), { label: `猫眼《${title}》`, signal: taskSignal }), signal);
  }]);
  const settled = await Promise.allSettled(jobs.map(([, fn]) => collectVerified(() => fn(title))));
  jobs.forEach(([label, _], i) => {
    const s = settled[i];
    results[label] =
      s.status === "fulfilled"
        ? { ok: true, data: s.value }
        : { ok: false, error: s.reason instanceof Error ? s.reason.message : String(s.reason) };
  });
  if (!signal?.aborted) json(res, 200, { ok: true, type: "multi", results, skipped: skipLabels, ms: Date.now() - t0, note: "各源独立；失败源会在 results 里标 ok:false" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const u = url.pathname;
  const q = url.searchParams;
  const title = (q.get("title") || "").trim();
  const signal = requestAbortSignal(req, res);

  if (u === "/ping" || u === "/health") {
    return json(res, 200, { ok: true, service: "drama-heat-collector", pid: process.pid, browserQueue: browserTaskQueue.snapshot() });
  }
  if (u === "/progress") {
    const key = q.get("key") || "";
    const progress = taskProgress.get(key);
    return json(res, 200, { ok: true, progress: progress ? { ...progress, waitingTasks: browserTaskQueue.snapshot().pending } : null });
  }
  if (u === "/collect/guduo") {
    if (!title) return json(res, 400, { ok: false, error: "缺少 ?title=" });
    return runOne(res, "guduo", (item) => dedupeInFlight(`guduo:daily:${item}`, (taskSignal) => collectGuduo(item, { signal: taskSignal }), signal), title, signal);
  }
  if (u === "/collect/maoyan") {
    if (!title) return json(res, 400, { ok: false, error: "缺少 ?title=" });
    if (DISABLE_BROWSER) return json(res, 400, { ok: false, error: "DISABLE_BROWSER=1，浏览器源已关闭" });
    const requestedSeriesId = Number(q.get("seriesId") || 0);
    const sourceUrl = (q.get("sourceUrl") || "").trim();
    const actualId = await resolveMaoyanRequestIdQueued(title, sourceUrl, requestedSeriesId);
    if (!actualId) return json(res, 404, { ok: false, error: `无法解析《${title}》的猫眼 seriesId`, resolutionError: getResolutionFailure(title) || "NOT_FOUND", diagnostics: getResolutionDiagnostics(title) });
    return runOne(res, "maoyan", (item) => dedupeInFlight(`maoyan:daily:${actualId}`, (taskSignal) => enqueueBrowserTask(() => collectMaoyan(item, actualId), { label: `猫眼《${item}》`, signal: taskSignal }), signal), title, signal);
  }
  if (u === "/collect/all") {
    if (!title) return json(res, 400, { ok: false, error: "缺少 ?title=" });
    const skip = (q.get("skip") || "").split(",").map((item) => item.trim()).filter(Boolean);
    return runAll(res, title, skip, Number(q.get("seriesId") || 0), (q.get("sourceUrl") || "").trim(), signal);
  }
  if (u === "/ratings/collect") {
    if (!title) return json(res, 400, { ok: false, error: "缺少 ?title=" });
    const from = (q.get("from") || "").trim();
    const to = (q.get("to") || "").trim();
    if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || (from && to && from > to)) {
      return json(res, 400, { ok: false, error: "台端逐日核验日期范围无效" });
    }
    return runOne(res, "tv-ratings", (item) => dedupeInFlight(`tv-ratings:${item}`, () => collectTvRatings(item), signal), title, signal, { from, to });
  }
  if (u === "/ky/collect") {
    if (!title) return json(res, 400, { ok: false, error: "缺少 ?title=" });
    const platform = (q.get("platform") || "优酷").trim();
    return runOne(res, "ky", (item) => dedupeInFlight(`ky:${item}:${platform}`, (taskSignal) => enqueueBrowserTask(() => collectKy(item, platform, { signal: taskSignal }), { label: `酷云《${item}》`, maxWaitMs: 600_000, signal: taskSignal }), signal), title, signal);
  }
  if (u === "/ky/history") {
    const from = (q.get("from") || "").trim();
    const to = (q.get("to") || "").trim();
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return json(res, 400, { ok: false, error: "酷云历史采集需要 title、有效 from、to 日期" });
    }
    const t0 = Date.now();
    const timeoutMs = kyHistoryTimeoutMs(from, to);
    const progressKey = `ky:history:${title}:${from}:${to}`;
    if (!dedupeInFlight.has(progressKey)) updateTaskProgress(progressKey, {
      source: "酷云历史", state: "queued", title, from, to, pass: 0,
      totalDays: Math.floor((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1,
      checkedDays: 0, currentDate: null, metric: null, startedAt: new Date().toISOString(),
    });
    try {
      const data = await dedupeInFlight(progressKey, (sharedSignal) => collectVerified(
        ({ pass }) => {
          updateTaskProgress(progressKey, { state: "queued", pass, metric: null, checkedDays: 0, currentDate: null, hitDays: 0, noDataDays: 0 });
          return enqueueBrowserTask(({ signal: taskSignal }) => collectKyHistory(title, from, to, {
            signal: taskSignal,
            onProgress: (progress) => updateTaskProgress(progressKey, { ...progress, pass }),
          }), { label: `酷云历史《${title}》`, maxWaitMs: timeoutMs, signal: sharedSignal });
        },
        { from, to },
      ), signal);
      updateTaskProgress(progressKey, {
        state: data.verification?.verified ? "complete" : "incomplete",
        pass: data.verification?.passes || 2,
        error: data.verification?.verified ? null : data.verification?.message || "仍有日期未通过核验",
      });
      return json(res, 200, { ok: true, type: "ky.history", ...data, ms: Date.now() - t0 });
    } catch (error) {
      updateTaskProgress(progressKey, { state: "failed", error: error instanceof Error ? error.message : String(error) });
      return json(res, 502, { ok: false, type: "ky.history", error: error instanceof Error ? error.message : String(error), ms: Date.now() - t0 });
    }
  }
  // 骨朵历史回填：从 ?from=（首播日 YYYY-MM-DD）到今天逐日取该剧骨朵热度/排名
  if (u === "/guduo/history") {
    const from = (q.get("from") || "").trim();
    const to = (q.get("to") || "").trim();
    const hadData = q.get("hadData") === "1";
    const emptyStreak = Math.max(0, Math.min(14, Number(q.get("emptyStreak")) || 0));
    if (!title || !from) return json(res, 400, { ok: false, error: "缺少 ?title= 和 ?from=YYYY-MM-DD" });
    const t0 = Date.now();
    try {
      const out = await dedupeInFlight(`guduo:history:${title}:${from}:${to}:${hadData}:${emptyStreak}`, (taskSignal) => collectVerified(
        () => guduoHistory(title, from, to, { signal: taskSignal, hadData, emptyStreak }), { from, to },
      ), signal);
      return json(res, 200, { ok: true, type: "guduo.history", from, to: out.requestedTo, count: out.series.length, complete: out.complete, failedDates: out.failedDates, data: out, ms: Date.now() - t0 });
    } catch (e) {
      return json(res, 502, { ok: false, type: "guduo.history", error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 });
    }
  }
  // 猫眼 seriesId 解析：官方 MDB 搜索 → 精确剧名与类型评分 → 进程内短缓存
  if (u === "/maoyan/resolve") {
    if (!title) return json(res, 400, { ok: false, error: "缺少 ?title=" });
    const t0 = Date.now();
    try {
      const forceDiscovery = q.get("force") === "1";
      const sourceUrl = (q.get("sourceUrl") || "").trim();
      const result = await resolveSeriesId(title, { forceDiscovery, sourceUrl });
      if (!result) {
        const error = getResolutionFailure(title) || "NOT_FOUND";
        const note = error === "SOURCE_UNAVAILABLE"
          ? "猫眼官方 MDB 搜索暂时不可用；当前不能据此判断该剧没有猫眼 ID。"
          : "猫眼官方 MDB 搜索未返回精确同名候选；这不等于该剧一定没有猫眼 ID。";
        return json(res, 200, { ok: true, resolved: false, title, forceDiscovery, error, note, diagnostics: getResolutionDiagnostics(title), ms: Date.now() - t0 });
      }
      return json(res, 200, { ok: true, resolved: true, title, ...result, ms: Date.now() - t0 });
    } catch (e) {
      return json(res, 502, { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 });
    }
  }
  // 猫眼全量历史：由 resolver 生成 seriesId，再拉取开播以来每一天的热度/曝光/转评赞/发布量/弹幕
  if (u === "/maoyan/history") {
    const sourceUrl = (q.get("sourceUrl") || "").trim();
    const requestedSeriesId = Number(q.get("seriesId") || 0);
    const from = (q.get("from") || "").trim();
    const to = (q.get("to") || "").trim();
    if (!title) return json(res, 400, { ok: false, error: "缺少 ?title=；seriesId 由 resolver 统一解析" });
    const t0 = Date.now();
    try {
      const actualId = await resolveMaoyanRequestIdQueued(title, sourceUrl, requestedSeriesId);
      if (!actualId) return json(res, 404, { ok: false, error: `无法解析《${title}》的猫眼 seriesId`, resolutionError: getResolutionFailure(title) || "NOT_FOUND", diagnostics: getResolutionDiagnostics(title) });
      const data = await dedupeInFlight(`maoyan:history:${actualId}:${from}:${to}`, (taskSignal) => collectVerified(
        () => enqueueBrowserTask(() => maoyanDetail(actualId, { from, to }), { label: `猫眼历史《${title}》`, maxWaitMs: 600_000, signal: taskSignal }),
        { from, to },
      ), signal);
      return json(res, 200, { ok: true, type: "maoyan.history", ...data, ms: Date.now() - t0 });
    } catch (e) {
      return json(res, 502, { ok: false, type: "maoyan.history", error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 });
    }
  }
  // 猫眼详情页的独立明细：平台表现 / 有效播放
  if (u === "/maoyan/platform" || u === "/maoyan/effective") {
    const sourceUrl = (q.get("sourceUrl") || "").trim();
    const requestedSeriesId = Number(q.get("seriesId") || 0);
    if (!title) return json(res, 400, { ok: false, error: "缺少 ?title=；seriesId 由 resolver 统一解析" });
    const metric = u.endsWith("platform") ? "platform" : "effective";
    const t0 = Date.now();
    try {
      const actualId = await resolveMaoyanRequestIdQueued(title, sourceUrl, requestedSeriesId);
      if (!actualId) return json(res, 404, { ok: false, error: `无法解析《${title}》的猫眼 seriesId`, resolutionError: getResolutionFailure(title) || "NOT_FOUND", diagnostics: getResolutionDiagnostics(title) });
      const from = (q.get("from") || "").trim();
      const to = (q.get("to") || "").trim();
      const data = await dedupeInFlight(`maoyan:${metric}:${actualId}:${from}:${to}`, (taskSignal) => collectVerified(
        () => enqueueBrowserTask(() => maoyanMetricDetail(actualId, metric), { label: `猫眼${metric}《${title}》`, maxWaitMs: 600_000, signal: taskSignal }),
        { from, to },
      ), signal);
      return json(res, 200, { ok: true, type: `maoyan.${metric}`, ...data, ms: Date.now() - t0 });
    } catch (e) {
      return json(res, 502, { ok: false, type: `maoyan.${metric}`, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 });
    }
  }
  if (u === "/maoyan/tvinfo") {
    const sourceUrl = (q.get("sourceUrl") || "").trim();
    const requestedSeriesId = Number(q.get("seriesId") || 0);
    if (!title) return json(res, 400, { ok: false, error: "缺少 ?title=；seriesId 由 resolver 统一解析" });
    const t0 = Date.now();
    try {
      const actualId = await resolveMaoyanRequestIdQueued(title, sourceUrl, requestedSeriesId);
      if (!actualId) return json(res, 404, { ok: false, error: `无法解析《${title}》的猫眼 seriesId`, resolutionError: getResolutionFailure(title) || "NOT_FOUND", diagnostics: getResolutionDiagnostics(title) });
      const from = (q.get("from") || "").trim();
      const to = (q.get("to") || "").trim();
      if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || (from && to && from > to)) {
        return json(res, 400, { ok: false, error: "猫眼台端逐日核验日期范围无效" });
      }
      const data = await dedupeInFlight(`maoyan:tvinfo:${actualId}:${from}:${to}`, (taskSignal) => collectVerified(
        () => enqueueBrowserTask(() => maoyanTvInfo(actualId), { label: `猫眼台端《${title}》`, maxWaitMs: 600_000, signal: taskSignal }),
        { from, to },
      ), signal);
      return json(res, 200, { ok: true, type: "maoyan.tvinfo", ...data, ms: Date.now() - t0 });
    } catch (e) {
      return json(res, 502, { ok: false, type: "maoyan.tvinfo", error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 });
    }
  }
  if (u === "/maoyan/catalog") return json(res, 410, { ok: false, error: "本地猫眼 Catalog 已移除，请使用 /maoyan/resolve 的官方 MDB 搜索链路。" });

  if (u === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(
      "<h1>drama-heat-collector</h1><p>开源电视剧数据采集服务。已接：guduo、maoyan 网播看板，以及公开台端逐日收视表。</p>" +
        "<p>用法：" +
        "<code>/collect/all?title=交锋</code> · " +
        "<code>/guduo/history?title=交锋&from=2026-09-06</code> · " +
        "<code>/maoyan/resolve?title=交锋</code> · " +
        "<code>/maoyan/history?title=交锋</code> · " +
        "<code>/maoyan/catalog</code></p>" +
        "<p>猫眼身份来自官方 MDB 搜索页，解析结果只保留进程内短缓存，不写本地人工目录。</p>"
    );
  }
  return json(res, 404, { ok: false, error: `未知路径 ${u}` });
});

// 优雅退出
process.on("SIGINT", async () => {
  await teardown();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await teardown();
  process.exit(0);
});

server.listen(PORT, HOST, () => {
  console.log(`drama-heat-collector 已启动 http://${HOST}:${PORT}   (DISABLE_BROWSER=${DISABLE_BROWSER ? "1" : "0"})`);
});
