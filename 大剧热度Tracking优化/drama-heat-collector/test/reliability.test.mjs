import assert from "node:assert/strict";
import test from "node:test";
import { SerialBrowserTaskQueue } from "../src/browser-task-queue.js";
import { collectGuduo, guduoHistory, recentShanghaiDates } from "../src/providers/guduo.js";
import { isHeatOnlyPlatformPayload, safeRenderedPlatformFallback, tvSlotFromLabels } from "../src/providers/maoyan.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("骨朵命中后连续15天成功空值便停止，并单独记录后续推定无值区间", async () => {
  const originalFetch = globalThis.fetch;
  const requested = new Set();
  globalThis.fetch = async (url) => {
    const date = new URL(String(url)).searchParams.get('date');
    requested.add(date);
    return new Response(JSON.stringify({ code: 0, data: date === '2023-06-01' ? [{ name: '测试剧', gdiFloat: 70, rank: 5 }] : [] }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await guduoHistory('测试剧', '2023-06-01', '2023-07-01');
    assert.equal(result.stopDate, '2023-06-16');
    assert.equal(result.attemptedDates, 16);
    assert.equal([...requested].sort().at(-1), '2023-06-16');
    assert.equal(result.inferredNoDataDates[0], '2023-06-17');
    assert.equal(result.inferredNoDataDates.at(-1), '2023-07-01');
    assert.equal(result.complete, true);
  } finally { globalThis.fetch = originalFetch; }
});

test("骨朵连续空值跨页累计，未曾命中时不会提前停止", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 0, data: [] }), { headers: { 'content-type': 'application/json' } });
  try {
    const crossing = await guduoHistory('测试剧', '2023-06-16', '2023-06-22', { hadData: true, emptyStreak: 14 });
    assert.equal(crossing.stopDate, '2023-06-16');
    assert.equal(crossing.attemptedDates, 1);
    const neverHit = await guduoHistory('测试剧', '2023-06-01', '2023-06-30');
    assert.equal(neverHit.stopDate, null);
    assert.equal(neverHit.attemptedDates, 30);
  } finally { globalThis.fetch = originalFetch; }
});

test("骨朵请求失败打断连续空值，不能触发15天无值停止规则", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new URL(String(url)).searchParams.get('date') === '2023-06-16'
    ? new Response('failure', { status: 503 })
    : new Response(JSON.stringify({ code: 0, data: [] }), { headers: { 'content-type': 'application/json' } });
  try {
    const result = await guduoHistory('测试剧', '2023-06-16', '2023-06-18', { hadData: true, emptyStreak: 14 });
    assert.equal(result.stopDate, null);
    assert.equal(result.attemptedDates, 3);
    assert.equal(result.complete, false);
    assert.deepEqual(result.inferredNoDataDates, []);
  } finally { globalThis.fetch = originalFetch; }
});

test("骨朵近期窗口按上海自然日递减，不会请求未来日期", () => {
  assert.deepEqual(
    recentShanghaiDates(4, new Date("2026-09-23T15:15:22.000Z")),
    ["2026-09-23", "2026-09-22", "2026-09-21", "2026-09-20"],
  );
  assert.deepEqual(
    recentShanghaiDates(3, new Date("2026-09-23T17:15:22.000Z")),
    ["2026-09-24", "2026-09-23", "2026-09-22"],
  );
});

