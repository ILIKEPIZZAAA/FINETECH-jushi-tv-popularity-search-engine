import { createInFlightTaskRunner } from "../in-flight-tasks.js";

// 骨朵热度（HTTP 直连公开接口）。已实测可用、无需登录。
// 返回当日（或在播最近一次上榜日）《剧名》的骨朵全网热度分与全网排名。

const BASE = "https://d2.guduomedia.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function normalize(value = "") {
  return value
    .replace(/[《》·•・\s,，:：;；/／|｜（）()\[\]【】\-—_]/g, "")
    .toLowerCase();
}
const REQUEST_TIMEOUT_MS = 10_000;
const REQUEST_ATTEMPTS = 5;
const HISTORY_CATEGORIES = ["NETWORK_DRAMA", "TV_DRAMA"];
const ALL_DRAMAS_CATEGORY = "DRAMA";
const readBillboard = createInFlightTaskRunner();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url, signal) {
  let lastError;
  for (let attempt = 0; attempt < REQUEST_ATTEMPTS; attempt += 1) {
    signal?.throwIfAborted();
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { "User-Agent": UA, Accept: "application/json", Referer: `${BASE}/`, "X-Requested-With": "XMLHttpRequest" },
      });
      if (!res.ok) throw new Error(`骨朵接口返回 ${res.status}`);
      return await res.json();
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
      if (attempt + 1 < REQUEST_ATTEMPTS) await sleep(250 * (attempt + 1));
    }
  }
  throw lastError;
}

async function billboard(category, date, signal) {
  const url = `${BASE}/m/v3/billboard/list?type=DAILY&category=${encodeURIComponent(category)}&date=${date}&orderTitle=gdi&platformId=0`;
  const json = await readBillboard(`${category}:${date}`, (taskSignal) => getJson(url, taskSignal), signal);
  if (json.code !== 0) throw new Error(`骨朵榜单读取失败：${json.msg || `code ${json.code}`}`);
  return (json.data || []).filter(Boolean);
}

export function recentShanghaiDates(count, now = new Date()) {
  const today = toShanghaiDate(now);
  const out = [];
  for (let o = 0; o < count; o += 1) {
    // 先确定上海的自然日，再按日历日递减；避免把 UTC 时刻再次加 8 小时导致跨到未来。
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - o);
    out.push(date.toISOString().slice(0, 10));
  }
  return out;
}

const CATEGORIES = ["NETWORK_DRAMA", "TV_DRAMA", "NETWORK_VARIETY"];

// 找某剧在某个日期的剧集榜单行。无数据和请求失败必须分开返回：前者是合法断点，
// 后者需要重试，不能混入“未上榜”。
async function findOnDay(titleKey, date, signal) {
  const failedCategories = [];
  let heatRow = null;
  for (const category of HISTORY_CATEGORIES) {
    try {
      const items = await billboard(category, date, signal);
      const hit = items.find((it) => normalize(it.name) === titleKey);
      if (hit) {
        const heat = hit.gdiFloat ?? Number(hit.gdi);
        if (!Number.isFinite(Number(heat))) continue;
        heatRow = {
            date,
            heat: Number(heat),
            rise: hit.rise ?? null,
            category: hit.category || category,
            showId: hit.showId,
            sourceUrl: `${BASE}/m/v3/billboard/list?type=DAILY&category=${encodeURIComponent(category)}&date=${date}&orderTitle=gdi&platformId=0`,
          };
        break;
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      failedCategories.push({ category, error: error instanceof Error ? error.message : String(error) });
    }
  }
  let rankRow = null;
  let rankFailure = null;
  try {
    const items = await billboard(ALL_DRAMAS_CATEGORY, date, signal);
    rankRow = items.find((it) => normalize(it.name) === titleKey) || null;
  } catch (error) {
    if (signal?.aborted) throw error;
    rankFailure = { category: ALL_DRAMAS_CATEGORY, error: error instanceof Error ? error.message : String(error) };
  }
  const row = heatRow || (rankRow ? { date, heat: null, category: ALL_DRAMAS_CATEGORY } : null);
  if (row) {
    row.rank = rankRow?.rank ?? null;
    row.rankSourceUrl = `${BASE}/m/v3/billboard/list?type=DAILY&category=${ALL_DRAMAS_CATEGORY}&date=${date}&orderTitle=gdi&platformId=0`;
  }
  return { date, row, failedCategories, rankFailure };
}

// 上海自然日工具
function toShanghaiDate(d) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseIso(value);
  return toShanghaiDate(parsed) === value;
}
function parseIso(iso) {
  const [y, m, day] = iso.split("-").map(Number);
  // 上海中午作为当天代表，避免跨日漂移
  return new Date(Date.UTC(y, m - 1, day, 4, 0, 0)); // UTC+8 中午 = UTC 04:00
}
function addDays(iso, n) {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toShanghaiDate(d);
}

