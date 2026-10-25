import assert from 'node:assert/strict'
import test from 'node:test'
import { openXiaohongshuApp, XIAOHONGSHU_PROFILE_APP, XIAOHONGSHU_PROFILE_WEB } from '../src/lib/xiaohongshuLink.js'

function browserFixture() {
  const browserWindow = new EventTarget()
  const browserDocument = new EventTarget()
  const destinations = []
  let callback
  browserWindow.location = { assign: (url) => destinations.push(url) }
  browserWindow.setTimeout = (fn) => { callback = fn; return 1 }
  browserWindow.clearTimeout = () => { callback = null }
  browserDocument.visibilityState = 'visible'
  return { browserWindow, browserDocument, destinations, fireFallback: () => callback?.() }
}

test('手机主页链接先唤起指定小红书主页，未切入 App 时回退到原分享页', () => {
  const fixture = browserFixture()
  openXiaohongshuApp(fixture.browserWindow, fixture.browserDocument)
  assert.deepEqual(fixture.destinations, [XIAOHONGSHU_PROFILE_APP])
  fixture.fireFallback()
  assert.deepEqual(fixture.destinations, [XIAOHONGSHU_PROFILE_APP, XIAOHONGSHU_PROFILE_WEB])
})

test('成功切入 App 后取消回退，返回网页时不会再跳转', () => {
  const fixture = browserFixture()
  openXiaohongshuApp(fixture.browserWindow, fixture.browserDocument)
  fixture.browserDocument.visibilityState = 'hidden'
  fixture.browserDocument.dispatchEvent(new Event('visibilitychange'))
  fixture.browserDocument.visibilityState = 'visible'
  fixture.fireFallback()
  assert.deepEqual(fixture.destinations, [XIAOHONGSHU_PROFILE_APP])
})

test('离开页面或组件卸载会清理回退定时器', () => {
  for (const pagehide of [true, false]) {
    const fixture = browserFixture()
    const cleanup = openXiaohongshuApp(fixture.browserWindow, fixture.browserDocument)
    if (pagehide) fixture.browserWindow.dispatchEvent(new Event('pagehide'))
    else cleanup()
    fixture.fireFallback()
    assert.deepEqual(fixture.destinations, [XIAOHONGSHU_PROFILE_APP])
  }
})
