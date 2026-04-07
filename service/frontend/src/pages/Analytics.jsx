import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts'
import { metricsAPI, transportAPI } from '../api'
import { useSimulator } from '../hooks/useSimulator'
import { colors } from '../theme'

export default function Analytics() {
  const { status } = useSimulator()
  const [metrics, setMetrics] = useState(null)
  const [orders, setOrders] = useState(null)

  useEffect(() => {
    metricsAPI.get().then(r => setMetrics(r.data)).catch(console.error)
    transportAPI.getOrders().then(r => setOrders(r.data)).catch(console.error)
  }, [status?.current_time])

  // Top-20 routes by utilization for bar chart
  const topRoutes = metrics?.routes?.slice(0, 20).map(r => ({
    name: `#${r.route_id}`,
    util: Math.round(r.avg_utilization * 100),
    cost: r.total_cost_rub,
    orders: r.total_orders,
  })) || []

  // Vehicle distribution
  const vehicleDist = orders ? [
    { name: 'Фуры', value: orders.orders?.filter(o => o.vehicle.name === 'large').length || 0, color: colors.red },
    { name: 'Средние', value: orders.orders?.filter(o => o.vehicle.name === 'medium').length || 0, color: colors.yellow },
    { name: 'Газели', value: orders.orders?.filter(o => o.vehicle.name === 'gazelle').length || 0, color: colors.green },
  ] : []

  // Office distribution
  const officeDist = orders?.orders
    ? Object.entries(
        orders.orders.reduce((acc, o) => {
          acc[o.office_from_id] = (acc[o.office_from_id] || 0) + 1
          return acc
        }, {})
      ).map(([id, count]) => ({ name: `Склад #${id}`, value: count }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8)
    : []

  const kpis = metrics ? [
    { label: 'Загрузка машин', value: `${Math.round(metrics.avg_utilization * 100)}%`, sub: 'Цель ≥75%', ok: metrics.avg_utilization >= 0.75 },
    { label: 'Своевременность', value: `${Math.round(metrics.on_time_dispatch_rate * 100)}%`, sub: 'Цель ≥95%', ok: metrics.on_time_dispatch_rate >= 0.95 },
    { label: 'Стоимость/посылка', value: `₽${metrics.cost_per_parcel_rub?.toFixed(1)}`, sub: 'Цель ₽25-60', ok: metrics.cost_per_parcel_rub >= 25 && metrics.cost_per_parcel_rub <= 60 },
    { label: 'Итого заявок', value: metrics.total_orders, sub: 'за окно', ok: null },
    { label: 'Итого расход', value: `₽${metrics.total_cost_rub?.toLocaleString('ru-RU')}`, sub: 'за окно', ok: null },
    { label: 'Активных маршрутов', value: metrics.routes?.length || 0, sub: 'из 1000', ok: null },
  ] : []

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>Аналитика</h1>
          <p style={s.pageSubtitle}>KPI системы управления транспортом</p>
        </div>
      </div>

      {/* KPIs */}
      <div style={s.kpiGrid}>
        {kpis.map((k, i) => (
          <div key={i} style={s.kpiCard}>
            <div style={{ ...s.kpiVal, color: k.ok === null ? colors.textPrimary : k.ok ? colors.green : colors.yellow }}>
              {k.value}
            </div>
            <div style={s.kpiLabel}>{k.label}</div>
            <div style={s.kpiSub}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div style={s.row}>
        {/* Utilization by route */}
        <div style={{ ...s.card, gridColumn: 'span 2' }}>
          <div style={s.cardTitle}>Загрузка по маршрутам (топ-20)</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={topRoutes} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: colors.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: colors.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} domain={[0, 100]} />
              <Tooltip
                contentStyle={{ background: '#0d1b2e', border: `1px solid ${colors.border}`, borderRadius: 8 }}
                labelStyle={{ color: colors.textSecondary, fontSize: 12 }}
                itemStyle={{ color: colors.wb1 }}
                formatter={v => [`${v}%`, 'Загрузка']}
              />
              <Bar dataKey="util" fill={colors.wb1} radius={[3, 3, 0, 0]}>
                {topRoutes.map((entry, i) => (
                  <Cell key={i} fill={entry.util >= 75 ? colors.green : entry.util >= 50 ? colors.yellow : colors.red} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Vehicle distribution */}
        <div style={s.card}>
          <div style={s.cardTitle}>Распределение транспорта</div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={vehicleDist} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={4} dataKey="value">
                {vehicleDist.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#0d1b2e', border: `1px solid ${colors.border}`, borderRadius: 8 }}
                itemStyle={{ color: colors.textPrimary }}
              />
              <Legend
                formatter={(value) => <span style={{ color: colors.textSecondary, fontSize: 12 }}>{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={s.row}>
        {/* Cost by route (top 10) */}
        <div style={s.card}>
          <div style={s.cardTitle}>Расходы по маршрутам (топ-10)</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={topRoutes.slice(0, 10)} layout="vertical" margin={{ top: 0, right: 10, left: 20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} horizontal={false} />
              <XAxis type="number" tick={{ fill: colors.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `₽${v/1000}к`} />
              <YAxis type="category" dataKey="name" tick={{ fill: colors.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} width={48} />
              <Tooltip
                contentStyle={{ background: '#0d1b2e', border: `1px solid ${colors.border}`, borderRadius: 8 }}
                formatter={v => [`₽${v.toLocaleString('ru-RU')}`, 'Расход']}
              />
              <Bar dataKey="cost" fill={colors.yellow} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Orders by warehouse */}
        <div style={s.card}>
          <div style={s.cardTitle}>Заявки по складам</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={officeDist} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: colors.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: colors.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#0d1b2e', border: `1px solid ${colors.border}`, borderRadius: 8 }}
                formatter={v => [v, 'Заявок']}
              />
              <Bar dataKey="value" fill={colors.blue} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
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
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 12 },
  kpiCard: { background: 'rgba(13,27,46,0.8)', border: `1px solid ${colors.border}`, borderRadius: 12, padding: '14px 12px', backdropFilter: 'blur(8px)', textAlign: 'center' },
  kpiVal: { fontSize: 20, fontWeight: 800, lineHeight: 1 },
  kpiLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
  kpiSub: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  card: { background: 'rgba(13,27,46,0.8)', border: `1px solid ${colors.border}`, borderRadius: 12, padding: 18, backdropFilter: 'blur(8px)' },
  cardTitle: { fontSize: 14, fontWeight: 700, color: colors.textPrimary, marginBottom: 14 },
}
