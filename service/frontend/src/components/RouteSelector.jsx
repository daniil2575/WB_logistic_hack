export default function RouteSelector({ routes, selected, onSelect }) {
  return (
    <div style={styles.container}>
      <div style={styles.label}>Маршрут</div>
      <select
        value={selected || ''}
        onChange={e => onSelect(e.target.value ? parseInt(e.target.value) : null)}
        style={styles.select}
      >
        <option value="">— Все маршруты —</option>
        {routes.map(r => (
          <option key={r} value={r}>#{r}</option>
        ))}
      </select>
    </div>
  )
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    color: '#94a3b8',
    fontSize: 13,
    whiteSpace: 'nowrap',
  },
  select: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 6,
    color: '#f1f5f9',
    padding: '6px 10px',
    fontSize: 13,
    cursor: 'pointer',
    minWidth: 160,
  },
}
