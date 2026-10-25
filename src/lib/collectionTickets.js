const KEY = 'glintscore-pending-source-jobs-v1'
const TTL = 30 * 60 * 1000

export function collectionTicketKey(path, options) {
  return `${options.method || 'GET'}:${path}:${options.body || ''}`
}

export function readCollectionTicket(key, now = Date.now()) {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(KEY) || '{}')[key]
    return value && now - value.savedAt < TTL ? value.jobId : null
  } catch { return null }
}

export function saveCollectionTicket(key, jobId, now = Date.now()) {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(KEY) || '{}')
    const next = Object.fromEntries(Object.entries(saved).filter(([, value]) => now - value.savedAt < TTL))
    if (jobId) next[key] = { jobId, savedAt: now }
    else delete next[key]
    window.sessionStorage.setItem(KEY, JSON.stringify(next))
  } catch { /* Existing dashboard storage warning handles unavailable storage. */ }
}
