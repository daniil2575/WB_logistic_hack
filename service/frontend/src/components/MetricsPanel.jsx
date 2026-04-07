import { useEffect, useState } from 'react'
import { TrendingUp, CheckCircle, DollarSign, Truck } from 'lucide-react'
import { metricsAPI } from '../api'

export default function MetricsPanel({ currentTime }) {
  const [data, setData] = useState(null)

  useEffect(() => {
    metricsAPI.get()
      .then(res => setData(res.data))
      .catch(console.error)
  }, [currentTime])

  if (!data) return null

  const cards = [
    {
      icon: <TrendingUp size={18} />,
      label: 'Загрузка машин',
      value: `${Math.round(data.avg_utilization * 100)}%`,
      target: '≥ 75%',
      ok: data.avg_utilization >= 0.75,
    },
    {
      icon: <CheckCircle size={18} />,
      label: 'Своевременность',
      value: `${Math.round(data.on_time_dispatch_rate * 100)}%`,
      target: '≥ 95%',
      ok: data.on_time_dispatch_rate >= 0.95,
    },
    {
      icon: <Truck size={18} />,
      label: 'Заявок всего',
      value: data.total_orders,
      target: null,
      ok: null,
    },
    {
      icon: <DollarSign size={18} />,
      label: 'Стоимость/посылка',
      value: `₽${data.cost_per_parcel_rub.toFixed(1)}`,
      target: '₽25–60',
      ok: data.cost_per_parcel_rub >= 25 && data.cost_per_parcel_rub <= 60,
    },
  ]

  return (
    <div style={styles.grid}>
      {cards.map((card, i) => (
        <div key={i} style={styles.card}>
          <div style={{ ...styles.icon, color: card.ok === null ? '#6366f1' : card.ok ? '#22c55e' : '#ef4444' }}>
            {card.icon}
          </div>
          <div style={styles.value}>{card.value}</div>
          <div style={styles.label}>{card.label}</div>
          {card.target && (
            <div style={styles.target}>цель: {card.target}</div>
          )}
        </div>
      ))}
    </div>
  )
}

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 12,
  },
  card: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 8,
    padding: '16px 12px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  icon: {
    marginBottom: 4,
  },
  value: {
    fontSize: 22,
    fontWeight: 800,
    color: '#f1f5f9',
  },
  label: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
  },
  target: {
    fontSize: 11,
    color: '#475569',
  },
}
