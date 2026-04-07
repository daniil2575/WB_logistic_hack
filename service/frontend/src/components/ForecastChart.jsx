import { useEffect, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { forecastAPI } from '../api'

export default function ForecastChart({ routeId, currentTime }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!routeId) return
    setLoading(true)
    forecastAPI.getRoute(routeId)
      .then(res => {
        const points = res.data.predictions.map(p => ({
          label: new Date(p.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
          value: p.y_pred,
          step: p.step,
        }))
        setData(points)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [routeId, currentTime])

  if (!routeId) return (
    <div style={styles.empty}>Выберите маршрут</div>
  )

  if (loading) return <div style={styles.empty}>Загрузка...</div>

  const maxVal = Math.max(...data.map(d => d.value), 10)

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        Прогноз отгрузок — маршрут #{routeId}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} />
          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} domain={[0, maxVal * 1.2]} />
          <Tooltip
            contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6 }}
            labelStyle={{ color: '#94a3b8' }}
            itemStyle={{ color: '#a5b4fc' }}
            formatter={(v) => [`${v.toFixed(1)} посылок`, 'Прогноз']}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#6366f1"
            strokeWidth={2}
            fill="url(#forecastGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

const styles = {
  container: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 8,
    padding: 16,
  },
  header: {
    color: '#f1f5f9',
    fontWeight: 600,
    marginBottom: 12,
    fontSize: 14,
  },
  empty: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 8,
    padding: 32,
    color: '#64748b',
    textAlign: 'center',
    fontSize: 14,
  },
}