test("骨朵近期窗口全部成功但没有命中时明确返回源端无数据", async () => {
  const originalFetch = globalThis.fetch;
  const requestedDates = new Set();
  globalThis.fetch = async (url) => {
    requestedDates.add(new URL(String(url)).searchParams.get("date"));
    return new Response(JSON.stringify({ code: 0, data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await collectGuduo("测试剧");
    assert.equal(result.availability, "not-published");
    assert.deepEqual(result.checkedDates, recentShanghaiDates(4));
    assert.deepEqual([...requestedDates].sort(), [...recentShanghaiDates(4)].sort());
    assert.match(result.notice, /未找到/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("骨朵近期窗口有接口失败时不降级成源端无数据", async () => {
  const originalFetch = globalThis.fetch;
  let failedAttempts = 0;
  const failedDate = recentShanghaiDates(4)[0];
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.searchParams.get("date") === failedDate && parsed.searchParams.get("category") === "NETWORK_DRAMA") {
      failedAttempts += 1;
      return new Response("upstream failure", { status: 503 });
    }
    return new Response(JSON.stringify({ code: 0, data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await assert.rejects(collectGuduo("测试剧"), /未能完整核查.*不能判定为无榜单数据/);
    assert.equal(failedAttempts, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("骨朵较新日期失败但旧日期命中时附带覆盖告警", async () => {
  const originalFetch = globalThis.fetch;
  const latestDate = recentShanghaiDates(4)[0];
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    const category = parsed.searchParams.get("category");
    const date = parsed.searchParams.get("date");
    if (date === latestDate && category === "NETWORK_DRAMA") return new Response("upstream failure", { status: 503 });
    return new Response(JSON.stringify({ code: 0, data: date === latestDate && category === "TV_DRAMA" ? [{ name: "测试剧", gdiFloat: 77, date }] : [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await collectGuduo("测试剧");
    assert.equal(result.heat, 77);
    assert.equal(result.date, latestDate);
    assert.match(result.coverageWarnings[0], /未能确认它是最新日期/);
    assert.equal(result.coverageWarnings.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("浏览器队列拒绝超出容量和过期任务，过期任务不会执行", async () => {
  const queue = new SerialBrowserTaskQueue({ maxPending: 1, defaultMaxWaitMs: 100 });
  let releaseFirst;
  const first = queue.enqueue(() => new Promise((resolve) => { releaseFirst = resolve; }), { label: "首个任务" });
  const second = queue.enqueue(() => "second", { label: "等待任务" });
  await assert.rejects(
    queue.enqueue(() => "third", { label: "溢出任务" }),
    (error) => error?.code === "QUEUE_FULL",
  );
  releaseFirst("first");
  assert.equal(await first, "first");
  assert.equal(await second, "second");

  const expiryQueue = new SerialBrowserTaskQueue({ maxPending: 2, defaultMaxWaitMs: 5 });
  let releaseGate;
  const gate = expiryQueue.enqueue(() => new Promise((resolve) => { releaseGate = resolve; }), { label: "阻塞任务" });
  let staleRan = false;
  const stale = expiryQueue.enqueue(() => { staleRan = true; return "stale"; }, { label: "过期任务", maxWaitMs: 5 });
  await sleep(15);
  releaseGate("done");
  assert.equal(await gate, "done");
  await assert.rejects(stale, (error) => error?.code === "QUEUE_WAIT_EXPIRED");
  assert.equal(staleRan, false);

  const cancelQueue = new SerialBrowserTaskQueue({ maxPending: 2, defaultMaxWaitMs: 100 });
  let releaseCancelGate;
  const cancelGate = cancelQueue.enqueue(() => new Promise((resolve) => { releaseCancelGate = resolve; }), { label: "取消前阻塞" });
  const controller = new AbortController();
  let cancelledRan = false;
  const cancelled = cancelQueue.enqueue(() => { cancelledRan = true; return "cancelled"; }, { label: "取消任务", signal: controller.signal });
  controller.abort();
  releaseCancelGate("released");
  assert.equal(await cancelGate, "released");
  await assert.rejects(cancelled, (error) => error?.code === "REQUEST_ABORTED");
  assert.equal(cancelledRan, false);
});

test("骨朵历史将同日部分分类失败标成未完成，即使另一分类已命中", async () => {
  const originalFetch = globalThis.fetch;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const yesterdayDate = new Date(`${today}T00:00:00Z`);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const from = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(yesterdayDate);
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    const category = parsed.searchParams.get("category");
    if (category === "NETWORK_DRAMA" && parsed.searchParams.get("date") === from) throw new Error("simulated network failure");
    if (parsed.searchParams.get("date") === from) return new Response(JSON.stringify({ code: 0, data: [{ name: "测试剧", gdiFloat: 88, date: from }] }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ code: 0, data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await guduoHistory("测试剧", from);
    assert.equal(result.complete, false);
    assert.equal(result.series.length, 1);
    assert.equal(result.failedDates.length, 1);
    assert.equal(result.failedDates[0].date, from);
    assert.equal(result.failedDates[0].dataAvailable, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("骨朵历史支持按日期页请求，并完整核查该页所有日期", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    requested.push(`${parsed.searchParams.get("category")}@${parsed.searchParams.get("date")}`);
    return new Response(JSON.stringify({ code: 0, data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await guduoHistory("测试剧", "2010-01-01", "2010-01-02");
    assert.equal(result.attemptedDates, 2);
    assert.equal(result.requestedFrom, "2010-01-01");
    assert.equal(result.requestedTo, "2010-01-02");
    assert.equal(result.complete, true);
    assert.deepEqual(requested.sort(), [
      "DRAMA@2010-01-01",
      "DRAMA@2010-01-02",
      "NETWORK_DRAMA@2010-01-01",
      "NETWORK_DRAMA@2010-01-02",
      "TV_DRAMA@2010-01-01",
      "TV_DRAMA@2010-01-02",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("骨朵热度沿用原分类，排名单独映射全部剧集全平台榜单", async () => {
  const originalFetch = globalThis.fetch;
  const date = "2010-01-01";
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    const category = parsed.searchParams.get("category");
    const data = category === "TV_DRAMA"
      ? [{ name: "测试剧", gdiFloat: 78.56, rank: 4, date }]
      : category === "DRAMA"
        ? [{ name: "测试剧", gdiFloat: 78.56, rank: 17, date }]
        : [];
    return new Response(JSON.stringify({ code: 0, data }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await guduoHistory("测试剧", date, date);
    assert.equal(result.series[0].heat, 78.56);
    assert.equal(result.series[0].rank, 17);
    assert.equal(result.complete, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("全剧排名接口失败时保留已抓到的骨朵热度，单独返回排名缺口", async () => {
  const originalFetch = globalThis.fetch;
  const date = "2010-01-01";
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    const category = parsed.searchParams.get("category");
    if (category === "DRAMA") return new Response("rank unavailable", { status: 503 });
    const data = category === "TV_DRAMA" ? [{ name: "测试剧", gdiFloat: 78.56, rank: 4, date }] : [];
    return new Response(JSON.stringify({ code: 0, data }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await guduoHistory("测试剧", date, date);
    assert.equal(result.complete, true);
    assert.equal(result.series[0].heat, 78.56);
    assert.equal(result.series[0].rank, null);
    assert.deepEqual(result.rankFailedDates.map((item) => item.date), [date]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("骨朵历史拒绝反向日期区间和非法日历日期", async () => {
  await assert.rejects(guduoHistory("测试剧", "2026-09-20", "2026-09-19"), /早于起始日期/);
  await assert.rejects(guduoHistory("测试剧", "2026-02-31", "2026-03-01"), /有效的起始日期/);
});

test("猫眼自身热度行不会被识别成平台表现数据", () => {
  assert.equal(isHeatOnlyPlatformPayload({ data: { rows: [{ dateTimeDesc: "2026-09-23", currHeat: 4000, currHeatDesc: "4000" }] } }), true);
  assert.equal(isHeatOnlyPlatformPayload({ data: { rows: [{ dateTimeDesc: "2026-09-23", currHeat: 4000, playCount: 1200 }] } }), false);
  assert.equal(isHeatOnlyPlatformPayload({ data: { rows: [] } }), false);
});

test("有效分平台响应与NaN猫眼热度响应并存时，不使用页签DOM兜底伪造平台序列", () => {
  const validPlatform = { data: { rows: [{ dateTimeDesc: "2026-09-23", platformHeat: 1200 }] } };
  const heatOnly = { data: { rows: [{ dateTimeDesc: "2026-09-23", currHeat: 4000, currHeatDesc: "4000" }] } };
  const renderedFallback = [{ date: "2026-09-23", value: "4000", platform: "腾讯视频", platformLabel: "腾讯视频" }];

  assert.deepEqual(safeRenderedPlatformFallback([validPlatform, heatOnly], renderedFallback), {
    series: [],
    mappingWarnings: ["1 条页面表格回退行因同时出现猫眼总热度响应而被排除；仅保留接口确认的平台行。"],
  });
  assert.deepEqual(safeRenderedPlatformFallback([validPlatform], renderedFallback), {
    series: renderedFallback,
    mappingWarnings: [],
  });
});

test("台端时段按猫眼当前频道的指标文案映射", () => {
  assert.equal(tvSlotFromLabels("黄金时段收视率", "黄金时段实时收视率明细"), "黄金时段");
  assert.equal(tvSlotFromLabels("CCTV-7 实时收视率明细", "实时收视率", "市占率"), "非黄金时段");
  assert.equal(tvSlotFromLabels("非黄金时段实时收视率"), "非黄金时段");
  assert.equal(tvSlotFromLabels("黄金时段收视率", "非黄金时段收视率"), "非黄金时段");
});
