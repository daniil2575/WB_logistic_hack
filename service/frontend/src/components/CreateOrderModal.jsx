import { useEffect, useState } from 'react'
import { X, Truck, Sparkles } from 'lucide-react'
import { forecastAPI } from '../api'
import { colors } from '../theme'

const VEHICLES = [
  { name: 'gazelle', label: 'Газель',           capacity: 100,  cost: 4000  },
  { name: 'medium',  label: 'Средний грузовик', capacity: 300,  cost: 10000 },
  { name: 'large',   label: 'Фура',             capacity: 1000, cost: 27000 },
]

function recommend(forecast) {
  if (!forecast?.predictions?.length) return null
  const peak = forecast.predictions.reduce((a, b) => a.y_pred > b.y_pred ? a : b)
  const vol  = peak.y_pred
  const v = vol > 300 ? VEHICLES[2] : vol > 100 ? VEHICLES[1] : VEHICLES[0]
  const leadMs = v.name === 'large' ? 3 * 3600000 : v.name === 'medium' ? 2 * 3600000 : 1.5 * 3600000
  const dispatchAt = new Date(new Date(peak.timestamp).getTime() - leadMs)
  const pad = n => String(n).padStart(2, '0')
  const dispatchStr = `${dispatchAt.getFullYear()}-${pad(dispatchAt.getMonth()+1)}-${pad(dispatchAt.getDate())}T${pad(dispatchAt.getHours())}:${pad(dispatchAt.getMinutes())}`
  return {
    vehicleName: v.name,
    dispatchAt: dispatchStr,
    volume: Math.round(vol),
    peakTime: new Date(peak.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    utilization: Math.round(Math.min(vol / v.capacity, 1) * 100),
    vehicleLabel: v.label,
  }
}

function isoToLocal(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function CreateOrderModal({ open, onClose, onSubmit, initialRouteId, initialOrder, status }) {
  const routes = status?.available_routes || []
  const [search, setSearch]         = useState('')
  const [routeId, setRouteId]       = useState(null)
  const [vehicle, setVehicle]       = useState('gazelle')
  const [dispatchAt, setDispatchAt] = useState('')
  const [volume, setVolume]         = useState('')
  const [forecast, setForecast]     = useState(null)
  const [loadingFc, setLoadingFc]   = useState(false)
  const [isEdit, setIsEdit]         = useState(false)
  const rec = recommend(forecast)

  useEffect(() => {
    if (!open) return
    setSearch('')
    setForecast(null)
    if (initialOrder) {
      setIsEdit(true)
      setRouteId(initialOrder.route_id)
      setVehicle(initialOrder.vehicle.name)
      setDispatchAt(isoToLocal(initialOrder.dispatch_at))
      setVolume(String(Math.round(initialOrder.forecast_volume)))
    } else {
      setIsEdit(false)
      setRouteId(initialRouteId ?? null)
      setVehicle('gazelle')
      setDispatchAt('')
      setVolume('')
    }
  }, [open, initialRouteId, initialOrder])

  useEffect(() => {
    if (routeId === null) return
    setLoadingFc(true)
    forecastAPI.getRoute(routeId)
      .then(r => {
        setForecast(r.data)
        // auto-fill only for fresh create, not when editing existing order
        if (!isEdit) {
          const r2 = recommend(r.data)
          if (r2) {
            setVehicle(r2.vehicleName)
            setDispatchAt(r2.dispatchAt)
            setVolume(String(r2.volume))
          }
        }
      })
      .catch(console.error)
      .finally(() => setLoadingFc(false))
  }, [routeId])

  if (!open) return null

  const filteredRoutes = routes.filter(r => String(r).includes(search)).slice(0, 100)

  const handleSubmit = () => {
    const v = VEHICLES.find(v => v.name === vehicle)
    onSubmit({
      order_id: String(Date.now()).slice(-8),
      route_id: routeId,
      office_from_id: 0,
      vehicle: { name: v.name, label: v.label, capacity: v.capacity, cost_rub: v.cost },
      dispatch_at: dispatchAt ? new Date(dispatchAt).toISOString() : new Date().toISOString(),
      forecast_volume: parseFloat(volume) || 0,
      utilization: Math.min((parseFloat(volume) || 0) / v.capacity, 1),
      created_at: new Date().toISOString(),
      manual: true,
    })
    onClose()
  }

  return (
    <div style={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={s.modal}>
        <div style={s.header}>
          <span style={s.title}>{isEdit ? 'Изменить заявку' : 'Новая заявка'}</span>
          <button style={s.closeBtn} onClick={onClose}><X size={18} /></button>
        </div>

        <div style={s.field}>
          <label style={s.label}>Маршрут</label>
          <input
            style={s.input}
            placeholder="Поиск маршрута..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            style={{ ...s.input, marginTop: 6, height: 120 }}
            size={5}
            value={routeId ?? ''}
            onChange={e => setRouteId(Number(e.target.value))}
          >
            {filteredRoutes.map(r => (
              <option key={r} value={r}>Маршрут #{r}</option>
            ))}
          </select>
        </div>

        {rec && (
          <div style={s.recBlock}>
            <Sparkles size={13} color={colors.wb1} />
            <span style={s.recText}>
              Ожидается <strong>{rec.volume}</strong> посылок к {rec.peakTime}, загрузка {rec.vehicleLabel} {rec.utilization}%
            </span>
          </div>
        )}

        <div style={s.field}>
          <label style={s.label}>Тип транспорта</label>
          <div style={s.radioGroup}>
            {VEHICLES.map(v => (
              <button
                key={v.name}
                style={{ ...s.radioBtn, ...(vehicle === v.name ? s.radioBtnActive : {}) }}
                onClick={() => setVehicle(v.name)}
              >
                <Truck size={13} />
                {v.label}
                {rec?.vehicleName === v.name && (
                  <span style={s.recBadge}>✦ рек.</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div style={s.field}>
          <label style={s.label}>Время подачи</label>
          <input
            type="datetime-local"
            style={s.input}
            value={dispatchAt}
            onChange={e => setDispatchAt(e.target.value)}
          />
        </div>

        <div style={s.field}>
          <label style={s.label}>Объём (посылок)</label>
          <input
            type="number"
            style={s.input}
            value={volume}
            onChange={e => setVolume(e.target.value)}
            placeholder="Введите объём"
          />
        </div>

        <div style={s.footer}>
          <button style={s.cancelBtn} onClick={onClose}>Отменить</button>
          <button
            style={{ ...s.submitBtn, opacity: routeId === null ? 0.4 : 1 }}
            disabled={routeId === null || loadingFc}
            onClick={handleSubmit}
          >
            {loadingFc ? 'Загрузка...' : 'Отправить заявку'}
          </button>
        </div>
      </div>
    </div>
  )
}

const s = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1001,
    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: 'rgba(13,20,40,0.98)', border: `1px solid rgba(203,17,171,0.3)`,
    borderRadius: 16, padding: 24, width: 440, maxWidth: '90vw',
    display: 'flex', flexDirection: 'column', gap: 16,
    boxShadow: '0 8px 48px rgba(0,0,0,0.6)',
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: 800, color: colors.textPrimary },
  closeBtn: { background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', padding: 4 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 12, color: colors.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    background: 'rgba(255,255,255,0.05)', border: `1px solid ${colors.border}`,
    borderRadius: 8, color: colors.textPrimary, padding: '9px 12px',
    fontSize: 13, fontFamily: 'inherit', outline: 'none',
  },
  recBlock: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'rgba(123,0,180,0.12)', border: `1px solid rgba(123,0,180,0.3)`,
    borderRadius: 8, padding: '10px 12px',
  },
  recText: { fontSize: 13, color: colors.textSecondary, lineHeight: 1.4 },
  radioGroup: { display: 'flex', gap: 8 },
  radioBtn: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    background: 'rgba(255,255,255,0.04)', border: `1px solid ${colors.border}`,
    borderRadius: 8, padding: '9px 8px', cursor: 'pointer',
    fontSize: 12, color: colors.textSecondary, fontFamily: 'inherit',
  },
  radioBtnActive: {
    background: 'rgba(203,17,171,0.15)', borderColor: colors.wb1, color: '#e87cda',
  },
  recBadge: {
    fontSize: 10, color: colors.wb1, fontWeight: 700,
    background: 'rgba(203,17,171,0.15)', borderRadius: 4, padding: '1px 5px',
  },
  footer: { display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 },
  cancelBtn: {
    background: 'rgba(255,255,255,0.06)', border: `1px solid ${colors.border}`,
    borderRadius: 8, color: colors.textSecondary, padding: '10px 20px',
    cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
  },
  submitBtn: {
    background: 'linear-gradient(135deg, #7B00B4, #CB11AB)',
    color: '#fff', border: 'none', borderRadius: 8,
    padding: '10px 24px', cursor: 'pointer', fontSize: 13,
    fontWeight: 700, fontFamily: 'inherit',
  },
}
