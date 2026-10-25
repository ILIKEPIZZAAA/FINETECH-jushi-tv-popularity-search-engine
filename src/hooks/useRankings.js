import { useEffect, useState } from 'react'

export function useRankings(enabled = true) {
  const [rankings, setRankings] = useState({ boards: [], loading: true, error: '' })
  useEffect(() => {
    if (!enabled) return undefined
    const controller = new AbortController()
    fetch('/api/rankings', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('榜单缓存暂时不可用')
      const data = await response.json()
      if (!Array.isArray(data.boards)) throw new Error('榜单缓存结构未确认')
      setRankings({ ...data, loading: false, error: '' })
    }).catch(error => {
      if (error.name !== 'AbortError') setRankings({ boards: [], loading: false, error: '榜单暂时不可用，请稍后查看' })
    })
    return () => controller.abort()
  }, [enabled])
  return rankings
}
