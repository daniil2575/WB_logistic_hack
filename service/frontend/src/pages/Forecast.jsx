import { useEffect, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { forecastAPI } from '../api'
import { useSimulator } from '../hooks/useSimulator'
import { colors } from '../theme'
import { Search } from 'lucide-react'
import PageLoader from '../components/PageLoader'

export default function Forecast() {
  const { status } = useSimulator()
  const routes = status?.available_routes || []
  const [selectedRoute, setSelectedRoute] = useState(null)
  const [forecast, setForecast] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const filteredRoutes = routes.filter(r => String(r).includes(search)).slice(0, 60)

  useEffect(() => {
    if (routes.length > 0 && !selectedRoute) setSelectedRoute(routes[0])
  }, [routes])

  useEffect(() => {
    if (selectedRoute === null) return
    setLoading(true)
    forecastAPI.getRoute(selectedRoute)
      .then(r => setForecast(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [selectedRoute, status?.current_time])

  const chartData = forecast?.predictions?.map(p => ({
    time: new Date(p.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    value: p.y_pred,
    lo: p.y_pred_lo ?? p.y_pred,
    hi: p.y_pred_hi ?? p.y_pred,
    band: p.y_pred_lo != null ? [p.y_pred_lo, p.y_pred_hi] : null,
    step: p.step,
  })) || []

  const hasConfidence = chartData.some(d => d.band != null)

  const total = chartData.reduce((s, d) => s + d.value, 0)
  const peak = chartData.reduce((m, d) => d.value > m.value ? d : m, { value: 0 })
  const avg = total / (chartData.length || 1)

  return (
    <PageLoader loading={loading}>
    <div style={s.page}>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>Прогноз отгрузок</h1>
          <p style={s.pageSubtitle}>Предсказание объёма посылок на 10 шагов вперёд (5 часов)</p>
        </div>
      </div>

      <div style={s.layout}>
        {/* Route list */}
        <div style={s.routePanel}>
          <div style={s.searchBox}>
            <Search size={13} color={colors.textMuted} />
            <input
              style={s.searchInput}
              placeholder="Поиск маршрута..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div style={s.routeList}>
            {filteredRoutes.map(r => (
              <button
                key={r}
                style={{ ...s.routeBtn, ...(selectedRoute === r ? s.routeBtnActive : {}) }}
                onClick={() => setSelectedRoute(r)}
              >
                <span>Маршрут #{r}</span>
                {selectedRoute === r && <div style={s.routeDot} />}
              </button>
            ))}
          </div>
        </div>

        {/* Chart area */}
        <div style={s.chartArea}>
          {forecast && (
            <>
              <div style={s.statsRow}>
                <StatBadge label="Маршрут" value={`#${forecast.route_id}`} color={colors.wb1} />
                <StatBadge label="Всего за окно" value={`${Math.round(total)} посылок`} color={colors.blue} />
                <StatBadge label="Пик" value={`${Math.round(peak.value)} (${peak.time})`} color={colors.wb1} />
                <StatBadge label="Среднее/шаг" value={`${avg.toFixed(1)}`} color={colors.blue} />
              </div>

              <div style={s.chartCard}>
                <div style={s.chartTitle}>Прогноз на 5 часов</div>
                {loading ? (
                  <div style={s.loading}>Загрузка...</div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="fg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={colors.wb1} stopOpacity={0.4} />
                          <stop offset="95%" stopColor={colors.wb1} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
                      <XAxis dataKey="time" tick={{ fill: colors.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: colors.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: '#0d1b2e', border: `1px solid ${colors.border}`, borderRadius: 8 }}
                        labelStyle={{ color: colors.textSecondary, fontSize: 12 }}
                        formatter={(v, name) => {
                          if (name === 'hi') return [`${v.toFixed(1)}`, 'Верхняя граница']
                          if (name === 'lo') return [`${v.toFixed(1)}`, 'Нижняя граница']
                          return [`${v.toFixed(1)} посылок`, 'Прогноз']
                        }}
                        itemStyle={{ color: '#e87cda' }}
                      />
                      {hasConfidence && (
                        <Area type="monotone" dataKey="hi" stroke="none" fill={colors.wb1} fillOpacity={0.10} legendType="none" />
                      )}
                      {hasConfidence && (
                        <Area type="monotone" dataKey="lo" stroke="none" fill={colors.bg} fillOpacity={1} legendType="none" />
                      )}
                      <Area type="monotone" dataKey="value" stroke={colors.wb1} strokeWidth={2.5} fill="url(#fg)" dot={{ fill: colors.wb1, r: 4, strokeWidth: 0 }} activeDot={{ r: 6 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Step table */}
              <div style={s.table}>
                <div style={{ ...s.tableHeader, gridTemplateColumns: hasConfidence ? 'repeat(5,1fr)' : 'repeat(4,1fr)' }}>
                  {['Шаг', 'Время', 'Прогноз, посылок', ...(hasConfidence ? ['Диапазон'] : []), 'Уровень'].map(h => (
                    <div key={h} style={s.th}>{h}</div>
                  ))}
                </div>
                {chartData.map((row, i) => {
                  const level = row.value >= avg * 1.3 ? 'Высокий' : row.value >= avg * 0.7 ? 'Средний' : 'Низкий'
                  const lColor = level === 'Высокий' ? colors.wb1 : level === 'Средний' ? colors.blue : colors.textMuted
                  return (
                    <div key={i} style={{ ...s.tableRow, gridTemplateColumns: hasConfidence ? 'repeat(5,1fr)' : 'repeat(4,1fr)', background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                      <div style={s.td}>+{row.step * 30} мин</div>
                      <div style={s.td}>{row.time}</div>
                      <div style={{ ...s.td, fontWeight: 700, color: colors.textPrimary }}>{row.value.toFixed(1)}</div>
                      {hasConfidence && (
                        <div style={{ ...s.td, color: colors.textMuted, fontSize: 12 }}>
                          {row.lo.toFixed(0)}–{row.hi.toFixed(0)}
                        </div>
                      )}
                      <div style={{ ...s.td, color: lColor, fontWeight: 600 }}>{level}</div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
          {!forecast && !loading && (
            <div style={s.noData}>Выберите маршрут слева</div>
          )}
        </div>
      </div>
    </div>
    </PageLoader>
  )
}

function StatBadge({ label, value, color }) {
  return (
    <div style={{ ...s.statBadge, borderColor: color + '44' }}>
      <div style={{ ...s.statVal, color }}>{value}</div>
      <div style={s.statLabel}>{label}</div>
    </div>
  )
}

const s = {
  page: { padding: 28, display: 'flex', flexDirection: 'column', gap: 20 },
  pageHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  pageTitle: { fontSize: 26, fontWeight: 800, color: colors.textPrimary },
  pageSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  layout: { display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16 },
  routePanel: { background: 'rgba(13,27,46,0.8)', border: `1px solid ${colors.border}`, borderRadius: 12, padding: 12, backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '80vh', overflow: 'hidden' },
  searchBox: { display: 'flex', alignItems: 'center', gap: 6, background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 6, padding: '6px 8px' },
  searchInput: { background: 'none', border: 'none', outline: 'none', color: colors.textPrimary, fontSize: 12, width: '100%', fontFamily: 'inherit' },
  routeList: { overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, flex: 1 },
  routeBtn: { background: 'none', border: 'none', color: colors.textSecondary, fontSize: 12, padding: '7px 8px', borderRadius: 6, cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'inherit', transition: 'all 0.1s' },
  routeBtnActive: { background: 'rgba(203,17,171,0.15)', color: '#e87cda' },
  routeDot: { width: 6, height: 6, borderRadius: '50%', background: colors.wb1 },
  chartArea: { display: 'flex', flexDirection: 'column', gap: 14 },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 },
  statBadge: { background: 'rgba(13,27,46,0.8)', border: '1px solid', borderRadius: 10, padding: '12px 14px', backdropFilter: 'blur(8px)' },
  statVal: { fontSize: 18, fontWeight: 800 },
  statLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  chartCard: { background: 'rgba(13,27,46,0.8)', border: `1px solid ${colors.border}`, borderRadius: 12, padding: '18px 16px', backdropFilter: 'blur(8px)' },
  chartTitle: { fontSize: 14, fontWeight: 700, color: colors.textPrimary, marginBottom: 14 },
  loading: { color: colors.textMuted, textAlign: 'center', padding: 40 },
  table: { background: 'rgba(13,27,46,0.8)', border: `1px solid ${colors.border}`, borderRadius: 12, overflow: 'hidden', backdropFilter: 'blur(8px)' },
  tableHeader: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', background: 'rgba(255,255,255,0.04)', borderBottom: `1px solid ${colors.border}` },
  tableRow: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', borderBottom: `1px solid rgba(30,48,80,0.5)` },
  th: { padding: '10px 16px', fontSize: 11, color: colors.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 },
  td: { padding: '10px 16px', fontSize: 13, color: colors.textSecondary },
  noData: { color: colors.textMuted, textAlign: 'center', padding: 80, fontSize: 14 },
}