// 从 startIso 到明确的截止日（包含今天）逐日找这部剧在骨朵的值，返回稀疏历史。
// 每天可能缺（开播前/掉出榜单/分类不符），缺失就跳过该天。
export async function guduoHistory(title, startIso, endIso, { signal, hadData = false, emptyStreak = 0 } = {}) {
  signal?.throwIfAborted();
  const key = normalize(title);
  const today = toShanghaiDate(new Date());
  const start = (startIso || "").slice(0, 10);
  if (!isValidIsoDate(start)) {
    throw new Error(`需要有效的起始日期（YYYY-MM-DD），收到“${start}”`);
  }
  const requestedEnd = (endIso || "").slice(0, 10);
  if (requestedEnd && !isValidIsoDate(requestedEnd)) {
    throw new Error(`需要有效的结束日期（YYYY-MM-DD），收到“${requestedEnd}”`);
  }
  if (requestedEnd && requestedEnd < start) throw new Error(`结束日期 ${requestedEnd} 早于起始日期 ${start}`);
  const end = requestedEnd && requestedEnd <= today ? requestedEnd : today;
  if (start > end) return { title, series: [], attemptedDates: 0, failedDates: [], complete: true, requestedFrom: start, requestedTo: end };

  const dates = [];
  let cursor = start;
  while (cursor <= end) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  // Calendar-order reads make the 15-successful-empty-day stop exact. Failures
  // break the empty streak; a never-listed title still scans the whole range.
  const outcomes = [];
  let seenData = Boolean(hadData), consecutiveEmpty = Math.max(0, Math.min(14, Number(emptyStreak) || 0));
  let stopDate = null;
  for (const date of dates) {
    signal?.throwIfAborted();
    const outcome = await findOnDay(key, date, signal);
    outcomes.push(outcome);
    const hasValue = outcome.row && [outcome.row.heat, outcome.row.rank].some((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
    if (hasValue) { seenData = true; consecutiveEmpty = 0; }
    else if (outcome.failedCategories.length || outcome.rankFailure) consecutiveEmpty = 0;
    else if (seenData) consecutiveEmpty += 1;
    if (seenData && consecutiveEmpty >= 15) { stopDate = date; break; }
  }
  const scannedDates = outcomes.map((outcome) => outcome.date);
  const inferredNoDataDates = stopDate ? dates.filter((date) => date > stopDate) : [];
  const noDataDates = [...outcomes.filter((outcome) => !outcome.row && !outcome.failedCategories.length && !outcome.rankFailure).map((outcome) => outcome.date), ...inferredNoDataDates];
  const series = outcomes.flatMap((outcome) => outcome?.row ? [outcome.row] : []);
  const failedDates = outcomes
    .filter((outcome) => outcome?.failedCategories.length)
    .map((outcome) => ({ date: outcome.date, failedCategories: outcome.failedCategories, dataAvailable: Boolean(outcome.row) }));
  const rankFailedDates = outcomes
    .filter((outcome) => outcome?.rankFailure)
    .map((outcome) => ({ date: outcome.date, error: outcome.rankFailure.error }));
  return { title, series, attemptedDates: outcomes.length, scannedDates, noDataDates, inferredNoDataDates,
    stopDate, stopReason: stopDate ? '15-consecutive-empty-after-hit' : null,
    continuity: { hadData: seenData, emptyStreak: consecutiveEmpty },
    failedDates, rankFailedDates, requestedFrom: start, requestedTo: end, complete: failedDates.length === 0 };
}

export async function collectGuduo(title, { signal } = {}) {
  signal?.throwIfAborted();
  const key = normalize(title);
  const triedDates = recentShanghaiDates(4);
  const tried = [];
  const failed = [];
  for (const category of CATEGORIES) {
    for (const date of triedDates) {
      tried.push(`${category}@${date}`);
      let items = [];
      try {
        items = await billboard(category, date, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        failed.push({ category, date, message: error instanceof Error ? error.message : String(error) });
        continue;
      }
      const hit = items.find((it) => normalize(it.name) === key);
      if (hit) {
        const heat = hit.gdiFloat ?? Number(hit.gdi);
        if (!Number.isFinite(Number(heat))) {
          throw new Error(`骨朵命中《${hit.name}》但没有可用热度分`);
        }
        let rank = null;
        let rankSourceUrl = `${BASE}/m/v3/billboard/list?type=DAILY&category=${ALL_DRAMAS_CATEGORY}&date=${date}&orderTitle=gdi&platformId=0`;
        try {
          const rankItems = await billboard(ALL_DRAMAS_CATEGORY, date, signal);
          rank = rankItems.find((item) => normalize(item.name) === key)?.rank ?? null;
        } catch (error) {
          if (signal?.aborted) throw error;
          failed.push({ category: ALL_DRAMAS_CATEGORY, date, message: error instanceof Error ? error.message : String(error) });
        }
        return {
          platform: "guduo",
          title: hit.name,
          date: hit.date || date,
          heat: Number(heat),
          rank,
          rankSourceUrl,
          ...(failed.length ? {
            coverageWarnings: [`骨朵较新日期榜单请求失败；当前返回 ${hit.date || date} 的最近命中值，未能确认它是最新日期。`, ...failed.map((item) => `${item.category} ${item.date}：${item.message}`)],
          } : {}),
          sourceUrl: `${BASE}/m/v3/billboard/list?category=${category}&date=${date}`,
          fetchedAt: new Date().toISOString(),
        };
      }
    }
  }
  if (failed.length) {
    throw new Error(`骨朵最近 4 天未能完整核查《${title}》：${failed.length}/${tried.length} 次榜单请求失败；当前不能判定为无榜单数据。`);
  }
  return {
    platform: "guduo",
    title,
    availability: "not-published",
    notice: `骨朵最近 4 天（${triedDates.at(-1)}—${triedDates[0]}）未找到《${title}》的榜单热度。`,
    checkedDates: triedDates,
    sourceUrl: `${BASE}/m/v3/billboard/list?type=DAILY&category=NETWORK_DRAMA&date=${triedDates[0]}&orderTitle=gdi&platformId=0`,
    fetchedAt: new Date().toISOString(),
  };
}
