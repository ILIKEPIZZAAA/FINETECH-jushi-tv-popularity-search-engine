// 猫眼剧集身份解析：官方 MDB 搜索页是唯一的发现入口。
// 这里保留进程内短缓存，不写本地 Catalog，避免旧 ID 或人工映射污染新链路。

const MDB_SEARCH_URL = "https://piaofang.maoyan.com/mdb/search";
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36";
const cache = new Map();
const failures = new Map();
const diagnostics = new Map();
const inflight = new Map();

function chineseNumeralToArabic(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d+$/.test(text)) return text;
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if ([...text].every((char) => Object.hasOwn(digits, char))) return [...text].map((char) => digits[char]).join("");
  if (text === "十") return "10";
  const ten = text.match(/^十([一二两三四五六七八九])$/);
  if (ten) return String(10 + digits[ten[1]]);
  const leadingTen = text.match(/^([一二两三四五六七八九])十([一二两三四五六七八九])?$/);
  if (leadingTen) return String(digits[leadingTen[1]] * 10 + (leadingTen[2] ? digits[leadingTen[2]] : 0));
  return text;
}

function normalizeTitle(value) {
  let text = String(value || "").normalize("NFKC").replace(/[《》「」『』]/g, "").replace(/[\s\u3000]+/g, "").trim().toLowerCase();
  // 猫眼 MDB 经常把续作写成“第二季/第二部”，用户输入则常写成“2”。
  // 只转换带季/部/篇语义的片段，避免改动剧名中的普通数字。
  text = text.replace(/第([零一二两三四五六七八九十百千万\d]+)(季|部|篇)/g, (_, number) => chineseNumeralToArabic(number));
  text = text.replace(/([零一二两三四五六七八九十百千万\d]+)(季|部|篇)/g, (_, number) => chineseNumeralToArabic(number));
  return text;
}

function parseEmbeddedObject(html, marker = "AppData =") {
  const start = html.indexOf(marker);
  if (start < 0) throw new Error("猫眼官方搜索页未找到 AppData");
  const first = html.indexOf("{", start + marker.length);
  if (first < 0) throw new Error("猫眼官方搜索页 AppData 格式异常");
  let depth = 0; let quoted = false; let escaped = false;
  for (let i = first; i < html.length; i += 1) {
    const ch = html[i];
    if (quoted) {
      if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === "{") depth += 1;
    if (ch === "}") { depth -= 1; if (depth === 0) return JSON.parse(html.slice(first, i + 1)); }
  }
  throw new Error("猫眼官方搜索页 AppData 未闭合");
}

function asRows(data) {
  const list = Array.isArray(data?.list) ? data.list : Array.isArray(data?.data?.list) ? data.data.list : [];
  return list.filter((row) => Number(row?.movieId) > 0 && String(row?.movieName || "").trim());
}

