export function createInFlightTaskRunner() {
  const tasks = new Map();
  function run(key, taskFactory, signal) {
    if (signal?.aborted) return Promise.reject(new DOMException("请求已取消", "AbortError"));
    let task = tasks.get(key);
    if (!task || task.controller.signal.aborted) {
      task = { controller: new AbortController(), subscribers: 0, settled: false };
      const own = task;
      task.promise = Promise.resolve().then(() => {
        own.controller.signal.throwIfAborted();
        return taskFactory(own.controller.signal);
      });
      tasks.set(key, task);
      const finish = () => { own.settled = true; if (tasks.get(key) === own) tasks.delete(key); };
      task.promise.then(finish, finish);
    }
    task.subscribers += 1;
    return new Promise((resolve, reject) => {
      let released = false;
      const release = (cancelled) => {
        if (released) return;
        released = true;
        signal?.removeEventListener("abort", onAbort);
        task.subscribers -= 1;
        if (cancelled && !task.subscribers && !task.settled) task.controller.abort(new DOMException("所有请求方均已离开", "AbortError"));
      };
      const onAbort = () => { release(true); reject(new DOMException("请求已取消", "AbortError")); };
      signal?.addEventListener("abort", onAbort, { once: true });
      task.promise.then((value) => { if (!released) { release(false); resolve(value); } }, (error) => { if (!released) { release(false); reject(error); } });
    });
  }
  run.has = (key) => tasks.has(key);
  return run;
}
