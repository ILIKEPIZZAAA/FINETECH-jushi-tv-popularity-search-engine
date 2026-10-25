export function clearCompetitorAttemptMarkers(attempts, projectId) {
  const prefix = `${projectId}:`
  for (const attempt of attempts) {
    if (attempt.startsWith(prefix)) attempts.delete(attempt)
  }
}

export async function refreshCompetitorPool(competitors, {
  enqueue,
  hasWeb,
  hasTv,
  collectWeb,
  collectTv,
}) {
  let collected = 0
  for (const competitor of competitors) {
    collected += await enqueue(async () => {
      const tasks = []
      if (hasWeb(competitor)) tasks.push(collectWeb(competitor))
      if (hasTv(competitor)) tasks.push(collectTv(competitor))
      const results = await Promise.allSettled(tasks)
      return results.reduce((sum, result) => sum + (result.status === 'fulfilled' ? Number(result.value) || 0 : 0), 0)
    })
  }
  return collected
}
