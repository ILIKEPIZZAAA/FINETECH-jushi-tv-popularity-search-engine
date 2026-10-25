// Page readiness and source-task lifetime are separate. Keep the original task
// alive (and deduplicated/cancellable) until its background sources settle.
export function foregroundCollection(work) {
  let release
  const ready = new Promise(resolve => { release = resolve })
  const complete = Promise.resolve().then(() => work(release))
  void complete.then(release, release)
  return { ready, complete }
}

export async function settleCollectionPhases(tasks, onForegroundReady = () => {}) {
  // Attach rejection handlers immediately, including for background work.
  const complete = Promise.allSettled(tasks.map(task => task.promise))
  await Promise.allSettled(tasks.filter(task => !task.background).map(task => task.promise))
  onForegroundReady()
  return complete
}
