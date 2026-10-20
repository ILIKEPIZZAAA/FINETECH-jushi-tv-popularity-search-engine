const VOLATILE_FIELDS = new Set(["fetchedAt", "sourceUrl", "ms", "durationMs"]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => !VOLATILE_FIELDS.has(key))
    .map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function shanghaiToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

// Only today's observations use the explicitly approved first-read snapshot
// policy. Units, identities, ranks, missing values and historical dates stay strict.
function withinTodayTolerance(first, later, key) {
  if (Object.is(first, later)) return true;
  if (/rank|episodes|(?:^|[._])id$/i.test(key)) return false;
  const numeric = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return { number: value, unit: "number" };
    if (typeof value !== "string") return null;
    const match = value.replace(/,/g, "").match(/^([^\d]*?)(-?\d+(?:\.\d+)?)([^\d]*)$/);
    return match ? { number: Number(match[2]), unit: `${match[1]}|${match[3]}` } : null;
  };
  const a = numeric(first), b = numeric(later);
  if (!a || !b || a.unit !== b.unit || !Number.isFinite(a.number) || !Number.isFinite(b.number) || a.number === 0) return false;
  // Compare decimal integers to avoid binary floating-point admitting an exact
  // 1% boundary (for example 0.33 -> 0.3333).
  const decimal = (number) => {
    const [mantissa, exponent = '0'] = String(number).toLowerCase().split('e');
    const places = (mantissa.split('.')[1]?.length || 0) - Number(exponent);
    const integer = BigInt(mantissa.replace('.', ''));
    return places < 0 ? { integer: integer * 10n ** BigInt(-places), places: 0 } : { integer, places };
  };
  const x = decimal(a.number), y = decimal(b.number), places = Math.max(x.places, y.places);
  const base = x.integer * 10n ** BigInt(places - x.places), laterValue = y.integer * 10n ** BigInt(places - y.places);
  const abs = (value) => value < 0n ? -value : value;
  return abs(laterValue - base) * 100n < abs(base);
}

function todayComparisonPasses(passes, today, currentSummary) {
  const first = passes[0];
  const audit = [];
  const normalize = (base, value, path) => {
    if (base && value && typeof base === "object" && typeof value === "object") {
      if (Array.isArray(base) !== Array.isArray(value)) return value;
      if (Array.isArray(value)) return value.map((item, index) => normalize(base[index], item, `${path}[${index}]`));
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(base[key], item, `${path}.${key}`)]));
    }
    if (!Object.is(base, value) && withinTodayTolerance(base, value, path)) {
      audit.push({ key: path, first: base, observed: value, rule: "abs(observed-first)/abs(first)<0.01" });
      return base;
    }
    return value;
  };
  const firstRows = new Map(rowsFor(first).rows.map((row) => [rowKey(row), row]));
  const summaryIsToday = (payload) => {
    if (!currentSummary) return false;
    const dated = payload?.summary?.date || payload?.summary?.asOfDate || payload?.fetchedAt;
    if (!dated) return true; // This independent read observes the current source snapshot.
    const instant = new Date(dated);
    if (Number.isNaN(instant.getTime())) return false;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dated) ? dated
      : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(instant);
    return date === today;
  };
  const compared = passes.map((payload, passIndex) => {
    if (!passIndex || payload?.availability === "error" || first?.availability === "error") return payload;
    const { field, rows } = rowsFor(payload);
    const updated = rows.map((row) => row.date === today && firstRows.has(rowKey(row))
      ? normalize(firstRows.get(rowKey(row)), row, `row:${rowKey(row)}`) : row);
    const result = { ...payload };
    if (field === "self") Object.assign(result, updated[0]);
    else if (field) result[field] = updated;
    if (summaryIsToday(first) && summaryIsToday(payload)) result.summary = normalize(first.summary, payload.summary, "summary");
    return result;
  });
  return { compared, audit, summaryIsToday: summaryIsToday(first) };
}

function rowsFor(payload) {
  if (Array.isArray(payload?.series)) return { field: "series", rows: payload.series };
  if (Array.isArray(payload?.metrics)) return { field: "metrics", rows: payload.metrics };
  if (payload?.date && (payload?.heat !== undefined || payload?.value !== undefined)) {
    return { field: "self", rows: [payload] };
  }
  return { field: "", rows: [] };
}

