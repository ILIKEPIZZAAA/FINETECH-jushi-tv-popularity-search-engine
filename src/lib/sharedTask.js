export function createSerialTaskQueue() {
  let tail = Promise.resolve()
  return (work) => {
    const task = tail.catch(() => undefined).then(work)
    tail = task
    // Keep a failed job observable to its caller without an unhandled tail.
    void task.catch(() => undefined)
    return task
  }
}

export function runSharedTask(tasks, key, work) {
  if (key === null || key === undefined) return Promise.resolve().then(work)

  const active = tasks.get(key)
  if (active) return active

  let shared
  shared = Promise.resolve()
    .then(work)
    .finally(() => {
      if (tasks.get(key) === shared) tasks.delete(key)
    })
  tasks.set(key, shared)
  return shared
}
