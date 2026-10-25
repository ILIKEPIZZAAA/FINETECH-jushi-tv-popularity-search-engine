// Treat uninterrupted wheel events (including trackpad inertia) as one gesture.
// A quiet interval followed by a new gesture releases the checkpoint.
export function createScrollCheckpoint({ idleMs = 240, rearmDistance = 80 } = {}) {
  let phase = 'armed'
  let lastBlockedAt = -Infinity

  return {
    reset() {
      phase = 'armed'
      lastBlockedAt = -Infinity
    },
    shouldStop({ position, delta, stop, now }) {
      if (position < stop - rearmDistance) phase = 'armed'
      if (delta <= 0) {
        // Never trap upward navigation, even during the held gesture.
        if (delta < 0 && phase === 'held') phase = 'armed'
        return false
      }
      if (phase === 'held' && now - lastBlockedAt >= idleMs) phase = 'released'
      if (phase === 'released' || position > stop + 2) return false
      if (phase === 'held' || position + delta >= stop) {
        phase = 'held'
        lastBlockedAt = now
        return true
      }
      return false
    },
  }
}
