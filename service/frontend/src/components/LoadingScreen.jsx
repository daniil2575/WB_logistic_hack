import { useEffect, useState } from 'react'

export default function LoadingScreen({ onDone }) {
  const [phase, setPhase] = useState('truck')   // truck → text → fade
  const [opacity, setOpacity] = useState(1)

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('text'), 1200)
    const t2 = setTimeout(() => setPhase('fade'), 3200)
    const t3 = setTimeout(() => {
      setOpacity(0)
    }, 3400)
    const t4 = setTimeout(() => onDone(), 3900)
    return () => [t1, t2, t3, t4].forEach(clearTimeout)
  }, [onDone])

  return (
    <div style={{ ...s.root, opacity }}>
      <style>{css}</style>

      {/* Road */}
      <div style={s.road}>
        <div style={s.roadLine} />
      </div>

      {/* Truck SVG */}
      <div style={{ ...s.truckWrap, animationPlayState: phase === 'fade' ? 'paused' : 'running' }}>
        <TruckPhoto />
      </div>

      {/* Logo text */}
      <div style={{ ...s.logoWrap, opacity: phase === 'text' || phase === 'fade' ? 1 : 0 }}>
        <span style={s.logoWB}>wildberries</span>
        <span style={s.logoSub}>Logistics Intelligence</span>
      </div>

      {/* Team credit */}
      <div style={{ ...s.teamCredit, opacity: phase === 'text' || phase === 'fade' ? 1 : 0 }}>
        Made by REU Data Science Club team
      </div>

      {/* Particles */}
      {[...Array(18)].map((_, i) => (
        <div key={i} style={{ ...s.particle, ...particleStyle(i) }} />
      ))}
    </div>
  )
}

function TruckPhoto() {
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {/* Грузовик — белый фон убирается через multiply */}
      <img
        src="/image2.png"
        style={{
          width: 380,
          height: 'auto',
          display: 'block',
          mixBlendMode: 'multiply',
          filter: 'contrast(1.05)',
        }}
      />
    </div>
  )
}


function particleStyle(i) {
  const angle = (i / 18) * 360
  const r = 80 + (i % 5) * 40
  const x = 50 + r * Math.cos((angle * Math.PI) / 180) * 0.3
  const y = 50 + r * Math.sin((angle * Math.PI) / 180) * 0.15
  const size = 2 + (i % 3)
  return {
    left: `${x}%`,
    top: `${y}%`,
    width: size,
    height: size,
    animationDelay: `${(i * 0.12).toFixed(2)}s`,
    animationDuration: `${1.5 + (i % 4) * 0.5}s`,
    opacity: 0.3 + (i % 3) * 0.15,
  }
}

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');

  @keyframes driveIn {
    0%   { transform: translateX(-430px); }
    60%  { transform: translateX(calc(50vw - 190px)); }
    100% { transform: translateX(calc(50vw - 190px)); }
  }
  @keyframes truckStop {
    0%   { transform: translateX(-430px); }
    55%  { transform: translateX(calc(50vw - 190px)); }
    100% { transform: translateX(calc(50vw - 190px)); }
  }
  @keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 0.3; }
    50%       { transform: scale(1.6); opacity: 0; }
  }
  @keyframes roadMove {
    from { background-position: 0 0; }
    to   { background-position: -80px 0; }
  }
`

const s = {
  root: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    background: 'linear-gradient(135deg, #1a003a 0%, #3d0070 40%, #7B00B4 70%, #CB11AB 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    transition: 'opacity 0.5s ease',
  },
  road: {
    position: 'absolute',
    bottom: '28%',
    left: 0,
    right: 0,
    height: 18,
    background: 'rgba(0,0,0,0.35)',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  roadLine: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: 2,
    backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.4) 0px, rgba(255,255,255,0.4) 40px, transparent 40px, transparent 80px)',
    animation: 'roadMove 0.4s linear infinite',
    transform: 'translateY(-50%)',
  },
  truckWrap: {
    position: 'absolute',
    bottom: 'calc(28% + 2px)',
    left: 0,
    animation: 'driveIn 1.4s cubic-bezier(0.25,0.46,0.45,0.94) forwards',
    filter: 'drop-shadow(0 8px 24px rgba(203,17,171,0.5))',
  },
  logoWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    transition: 'opacity 0.6s ease',
  },
  logoWB: {
    fontFamily: '"Inter", sans-serif',
    fontWeight: 900,
    fontSize: 52,
    letterSpacing: 4,
    color: 'white',
    textTransform: 'lowercase',
    textShadow: '0 0 40px rgba(203,17,171,0.8), 0 0 80px rgba(123,0,180,0.6)',
  },
  logoSub: {
    fontFamily: '"Inter", sans-serif',
    fontWeight: 400,
    fontSize: 16,
    letterSpacing: 6,
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
  },
  teamCredit: {
    position: 'absolute',
    bottom: 'calc(28% - 36px)',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontFamily: '"Inter", sans-serif',
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    transition: 'opacity 0.5s ease 0.3s',
  },
  particle: {
    position: 'absolute',
    borderRadius: '50%',
    background: 'rgba(203,17,171,0.8)',
    animation: 'pulse 2s ease-in-out infinite',
    pointerEvents: 'none',
  },
}
