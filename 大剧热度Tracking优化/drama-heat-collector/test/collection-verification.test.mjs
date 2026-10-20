import assert from "node:assert/strict";
import test from "node:test";
import { collectVerified, compareCollectionRows } from "../src/collection-verification.js";
import { maoyanHistoryCoverage } from "../src/providers/maoyan.js";

test("猫眼完整返回历史末日之后双轮均无数值时通过并标明每日无数据", async () => {
  const series = [{ date: "2026-03-06", heat: 70 }];
  // A compact example of the confirmed source-ended-history policy.
  const payload = { series, ...maoyanHistoryCoverage(series, "2026-03-06", "2026-03-08") };
  const result = await collectVerified(async () => structuredClone(payload), { from: "2026-03-06", to: "2026-03-08" });
  assert.equal(result.verification.verified, true);
  assert.equal(result.verification.passes, 2);
  assert.deepEqual(result.verification.noDataDates, ["2026-03-07", "2026-03-08"]);
});

test("成功读取分平台历史后同一日期平台连续无记录也判为无数据通过", async () => {
  const result = await collectVerified(async () => ({ sourceReadSuccessful: true, metric: 'effective', series: [
    { date: '2026-09-01', platform: '腾讯视频', value: 100 },
    { date: '2026-09-01', platform: '爱奇艺', value: 80 },
    { date: '2026-09-02', platform: '腾讯视频', value: 110 },
  ] }), { from: '2026-09-01', to: '2026-09-02' });
  assert.equal(result.verification.verified, true);
  assert.equal(result.verification.passes, 2);
  assert.deepEqual(result.verification.noDataByMetric['effective:爱奇艺'], ['2026-09-02']);
});

test("今日数值与摘要差异小于1%时两轮通过并保留首遍快照", async () => {
  let pass = 0;
  const result = await collectVerified(async () => ({
    complete: true,
    series: [{ date: "2026-10-13", platform: "腾讯视频", value: ++pass === 1 ? 1000 : 1009 }],
    summary: { subItems: [{ mainTitle: "累计有效播放", mainData: pass === 1 ? "1.00亿" : "1.009亿", mainDataNum: pass === 1 ? 100000000 : 100900000 }] },
  }), { from: "2026-10-13", to: "2026-10-13", today: "2026-10-13" });
  assert.equal(result.verification.verified, true);
  assert.equal(result.verification.passes, 2);
  assert.equal(result.series[0].value, 1000);
  assert.equal(result.summary.subItems[0].mainDataNum, 100000000);
  assert.ok(result.verification.toleranceAccepted.length > 0);
});

test("今日第二遍失败后第三遍成功且小于1%，使用两次成功观察核验首遍摘要", async () => {
  let pass = 0;
  const result = await collectVerified(async () => {
    if (++pass === 2) throw new Error('timeout');
    return { complete: true, series: [{ date: '2026-10-13', value: pass === 1 ? 1000 : 1005 }], summary: { value: pass === 1 ? 1000 : 1005 } };
  }, { from: '2026-10-13', to: '2026-10-13', today: '2026-10-13' });
  assert.equal(result.verification.verified, true);
  assert.equal(result.verification.passes, 3);
  assert.equal(result.summary.value, 1000);
});

test("今日恰好1%、大于1%、零变非零及空值变数值均不允许替换首遍", async () => {
  for (const [first, later] of [[1000, 1010], [0.33, 0.3333], [1000, 1020], [0, 1], [null, 1]]) {
    let pass = 0;
    const result = await collectVerified(async () => ({ complete: true,
      series: [{ date: "2026-10-13", value: ++pass === 1 ? first : later }],
    }), { from: "2026-10-13", to: "2026-10-13", today: "2026-10-13" });
    assert.equal(result.verification.verified, false, `${first} -> ${later}`);
    assert.equal(result.verification.passes, 3);
    assert.deepEqual(result.series, []);
  }
});

test("历史日即便差异小于1%仍严格核验，今日第三遍也须相对首遍小于1%", async () => {
  let pass = 0;
  const result = await collectVerified(async () => ({ complete: true, series: [
    { date: "2026-10-12", value: 1000 + ++pass },
    { date: "2026-10-13", value: pass === 3 ? 1020 : 1000 },
  ] }), { from: "2026-10-12", to: "2026-10-13", today: "2026-10-13" });
  assert.equal(result.verification.verified, false);
  assert.deepEqual(result.verification.unresolvedDates, ["2026-10-12", "2026-10-13"]);
});

