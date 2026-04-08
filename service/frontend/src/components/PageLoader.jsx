export default function PageLoader({ loading, children }) {
  return (
    <div style={{ position: 'relative' }}>
      {loading && (
        <div style={s.overlay}>
          <style>{css}</style>
          <div style={s.scene}>
            <div style={s.cube}>
              <div style={{ ...s.face, ...s.front }} />
              <div style={{ ...s.face, ...s.back }} />
              <div style={{ ...s.face, ...s.left }} />
              <div style={{ ...s.face, ...s.right }} />
              <div style={{ ...s.face, ...s.top }} />
              <div style={{ ...s.face, ...s.bottom }} />
            </div>
          </div>
          <div style={s.label}>Загрузка...</div>
        </div>
      )}
      <div style={{ filter: loading ? 'blur(4px)' : 'none', pointerEvents: loading ? 'none' : 'auto', transition: 'filter 0.3s' }}>
        {children}
      </div>
    </div>
  )
}

const css = `
  @keyframes tumble {
    0%   { transform: rotateX(0deg)   rotateY(0deg)   rotateZ(0deg); }
    33%  { transform: rotateX(120deg) rotateY(240deg) rotateZ(120deg); }
    66%  { transform: rotateX(240deg) rotateY(120deg) rotateZ(240deg); }
    100% { transform: rotateX(360deg) rotateY(360deg) rotateZ(360deg); }
  }
`

const SIZE = 54
const HALF = SIZE / 2

const s = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 999,
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 20,
    background: 'rgba(8,12,24,0.4)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
  },
  scene: {
    width: SIZE, height: SIZE,
    perspective: 300,
  },
  cube: {
    width: SIZE, height: SIZE,
    position: 'relative',
    transformStyle: 'preserve-3d',
    animation: 'tumble 1.4s ease-in-out infinite',
  },
  face: {
    position: 'absolute', width: SIZE, height: SIZE,
    border: '2px solid rgba(203,17,171,0.6)',
    borderRadius: 6,
    backfaceVisibility: 'visible',
  },
  front:  { background: 'rgba(123,0,180,0.55)',  transform: `translateZ(${HALF}px)` },
  back:   { background: 'rgba(123,0,180,0.35)',  transform: `rotateY(180deg) translateZ(${HALF}px)` },
  left:   { background: 'rgba(203,17,171,0.45)', transform: `rotateY(-90deg) translateZ(${HALF}px)` },
  right:  { background: 'rgba(203,17,171,0.45)', transform: `rotateY(90deg)  translateZ(${HALF}px)` },
  top:    { background: 'rgba(160,0,200,0.55)',  transform: `rotateX(90deg)  translateZ(${HALF}px)` },
  bottom: { background: 'rgba(80,0,120,0.4)',    transform: `rotateX(-90deg) translateZ(${HALF}px)` },
  label: {
    color: 'rgba(255,255,255,0.6)', fontSize: 13,
    fontFamily: 'Inter, sans-serif', letterSpacing: 2,
    textTransform: 'uppercase', fontWeight: 600,
  },
}
