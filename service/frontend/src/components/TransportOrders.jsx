import { useEffect, useState } from 'react'
import { Truck, Package, Clock } from 'lucide-react'
import { transportAPI } from '../api'

const VEHICLE_COLORS = {
  large: '#ef4444',
  medium: '#f59e0b',
  gazelle: '#22c55e',
}

export default function TransportOrders({ currentTime, routeId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    transportAPI.getOrders(null, routeId)
      .then(res => setData(res.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [currentTime, routeId])

  if (loading) return <div style={styles.empty}>Загрузка заявок...</div>
  if (!data) return null

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.title}>
          <Truck size={16} />
          Заявки на транспорт
        </div>
        <div style={styles.summary}>
          <span style={styles.badge}>{data.total_orders} заявок</span>
          <span style={styles.cost}>₽{data.total_cost_rub.toLocaleString('ru-RU')}</span>
        </div>
      </div>

      {data.orders.length === 0 ? (
        <div style={styles.noOrders}>Заявок нет — объём ниже порогового значения</div>
      ) : (
        <div style={styles.list}>
          {data.orders.map(order => (
            <OrderCard key={order.order_id} order={order} />
          ))}
        </div>
      )}
    </div>
  )
}

function OrderCard({ order }) {
  const color = VEHICLE_COLORS[order.vehicle.name] || '#6366f1'
  const utilPct = Math.round(order.utilization * 100)
  const dispatchTime = new Date(order.dispatch_at).toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit'
  })

  return (
    <div style={styles.card}>
      <div style={{ ...styles.vehicleBadge, background: color + '22', color }}>
        {order.vehicle.label}
      </div>

      <div style={styles.cardBody}>
        <div style={styles.cardRow}>
          <span style={styles.label}>Маршрут</span>
          <span style={styles.value}>#{order.route_id}</span>
        </div>
        <div style={styles.cardRow}>
          <span style={styles.label}>Склад</span>
          <span style={styles.value}>#{order.office_from_id}</span>
        </div>
        <div style={styles.cardRow}>
          <span style={styles.label}><Clock size={11} /> Подать до</span>
          <span style={{ ...styles.value, color: '#f59e0b' }}>{dispatchTime}</span>
        </div>
        <div style={styles.cardRow}>
          <span style={styles.label}><Package size={11} /> Объём</span>
          <span style={styles.value}>{Math.round(order.forecast_volume)} посылок</span>
        </div>
      </div>

      <div style={styles.utilBar}>
        <div style={{ ...styles.utilFill, width: `${utilPct}%`, background: color }} />
      </div>
      <div style={styles.utilLabel}>{utilPct}% загрузка</div>
    </div>
  )
}

const styles = {
  container: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 8,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    color: '#f1f5f9',
    fontWeight: 600,
    fontSize: 14,
  },
  summary: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    background: '#334155',
    color: '#94a3b8',
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 12,
  },
  cost: {
    color: '#22c55e',
    fontWeight: 700,
    fontSize: 14,
  },
  noOrders: {
    color: '#64748b',
    fontSize: 13,
    textAlign: 'center',
    padding: '12px 0',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    maxHeight: 360,
    overflowY: 'auto',
  },
  card: {
    background: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: 6,
    padding: 12,
  },
  vehicleBadge: {
    display: 'inline-block',
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 8,
  },
  cardBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  cardRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    color: '#64748b',
    fontSize: 12,
  },
  value: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: 600,
  },
  utilBar: {
    height: 4,
    background: '#334155',
    borderRadius: 2,
    marginTop: 10,
    overflow: 'hidden',
  },
  utilFill: {
    height: '100%',
    borderRadius: 2,
    transition: 'width 0.3s ease',
  },
  utilLabel: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 3,
    textAlign: 'right',
  },
  empty: {
    color: '#64748b',
    fontSize: 13,
    textAlign: 'center',
    padding: 24,
  },
}