test("来源明确返回相同日期指标空值时通过，零值保留为数值", async () => {
  const result = await collectVerified(async () => ({ complete: true, series: [
    { date: "2026-10-12", name: "酷云全端热度", value: null },
    { date: "2026-10-12", name: "酷云增长指数", value: 0 },
  ] }), { from: "2026-10-12", to: "2026-10-12" });
  assert.equal(result.verification.verified, true);
  assert.deepEqual(result.verification.noDataByMetric["酷云全端热度"], ["2026-10-12"]);
  assert.deepEqual(result.series.map((row) => row.value), [0]);
});

test("重复扫描完全一致时，两轮即通过并记录空白日期", async () => {
  let calls = 0;
  const result = await collectVerified(async () => {
    calls += 1;
    return { complete: true, series: [{ date: "2026-09-01", heat: 70 }, { date: "2026-09-03", heat: 72 }] };
  }, { from: "2026-09-01", to: "2026-09-03" });

  assert.equal(calls, 2);
  assert.equal(result.verification.verified, true);
  assert.equal(result.verification.passes, 2);
  assert.deepEqual(result.verification.checkedDates, ["2026-09-01", "2026-09-02", "2026-09-03"]);
  assert.deepEqual(result.verification.noDataDates, ["2026-09-02"]);
  assert.deepEqual(result.series.map((row) => row.date), ["2026-09-01", "2026-09-03"]);
});

test("累计摘要前两轮不一致时补核一次，并采用两次一致的摘要", async () => {
  let pass = 0;
  const result = await collectVerified(async () => ({
    complete: true,
    series: [{ date: "2026-09-01", platform: "腾讯视频", metric: "累计有效播放", value: 710_000_000 }],
    summary: { metric: "累计有效播放", platform: "全平台", value: ++pass === 1 ? 710_000_000 : 926_000_000 },
  }), { from: "2026-09-01", to: "2026-09-01" });

  assert.equal(result.verification.verified, true);
  assert.equal(result.verification.passes, 3);
  assert.deepEqual(result.series.map((row) => row.value), [710_000_000]);
  assert.equal(result.verification.summaryVerified, true);
  assert.equal(result.summary.value, 926_000_000);
});

test("两轮部分失败时保留其它已一致日期并把失败日留在未核验状态", async () => {
  const result = await collectVerified(async () => ({
    complete: false,
    failedDates: ["2026-09-02"],
    scannedDates: ["2026-09-01"],
    series: [{ date: "2026-09-01", platform: "爱奇艺", metric: "有效播放", value: 100 }],
  }), { from: "2026-09-01", to: "2026-09-02" });

  assert.equal(result.verification.verified, false);
  assert.equal(result.complete, false);
  assert.deepEqual(result.series.map((row) => row.date), ["2026-09-01"]);
  assert.deepEqual(result.verification.unresolvedDates, ["2026-09-02"]);
  assert.deepEqual(result.verification.noDataDates, []);
});

test("分别核验每日指标的无数据状态，不把一个指标的空值套到另一个指标", async () => {
  const result = await collectVerified(async () => ({
    complete: true,
    series: [{ date: "2026-09-01", name: "酷云全端热度", value: 9000 }],
    noDataByMetric: { 酷云全端热度: [], 酷云增长指数: ["2026-09-01"] },
  }), { from: "2026-09-01", to: "2026-09-01" });

  assert.equal(result.verification.verified, true);
  assert.deepEqual(result.verification.noDataDates, []);
  assert.deepEqual(result.verification.noDataByMetric, { 酷云增长指数: ["2026-09-01"] });
});

test("同一平台在某日连续缺失且来源未给明确无数据标记时不能判为完整", async () => {
  let calls = 0;
  const result = await collectVerified(async () => {
    calls += 1;
    return {
      metric: "effective",
      series: [
        { date: "2026-09-01", platform: "腾讯视频", effectivePlay: 100 },
        { date: "2026-09-01", platform: "爱奇艺", effectivePlay: 80 },
        { date: "2026-09-02", platform: "腾讯视频", effectivePlay: 110 },
      ],
    };
  }, { from: "2026-09-01", to: "2026-09-02" });

  assert.equal(calls, 3);
  assert.equal(result.verification.passes, 3);
  assert.equal(result.verification.verified, false);
  assert.deepEqual(result.verification.unresolvedDates, ["2026-09-02"]);
  assert.deepEqual(result.verification.noDataDates, []);
  assert.deepEqual(result.verification.metricCoverageGaps.map(({ date, metric }) => ({ date, metric })), [
    { date: "2026-09-02", metric: "effective:爱奇艺" },
  ]);
});

