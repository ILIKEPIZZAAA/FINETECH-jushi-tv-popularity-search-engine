export function coalesceInFlight(map, key, loader) {
  const current = map.get(key)
  if (current) return current
  const task = Promise.resolve().then(loader)
  map.set(key, task)
  task.finally(() => {
    if (map.get(key) === task) map.delete(key)
  }).catch(() => undefined)
  return task
}
