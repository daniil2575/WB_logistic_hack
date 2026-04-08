import { useEffect, useRef, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { forecastAPI } from '../api'
import { colors } from '../theme'

const PEAK_THRESHOLD = 150
const TOAST_TTL_MS  = 8000
const COOLDOWN_MS   = 10 * 60 * 1000

export function useToasts(status) {
  const [toasts, setToasts] = useState([])
  const lastToasted = useRef({})
  const toastCounter = useRef(0)
  const timeoutIds = useRef([])

  useEffect(() => {
    return () => { timeoutIds.current.forEach(id => clearTimeout(id)) }
  }, [])

  useEffect(() => {
    if (!status?.available_routes?.length) return
    const routes = status.available_routes.slice(0, 10)
    const now = Date.now()

    Promise.all(routes.map(rid => forecastAPI.getRoute(rid).then(r => r.data).catch(() => null)))
      .then(forecasts => {
        let best = null
        forecasts.forEach(fc => {
          if (!fc) return
          const step1 = fc.predictions?.[0]
          if (!step1 || step1.y_pred < PEAK_THRESHOLD) return
          const sinceLastToast = now - (lastToasted.current[fc.route_id] || 0)
          if (sinceLastToast < COOLDOWN_MS) return
          if (!best || step1.y_pred > best.y_pred) {
            best = { routeId: fc.route_id, y_pred: step1.y_pred, timestamp: step1.timestamp }
          }
        })
        if (!best) return
        lastToasted.current[best.routeId] = now
        const id = ++toastCounter.current
        setToasts(prev => [...prev, {
          id,
          routeId: best.routeId,
          message: `Маршрут #${best.routeId}: ожидается ${Math.round(best.y_pred)} посылок через 30 мин`,
        }])
        const tid = setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), TOAST_TTL_MS)
        timeoutIds.current.push(tid)
      })
  }, [status?.current_time])

  const dismiss = (id) => setToasts(prev => prev.filter(t => t.id !== id))

  return { toasts, dismiss }
}

export default function ToastNotification({ toasts, onDismiss, onCreateOrder }) {
  if (!toasts.length) return null
  return (
    <div style={s.container}>
      {toasts.map(t => (
        <div key={t.id} style={s.toast}>
          <div style={s.toastIcon}><Bell size={14} color={colors.wb1} /></div>
          <div style={s.toastBody}>
            <div style={s.toastMsg}>{t.message}</div>
            <button style={s.toastAction} onClick={() => onCreateOrder?.(t.routeId)}>
              Создать заявку
            </button>
          </div>
          <button style={s.toastClose} onClick={() => onDismiss(t.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}

const s = {
  container: {
    position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
    display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 340,
  },
  toast: {
    background: 'rgba(13,27,46,0.97)', border: `1px solid ${colors.border}`,
    borderLeft: `3px solid ${colors.wb1}`, borderRadius: 10,
    padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 10,
    backdropFilter: 'blur(12px)', boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
  },
  toastIcon: { marginTop: 2, flexShrink: 0 },
  toastBody: { flex: 1, display: 'flex', flexDirection: 'column', gap: 6 },
  toastMsg: { fontSize: 13, color: colors.textPrimary, lineHeight: 1.4 },
  toastAction: {
    alignSelf: 'flex-start', background: 'linear-gradient(135deg, #7B00B4, #CB11AB)', color: '#fff',
    border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12,
    fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  },
  toastClose: {
    background: 'none', border: 'none', color: colors.textMuted,
    cursor: 'pointer', padding: 2, flexShrink: 0,
  },
}