function metricDimensions(payload) {
  const { rows } = rowsFor(payload);
  const dimensions = new Map();
  for (const row of rows) {
    const metric = String(row?.name || row?.metric || row?.category || payload?.metric || "value");
    const platform = String(row?.platform || row?.platformLabel || "");
    const channel = String(row?.channel || "");
    const slot = String(row?.slot || row?.period || "");
    const episodes = String(row?.episodes ?? "");
    const key = JSON.stringify([metric, platform, channel, slot, episodes]);
    dimensions.set(key, { key, metric, platform, channel, slot, episodes });
  }
  for (const metric of Object.keys(payload?.noDataByMetric || {})) {
    const key = JSON.stringify([metric, "", "", "", ""]);
    dimensions.set(key, { key, metric, platform: "", channel: "", slot: "", episodes: "" });
  }
  return [...dimensions.values()];
}

function rowMatchesDimension(row, payload, dimension) {
  const metric = String(row?.name || row?.metric || row?.category || payload?.metric || "value");
  return JSON.stringify([
    metric,
    String(row?.platform || row?.platformLabel || ""),
    String(row?.channel || ""),
    String(row?.slot || row?.period || ""),
    String(row?.episodes ?? ""),
  ]) === dimension.key;
}

function hasUnverifiedDimensionGaps(payloads, expectedDates) {
  const dimensions = [...new Map(payloads.flatMap(metricDimensions).map((dimension) => [dimension.key, dimension])).values()];
  if (!dimensions.length && expectedDates.length) {
    return !payloads.every((payload) => payload?.complete === true || payload?.availability === "not-published");
  }
  return expectedDates.some((date) => dimensions.some((dimension) => {
    if (payloads.some((payload) => rowsFor(payload).rows.some((row) => row?.date === date && rowMatchesDimension(row, payload, dimension)))) return false;
    return !payloads.every((payload) => {
      const noData = noDataForDate(payload, date, dimension);
      const sourceCoverageReachesDate = payload?.coverage?.sourceLatestBeforeRequestedTo !== true
        && (!payload?.coverage?.actualTo || date <= payload.coverage.actualTo);
      return noData || payload?.complete === true && payload?.availability !== "error" && sourceCoverageReachesDate;
    });
  }));
}

function noDataForDate(payload, date, dimension) {
  const metric = dimension.platform ? `${dimension.metric}:${dimension.platform}` : dimension.metric;
  return payload?.noDataByMetric?.[dimension.metric]?.includes?.(date)
    || payload?.noDataByMetric?.[metric]?.includes?.(date)
    || payload?.noDataDates?.includes?.(date)
    || rowsFor(payload).rows.some((row) => row.date === date && rowMatchesDimension(row, payload, dimension) && emptyMetricRow(row))
    || payload?.sourceReadSuccessful === true && payload?.availability !== "error"
      && !(payload.failedDates || []).some((item) => (typeof item === "string" ? item : item?.date) === date)
      && !rowsFor(payload).rows.some((row) => row.date === date && rowMatchesDimension(row, payload, dimension));
}

const VALUE_FIELDS = ["value", "heat", "exposure", "interaction", "publish", "bulletScreen", "effectivePlay", "cumulativeEffectivePlay", "platformHeat", "csmCityRating", "nationalRating", "rating", "csmCityShare", "nationalShare", "share"];
function explicitEmpty(value) {
  return value === null || typeof value === "string" && ["", "--", "-", "暂无", "无", "无数据"].includes(value.trim());
}
function emptyMetricRow(row) {
  const fields = VALUE_FIELDS.filter((key) => Object.hasOwn(row, key));
  return fields.length > 0 && fields.every((key) => explicitEmpty(row[key]));
}

function rowKey(row) {
  return [row?.date, row?.platform || row?.platformLabel, row?.name || row?.metric, row?.category, row?.channel, row?.slot || row?.period, row?.episodes]
    .map((value) => String(value ?? ""))
    .join("\u001f");
}

function rowMaps(payloads) {
  return payloads.map((payload) => {
    const { rows } = rowsFor(payload);
    return new Map(rows.map((row) => [rowKey(row), row]));
  });
}

function disagreementKeys(maps) {
  const keys = new Set(maps.flatMap((map) => [...map.keys()]));
  return [...keys].filter((key) => new Set(maps.map((map) => map.has(key) ? stableJson(map.get(key)) : "<no-row>")).size > 1);
}

function datesFromKeys(keys) {
  return [...new Set(keys.map((key) => key.split("\u001f", 1)[0]).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
}

function reportedGapDates(payload) {
  const values = [
    ...(Array.isArray(payload?.missingDates) ? payload.missingDates : []),
    ...(Array.isArray(payload?.failedDates) ? payload.failedDates : []),
  ];
  return values.map((item) => typeof item === "string" ? item : item?.date)
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date || ""));
}

