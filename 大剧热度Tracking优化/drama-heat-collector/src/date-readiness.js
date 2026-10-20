export async function waitForDate(readDate, expectedDate, {
  timeoutMs = 12_000,
  intervalMs = 100,
  signal,
} = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    if (signal?.aborted) {
      const error = new Error('等待来源日期时采集已取消')
      error.name = 'AbortError'
      throw error
    }
    const visibleDate = await readDate()
    if (visibleDate === expectedDate) return visibleDate
    if (visibleDate && visibleDate < expectedDate) {
      throw new Error(`来源日期从当前页跳过了预期日期 ${expectedDate}，实际显示 ${visibleDate}`)
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`等待来源切换到 ${expectedDate} 超时；当前页日期仍未确认`)
}
