import { Play, RotateCcw, Clock } from 'lucide-react'

export default function SimulatorControls({ status, loading, onTick, onReset, onSetTime }) {
  if (!status) return null

  const current = new Date(status.current_time)
  const min = new Date(status.min_time)
  const max = new Date(status.max_time)
  const progress = ((current - min) / (max - min)) * 100

  const handleSlider = (e) => {
    const pct = parseFloat(e.target.value) / 100
    const ts = new Date(min.getTime() + pct * (max.getTime() - min.getTime()))
    onSetTime(ts.toISOString())
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <Clock size={16} />
        <span style={styles.title}>Симулятор времени</span>
      </div>

      <div style={styles.timeDisplay}>
        {current.toLocaleString('ru-RU', {
          weekday: 'short', day: '2-digit', month: '2-digit',
          year: 'numeric', hour: '2-digit', minute: '2-digit'
        })}
      </div>

      <input
        type="range"
        min={0}
        max={100}
        step={0.1}
        value={progress.toFixed(1)}
        onChange={handleSlider}
        style={styles.slider}
        disabled={loading}
      />

      <div style={styles.bounds}>
        <span>{min.toLocaleDateString('ru-RU')}</span>
        <span>{max.toLocaleDateString('ru-RU')}</span>
      </div>

      <div style={styles.buttons}>
        <button onClick={onTick} disabled={loading} style={styles.btnPrimary}>
          <Play size={14} /> +30 мин
        </button>
        <button onClick={onReset} disabled={loading} style={styles.btnSecondary}>
          <RotateCcw size={14} /> Сброс
        </button>
      </div>
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
    gap: 10,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: { color: '#94a3b8' },
  timeDisplay: {
    fontSize: 18,
    fontWeight: 700,
    color: '#f1f5f9',
  },
  slider: {
    width: '100%',
    accentColor: '#6366f1',
    cursor: 'pointer',
  },
  bounds: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: '#64748b',
  },
  buttons: {
    display: 'flex',
    gap: 8,
    marginTop: 4,
  },
  btnPrimary: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
  },
  btnSecondary: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    background: '#334155',
    color: '#cbd5e1',
    border: 'none',
    borderRadius: 6,
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: 13,
  },
}