function summaryMap(payload) {
  const summary = payload?.summary;
  if (summary == null) return new Map();
  const entries = new Map();
  const visit = (value, path) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const identity = item && typeof item === "object"
          ? item.mainTitle || item.platformLabel || item.title || item.name || item.platform || item.id
          : null;
        visit(item, `${path}[${identity ?? index}]`);
      });
      return;
    }
    if (value && typeof value === "object") {
      for (const key of Object.keys(value).sort()) {
        if (["fetchedAt", "sourceUrl", "ms", "durationMs"].includes(key)) continue;
        visit(value[key], path ? `${path}.${key}` : key);
      }
      return;
    }
    entries.set(path || "summary", stableJson(value));
  };
  visit(summary, "summary");
  return entries;
}

function summaryDisagreements(payloads) {
  const maps = payloads.map(summaryMap);
  const keys = new Set(maps.flatMap((map) => [...map.keys()]));
  return [...keys].filter((key) => new Set(maps.map((map) => map.has(key) ? map.get(key) : "<missing>")).size > 1)
    .map((key) => ({ key, values: maps.map((map) => map.has(key) ? map.get(key) : null) }));
}

function summaryVote(payloads) {
  const maps = payloads.map(summaryMap);
  const keys = new Set(maps.flatMap((map) => [...map.keys()]));
  const agreed = new Map();
  const unresolved = [];
  for (const key of keys) {
    const values = maps.map((map) => map.has(key) ? map.get(key) : "<missing>");
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    const winner = [...counts].find(([, count]) => count >= 2)?.[0];
    if (winner === undefined) unresolved.push({ key, values: values.map((value) => value === "<missing>" ? null : value) });
    else agreed.set(key, winner);
  }
  const matchingPayload = payloads.find((payload, index) => {
    const map = maps[index];
    return [...agreed].every(([key, value]) => map.get(key) === value)
      && unresolved.length === 0;
  });
  return { disagreements: unresolved, summary: matchingPayload?.summary };
}

function statusSignature(payload) {
  const { rows } = rowsFor(payload);
  return payload?.availability || (rows.some((row) => !emptyMetricRow(row)) ? "available" : "empty");
}

function statusConsensus(payloads) {
  const counts = new Map();
  for (const payload of payloads) {
    const signature = statusSignature(payload);
    counts.set(signature, (counts.get(signature) || 0) + 1);
  }
  const winner = [...counts.entries()].find(([, count]) => count >= 2)?.[0] || null;
  return { winner, stable: Boolean(winner), mixed: counts.size > 1 };
}

function majorityRows(payloads, maps, unresolvedKeys) {
  const unresolved = new Set(unresolvedKeys);
  const keys = new Set(maps.flatMap((map) => [...map.keys()]));
  const result = [];
  for (const key of keys) {
    const candidates = maps.map((map) => map.has(key)
      ? { signature: stableJson(map.get(key)), row: map.get(key) }
      : { signature: "<no-row>", row: null });
    const counts = new Map();
    for (const candidate of candidates) counts.set(candidate.signature, (counts.get(candidate.signature) || 0) + 1);
    const majority = [...counts.entries()].find(([, count]) => count >= 2)?.[0];
    if (!majority) {
      unresolved.add(key);
      continue;
    }
    const chosen = candidates.find((candidate) => candidate.signature === majority)?.row;
    if (chosen) result.push(chosen);
  }
  return { rows: result, unresolvedKeys: [...unresolved] };
}

function dateRange(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "") || from > to) return [];
  const dates = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function attachVerification(payload, verification, rows) {
  const target = { ...(payload || {}), verification };
  const { field } = rowsFor(payload);
  if (field === "series") target.series = rows;
  else if (field === "metrics") target.metrics = rows;
  else if (field === "self" && rows.length) Object.assign(target, rows[0]);
  if (verification.availability) {
    if (verification.availability === "available") delete target.availability;
    else if (verification.availability === "empty") target.availability = "not-published";
    else target.availability = verification.availability;
  }
  if (verification.verified === false) target.complete = false;
  return target;
}

/**
 * Read a source independently twice. If rows, summary, or source coverage do
 * not converge, allow one bounded third pass and accept only a two-of-three
 * consensus. Remaining conflicts are explicitly incomplete.
 */
