export function createRawDataExportTask({ build, save }) {
  let pending = null
  return (state, options = {}) => {
    if (pending) return pending
    const snapshot = structuredClone(state)
    pending = Promise.resolve().then(async () => {
      const bytes = await build(snapshot, options)
      if (options.signal?.aborted) throw new DOMException('导出已取消', 'AbortError')
      await save(bytes, snapshot)
    }).finally(() => { pending = null })
    return pending
  }
}

export function generateWorkbookInWorker(state, { signal, workerFactory = () => new Worker(new URL('../workers/rawData.worker.js', import.meta.url), { type: 'module' }) } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('导出已取消', 'AbortError'))
    const worker = workerFactory()
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      if (error) reject(error)
      else resolve(value)
    }
    const abort = () => finish(new DOMException('导出已取消', 'AbortError'))
    const timer = setTimeout(() => finish(new Error('生成Excel超时，请缩小数据范围或重试')), 120_000)
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }) => data.error ? finish(new Error(data.error)) : finish(null, data.bytes)
    worker.onerror = () => finish(new Error('Excel生成失败，请重试'))
    worker.onmessageerror = () => finish(new Error('Excel数据传输失败，请重试'))
    try { worker.postMessage(state) } catch (error) { finish(error) }
  })
}

export function saveRawDataFile(bytes, state) {
  const title = state.projects.find((project) => project.id === state.selectedId)?.title || 'finetech'
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  try {
    anchor.href = url
    anchor.download = `${title}-rawdata.xlsx`
    document.body.appendChild(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
}
