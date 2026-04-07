import { useState, useCallback } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import LoadingScreen from './components/LoadingScreen'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Forecast from './pages/Forecast'
import Orders from './pages/Orders'
import Analytics from './pages/Analytics'
import Simulator from './pages/Simulator'

export default function App() {
  const [loaded, setLoaded] = useState(false)
  const onDone = useCallback(() => setLoaded(true), [])

  return (
    <>
      {!loaded && <LoadingScreen onDone={onDone} />}
      <div style={{ opacity: loaded ? 1 : 0, transition: 'opacity 0.5s ease' }}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="forecast" element={<Forecast />} />
              <Route path="orders" element={<Orders />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="simulator" element={<Simulator />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </div>
    </>
  )
}
