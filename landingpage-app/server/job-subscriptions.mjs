export function createJobSubscriptions({ now = Date.now, leaseMs = 180_000 } = {}) {
  const jobs = new Map()
  const release = (client, jobId) => {
    for (const [id, job] of jobs) {
      if (jobId && id !== jobId) continue
      job.clients.delete(client)
      if (!job.clients.size) {
        jobs.delete(id)
        job.controller.abort(new DOMException('所有采集页面均已离开', 'AbortError'))
      }
    }
  }
  return {
    join(client, id, controller) {
      if (!client || controller.signal.aborted) return
      let job = jobs.get(id)
      if (!job) { job = { controller, clients: new Map() }; jobs.set(id, job) }
      job.clients.set(client, now() + leaseMs)
    },
    release,
    finish(id) { jobs.delete(id) },
    expire() {
      for (const [id, job] of jobs) for (const [client, expiry] of job.clients) if (expiry <= now()) release(client, id)
    },
  }
}
