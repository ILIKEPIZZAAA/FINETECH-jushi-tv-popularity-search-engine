// 台端收视率历史采集器。
//
// 台端收视率与网端热度是两套口径：一行数据必须保存到“频道 × 日期 × 播出时段 × 指标”。
// 本适配器只读取公开页面已经展示的收视表，不调用受限商业接口，也不推测缺失日期。

const SEARCH = "https://html.duckduckgo.com/html/";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

function decodeHtml(value = "") {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function text(value = "") {
  return decodeHtml(value)
    .replace(/<br\s*\/?>/gi, " / ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value = "") {
  return value.replace(/[《》·•・\s,，:：;；/／|｜（）()\[\]【】\-—_]/g, "").toLowerCase();
}

function isoDate(value) {
  const match = value.match(/(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function numberOrNull(value) {
  const parsed = Number(String(value).replace(/[%％,，\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchText(url, timeout = 15_000) {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9", Accept: "text/html,application/xhtml+xml" },
    cache: "no-store",
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`公开收视表页面返回 ${response.status}`);
  return { url: response.url, html: await response.text() };
}

async function findBaikePage(title) {
  const query = new URLSearchParams({ q: `site:baike.so.com/doc ${title} 收视率` });
  const { html } = await fetchText(`${SEARCH}?${query}`);
  for (const match of html.matchAll(/[?&]uddg=([^&"']+)/g)) {
    try {
      const url = decodeURIComponent(match[1]);
      const parsed = new URL(url);
      if (/(^|\.)baike\.so\.com$/.test(parsed.hostname) && /^\/doc\/\d+-\d+\.html/.test(parsed.pathname)) return parsed.toString();
    } catch {
      // 继续下一条检索结果。
    }
  }
  return null;
}

function rowsFromTable(tableHtml, channel, sourceUrl) {
  const rows = [];
  for (const rowMatch of tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => text(match[1]));
    const date = isoDate(cells[0] || "");
    if (!date || cells.length < 6) continue;
    // 常见公开表顺序：日期、时间、集数、CSM城市网 收视率/份额/排名、全国网 收视率/份额/排名。
    rows.push({
      date,
      channel,
      slot: cells[1] || null,
      episodes: cells[2] || null,
      csmCityRating: numberOrNull(cells[3]),
      csmCityShare: numberOrNull(cells[4]),
      csmCityRank: numberOrNull(cells[5]),
      nationalRating: numberOrNull(cells[6]),
      nationalShare: numberOrNull(cells[7]),
      nationalRank: numberOrNull(cells[8]),
      sourceUrl,
    });
  }
  return rows;
}

function parseRatings(title, sourceUrl, html) {
  if (!normalize(html).includes(normalize(title))) return [];
  const series = [];
  for (const tableMatch of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const table = tableMatch[1];
    const caption = text(table.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i)?.[1] || "");
    if (!/收视率/.test(caption)) continue;
    const channel = caption.match(/[》《]?([^《》\s]+卫视)[^]*?首播收视率/)?.[1] || caption.match(/([^《》\s]+卫视)/)?.[1] || "频道待识别";
    series.push(...rowsFromTable(table, channel, sourceUrl));
  }
  return series;
}

export async function collectTvRatings(title) {
  const pageUrl = await findBaikePage(title);
  if (!pageUrl) throw new Error(`未找到《${title}》的公开逐日收视表。该剧仍可建立为台端项目；若你有 CSM/酷云等合规导出，可走导入适配器补齐。`);
  const { url, html } = await fetchText(pageUrl);
  const series = parseRatings(title, url, html);
  if (!series.length) throw new Error(`《${title}》页面已找到，但没有可解析的逐日收视表。可能只公开了平均值，或表格结构已变更。`);
  return {
    platform: "tv-ratings",
    title,
    source: "公开逐日收视表",
    sourceUrl: url,
    fetchedAt: new Date().toISOString(),
    fields: ["频道", "日期", "播出时段", "集数", "CSM城市网收视率", "CSM城市网份额", "CSM城市网排名", "全国网收视率", "全国网份额", "全国网排名"],
    series,
  };
}
