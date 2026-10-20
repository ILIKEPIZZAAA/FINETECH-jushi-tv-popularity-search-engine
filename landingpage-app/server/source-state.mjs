import { parse } from '@babel/parser'

// Decode data literals in official SSR pages without executing remote scripts.
// Nuxt's parameter-compressed literal is supported; arbitrary calls and property
// access are deliberately rejected.
export function decodeSourceState(html, name) {
  const marker = `window.${name}`
  const start = html.indexOf(marker)
  if (start < 0) throw new Error(`官网页面缺少 ${name} 数据`)
  const end = html.indexOf('</script>', start)
  if (end < 0 || end - start > 8_000_000) throw new Error('官网数据结构无效或过大')
  const script = parse(html.slice(start, end), { sourceType: 'script' })
  const memberPath = node => node?.type === 'Identifier' ? node.name
    : node?.type === 'MemberExpression' && !node.computed ? `${memberPath(node.object)}.${node.property.name}` : ''
  const statement = script.program.body.map(item => item.expression).find(item => item?.type === 'AssignmentExpression' && memberPath(item.left) === marker)
  if (!statement) throw new Error('官网数据赋值结构已变化')
  let visited = 0
  const decode = (node, scope = Object.create(null), depth = 0) => {
    if (++visited > 200_000 || depth > 100) throw new Error('官网数据结构超限')
    if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(node?.type)) return node.value
    if (node?.type === 'NullLiteral') return null
    if (node?.type === 'Identifier') {
      if (node.name === 'undefined') return null
      if (Object.hasOwn(scope, node.name)) return scope[node.name]
    }
    if (node?.type === 'UnaryExpression' && node.operator === '-' && node.argument?.type === 'NumericLiteral') return -node.argument.value
    if (node?.type === 'UnaryExpression' && node.operator === '!' && node.argument?.type === 'NumericLiteral') return !node.argument.value
    if (node?.type === 'UnaryExpression' && node.operator === 'void' && node.argument?.type === 'NumericLiteral') return null
    if (node?.type === 'ArrayExpression') return node.elements.map(item => decode(item, scope, depth + 1))
    if (node?.type === 'ObjectExpression') {
      const result = Object.create(null)
      for (const property of node.properties) {
        if (property.type !== 'ObjectProperty' || property.computed || property.method) throw new Error('官网对象包含非数据成员')
        const key = property.key.name ?? property.key.value
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('官网对象包含无效字段')
        result[key] = decode(property.value, scope, depth + 1)
      }
      return result
    }
    if (node?.type === 'CallExpression' && node.callee.type === 'FunctionExpression') {
      const fn = node.callee
      if (fn.async || fn.generator || fn.body.body.at(-1)?.type !== 'ReturnStatement' || fn.params.some(param => param.type !== 'Identifier')) throw new Error('官网数据函数结构已变化')
      const argumentsScope = Object.create(null)
      fn.params.forEach((param, index) => { argumentsScope[param.name] = decode(node.arguments[index], scope, depth + 1) })
      for (const item of fn.body.body.slice(0, -1)) {
        const assignment = item.expression
        const left = assignment?.left
        const key = left?.computed ? left.property.value : left?.property?.name
        const object = left?.object?.type === 'Identifier' ? argumentsScope[left.object.name] : null
        if (item.type !== 'ExpressionStatement' || assignment?.type !== 'AssignmentExpression' || assignment.operator !== '=' || left?.type !== 'MemberExpression' || !object || typeof object !== 'object' || typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('官网数据包含非本地对象赋值')
        object[key] = decode(assignment.right, argumentsScope, depth + 1)
      }
      return decode(fn.body.body.at(-1).argument, argumentsScope, depth + 1)
    }
    throw new Error(`拒绝执行官网脚本成员：${node?.type || 'unknown'}`)
  }
  return decode(statement.right)
}