test("三次来源读数各不相同时停止补核并明确标为未收敛", async () => {
  let calls = 0;
  const result = await collectVerified(async () => {
    calls += 1;
    return { complete: true, series: [{ date: "2026-09-01", heat: 69 + calls }] };
  }, { from: "2026-09-01", to: "2026-09-01" });

  assert.equal(calls, 3);
  assert.equal(result.verification.passes, 3);
  assert.equal(result.verification.verified, false);
  assert.equal(result.complete, false);
  assert.deepEqual(result.verification.gapDates, ["2026-09-01"]);
  assert.deepEqual(result.verification.unresolvedDates, ["2026-09-01"]);
  assert.deepEqual(result.series, []);
  assert.equal(result.pendingSeries[0].heat, 72);
});

test("第三轮仍未读到缺口日时保留未核实日期", async () => {
  let calls = 0;
  const result = await collectVerified(async ({ pass }) => {
    calls += 1;
    if (pass === 1) return { complete: true, series: [{ date: "2026-09-01", heat: 70 }, { date: "2026-09-02", heat: 71 }] };
    return { complete: true, series: [{ date: "2026-09-01", heat: 70 }, ...(pass === 2 ? [{ date: "2026-09-02", heat: 72 }] : [])] };
  }, { from: "2026-09-01", to: "2026-09-02" });

  assert.equal(calls, 3);
  assert.equal(result.verification.verified, false);
  assert.equal(result.complete, false);
  assert.deepEqual(result.verification.gapDates, ["2026-09-02"]);
  assert.deepEqual(result.verification.unresolvedDates, ["2026-09-02"]);
  assert.deepEqual(result.series.map((row) => row.date), ["2026-09-01"]);
  assert.deepEqual(result.pendingSeries.map((row) => row.date), ["2026-09-02"]);
});

test("差异补核有界，只进行一次第三轮", async () => {
  let calls = 0;
  const result = await collectVerified(async () => {
    calls += 1;
    return { complete: true, series: [{ date: "2026-09-01", heat: 69 + calls }] };
  }, { from: "2026-09-01", to: "2026-09-01" });

  assert.equal(calls, 3);
  assert.equal(result.verification.verified, false);
  assert.equal(result.complete, false);
  assert.equal(result.verification.passes, 3);
  assert.deepEqual(result.verification.unresolvedDates, ["2026-09-01"]);
});

test("未收敛日期暴露最新源端候选值，同时稳定日期仍可用", async () => {
  let calls = 0;
  const result = await collectVerified(async () => {
    calls += 1;
    return {
      complete: true,
      series: [
        { date: "2026-09-26", platform: "腾讯视频", value: "8.80亿" },
        { date: "2026-09-27", platform: "腾讯视频", value: `${9 + calls / 10}亿` },
      ],
    };
  }, { from: "2026-09-26", to: "2026-09-27" });

  assert.equal(result.verification.verified, false);
  assert.deepEqual(result.series.map((row) => row.date), ["2026-09-26"]);
  assert.deepEqual(result.pendingSeries.map((row) => row.date), ["2026-09-27"]);
  assert.equal(result.pendingSeries[0].value, "9.3亿");
});

test("两轮无命中只有在来源明确完整时才视为已核验无数据", async () => {
  const verifiedEmpty = await collectVerified(async () => ({ complete: true, series: [] }), {
    from: "2026-09-01", to: "2026-09-02",
  });
  const requestFailure = await collectVerified(async () => ({ complete: false, failedDates: [{ date: "2026-09-02" }], series: [] }), {
    from: "2026-09-01", to: "2026-09-02",
  });

  assert.equal(verifiedEmpty.verification.verified, true);
  assert.deepEqual(verifiedEmpty.verification.noDataDates, ["2026-09-01", "2026-09-02"]);
  assert.equal(requestFailure.verification.verified, false);
  assert.equal(requestFailure.complete, false);

  let unconfirmedCalls = 0;
  const unconfirmedEmpty = await collectVerified(async () => {
    unconfirmedCalls += 1;
    return { series: [] };
  }, { from: "2026-09-01", to: "2026-09-02" });
  assert.equal(unconfirmedCalls, 3);
  assert.equal(unconfirmedEmpty.verification.verified, false);
  assert.deepEqual(unconfirmedEmpty.verification.noDataDates, []);
  assert.deepEqual(unconfirmedEmpty.verification.unresolvedDates, ["2026-09-01", "2026-09-02"]);

  const explicitlyNotPublished = await collectVerified(async () => ({ availability: "not-published", series: [] }), {
    from: "2026-09-01", to: "2026-09-02",
  });
  assert.equal(explicitlyNotPublished.verification.verified, true);
  assert.deepEqual(explicitlyNotPublished.verification.noDataDates, ["2026-09-01", "2026-09-02"]);
});