async function fetchSearch(title) {
  const url = `${MDB_SEARCH_URL}?key=${encodeURIComponent(title)}`;
  const response = await fetch(url, { headers: { "User-Agent": REQUEST_UA, Referer: "https://piaofang.maoyan.com/", Accept: "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(20_000) });
  const html = await response.text();
  if (!response.ok) throw new Error(`猫眼官方搜索 HTTP ${response.status}`);
  const data = parseEmbeddedObject(html);
  return { url, data, rows: asRows(data), status: response.status };
}

function premiereDate(row) {
  const release = String(row.releaseInfo || "");
  const match = release.match(/(20\d{2})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/);
  return match ? `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}` : "";
}

function candidateMetadata(row) {
  const category = String(row.categoryDesc || "");
  const release = String(row.releaseInfo || "");
  const roles = String(row.rolesDesc || "");
  const hasWebPlatform = /(爱奇艺|优酷|腾讯|芒果|多平台|网络|网播|线上)/i.test(release);
  const hasReleaseEvent = /(开播|上线|独播|首播|多平台)/.test(release);
  const date = premiereDate(row);
  // 信息完整度优先于“分类里是否写了电视剧”。MDB 的 categoryDesc 不是稳定的媒介类型字段。
  const completeness = (roles ? 25 : 0) + (category ? 8 : 0) + (row.imageUrl ? 5 : 0) + (date ? 5 : 0);
  return { date, hasWebPlatform, hasReleaseEvent, completeness };
}

function candidateScore(title, row) {
  if (normalizeTitle(row.movieName) !== normalizeTitle(title)) return -1000;
  const release = String(row.releaseInfo || "");
  const meta = candidateMetadata(row);
  let score = 100 + meta.completeness;
  if (meta.date) score += 25;
  if (meta.hasWebPlatform) score += 25;
  if (meta.hasReleaseEvent) score += 10;
  if (/上映/.test(release)) score -= 30;
  if (!release) score -= 20;
  return score;
}

function chooseCandidate(title, rows) {
  return rows
    .map((row) => ({ row, score: candidateScore(title, row), meta: candidateMetadata(row) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score
      || b.meta.completeness - a.meta.completeness
      || Number(Boolean(b.meta.hasWebPlatform)) - Number(Boolean(a.meta.hasWebPlatform))
      || b.meta.date.localeCompare(a.meta.date)
      || Number(b.row.movieId) - Number(a.row.movieId))[0]?.row || null;
}

function splitCredits(rolesDesc) {
  const text = String(rolesDesc || "").trim(); if (!text) return { directors: [], cast: [] };
  const parts = text.split(/\s*\/\s*/);
  return { directors: (parts[0] || "").split(/[,，、]/).map((item) => item.trim()).filter(Boolean), cast: parts.slice(1).join(",").split(/[,，、]/).map((item) => item.trim()).filter(Boolean) };
}

function parsePremiered(releaseInfo) { return String(releaseInfo || "").match(/(20\d{2}-\d{2}-\d{2})/)?.[1] || null; }

function parsePlatforms(releaseInfo) {
  const text = String(releaseInfo || "");
  const web = [[/(腾讯视频|腾讯)/, "腾讯视频"], [/(爱奇艺|iQIYI)/i, "爱奇艺"], [/(优酷|Youku)/i, "优酷"], [/(芒果TV|芒果)/, "芒果TV"]];
  const tv = /(CCTV-?\d+|湖南卫视|浙江卫视|东方卫视|江苏卫视|北京卫视)/.exec(text)?.[1];
  const parsed = [...web.filter(([pattern]) => pattern.test(text)).map(([, name]) => ({ name, dimension: "web" })), ...(tv ? [{ name: tv, dimension: "tv" }] : [])];
  // MDB 有时只写“多平台开播”，没有把平台名放进搜索结果；保留网端维度，
  // 让后续详情页仍能继续采集有效播放/平台表现，不把项目误判为无网端数据。
  return parsed.length ? parsed : (/多平台|网络|网播/.test(text) ? [{ name: "网端", dimension: "web" }] : []);
}

function officialDetails(title, row) {
  const credits = splitCredits(row.rolesDesc);
  const id = Number(row.movieId);
  const sourceUrl = `${MDB_SEARCH_URL}?key=${encodeURIComponent(title)}`;
  return {
    title: String(row.movieName || title), originalTitle: String(row.movieName || title), seriesId: id, premiered: parsePremiered(row.releaseInfo),
    poster: row.imageUrl || null, genres: String(row.categoryDesc || "").split(/[、,，/]/).map((item) => item.trim()).filter(Boolean),
    directors: credits.directors, cast: credits.cast, platforms: parsePlatforms(row.releaseInfo), releaseInfo: String(row.releaseInfo || ""), categoryDesc: String(row.categoryDesc || ""),
    summary: [row.categoryDesc, row.releaseInfo].filter(Boolean).join("；"), sourceUrl, detailUrl: `https://piaofang.maoyan.com/i/tv-datainfo/${id}/maoyan?barTheme=424242`, imageUrl: row.imageUrl || null,
    fetchedAt: new Date().toISOString(), searchEvidence: { movieId: id, movieName: row.movieName, categoryDesc: row.categoryDesc || "", releaseInfo: row.releaseInfo || "", rolesDesc: row.rolesDesc || "" },
  };
}

export async function verifySeriesIdDetailed(seriesId, expectedTitle, sourceUrl = "") {
  try {
    const result = await fetchSearch(expectedTitle);
    const row = result.rows.find((item) => Number(item.movieId) === Number(seriesId) && normalizeTitle(item.movieName) === normalizeTitle(expectedTitle));
    const evidence = { checkUrl: `${MDB_SEARCH_URL}?key=${encodeURIComponent(expectedTitle)}`, httpStatus: result.status, pageTitle: "猫眼影片/电视剧搜索", jsonName: row?.movieName || "", sourceUrl: sourceUrl || null };
    if (!row) return { ok: false, error: "VERIFY_FAILED", message: "官方搜索结果中未找到同名同 ID 项", evidence };
    const details = officialDetails(expectedTitle, row);
    return { ok: true, name: row.movieName, seriesId: Number(row.movieId), sourceUrl: details.detailUrl, verifiedAt: new Date().toISOString(), evidence, details };
  } catch (error) {
    return { ok: false, error: "VERIFY_NETWORK", message: error instanceof Error ? error.message : String(error), evidence: { checkUrl: `${MDB_SEARCH_URL}?key=${encodeURIComponent(expectedTitle)}`, httpStatus: null, pageTitle: "", jsonName: "", sourceUrl: sourceUrl || null } };
  }
}

async function resolveInternal(title) {
  const normalized = normalizeTitle(title); const result = await fetchSearch(title); const row = chooseCandidate(title, result.rows);
  diagnostics.set(normalized, { engine: "official-mdb-search", query: title, candidateCount: result.rows.length, candidates: result.rows.slice(0, 20).map((item) => ({ seriesId: Number(item.movieId), name: item.movieName, category: item.categoryDesc || "", releaseInfo: item.releaseInfo || "", score: candidateScore(title, item), completeness: candidateMetadata(item).completeness })) });
  if (!row) { failures.set(normalized, "NOT_FOUND"); return null; }
  const details = officialDetails(title, row);
  const resolved = { resolved: true, seriesId: details.seriesId, name: details.title, source: "official-mdb-search", sourceUrl: details.detailUrl, details, evidence: { checkUrl: details.detailUrl, httpStatus: result.status, pageTitle: "猫眼影片/电视剧搜索", jsonName: details.title, sourceUrl: result.url }, verifiedAt: new Date().toISOString() };
  failures.delete(normalized); cache.set(normalized, { expiresAt: Date.now() + CACHE_TTL_MS, result: resolved }); return resolved;
}

export async function resolveSeriesId(title, { forceDiscovery = false } = {}) {
  const normalized = normalizeTitle(title); if (!normalized) return null;
  if (!forceDiscovery) { const cached = cache.get(normalized); if (cached && cached.expiresAt > Date.now()) return cached.result; }
  if (inflight.has(normalized)) return inflight.get(normalized);
  const task = resolveInternal(title).catch((error) => { failures.set(normalized, "SOURCE_UNAVAILABLE"); diagnostics.set(normalized, { engine: "official-mdb-search", query: title, error: error instanceof Error ? error.message : String(error) }); throw error; }).finally(() => inflight.delete(normalized));
  inflight.set(normalized, task); return task;
}

export function getResolutionFailure(title) { return failures.get(normalizeTitle(title)) || null; }
export function getResolutionDiagnostics(title) { return diagnostics.get(normalizeTitle(title)) || null; }