export async function collectVerified(fetchOnce, { from = "", to = "", today = shanghaiToday() } = {}) {
  const runPass = async (pass) => {
    try {
      return await fetchOnce({ pass });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      return {
        complete: false,
        availability: "error",
        error: error instanceof Error ? error.message : String(error),
        series: [],
      };
    }
  };
  const first = await runPass(1);
  const second = await runPass(2);
  let passes = [first, second];
  let comparison = todayComparisonPasses(passes, today, !to || to === today);
  const expectedDates = dateRange(from, to);
  const initialUsable = comparison.compared.filter((payload) => payload?.availability !== "error");
  const initialMaps = rowMaps(initialUsable);
  const initialSummaryDiffs = summaryDisagreements(comparison.compared);
  const initialHasGaps = passes.some((payload) => payload?.complete === false || payload?.availability === "error");
  // E: repair only after the two independent reads disagree or report incomplete
  // coverage. This is deliberately bounded to one additional full source pass.
  if (initialHasGaps || disagreementKeys(initialMaps).length || initialSummaryDiffs.length
    || hasUnverifiedDimensionGaps(passes, expectedDates)) {
    passes = [...passes, await runPass(3)];
  }
  comparison = todayComparisonPasses(passes, today, !to || to === today);
  // Keep partial observations. A failed date should not discard rows that both
  // independent passes read successfully and identically on other dates.
  const usable = comparison.compared.filter((payload) => payload?.availability !== "error");
  const maps = rowMaps(usable);
  const vote = majorityRows(usable, maps, []);
  // A later majority must not silently replace today's first snapshot after an
  // out-of-tolerance read. Historical observations retain exact 2-of-3 voting.
  if (first?.availability !== "error") {
    const firstMap = rowMaps([first])[0];
    for (const key of disagreementKeys(maps).filter((key) => key.startsWith(`${today}\u001f`) && firstMap.has(key))) {
      vote.rows = vote.rows.filter((row) => rowKey(row) !== key);
      if (!vote.unresolvedKeys.includes(key)) vote.unresolvedKeys.push(key);
    }
  }
  const status = statusConsensus(usable);
  const summaryResult = summaryVote(comparison.compared);
  if (comparison.summaryIsToday && first?.availability !== "error") {
    summaryResult.disagreements = summaryDisagreements(comparison.compared.filter((payload) => payload.availability !== "error"));
    summaryResult.summary = summaryResult.disagreements.length ? undefined : first.summary;
  }
  const summaryDiffs = summaryResult.disagreements;
  const summaryKeys = summaryDiffs.map((item) => item.key);
  const gapDateSet = new Set(datesFromKeys(disagreementKeys(maps)));
  const unresolvedDateSet = new Set(datesFromKeys(vote.unresolvedKeys));
  const noDataDatesByPass = passes.map((payload) => new Set([
    ...(payload?.availability === "not-published" ? expectedDates : []),
    ...(Array.isArray(payload?.noDataDates) ? payload.noDataDates : []),
    ...Object.values(payload?.noDataByMetric || {}).flatMap((dates) => Array.isArray(dates) ? dates : []),
  ]));
  const dimensions = [...new Map(passes.flatMap(metricDimensions).map((dimension) => [dimension.key, dimension])).values()];
  const noDataMetricSets = passes.map((payload) => new Map(Object.entries(payload?.noDataByMetric || {})
    .map(([metric, dates]) => [metric, new Set(Array.isArray(dates) ? dates : [])])));
  const verifiedNoDataByMetric = {};
  const metricCoverageGaps = [];
  const sourceIssueDates = passes.map((payload) => new Set([
    ...reportedGapDates(payload),
    ...(Array.isArray(payload?.failedDates) ? payload.failedDates : []).map((item) => typeof item === "string" ? item : item?.date),
    ...(Array.isArray(payload?.missingDates) ? payload.missingDates : []).map((item) => typeof item === "string" ? item : item?.date),
  ].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date || ""))));
  const issueThreshold = passes.length >= 3 ? 2 : 1;
  const issueDates = [...new Set(sourceIssueDates.flatMap((dates) => [...dates]))];
  const failedDateSet = new Set(issueDates.filter((date) => sourceIssueDates.filter((dates) => dates.has(date)).length >= issueThreshold
    && passes.filter((payload) => (payload?.failedDates || []).some((item) => (typeof item === "string" ? item : item?.date) === date)).length >= issueThreshold));
  issueDates.filter((date) => sourceIssueDates.filter((dates) => dates.has(date)).length >= issueThreshold).forEach((date) => gapDateSet.add(date));

  for (const date of expectedDates) {
    const hasStableRow = vote.rows.some((row) => row?.date === date && !emptyMetricRow(row));
    const hasDisagreement = datesFromKeys(vote.unresolvedKeys).includes(date);
    const completeReads = passes.filter((payload) => payload?.complete === true && payload?.availability !== "error").length;
    const repeatedSourceIssue = sourceIssueDates.filter((dates) => dates.has(date)).length >= issueThreshold;
    const failed = repeatedSourceIssue;
    if (failed || hasDisagreement || (usable.length < 2 && !hasStableRow)) unresolvedDateSet.add(date);
    for (const dimension of dimensions) {
      const metric = dimension.platform ? `${dimension.metric}:${dimension.platform}` : dimension.metric;
      const hasRows = (payload) => rowsFor(payload).rows.some((row) => row?.date === date && rowMatchesDimension(row, payload, dimension));
      const state = (payload, passIndex) => {
        if (payload?.availability === "error" || (payload?.failedDates || []).some((item) => (typeof item === "string" ? item : item?.date) === date)) return "failed";
        if (hasRows(payload) && !rowsFor(payload).rows.filter((row) => row.date === date && rowMatchesDimension(row, payload, dimension)).every(emptyMetricRow)) return "data";
        if ((noDataMetricSets[passIndex].get(dimension.metric)?.has(date)
          || noDataMetricSets[passIndex].get(metric)?.has(date)
          || noDataForDate(payload, date, dimension)) && payload?.availability !== "error") return "no-data";
        if (Array.isArray(payload?.failedDates) && payload.failedDates.some((item) => (typeof item === "string" ? item : item?.date) === date)) return "failed";
        if (Array.isArray(payload?.missingDates) && payload.missingDates.some((item) => (typeof item === "string" ? item : item?.date) === date)) return "unresolved";
        if (payload?.availability === "error" || Array.isArray(payload?.failedDates) && payload.failedDates.some((item) => (typeof item === "string" ? item : item?.date) === date)) return "failed";
        // A source-level completeness declaration can justify an empty date; an
        // absent row in a response without that declaration remains unverified.
        const sourceCoverageReachesDate = payload?.coverage?.sourceLatestBeforeRequestedTo !== true
          && (!payload?.coverage?.actualTo || date <= payload.coverage.actualTo);
        if (payload?.complete === true && payload?.availability !== "error" && sourceCoverageReachesDate) return "no-data";
        return "unresolved";
      };
      const states = passes.map(state);
      const counts = new Map();
      for (const value of states) counts.set(value, (counts.get(value) || 0) + 1);
      const consensus = [...counts].find(([, count]) => count >= issueThreshold)?.[0];
      if (consensus === "no-data") {
        verifiedNoDataByMetric[metric] ||= [];
        verifiedNoDataByMetric[metric].push(date);
      } else if (consensus !== "data") {
        unresolvedDateSet.add(date);
        metricCoverageGaps.push({ date, metric, states });
      }
    }
    if (!dimensions.length && !hasStableRow && noDataDatesByPass.filter((dates) => dates.has(date)).length < issueThreshold && completeReads < issueThreshold) unresolvedDateSet.add(date);
  }
  const unresolvedDates = [...unresolvedDateSet].sort();
  const returnedDates = new Set(vote.rows.filter((row) => !emptyMetricRow(row)).map((row) => row?.date).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date || "")));
  const noDataDates = expectedDates.filter((date) => {
    if (returnedDates.has(date) || unresolvedDateSet.has(date)) return false;
    if (dimensions.length) return dimensions.every((dimension) => {
      const metric = dimension.platform ? `${dimension.metric}:${dimension.platform}` : dimension.metric;
      return verifiedNoDataByMetric[metric]?.includes(date);
    });
    return noDataDatesByPass.filter((dates) => dates.has(date)).length >= issueThreshold
      || passes.filter((payload) => (payload?.complete === true || payload?.availability === "not-published") && payload?.availability !== "error").length >= issueThreshold;
  });
  const latest = [...passes].reverse().find((payload) => payload?.availability !== "error") || passes.at(-1) || {};
  const converged = vote.unresolvedKeys.length === 0 && usable.length >= 2 && status.stable;
  const verified = converged && unresolvedDates.length === 0 && summaryDiffs.length === 0;
  metricCoverageGaps.forEach(({ date }) => gapDateSet.add(date));
  const sourceGapDates = [...gapDateSet].sort();
  const stopCounts = new Map();
  for (const payload of passes) if (payload.stopDate && payload.stopReason && payload.availability !== "error") {
    const key = JSON.stringify({ date: payload.stopDate, reason: payload.stopReason });
    stopCounts.set(key, (stopCounts.get(key) || 0) + 1);
  }
  const stopWinner = [...stopCounts].find(([, count]) => count >= 2);
  const verification = {
    version: 1,
    state: verified ? "verified" : "incomplete",
    verified,
    availability: status.winner,
    passes: passes.length,
    from: from || null,
    to: to || null,
    checkedDates: expectedDates,
    noDataDates,
    noDataByMetric: Object.fromEntries(Object.entries(verifiedNoDataByMetric).map(([metric, dates]) => [metric, [...new Set(dates)].sort()])),
    noDataFields: vote.rows.flatMap((row) => VALUE_FIELDS.filter((field) => Object.hasOwn(row, field) && explicitEmpty(row[field]))
      .map((field) => ({ date: row.date, platform: row.platform || row.platformLabel || "", metric: row.name || row.metric || "", field }))),
    metricCoverageGaps,
    failedDates: [...failedDateSet].sort(),
    gapDates: sourceGapDates,
    unresolvedDates,
    summaryVerified: summaryDiffs.length === 0,
    unresolvedSummaryKeys: summaryKeys,
    summaryDisagreements: summaryDiffs,
    toleranceAccepted: comparison.audit,
    snapshotPolicy: { today, relativeDifferenceExclusive: 0.01, baseline: "first-independent-read" },
    snapshotFetchedAt: first.fetchedAt || null,
    observations: passes.map((payload, index) => ({ pass: index + 1, fetchedAt: payload.fetchedAt || null, availability: payload.availability || null, coverage: payload.coverage || null })),
    termination: stopWinner ? { ...JSON.parse(stopWinner[0]), confirmedBy: stopWinner[1] } : null,
    observedDates: expectedDates.filter((date) => passes.filter((payload) => payload.scannedDates?.includes(date)).length >= 2),
    inferredNoDataDates: expectedDates.filter((date) => passes.filter((payload) => payload.inferredNoDataDates?.includes(date)).length >= 2),
    message: verified
      ? `逐日数据和累计摘要已完成两轮独立核验${passes.length === 3 ? "并通过差异补核" : "，两轮一致"}${sourceGapDates.length ? `，来源报告 ${sourceGapDates.length} 个日期缺口` : ""}`
      : `两轮仍有未核实内容：${unresolvedDates.length ? `日期 ${unresolvedDates.join("、")}` : ""}${summaryKeys.length ? `${unresolvedDates.length ? "；" : ""}累计摘要 ${summaryKeys.join("、")}` : ""}${usable.length < 2 ? "来源请求未能完成两次有效读取" : status.mixed ? "来源数据状态不一致" : ""}`,
  };
  const inRequestedRange = (row) => /^\d{4}-\d{2}-\d{2}$/.test(row?.date || "")
    && (!from || row.date >= from)
    && (!to || row.date <= to);
  const stableRows = vote.rows.filter((row) => inRequestedRange(row) && !emptyMetricRow(row));
  const pendingDates = new Set(unresolvedDates);
  const pendingKeys = new Set(vote.unresolvedKeys);
  const pendingByKey = new Map();
  if (usable.length >= 2) {
    for (const payload of [...usable].reverse()) {
      for (const row of rowsFor(payload).rows) {
        const key = rowKey(row);
        if (pendingKeys.has(key) && inRequestedRange(row) && pendingDates.has(row.date) && !pendingByKey.has(key)) {
          pendingByKey.set(key, row);
        }
      }
    }
  }
  const pendingSeries = [...pendingByKey.values()];
  return {
    ...attachVerification(latest, verification, stableRows),
    ...(summaryResult.summary === undefined ? {} : { summary: summaryResult.summary }),
    noDataByMetric: verification.noDataByMetric,
    failedDates: verification.failedDates,
    pendingSeries,
  };
}

export function compareCollectionRows(first, second) {
  const summaryDiffs = summaryDisagreements([first, second]);
  return {
    equal: disagreementKeys(rowMaps([first, second])).length === 0
      && stableJson({ complete: first?.complete, availability: first?.availability }) === stableJson({ complete: second?.complete, availability: second?.availability })
      && summaryDiffs.length === 0,
    gapDates: datesFromKeys(disagreementKeys(rowMaps([first, second]))),
    summaryDisagreements: summaryDiffs,
  };
}
