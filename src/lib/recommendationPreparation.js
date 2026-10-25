import { sameDramaIdentity } from './dramaMonitor.js'

export async function prepareRecommendedCandidate(candidate, { searchDramas, getDramaDetails }) {
  let target = candidate
  if (candidate.provider !== 'catalog') {
    try {
      const payload = await searchDramas(candidate.title, candidate.contentType ? { contentType: candidate.contentType } : {})
      const rows = Array.isArray(payload) ? payload : payload.results || []
      target = rows.find((item) => item.provider === 'catalog' && sameDramaIdentity(candidate, item)) || candidate
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      // Keep the original source identity if its domestic counterpart is unconfirmed.
    }
  }
  // Preserve the recommendation's chosen category through identity enrichment;
  // the details API otherwise defaults an untyped candidate to drama.
  if (candidate.contentType) target = { ...target, contentType: candidate.contentType }
  const payload = await getDramaDetails(target)
  if (!sameDramaIdentity(candidate, payload.result)) throw new Error('推荐剧集详情身份不一致')
  return { ...candidate, ...payload.result, ...(candidate.contentType ? { contentType: candidate.contentType } : {}), title: candidate.title || payload.result.title }
}

export async function prepareRecommendedCandidates(candidates, api, concurrency = 3) {
  const results = new Array(candidates.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
    while (next < candidates.length) {
      const index = next++
      try {
        results[index] = { ...(await prepareRecommendedCandidate(candidates[index], api)), detailsPrepared: true }
      } catch (error) {
        if (error?.name === 'AbortError') throw error
        results[index] = { ...candidates[index], detailsPrepared: false }
      }
    }
  }))
  return results
}
