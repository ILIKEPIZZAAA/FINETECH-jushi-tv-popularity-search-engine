import { fileURLToPath } from 'node:url'
import { createRankingsService } from '../server/rankings.mjs'
const service = createRankingsService({ directory: process.env.RANKINGS_DATA_DIR || fileURLToPath(new URL('../.runtime/rankings', import.meta.url)) })
const result = await service.update()
console.log(JSON.stringify(result.boards?.map(({ id, status, rows, dataDate, passCount }) => ({ id, status, count: rows.length, dataDate, passCount })) || result, null, 2))
