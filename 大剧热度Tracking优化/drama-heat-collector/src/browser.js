// 共享的 Playwright 浏览器实例管理。
// 用系统 Chrome（channel:"chrome"），无头默认开启；设 MAOYAN_HEADED=1 可显示窗口排查。
// 一个常驻 context+page 被所有「浏览器采集型」provider 复用，避免每次重建，降低被风控判异的概率。

import { chromium } from "playwright-core";

const HEADED = process.env.MAOYAN_HEADED === "1";

let _browser = null;
let _page = null;
let _lastUse = 0;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function getPage() {
  const now = Date.now();
  if (_page && _lastUse && now - _lastUse > 30_000) {
    // 闲置太久就彻底回收，让下次请求干净重建，避免被平台挂到有问题的旧会话
    await teardown();
  }
  if (!_browser) {
    _browser = await chromium.launch({
      channel: "chrome",
      headless: !HEADED,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    const context = await _browser.newContext({
      userAgent: USER_AGENT,
      locale: "zh-CN",
      viewport: { width: 1440, height: 900 },
    });
    _page = await context.newPage();
  }
  _lastUse = Date.now();
  return _page;
}

export function refreshLastUse() {
  _lastUse = Date.now();
}

export async function teardown() {
  try { await _page?.close(); } catch {}
  try { await _browser?.close(); } catch {}
  _page = null;
  _browser = null;
}
