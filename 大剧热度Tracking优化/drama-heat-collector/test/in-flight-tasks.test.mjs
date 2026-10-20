import test from 'node:test';
import assert from 'node:assert/strict';
import { createInFlightTaskRunner } from '../src/in-flight-tasks.js';

test('一个调用方退出不会中止共享源请求，全部退出才取消', async () => {
  const run = createInFlightTaskRunner();
  const a = new AbortController(), b = new AbortController();
  let signal, calls = 0;
  const work = async (shared) => { signal = shared; calls++; return new Promise((resolve, reject) => shared.addEventListener('abort', () => reject(shared.reason), { once: true })); };
  const first = run('source', work, a.signal), second = run('source', work, b.signal);
  const results = Promise.allSettled([first, second]);
  await new Promise((resolve) => setImmediate(resolve));
  a.abort();
  assert.equal(signal.aborted, false);
  b.abort();
  assert.equal(signal.aborted, true);
  assert.deepEqual((await results).map((result) => result.status), ['rejected', 'rejected']);
  assert.equal(calls, 1);
});
