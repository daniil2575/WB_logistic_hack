import { useState, useEffect, useCallback } from 'react'
import { simulateAPI } from '../api'

export function useSimulator() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await simulateAPI.getStatus()
      setStatus(res.data)
    } catch (e) {
      console.error('Failed to fetch simulator status', e)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  const tick = async () => {
    setLoading(true)
    try {
      await simulateAPI.tick()
      await fetchStatus()
    } finally {
      setLoading(false)
    }
  }

  const setTime = async (timestamp) => {
    setLoading(true)
    try {
      await simulateAPI.setTime(timestamp)
      await fetchStatus()
    } finally {
      setLoading(false)
    }
  }

  const reset = async () => {
    setLoading(true)
    try {
      await simulateAPI.reset()
      await fetchStatus()
    } finally {
      setLoading(false)
    }
  }

  return { status, loading, tick, setTime, reset, refresh: fetchStatus }
}
