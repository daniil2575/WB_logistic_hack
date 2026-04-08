import { useState } from 'react'
import { Play, RotateCcw, Calendar, Info, Zap } from 'lucide-react'
import { useSimulator } from '../hooks/useSimulator'
import { colors } from '../theme'

export default function Simulator() {
  const { status, loading, tick, setTime, reset } = useSimulator()
  const [customTime, setCustomTime] = useState('')
  const [tickLog, setTickLog] = useState([])

  if (!status) return <div style={s.loading}>Загрузка симулятора...</div>

  const current = new Date(status.current_time)
  const min = new Date(status.min_time)
  const max = new Date(status.max_time)
  const progress = ((current - min) / (max - min)) * 100

  const toLocalIso = (date) => {
    const pad = n => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
  }

  const handleSlider = (e) => {
    const pct = parseFloat(e.target.value) / 100
    const ts = new Date(min.getTime() + pct * (max.getTime() - min.getTime()))
    setTime(toLocalIso(ts))
  }

  const handleTick = async () => {
    const prev = status.current_time
    await tick()
    setTickLog(log => [{
      from: new Date(prev).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      to: new Date(new Date(prev).getTime() + 30 * 60000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      ts: Date.now(),
    }, ...log].slice(0, 8))
  }

  const handleCustomTime = () => {
    if (customTime) setTime(customTime)
  }

  const presets = [
    { label: 'Начало данных', ts: status.min_time },
    { label: 'Середина', ts: toLocalIso(new Date(min.getTime() + (max - min) / 2)) },
    { label: 'Последние 24ч', ts: toLocalIso(new Date(max.getTime() - 24 * 3600000)) },
    { label: 'Последние 2ч', ts: toLocalIso(new Date(max.getTime() - 2 * 3600000)) },
    { label: 'Тест (30 мая 10:30)', ts: status.max_time },
  ]

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>Симулятор времени</h1>
          <p style={s.pageSubtitle}>Управление временем для демонстрации работы сервиса</p>
        </div>
        <div style={s.badge}>
          <Zap size={13} color={colors.wb1} />
          Мок-режим
        </div>
      </div>

      <div style={s.layout}>
        <div style={s.mainCol}>
          {/* Current time display */}
          <div style={s.timeCard}>
            <div style={s.timeLabel}>Текущее время симуляции</div>
            <div style={s.timeDisplay}>
              {current.toLocaleString('ru-RU', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
            <div style={s.progressWrap}>
              <input
                type="range" min={0} max={100} step={0.05}
                value={progress.toFixed(2)}
                onChange={handleSlider}
                disabled={loading}
                style={s.slider}
              />
              <div style={s.progressLabels}>
                <span>{min.toLocaleDateString('ru-RU')}</span>
                <span style={{ color: colors.wb1 }}>{progress.toFixed(1)}%</span>
                <span>{max.toLocaleDateString('ru-RU')}</span>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div style={s.controlsCard}>
            <div style={s.controlsTitle}>Управление</div>
            <div style={s.btnRow}>
              <button onClick={handleTick} disabled={loading} style={s.btnPrimary}>
                <Play size={15} /> +30 минут
              </button>
              <button onClick={reset} disabled={loading} style={s.btnSecondary}>
                <RotateCcw size={15} /> Сброс
              </button>
            </div>

            <div style={s.divider} />

            <div style={s.controlsTitle}>Установить время вручную</div>
            <div style={s.customRow}>
              <input
                type="datetime-local"
                style={s.dateInput}
                value={customTime}
                onChange={e => setCustomTime(e.target.value)}
                min={min.toISOString().slice(0, 16)}
                max={max.toISOString().slice(0, 16)}
              />
              <button onClick={handleCustomTime} disabled={loading || !customTime} style={s.btnPrimary}>
                <Calendar size={14} /> Перейти
              </button>
            </div>

            <div style={s.divider} />

            <div style={s.controlsTitle}>Быстрые переходы</div>
            <div style={s.presetGrid}>
              {presets.map(p => (
                <button key={p.label} onClick={() => setTime(p.ts)} disabled={loading} style={s.presetBtn}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tick log */}
          {tickLog.length > 0 && (
            <div style={s.logCard}>
              <div style={s.controlsTitle}>История шагов</div>
              {tickLog.map((l, i) => (
                <div key={l.ts} style={{ ...s.logRow, opacity: 1 - i * 0.1 }}>
                  <Zap size={10} color={colors.wb1} />
                  <span style={s.logText}>{l.from} → {l.to}</span>
                  <span style={s.logTs}>+30 мин</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info panel */}
        <div style={s.infoCol}>
          <div style={s.infoCard}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
              <Info size={16} color={colors.wb1} />
              <span style={s.controlsTitle}>Как это работает</span>
            </div>
            <div style={s.infoText}>
              Симулятор позволяет "перематывать" исторические данные, имитируя работу сервиса в реальном времени.
            </div>
            <div style={s.steps}>
              {[
                { n: '1', t: 'Выберите момент времени', d: 'Используйте слайдер или быстрые переходы' },
                { n: '2', t: 'Получите прогноз', d: 'Сервис загружает данные до выбранного момента и строит прогноз на 5 часов вперёд' },
                { n: '3', t: 'Заявки на транспорт', d: 'Автоматически формируются заявки исходя из прогноза и пороговых значений' },
                { n: '4', t: 'Шаг +30 мин', d: 'Нажмите кнопку чтобы продвинуться вперёд и увидеть следующее состояние системы' },
              ].map(step => (
                <div key={step.n} style={s.step}>
                  <div style={s.stepNum}>{step.n}</div>
                  <div>
                    <div style={s.stepTitle}>{step.t}</div>
                    <div style={s.stepDesc}>{step.d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={s.statsCard}>
            <div style={s.controlsTitle}>Параметры данных</div>
            <div style={s.statsList}>
              {[
                { label: 'Маршрутов', value: status.available_routes?.length ?? '—' },
                { label: 'Начало данных', value: min.toLocaleDateString('ru-RU') },
                { label: 'Конец данных', value: max.toLocaleDateString('ru-RU') },
                { label: 'Период', value: `${Math.round((max - min) / 86400000)} дней` },
                { label: 'Шаг', value: '30 минут' },
                { label: 'Горизонт прогноза', value: '10 шагов (5ч)' },
              ].map(item => (
                <div key={item.label} style={s.statItem}>
                  <span style={s.statLabel}>{item.label}</span>
                  <span style={s.statValue}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const s = {
  page: { padding: 28, display: 'flex', flexDirection: 'column', gap: 20 },
  loading: { padding: 40, color: colors.textMuted, textAlign: 'center' },
  pageHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  pageTitle: { fontSize: 26, fontWeight: 800, color: colors.textPrimary },
  pageSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  badge: { display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(203,17,171,0.08)', border: '1px solid rgba(203,17,171,0.2)', borderRadius: 8, padding: '6px 12px', fontSize: 12, color: colors.wb1, fontWeight: 600 },
  layout: { display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 },
  mainCol: { display: 'flex', flexDirection: 'column', gap: 14 },
  infoCol: { display: 'flex', flexDirection: 'column', gap: 14 },
  timeCard: { background: 'rgba(13,27,46,0.85)', border: `1px solid ${colors.border}`, borderRadius: 12, padding: 24, backdropFilter: 'blur(8px)' },
  timeLabel: { fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  timeDisplay: { fontSize: 24, fontWeight: 800, color: colors.textPrimary, marginBottom: 20 },
  progressWrap: { display: 'flex', flexDirection: 'column', gap: 6 },
  slider: { width: '100%', accentColor: colors.wb1, cursor: 'pointer', height: 6 },
  progressLabels: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: colors.textMuted },
  controlsCard: { background: 'rgba(13,27,46,0.85)', border: `1px solid ${colors.border}`, borderRadius: 12, padding: 20, backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column', gap: 12 },
  controlsTitle: { fontSize: 13, fontWeight: 700, color: colors.textPrimary },
  btnRow: { display: 'flex', gap: 10 },
  btnPrimary: { display: 'flex', alignItems: 'center', gap: 6, background: colors.wbGrad, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(203,17,171,0.3)' },
  btnSecondary: { display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.06)', color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: 8, padding: '10px 18px', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' },
  divider: { height: 1, background: colors.border },
  customRow: { display: 'flex', gap: 10 },
  dateInput: { flex: 1, background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.textPrimary, padding: '8px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none' },
  presetGrid: { display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 },
  presetBtn: { background: 'rgba(255,255,255,0.04)', border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.textSecondary, padding: '8px 12px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', textAlign: 'center', transition: 'all 0.15s' },
  logCard: { background: 'rgba(13,27,46,0.85)', border: `1px solid ${colors.border}`, borderRadius: 12, padding: 16, backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column', gap: 8 },
  logRow: { display: 'flex', alignItems: 'center', gap: 8 },
  logText: { flex: 1, fontSize: 12, color: colors.textSecondary, fontFamily: 'monospace' },
  logTs: { fontSize: 11, color: colors.textMuted },
  infoCard: { background: 'rgba(13,27,46,0.85)', border: `1px solid ${colors.border}`, borderRadius: 12, padding: 20, backdropFilter: 'blur(8px)' },
  infoText: { fontSize: 13, color: colors.textSecondary, lineHeight: 1.6, marginBottom: 16 },
  steps: { display: 'flex', flexDirection: 'column', gap: 12 },
  step: { display: 'flex', gap: 12, alignItems: 'flex-start' },
  stepNum: { width: 22, height: 22, borderRadius: '50%', background: colors.wbGrad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0, marginTop: 1 },
  stepTitle: { fontSize: 13, fontWeight: 600, color: colors.textPrimary, marginBottom: 2 },
  stepDesc: { fontSize: 12, color: colors.textMuted, lineHeight: 1.5 },
  statsCard: { background: 'rgba(13,27,46,0.85)', border: `1px solid ${colors.border}`, borderRadius: 12, padding: 20, backdropFilter: 'blur(8px)' },
  statsList: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 },
  statItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, borderBottom: `1px solid rgba(30,48,80,0.5)` },
  statLabel: { fontSize: 12, color: colors.textMuted },
  statValue: { fontSize: 12, color: colors.textPrimary, fontWeight: 600 },
}
