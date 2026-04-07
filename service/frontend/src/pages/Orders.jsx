import { useEffect, useState } from 'react'
import { Truck, Filter, Package, Clock, MapPin } from 'lucide-react'
import { transportAPI } from '../api'
import { useSimulator } from '../hooks/useSimulator'
import { colors } from '../theme'

const VEHICLE_COLORS = { large: colors.red, medium: colors.yellow, gazelle: colors.green }

export default function Orders() {
  const { status } = useSimulator()
  const [data, setData] = useState(null)
  const [filter, setFilter] = useState('all')  // all | large | medium | gazelle
  const [sortBy, setSortBy] = useState('dispatch_at')

  useEffect(() => {
    transportAPI.getOrders()
      .then(r => setData(r.data))
      .catch(console.error)
  }, [status?.current_time])

  const orders = data?.orders || []
  const filtered = orders
    .filter(o => filter === 'all' || o.vehicle.name === filter)
    .sort((a, b) => {
      if (sortBy === 'dispatch_at') return new Date(a.dispatch_at) - new Date(b.dispatch_at)
      if (sortBy === 'volume') return b.forecast_volume - a.forecast_volume
      if (sortBy === 'utilization') return b.utilization - a.utilization
      return 0
    })

  const summary = {
    total: orders.length,
    large: orders.filter(o => o.vehicle.name === 'large').length,
    medium: orders.filter(o => o.vehicle.name === 'medium').length,
    gazelle: orders.filter(o => o.vehicle.name === 'gazelle').length,
    cost: data?.total_cost_rub || 0,
  }

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>Заявки на транспорт</h1>
          <p style={s.pageSubtitle}>Сформированные заявки на основе прогноза отгрузок</p>
        </div>
        <div style={s.totalCost}>
          Итого: <span style={{ color: colors.green, fontWeight: 800 }}>₽{summary.cost.toLocaleString('ru-RU')}</span>
        </div>
      </div>

      {/* Vehicle summary */}
      <div style={s.vehicleSummary}>
        {[
          { key: 'all', label: 'Все', count: summary.total, color: colors.wb1 },
          { key: 'large', label: 'Фуры', count: summary.large, color: colors.red },
          { key: 'medium', label: 'Средние', count: summary.medium, color: colors.yellow },
          { key: 'gazelle', label: 'Газели', count: summary.gazelle, color: colors.green },
        ].map(v => (
          <button
            key={v.key}
            style={{ ...s.vehicleFilter, ...(filter === v.key ? { background: v.color + '22', borderColor: v.color, color: v.color } : {}) }}
            onClick={() => setFilter(v.key)}
          >
            <Truck size={14} />
            <span>{v.label}</span>
            <span style={s.filterCount}>{v.count}</span>
          </button>
        ))}

        <div style={{ flex: 1 }} />

        <div style={s.sortRow}>
          <Filter size={13} color={colors.textMuted} />
          <span style={s.sortLabel}>Сортировка:</span>
          {[
            { key: 'dispatch_at', label: 'По времени' },
            { key: 'volume', label: 'По объёму' },
            { key: 'utilization', label: 'По загрузке' },
          ].map(opt => (
            <button
              key={opt.key}
              style={{ ...s.sortBtn, ...(sortBy === opt.key ? s.sortBtnActive : {}) }}
              onClick={() => setSortBy(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Orders grid */}
      {filtered.length === 0 ? (
        <div style={s.empty}>
          <Truck size={40} color={colors.textMuted} />
          <div>Заявок нет</div>
        </div>
      ) : (
        <div style={s.grid}>
          {filtered.map(o => (
            <OrderCard key={o.order_id} order={o} currentTime={status?.current_time} />
          ))}
        </div>
      )}
    </div>
  )
}

function OrderCard({ order, currentTime }) {
  const color = VEHICLE_COLORS[order.vehicle.name] || colors.wb1
  const dispatchTime = new Date(order.dispatch_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const dispatchDate = new Date(order.dispatch_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  const utilPct = Math.round(order.utilization * 100)
  const minutesLeft = Math.round((new Date(order.dispatch_at) - new Date(currentTime)) / 60000)
  const isUrgent = minutesLeft < 60 && minutesLeft >= 0
  const isOverdue = minutesLeft < 0

  return (
    <div style={{ ...s.card, borderColor: isUrgent ? colors.yellow + '55' : isOverdue ? colors.red + '55' : colors.border }}>
      <div style={s.cardTop}>
        <div style={{ ...s.vBadge, background: color + '18', color }}>
          <Truck size={12} />
          {order.vehicle.label}
        </div>
        <div style={{ ...s.urgency, color: isOverdue ? colors.red : isUrgent ? colors.yellow : colors.textMuted }}>
          {isOverdue ? '⚠ Просрочено' : isUrgent ? `⏱ ${minutesLeft} мин` : `${minutesLeft} мин`}
        </div>
      </div>

      <div style={s.cardMain}>
        <div style={s.cardField}>
          <MapPin size={11} color={colors.textMuted} />
          <span style={s.fieldLabel}>Маршрут</span>
          <span style={s.fieldVal}>#{order.route_id}</span>
        </div>
        <div style={s.cardField}>
          <Package size={11} color={colors.textMuted} />
          <span style={s.fieldLabel}>Склад</span>
          <span style={s.fieldVal}>#{order.office_from_id}</span>
        </div>
        <div style={s.cardField}>
          <Clock size={11} color={colors.textMuted} />
          <span style={s.fieldLabel}>Подать до</span>
          <span style={{ ...s.fieldVal, color: isOverdue ? colors.red : isUrgent ? colors.yellow : colors.textPrimary, fontWeight: 700 }}>
            {dispatchDate} {dispatchTime}
          </span>
        </div>
        <div style={s.cardField}>
          <Package size={11} color={colors.textMuted} />
          <span style={s.fieldLabel}>Объём</span>
          <span style={s.fieldVal}>{Math.round(order.forecast_volume)} поc.</span>
        </div>
      </div>

      <div style={s.utilSection}>
        <div style={s.utilHeader}>
          <span style={s.utilLabel}>Загрузка</span>
          <span style={{ color, fontWeight: 700, fontSize: 13 }}>{utilPct}%</span>
        </div>
        <div style={s.utilBar}>
          <div style={{ ...s.utilFill, width: `${utilPct}%`, background: color }} />
        </div>
        <div style={s.utilFooter}>
          <span style={s.utilSub}>{Math.round(order.forecast_volume)} / {order.vehicle.capacity} посылок</span>
          <span style={s.costTag}>₽{order.vehicle.cost_rub.toLocaleString('ru-RU')}</span>
        </div>
      </div>
    </div>
  )
}

const s = {
  page: { padding: 28, display: 'flex', flexDirection: 'column', gap: 20 },
  pageHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  pageTitle: { fontSize: 26, fontWeight: 800, color: colors.textPrimary },
  pageSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  totalCost: { fontSize: 15, color: colors.textSecondary, background: 'rgba(13,27,46,0.8)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '8px 16px' },
  vehicleSummary: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  vehicleFilter: { display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(13,27,46,0.8)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13, color: colors.textSecondary, fontFamily: 'inherit', transition: 'all 0.15s' },
  filterCount: { background: 'rgba(255,255,255,0.08)', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700 },
  sortRow: { display: 'flex', alignItems: 'center', gap: 6 },
  sortLabel: { fontSize: 12, color: colors.textMuted },
  sortBtn: { background: 'none', border: `1px solid ${colors.border}`, borderRadius: 6, padding: '5px 10px', fontSize: 12, color: colors.textSecondary, cursor: 'pointer', fontFamily: 'inherit' },
  sortBtnActive: { background: 'rgba(203,17,171,0.15)', borderColor: colors.wb1, color: '#e87cda' },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: colors.textMuted, padding: 80, fontSize: 14 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 },
  card: { background: 'rgba(13,27,46,0.85)', border: '1px solid', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, backdropFilter: 'blur(8px)', transition: 'border-color 0.2s' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  vBadge: { display: 'flex', alignItems: 'center', gap: 5, borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 700 },
  urgency: { fontSize: 12, fontWeight: 600 },
  cardMain: { display: 'flex', flexDirection: 'column', gap: 6 },
  cardField: { display: 'flex', alignItems: 'center', gap: 6 },
  fieldLabel: { fontSize: 12, color: colors.textMuted, flex: 1 },
  fieldVal: { fontSize: 13, color: colors.textSecondary, fontWeight: 600 },
  utilSection: { display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 8, borderTop: `1px solid ${colors.border}` },
  utilHeader: { display: 'flex', justifyContent: 'space-between' },
  utilLabel: { fontSize: 12, color: colors.textMuted },
  utilBar: { height: 5, background: colors.border, borderRadius: 3, overflow: 'hidden' },
  utilFill: { height: '100%', borderRadius: 3, transition: 'width 0.3s' },
  utilFooter: { display: 'flex', justifyContent: 'space-between' },
  utilSub: { fontSize: 11, color: colors.textMuted },
  costTag: { fontSize: 12, color: colors.green, fontWeight: 700 },
}
