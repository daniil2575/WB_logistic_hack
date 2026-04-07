import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, TrendingUp, Truck, BarChart3, Clock, Zap } from 'lucide-react'
import { colors } from '../theme'
import { useSimulator } from '../hooks/useSimulator'

const NAV = [
  { to: '/',          label: 'Дашборд',    icon: LayoutDashboard },
  { to: '/forecast',  label: 'Прогноз',    icon: TrendingUp },
  { to: '/orders',    label: 'Заявки',     icon: Truck },
  { to: '/analytics', label: 'Аналитика',  icon: BarChart3 },
  { to: '/simulator', label: 'Симулятор',  icon: Clock },
]

export default function Layout() {
  const { status } = useSimulator()
  const currentTime = status?.current_time
    ? new Date(status.current_time).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '—'

  return (
    <div style={s.root}>
      <style>{globalCss}</style>

      {/* Background warehouse image overlay */}
      <div style={s.bgImage} />
      <div style={s.bgOverlay} />

      {/* Corner warehouse photo */}
      <div style={s.cornerPhoto} />

      {/* Sidebar */}
      <aside style={s.sidebar}>
        <div style={s.logo}>
          <div style={s.logoMark}>WB</div>
          <div>
            <div style={s.logoTitle}>Wildberries</div>
            <div style={s.logoSub}>Logistics</div>
          </div>
        </div>

        <nav style={s.nav}>
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              style={({ isActive }) => ({ ...s.navItem, ...(isActive ? s.navActive : {}) })}
            >
              <Icon size={18} />
              <span>{label}</span>
              {to === '/' && <div style={s.navPulse} />}
            </NavLink>
          ))}
        </nav>

        <div style={s.sidebarFooter}>
          <div style={s.timeBox}>
            <Zap size={12} color={colors.green} />
            <span style={s.timeLabel}>Симуляция</span>
            <span style={s.timeValue}>{currentTime}</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main style={s.main}>
        <Outlet />
      </main>
    </div>
  )
}

const globalCss = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #050d1a; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: #0d1b2e; }
  ::-webkit-scrollbar-thumb { background: #243858; border-radius: 3px; }
  a { text-decoration: none; }
`

const s = {
  root: {
    display: 'flex',
    minHeight: '100vh',
    fontFamily: '"Inter", -apple-system, sans-serif',
    color: colors.textPrimary,
    position: 'relative',
  },
  bgImage: {
    position: 'fixed',
    inset: 0,
    backgroundImage: `url("https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=1920&q=60")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    filter: 'blur(3px) brightness(0.18) saturate(0.5)',
    zIndex: 0,
    transform: 'scale(1.05)',
  },
  bgOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'linear-gradient(135deg, rgba(5,13,26,0.92) 0%, rgba(13,27,46,0.88) 100%)',
    zIndex: 1,
  },
  sidebar: {
    width: 220,
    minHeight: '100vh',
    background: 'rgba(11,20,38,0.92)',
    borderRight: `1px solid ${colors.border}`,
    display: 'flex',
    flexDirection: 'column',
    padding: '24px 0',
    position: 'sticky',
    top: 0,
    height: '100vh',
    zIndex: 10,
    backdropFilter: 'blur(12px)',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 20px 28px',
    borderBottom: `1px solid ${colors.border}`,
    marginBottom: 20,
  },
  logoMark: {
    width: 38,
    height: 38,
    borderRadius: 10,
    background: colors.wbGrad,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 900,
    fontSize: 14,
    letterSpacing: 1,
    boxShadow: '0 4px 16px rgba(203,17,171,0.4)',
  },
  logoTitle: {
    fontWeight: 800,
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 1.2,
  },
  logoSub: {
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  nav: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '0 12px',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    borderRadius: 8,
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: 500,
    transition: 'all 0.15s ease',
    position: 'relative',
    cursor: 'pointer',
  },
  navActive: {
    background: 'linear-gradient(90deg, rgba(203,17,171,0.18) 0%, rgba(123,0,180,0.1) 100%)',
    color: '#e87cda',
    borderLeft: '3px solid #CB11AB',
    paddingLeft: 9,
  },
  navPulse: {
    position: 'absolute',
    right: 10,
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: colors.green,
    boxShadow: `0 0 8px ${colors.green}`,
  },
  sidebarFooter: {
    padding: '16px 12px 0',
    borderTop: `1px solid ${colors.border}`,
    marginTop: 12,
  },
  timeBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    background: 'rgba(16,224,128,0.06)',
    border: `1px solid rgba(16,224,128,0.15)`,
    borderRadius: 8,
    padding: '10px 12px',
  },
  timeLabel: {
    fontSize: 10,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  timeValue: {
    fontSize: 12,
    color: colors.green,
    fontWeight: 700,
    fontFamily: 'monospace',
  },
  main: {
    flex: 1,
    zIndex: 2,
    overflowY: 'auto',
    minHeight: '100vh',
  },
  cornerPhoto: {
    position: 'fixed',
    bottom: 0,
    right: 0,
    width: 780,
    height: 480,
    backgroundImage: 'url("/image.png")',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    zIndex: 1,
    maskImage: 'radial-gradient(ellipse 65% 65% at 62% 62%, black 25%, rgba(0,0,0,0.5) 50%, transparent 72%)',
    WebkitMaskImage: 'radial-gradient(ellipse 65% 65% at 62% 62%, black 25%, rgba(0,0,0,0.5) 50%, transparent 72%)',
    filter: 'brightness(0.32) saturate(0.55)',
    pointerEvents: 'none',
  },
}
