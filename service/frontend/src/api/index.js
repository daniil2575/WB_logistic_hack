import api from './client'

export const simulateAPI = {
  getStatus: () => api.get('/simulate/status'),
  tick: () => api.post('/simulate/tick'),
  setTime: (timestamp) => api.post('/simulate/set', { timestamp }),
  reset: () => api.post('/simulate/reset'),
}

export const forecastAPI = {
  getRoute: (routeId, t) => api.get(`/forecast/${routeId}`, { params: t ? { t } : {} }),
  getAll: (t) => api.get('/forecast/', { params: t ? { t } : {} }),
}

export const transportAPI = {
  getOrders: (t, routeId, tariffs) => api.get('/transport/orders', {
    params: {
      ...(t ? { t } : {}),
      ...(routeId ? { route_id: routeId } : {}),
      ...(tariffs?.gazelle ? { cost_gazelle: tariffs.gazelle } : {}),
      ...(tariffs?.medium  ? { cost_medium:  tariffs.medium  } : {}),
      ...(tariffs?.large   ? { cost_large:   tariffs.large   } : {}),
    }
  }),
}

export const metricsAPI = {
  get: (t) => api.get('/metrics/', { params: t ? { t } : {} }),
}
