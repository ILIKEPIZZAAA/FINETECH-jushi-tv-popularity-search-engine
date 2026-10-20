import test from 'node:test';
import assert from 'node:assert/strict';
import { SerialBrowserTaskQueue } from '../src/browser-task-queue.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

test('idle browser closes after the completed queue is empty for 30 seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let closed = 0;
  const queue = new SerialBrowserTaskQueue({ onIdle: async () => { closed++; } });
  assert.equal(await queue.enqueue(async () => 'verified result'), 'verified result');
  t.mock.timers.tick(29_999);
  await flush();
  assert.equal(closed, 0);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(closed, 1);
});

test('new work cancels scheduled cleanup and an active read is never closed', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let closed = 0, finish;
  const queue = new SerialBrowserTaskQueue({ onIdle: async () => { closed++; } });
  await queue.enqueue(async () => 1);
  t.mock.timers.tick(20_000);
  const read = queue.enqueue(() => new Promise(resolve => { finish = resolve; }));
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(closed, 0);
  finish('second independent read');
  assert.equal(await read, 'second independent read');
  t.mock.timers.tick(30_000);
  await flush();
  assert.equal(closed, 1);
});

test('a new source read waits until an in-progress browser teardown finishes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finishCleanup;
  const order = [];
  const queue = new SerialBrowserTaskQueue({ onIdle: () => {
    order.push('closing');
    return new Promise(resolve => { finishCleanup = () => { order.push('closed'); resolve(); }; });
  } });
  await queue.enqueue(async () => 'first');
  t.mock.timers.tick(30_000);
  await flush();
  const next = queue.enqueue(async () => { order.push('new read'); return 'unchanged data'; });
  await flush();
  assert.deepEqual(order, ['closing']);
  finishCleanup();
  assert.equal(await next, 'unchanged data');
  assert.deepEqual(order, ['closing', 'closed', 'new read']);
});
