import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { passwordHash } from '../server/analytics.mjs'

if (!process.stdin.isTTY) throw new Error('请在交互式终端中设置密码')
const directory = process.env.ANALYTICS_DATA_DIR || resolve('.runtime/analytics')
let muted = false
const output = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk, encoding); done() } })
const terminal = createInterface({ input: process.stdin, output, terminal: true })
try {
  const prompt = async (label) => {
    process.stdout.write(label)
    muted = true
    const value = await terminal.question('')
    muted = false
    process.stdout.write('\n')
    return value
  }
  const password = await prompt('设置统计管理员密码（至少12个字符，输入不回显）: ')
  const confirmation = await prompt('再次输入密码: ')
  if (password.length < 12 || password.length > 256 || password !== confirmation) throw new Error('密码长度不符合要求或两次输入不一致；未修改密码')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  writeFileSync(join(directory, 'auth.json'), JSON.stringify(await passwordHash(password)), { mode: 0o600 })
  console.log('统计密码已设置。请在网站 /stats 页面登录；服务重启后需重新登录。')
} finally { muted = false; terminal.close() }
