import { useEffect, useState } from 'react'
import { Truck, Package, TrendingUp, AlertCircle, ArrowRight, MapPin } from 'lucide-react'
import { metricsAPI, transportAPI } from '../api'
import { useSimulator } from '../hooks/useSimulator'
import { colors } from '../theme'
import { useNavigate } from 'react-router-dom'
import PageLoader from '../components/PageLoader'

export default function Dashboard() {
  const { status } = useSimulator()
  const [metrics, setMetrics] = useState(null)
  const [orders, setOrders] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    setLoading(true)
    Promise.all([
      metricsAPI.get().then(r => setMetrics(r.data)),
      transportAPI.getOrders().then(r => setOrders(r.data)),
    ]).catch(console.error).finally(() => setLoading(false))
  }, [status?.current_time])

  const kpis = metrics ? [
    { label: 'Загрузка машин', value: `${Math.round(metrics.avg_utilization * 100)}%`, target: '≥75%', ok: metrics.avg_utilization >= 0.75, icon: <Truck size={20} />, color: colors.wb1 },
    { label: 'Своевременность', value: `${Math.round(metrics.on_time_dispatch_rate * 100)}%`, target: '≥95%', ok: metrics.on_time_dispatch_rate >= 0.95, icon: <TrendingUp size={20} />, color: colors.green },
    { label: 'Активных заявок', value: metrics.total_orders, target: null, ok: null, icon: <Package size={20} />, color: colors.blue },
    { label: 'Стоимость/посылка', value: `₽${metrics.cost_per_parcel_rub?.toFixed(1)}`, target: '₽25-60', ok: metrics.cost_per_parcel_rub >= 25 && metrics.cost_per_parcel_rub <= 60, icon: <AlertCircle size={20} />, color: colors.yellow },
  ] : []

  const topRoutes = metrics?.routes?.slice(0, 5) || []
  const urgentOrders = orders?.orders?.filter(o => {
    const diff = (new Date(o.dispatch_at) - new Date(status?.current_time)) / 60000
    return diff < 90
  }).slice(0, 4) || []

  return (
    <PageLoader loading={loading}>
    <div style={s.page}>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>Дашборд</h1>
          <p style={s.pageSubtitle}>Общий обзор системы управления транспортом</p>
        </div>
        <div style={s.liveTag}>
          <span style={s.liveDot} />
          LIVE
        </div>
      </div>

      {/* KPI Grid */}
      <div style={s.kpiGrid}>
        {kpis.map((k, i) => (
          <div key={i} style={{ ...s.kpiCard, borderColor: k.color + '33' }}>
            <div style={{ ...s.kpiIcon, background: k.color + '18', color: k.color }}>{k.icon}</div>
            <div style={s.kpiRight}>
              <div style={s.kpiValue}>{k.value ?? '—'}</div>
              <div style={s.kpiLabel}>{k.label}</div>
              {k.target && (
                <div style={{ ...s.kpiTarget, color: k.ok ? colors.textSecondary : colors.textMuted }}>
                  цель: {k.target}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={s.row}>
        {/* Urgent orders */}
        <div style={s.card}>
          <div style={s.cardHeader}>
            <span style={s.cardTitle}>Срочные заявки</span>
            <button style={s.link} onClick={() => navigate('/orders')}>
              Все заявки <ArrowRight size={12} />
            </button>
          </div>
          {urgentOrders.length === 0 ? (
            <div style={s.empty}>Срочных заявок нет</div>
          ) : (
            urgentOrders.map(o => (
              <UrgentOrderRow key={o.order_id} order={o} currentTime={status?.current_time} />
            ))
          )}
        </div>

        {/* Top routes */}
        <div style={s.card}>
          <div style={s.cardHeader}>
            <span style={s.cardTitle}>Топ маршруты по загрузке</span>
            <button style={s.link} onClick={() => navigate('/analytics')}>
              Аналитика <ArrowRight size={12} />
            </button>
          </div>
          {topRoutes.map(r => (
            <RouteRow key={r.route_id} route={r} />
          ))}
        </div>
      </div>

      {/* Summary bar */}
      {orders && (
        <div style={s.summaryBar}>
          <SummaryItem label="Всего заявок" value={orders.total_orders} color={colors.wb1} />
          <SummaryItem label="Общая стоимость" value={`₽${orders.total_cost_rub?.toLocaleString('ru-RU')}`} color={colors.textPrimary} />
          <SummaryItem label="Активных маршрутов" value={metrics?.routes?.length ?? '—'} color={colors.textPrimary} />
          <SummaryItem label="Складов" value={new Set(orders.orders?.map(o => o.office_from_id)).size} color={colors.blue} />
        </div>
      )}
    </div>
    </PageLoader>
  )
}

function UrgentOrderRow({ order, currentTime }) {
  const diff = Math.round((new Date(order.dispatch_at) - new Date(currentTime)) / 60000)
  const urgent = diff < 60
  return (
    <div style={s.orderRow}>
      <div style={{ ...s.vehicleTag, background: VCOLORS[order.vehicle.name] + '22', color: VCOLORS[order.vehicle.name] }}>
        {order.vehicle.label}
      </div>
      <div style={s.orderInfo}>
        <span style={s.orderRoute}>Маршрут #{order.route_id}</span>
        <span style={s.orderVol}>{Math.round(order.forecast_volume)} посылок</span>
      </div>
      <div style={{ ...s.orderTime, color: urgent ? colors.red : colors.textMuted }}>
        {diff < 0 ? 'Просрочено' : `через ${diff} мин`}
      </div>
    </div>
  )
}

function RouteRow({ route }) {
  const pct = Math.round(route.avg_utilization * 100)
  const color = pct >= 80 ? colors.wb1 : pct >= 50 ? colors.blue : '#3a5070'
  return (
    <div style={s.routeRow}>
      <MapPin size={12} color={colors.textMuted} />
      <span style={s.routeId}>#{route.route_id}</span>
      <div style={s.barWrap}>
        <div style={{ ...s.barFill, width: `${pct}%`, background: color }} />
      </div>
      <span style={{ ...s.routePct, color }}>{pct}%</span>
      <span style={s.routeCost}>₽{route.total_cost_rub?.toLocaleString('ru-RU')}</span>
    </div>
  )
}

function SummaryItem({ label, value, color }) {
  return (
    <div style={s.summaryItem}>
      <div style={{ ...s.summaryVal, color }}>{value}</div>
      <div style={s.summaryLabel}>{label}</div>
    </div>
  )
}

const VCOLORS = { large: colors.wb1, medium: colors.blue, gazelle: '#6b8fae' }

const s = {
  page: { padding: 28, display: 'flex', flexDirection: 'column', gap: 20 },
  pageHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  pageTitle: { fontSize: 26, fontWeight: 800, color: colors.textPrimary },
  pageSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  liveTag: { display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(203,17,171,0.1)', border: '1px solid rgba(203,17,171,0.25)', borderRadius: 20, padding: '4px 12px', fontSize: 11, fontWeight: 800, color: colors.wb1, letterSpacing: 2 },
  liveDot: { width: 6, height: 6, borderRadius: '50%', background: colors.wb1, boxShadow: `0 0 8px ${colors.wb1}`, display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 },
  kpiCard: { background: 'rgba(13,27,46,0.8)', border: '1px solid', borderRadius: 12, padding: 18, display: 'flex', gap: 14, alignItems: 'center', backdropFilter: 'blur(8px)' },
  kpiIcon: { width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  kpiRight: { display: 'flex', flexDirection: 'column', gap: 2 },
  kpiValue: { fontSize: 24, fontWeight: 800, color: colors.textPrimary, lineHeight: 1 },
  kpiLabel: { fontSize: 12, color: colors.textSecondary },
  kpiTarget: { fontSize: 11 },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  card: { background: 'rgba(13,27,46,0.8)', border: `1px solid ${colors.border}`, borderRadius: 12, padding: 18, backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column', gap: 10 },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardTitle: { fontSize: 14, fontWeight: 700, color: colors.textPrimary },
  link: { display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: colors.wb1, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' },
  empty: { color: colors.textMuted, fontSize: 13, padding: '8px 0' },
  orderRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${colors.border}` },
  vehicleTag: { borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' },
  orderInfo: { flex: 1, display: 'flex', flexDirection: 'column', gap: 1 },
  orderRoute: { fontSize: 13, fontWeight: 600, color: colors.textPrimary },
  orderVol: { fontSize: 11, color: colors.textMuted },
  orderTime: { fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' },
  routeRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${colors.border}` },
  routeId: { width: 52, fontSize: 12, color: colors.textSecondary, fontFamily: 'monospace' },
  barWrap: { flex: 1, height: 5, background: colors.border, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3, transition: 'width 0.4s ease' },
  routePct: { width: 36, fontSize: 12, fontWeight: 700, textAlign: 'right' },
  routeCost: { width: 72, fontSize: 11, color: colors.textMuted, textAlign: 'right' },
  summaryBar: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 },
  summaryItem: { background: 'rgba(13,27,46,0.8)', border: `1px solid ${colors.border}`, borderRadius: 12, padding: '16px 20px', backdropFilter: 'blur(8px)', textAlign: 'center' },
  summaryVal: { fontSize: 22, fontWeight: 800 },
  summaryLabel: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
}