test("来源连续报告内部断日时，保留具体 gap 日期且不能记成无数据", async () => {
  const result = await collectVerified(async () => ({
    complete: false,
    missingDates: ["2026-09-02"],
    series: [{ date: "2026-09-01", heat: 70 }, { date: "2026-09-03", heat: 72 }],
  }), { from: "2026-09-01", to: "2026-09-03" });

  assert.equal(result.verification.verified, false);
  assert.deepEqual(result.verification.gapDates, ["2026-09-02"]);
  assert.deepEqual(result.verification.unresolvedDates, ["2026-09-02"]);
  assert.deepEqual(result.verification.noDataDates, []);
});

test("来源最新日期早于请求截止日时，截止日之后不自动判成无数据", async () => {
  const result = await collectVerified(async () => ({
    complete: true,
    coverage: { actualTo: "2026-09-01", requestedTo: "2026-09-02", sourceLatestBeforeRequestedTo: true },
    series: [{ date: "2026-09-01", heat: 70 }],
  }), { from: "2026-09-01", to: "2026-09-02" });

  assert.equal(result.verification.verified, false);
  assert.deepEqual(result.verification.unresolvedDates, ["2026-09-02"]);
  assert.deepEqual(result.verification.noDataDates, []);
});

test("两轮都失败时只补核一次，仍失败就保持未核验", async () => {
  let calls = 0;
  const result = await collectVerified(async () => {
    calls += 1;
    return calls < 3
      ? { complete: false, failedDates: [{ date: "2026-09-02" }], series: [] }
      : { complete: true, series: [{ date: "2026-09-02", heat: 71 }] };
  }, { from: "2026-09-02", to: "2026-09-02" });

  assert.equal(calls, 3);
  assert.equal(result.verification.verified, false);
  assert.equal(result.complete, false);
  assert.deepEqual(result.series, []);
  assert.deepEqual(result.verification.unresolvedDates, ["2026-09-02"]);
});

test("行比较会忽略抓取时间和来源 URL，只比较日期数据", () => {
  assert.deepEqual(compareCollectionRows(
    { series: [{ date: "2026-09-01", heat: 70, fetchedAt: "a", sourceUrl: "one" }] },
    { series: [{ date: "2026-09-01", heat: 70, fetchedAt: "b", sourceUrl: "two" }] },
  ), { equal: true, gapDates: [], summaryDisagreements: [] });
});

test("同一天同频道不同播出时段分别比较并执行一次差异补核", async () => {
  let calls = 0;
  const result = await collectVerified(async () => {
    calls += 1;
    return {
      complete: true,
      series: [
        { date: "2026-09-01", channel: "湖南卫视", platform: "湖南卫视", slot: "黄金时段", csmCityRating: 1.2 },
        { date: "2026-09-01", channel: "湖南卫视", platform: "湖南卫视", slot: "非黄金时段", csmCityRating: 0.7 + calls / 10 },
      ],
    };
  }, { from: "2026-09-01", to: "2026-09-01" });

  assert.equal(result.verification.verified, false);
  assert.equal(result.verification.passes, 3);
  assert.equal(result.series.length, 1);
  assert.deepEqual(result.pendingSeries.map((row) => row.slot), ["非黄金时段"]);
});

test("首轮请求抛错后仍执行两个有效读取作为补核", async () => {
  let calls = 0;
  const result = await collectVerified(async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary timeout");
    return { complete: true, series: [{ date: "2026-09-01", heat: 70 }] };
  }, { from: "2026-09-01", to: "2026-09-01" });

  assert.equal(calls, 3);
  assert.equal(result.verification.verified, true);
  assert.equal(result.complete, true);
  assert.deepEqual(result.series.map((row) => row.heat), [70]);
});

test("第三轮有两次来源状态一致时按多数决修复一次状态差异", async () => {
  let calls = 0;
  const result = await collectVerified(async () => {
    calls += 1;
    return calls === 1
      ? { complete: true, availability: "not-published", series: [] }
      : { complete: true, series: [{ date: "2026-09-01", heat: 70 }] };
  }, { from: "2026-09-01", to: "2026-09-01" });

  assert.equal(calls, 3);
  assert.equal(result.verification.verified, true);
  assert.equal(result.complete, true);
  assert.equal(result.availability, undefined);
  assert.deepEqual(result.series.map((row) => row.heat), [70]);
});

test("限定首播至截止日期，只返回请求范围内记录", async () => {
  const result = await collectVerified(async () => ({
    complete: true,
    series: [
      { date: "2026-08-31", heat: 69 },
      { date: "2026-09-01", heat: 70 },
      { date: "2026-09-02", heat: 71 },
    ],
  }), { from: "2026-09-01", to: "2026-09-01" });

  assert.deepEqual(result.series.map((row) => row.date), ["2026-09-01"]);
  assert.deepEqual(result.verification.checkedDates, ["2026-09-01"]);
});
