import test from 'node:test'
import assert from 'node:assert/strict'
import { formatSourceMetric } from '../src/lib/dramaMonitor.js'

test('网端猫眼和骨朵图表展示源值两位小数并截断而不四舍五入', () => {
  assert.equal(formatSourceMetric(9383.299), '9,383.29')
  assert.equal(formatSourceMetric(69), '69.00')
})
