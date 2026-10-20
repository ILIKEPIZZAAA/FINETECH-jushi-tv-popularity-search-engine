import { buildRawDataXlsx } from '../lib/rawDataWorkbook.js'

self.onmessage = async ({ data }) => {
  try {
    const result = await buildRawDataXlsx(data)
    const bytes = result instanceof Uint8Array ? result : new Uint8Array(result)
    self.postMessage({ bytes }, [bytes.buffer])
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Excel生成失败' })
  }
}
