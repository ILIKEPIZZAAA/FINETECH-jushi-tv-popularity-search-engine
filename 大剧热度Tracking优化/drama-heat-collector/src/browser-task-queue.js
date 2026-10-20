export class BrowserTaskQueueError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BrowserTaskQueueError";
    this.code = code;
  }
}

// 浏览器采集复用同一张页面，任务必须串行；此队列只保留仍有机会返回给用户的任务。
// 超出容量或已经等待过久的任务会明确失败，不会在调用方超时后继续消耗浏览器。
export class SerialBrowserTaskQueue {
  constructor({ maxPending = 12, defaultMaxWaitMs = 25_000, onIdle = null, idleMs = 30_000 } = {}) {
    this.maxPending = maxPending;
    this.defaultMaxWaitMs = defaultMaxWaitMs;
    this.pending = [];
    this.active = null;
    this.onIdle = onIdle;
    this.idleMs = idleMs;
    this.idleTimer = null;
    this.cleanup = null;
  }

  snapshot() {
    return {
      active: this.active?.label || null,
      pending: this.pending.length,
      capacity: this.maxPending,
    };
  }

  enqueue(fn, { label = "浏览器采集", maxWaitMs = this.defaultMaxWaitMs, signal } = {}) {
    if (signal?.aborted) {
      return Promise.reject(new BrowserTaskQueueError("REQUEST_ABORTED", `${label}请求已取消，未进入浏览器队列`));
    }
    if (this.pending.length >= this.maxPending) {
      return Promise.reject(new BrowserTaskQueueError("QUEUE_FULL", `浏览器采集队列繁忙（最多等待 ${this.maxPending} 项），请稍后重试；该任务未进入后台队列`));
    }
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    return new Promise((resolve, reject) => {
      this.pending.push({ fn, label, maxWaitMs, signal, enqueuedAt: Date.now(), resolve, reject });
      void this.drain();
    });
  }

  async drain() {
    if (this.active || this.cleanup) return;
    const job = this.pending.shift();
    if (!job) {
      this.scheduleIdleCleanup();
      return;
    }
    this.active = job;
    try {
      if (job.signal?.aborted) {
        throw new BrowserTaskQueueError("REQUEST_ABORTED", `${job.label}请求已取消，未执行浏览器任务`);
      }
      const waitedMs = Date.now() - job.enqueuedAt;
      if (waitedMs > job.maxWaitMs) {
        throw new BrowserTaskQueueError("QUEUE_WAIT_EXPIRED", `${job.label}等待浏览器队列 ${Math.ceil(waitedMs / 1000)} 秒，已过期且未执行；请稍后重试`);
      }
      job.resolve(await job.fn({ signal: job.signal, queuedForMs: waitedMs }));
    } catch (error) {
      job.reject(error);
    } finally {
      this.active = null;
      void this.drain();
    }
  }

  scheduleIdleCleanup() {
    if (!this.onIdle || this.idleTimer || this.cleanup || this.active || this.pending.length) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.active || this.pending.length) return;
      // New jobs wait for teardown before acquiring the shared browser page.
      // A cleanup failure must not turn a completed source read into failure.
      this.cleanup = Promise.resolve().then(() => this.onIdle()).catch(error => {
        console.warn('采集浏览器空闲回收失败:', error instanceof Error ? error.message : String(error));
      }).finally(() => {
        this.cleanup = null;
        if (this.pending.length) void this.drain();
      });
    }, this.idleMs);
    this.idleTimer.unref?.();
  }
}
