import { useCallback, useEffect, useMemo, useState } from 'react'
import { Truck, Filter, Package, Clock, MapPin, Plus } from 'lucide-react'
import { transportAPI } from '../api'
import { useSimulator } from '../hooks/useSimulator'
import { colors } from '../theme'
import PageLoader from '../components/PageLoader'
import CreateOrderModal from '../components/CreateOrderModal'
import ToastNotification, { useToasts } from '../components/ToastNotification'

const VEHICLE_COLORS = { large: colors.wb1, medium: colors.blue, gazelle: '#6b8fae' }

const DEFAULT_TARIFFS = { gazelle: 4000, medium: 10000, large: 27000 }

export default function Orders() {
  const { status } = useSimulator()
  const [data, setData] = useState(null)
  const [filter, setFilter] = useState('all')  // all | large | medium | gazelle
  const [sortBy, setSortBy] = useState('dispatch_at')
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalRouteId, setModalRouteId] = useState(null)
  const [modalInitialOrder, setModalInitialOrder] = useState(null)
  const [userOrders, setUserOrders] = useState([])
  const [approvedIds, setApprovedIds] = useState(() => new Set())
  const [tariffs, setTariffs] = useState(DEFAULT_TARIFFS)
  const [tariffOpen, setTariffOpen] = useState(false)

  const handleCreateOrder = useCallback((routeId) => {
    setModalInitialOrder(null)
    setModalRouteId(routeId ?? null)
    setModalOpen(true)
  }, [])

  const handleEditOrder = useCallback((order) => {
    setModalInitialOrder(order)
    setModalRouteId(order.route_id)
    setModalOpen(true)
  }, [])

  const handleSubmitOrder = useCallback((order) => {
    setUserOrders(prev => [order, ...prev])
  }, [])

  const handleApproveOrder = useCallback((order) => {
    setApprovedIds(prev => new Set([...prev, order.order_id]))
    setUserOrders(prev => [{ ...order, approved: true }, ...prev])
  }, [])

  const { toasts, dismiss } = useToasts(status, handleCreateOrder)

  const tariffChanged = tariffs.gazelle !== DEFAULT_TARIFFS.gazelle ||
    tariffs.medium !== DEFAULT_TARIFFS.medium || tariffs.large !== DEFAULT_TARIFFS.large

  useEffect(() => {
    setLoading(true)
    transportAPI.getOrders(null, null, tariffChanged ? tariffs : null)
      .then(r => setData(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [status?.current_time, tariffs])

  const systemOrders = data?.orders || []

  // Deduplicate: user-created orders for the same (route_id, dispatch_at window) shadow system orders.
  // Two dispatch times are considered the same window if within 30 minutes of each other.
  const orders = useMemo(() => {
    const userKeys = new Set(
      userOrders.map(o => `${o.route_id}_${Math.round(new Date(o.dispatch_at).getTime() / 1800000)}`)
    )
    const deduped = systemOrders.filter(o => {
      const key = `${o.route_id}_${Math.round(new Date(o.dispatch_at).getTime() / 1800000)}`
      return !userKeys.has(key)
    })
    return deduped
  }, [systemOrders, userOrders])

  const filtered = useMemo(() => orders
    .filter(o => filter === 'all' || o.vehicle.name === filter)
    .sort((a, b) => {
      if (sortBy === 'dispatch_at') return new Date(a.dispatch_at) - new Date(b.dispatch_at)
      if (sortBy === 'volume') return b.forecast_volume - a.forecast_volume
      if (sortBy === 'utilization') return b.utilization - a.utilization
      return 0
    }), [orders, filter, sortBy])

  const summary = useMemo(() => ({
    total: orders.length,
    large: orders.filter(o => o.vehicle.name === 'large').length,
    medium: orders.filter(o => o.vehicle.name === 'medium').length,
    gazelle: orders.filter(o => o.vehicle.name === 'gazelle').length,
    cost: data?.total_cost_rub || 0,
    naive: data?.naive_cost_rub || 0,
    savings: data?.savings_rub || 0,
  }), [orders, data])

  return (
    <>
    <PageLoader loading={loading}>
    <div style={s.page}>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>Заявки на транспорт</h1>
          <p style={s.pageSubtitle}>Сформированные заявки на основе прогноза отгрузок</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div style={s.totalCost}>
            Итого: <span style={{ color: colors.textPrimary, fontWeight: 800 }}>₽{summary.cost.toLocaleString('ru-RU')}</span>
          </div>
          {summary.savings > 0 && (
            <div style={s.savingsBadge}>
              ✦ Экономия ₽{summary.savings.toLocaleString('ru-RU')} vs наивный
            </div>
          )}
          <button style={{ ...s.createBtn, background: tariffChanged ? 'rgba(203,17,171,0.25)' : 'rgba(255,255,255,0.06)', borderColor: tariffChanged ? colors.wb1 : colors.border }} onClick={() => setTariffOpen(o => !o)}>
            <Truck size={15} /> Тарифы{tariffChanged ? ' ✦' : ''}
          </button>
          <button style={s.createBtn} onClick={() => handleCreateOrder(null)}>
            <Plus size={15} /> Создать заявку
          </button>
        </div>
      </div>

      {/* Tariff editor */}
      {tariffOpen && (
        <div style={s.tariffPanel}>
          <span style={s.tariffTitle}>Тарифы перевозчиков (₽ за рейс)</span>
          {[
            { key: 'gazelle', label: 'Газель (100 мест)' },
            { key: 'medium',  label: 'Средний (300 мест)' },
            { key: 'large',   label: 'Фура (1000 мест)' },
          ].map(({ key, label }) => (
            <label key={key} style={s.tariffField}>
              <span style={s.tariffLabel}>{label}</span>
              <input
                type="number"
                style={s.tariffInput}
                value={tariffs[key]}
                min={1}
                onChange={e => setTariffs(t => ({ ...t, [key]: Number(e.target.value) || t[key] }))}
              />
            </label>
          ))}
          <button style={s.tariffReset} onClick={() => setTariffs(DEFAULT_TARIFFS)}>Сбросить</button>
        </div>
      )}

      {/* Vehicle summary */}
      <div style={s.vehicleSummary}>
        {[
          { key: 'all', label: 'Все', count: summary.total, color: colors.wb1 },
          { key: 'large', label: 'Фуры', count: summary.large, color: colors.wb1 },
          { key: 'medium', label: 'Средние', count: summary.medium, color: colors.blue },
          { key: 'gazelle', label: 'Газели', count: summary.gazelle, color: '#6b8fae' },
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

      {/* User orders section */}
      {userOrders.length > 0 && (
        <div>
          <div style={s.sectionTitle}>Мои заявки</div>
          <div style={s.grid}>
            {userOrders.map(o => (
              <OrderCard key={o.order_id} order={o} currentTime={status?.current_time} isManual />
            ))}
          </div>
        </div>
      )}

      {/* System recommendations */}
      {filtered.length === 0 ? (
        <div style={s.empty}>
          <Truck size={40} color={colors.textMuted} />
          <div>Заявок нет</div>
        </div>
      ) : (
        <div>
          <div style={s.sectionTitle}>Рекомендации системы</div>
          <div style={s.grid}>
            {filtered.map(o => (
              <OrderCard
                key={o.order_id}
                order={o}
                currentTime={status?.current_time}
                onApprove={approvedIds.has(o.order_id) ? null : () => handleApproveOrder(o)}
                approved={approvedIds.has(o.order_id)}
                onEdit={approvedIds.has(o.order_id) ? null : () => handleEditOrder(o)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
    </PageLoader>
    <CreateOrderModal
      open={modalOpen}
      onClose={() => { setModalOpen(false); setModalInitialOrder(null) }}
      onSubmit={handleSubmitOrder}
      initialRouteId={modalRouteId}
      initialOrder={modalInitialOrder}
      status={status}
    />
    <ToastNotification
      toasts={toasts}
      onDismiss={dismiss}
      onCreateOrder={handleCreateOrder}
    />
    </>
  )
}

function OrderCard({ order, currentTime, isManual = false, onApprove = null, approved = false, onEdit = null }) {
  const color = VEHICLE_COLORS[order.vehicle.name] || colors.wb1
  const dispatchTime = new Date(order.dispatch_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const dispatchDate = new Date(order.dispatch_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  const utilPct = Math.round(order.utilization * 100)
  const minutesLeft = currentTime ? Math.round((new Date(order.dispatch_at) - new Date(currentTime)) / 60000) : null
  const isUrgent = minutesLeft !== null && minutesLeft < 60 && minutesLeft >= 0
  const isOverdue = minutesLeft !== null && minutesLeft < 0

  return (
    <div style={{
      ...s.card,
      borderColor: isManual ? colors.wb1 + '55' : (isUrgent ? colors.textMuted + '55' : isOverdue ? colors.red + '55' : colors.border),
      borderLeft: isManual ? `3px solid ${colors.wb1}` : undefined,
    }}>
      <div style={s.cardTop}>
        <div style={{ ...s.vBadge, background: color + '18', color }}>
          <Truck size={12} />
          {order.vehicle.label}
        </div>
        <div style={{ ...s.urgency, color: isOverdue ? colors.red : colors.textMuted }}>
          {isOverdue ? '⚠ Просрочено' : isUrgent ? `⏱ ${minutesLeft} мин` : minutesLeft !== null ? `${minutesLeft} мин` : '—'}
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
          <span style={{ ...s.fieldVal, color: isOverdue ? colors.red : colors.textPrimary, fontWeight: 700 }}>
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

      {(onApprove || onEdit || approved) && (
        <div style={s.approveSection}>
          {approved ? (
            <div style={s.sentBadge}>✓ Отправлено перевозчику</div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ ...s.approveBtn, flex: 1 }} onClick={onApprove}>Одобрить →</button>
              {onEdit && (
                <button style={s.editBtn} onClick={onEdit}>Изменить</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const s = {
  page: { padding: 28, display: 'flex', flexDirection: 'column', gap: 20 },
  pageHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  pageTitle: { fontSize: 26, fontWeight: 800, color: colors.textPrimary },
  pageSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  totalCost: { fontSize: 15, color: colors.textSecondary, background: 'rgba(13,27,46,0.8)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '8px 16px' },
  savingsBadge: { fontSize: 13, fontWeight: 700, color: colors.green, background: 'rgba(61,214,140,0.08)', border: '1px solid rgba(61,214,140,0.2)', borderRadius: 8, padding: '8px 14px', whiteSpace: 'nowrap' },
  tariffPanel: { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: 'rgba(13,27,46,0.95)', border: `1px solid ${colors.wb1}44`, borderRadius: 12, padding: '14px 20px', backdropFilter: 'blur(8px)' },
  tariffTitle: { fontSize: 12, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 4 },
  tariffField: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'default' },
  tariffLabel: { fontSize: 12, color: colors.textSecondary, whiteSpace: 'nowrap' },
  tariffInput: { width: 90, background: 'rgba(255,255,255,0.05)', border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.textPrimary, padding: '5px 8px', fontSize: 13, fontFamily: 'inherit', outline: 'none', textAlign: 'right' },
  tariffReset: { marginLeft: 'auto', background: 'none', border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.textMuted, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' },
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
  costTag: { fontSize: 12, color: colors.textSecondary, fontWeight: 700 },
  createBtn: {
    display: 'flex', alignItems: 'center', gap: 6,
    background: 'linear-gradient(135deg, #7B00B4, #CB11AB)',
    color: '#fff', border: 'none', borderRadius: 8,
    padding: '9px 18px', cursor: 'pointer', fontSize: 13,
    fontWeight: 700, fontFamily: 'inherit',
    boxShadow: '0 4px 16px rgba(203,17,171,0.3)',
  },
  approveSection: { marginTop: 2 },
  editBtn: {
    background: 'rgba(255,255,255,0.05)', border: `1px solid ${colors.border}`,
    borderRadius: 7, color: colors.textSecondary, padding: '8px 12px', cursor: 'pointer',
    fontSize: 12, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  approveBtn: {
    width: '100%', background: 'rgba(203,17,171,0.1)', border: `1px solid rgba(203,17,171,0.3)`,
    borderRadius: 7, color: '#e87cda', padding: '8px 0', cursor: 'pointer',
    fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
  },
  sentBadge: {
    textAlign: 'center', fontSize: 12, fontWeight: 700, color: colors.textSecondary,
    background: 'rgba(255,255,255,0.05)', border: `1px solid ${colors.border}`,
    borderRadius: 7, padding: '7px 0',
  },
  sectionTitle: {
    fontSize: 13, fontWeight: 700, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
  },
}
