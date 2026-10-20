import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const collectorRoot = resolve(appRoot, '../大剧热度Tracking优化/drama-heat-collector')
const children = new Set()
let shuttingDown = false

function start(label, command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' })
  children.add(child)
  child.once('exit', (code, signal) => {
    children.delete(child)
    if (!shuttingDown) {
      console.error(`[${label}] exited (${signal || code}); stopping local stack`)
      shutdown(code || 1)
    }
  })
  return child
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) child.kill('SIGTERM')
  const deadline = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL')
  }, 5_000)
  deadline.unref()
  process.exitCode = code
}

process.once('SIGINT', () => shutdown(0))
process.once('SIGTERM', () => shutdown(0))

const node = process.execPath
start('collector-main', node, ['src/server.js'], collectorRoot, {
  HOST: '127.0.0.1', PORT: '8890',
})
start('collector-ky', node, ['src/server.js'], collectorRoot, {
  HOST: '127.0.0.1', PORT: '8891',
})
start('api', node, ['server/index.mjs'], appRoot, {
  HOST: '127.0.0.1', PORT: '3001',
  DRAMA_COLLECTOR_URL: 'http://127.0.0.1:8890',
  DRAMA_KY_COLLECTOR_URL: 'http://127.0.0.1:8891',
})
start('vite', node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--strictPort'], appRoot, {})

console.log('FINETECH local stack starting: http://127.0.0.1:5173')
console.log('API: 127.0.0.1:3001 · collectors: 127.0.0.1:8890 (main), 127.0.0.1:8891 (KY)')
