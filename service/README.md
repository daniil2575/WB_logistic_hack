# Сервис — Автоматический вызов транспорта

Веб-интерфейс для визуализации прогнозов и управления транспортными заявками.

---

## Стек

| Компонент | Технология |
|-----------|-----------|
| Backend | FastAPI + Uvicorn (Python 3.12) |
| Frontend | React 19 + Vite + Recharts |
| Валидация | Pydantic v2 |
| Данные | Pandas / NumPy / PyArrow |
| Продакшн | Docker Compose (Nginx для фронта) |

---

## Запуск

```bash
# 1. Подготовить данные (один раз)
# Положить train_team_track.parquet и submission.csv в нужные места
python prepare_data.py

# 2. Поднять сервисы
docker-compose up --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- Swagger UI: http://localhost:8000/docs

---

## Структура

```
service/
├── docker-compose.yml
├── prepare_data.py            # Подготовка submission.csv для бэка
├── backend/
│   └── app/
│       ├── main.py            # FastAPI app, CORS, роутеры
│       ├── data/
│       │   ├── submission.csv                # Предсказания модели
│       │   └── train_team_track.parquet      # Исторические данные (read-only)
│       ├── routers/
│       │   ├── forecast.py    # GET /api/forecast/{route_id}
│       │   ├── transport.py   # GET /api/transport/orders
│       │   ├── metrics.py     # GET /api/metrics/
│       │   └── simulate.py    # POST /api/simulate/tick|set|reset
│       ├── services/
│       │   ├── data_loader.py      # Загрузка данных (LRU cache)
│       │   ├── simulator.py        # Глобальное состояние времени
│       │   ├── forecast_service.py # Логика прогноза
│       │   ├── planner_service.py  # Транспортное планирование
│       │   └── metrics_service.py  # Бизнес-метрики
│       └── models/schemas.py       # Pydantic схемы
└── frontend/
    └── src/
        └── pages/
            ├── Dashboard.jsx  # KPI-карточки, срочные заявки, топ маршрутов
            ├── Forecast.jsx   # Прогноз по маршруту (area chart)
            ├── Orders.jsx     # Транспортные заявки (фильтр, сортировка)
            ├── Analytics.jsx  # Аналитические графики
            └── Simulator.jsx  # Time travel по историческим данным
```

---

## API Endpoints

| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/forecast/{route_id}` | Прогноз для маршрута (10 шагов × 30 мин) |
| GET | `/api/forecast/` | Прогноз для всех маршрутов |
| GET | `/api/transport/orders` | Транспортные заявки |
| GET | `/api/metrics/` | KPI-сводка |
| GET | `/api/simulate/status` | Текущее время симулятора |
| POST | `/api/simulate/tick` | Сдвинуть время на +30 мин |
| POST | `/api/simulate/set` | Установить конкретное время |
| POST | `/api/simulate/reset` | Сбросить к началу |

---

## Логика прогноза

```python
# Приоритет 1: submission.csv (предсказания ML-модели)
if route_id in submission_data:
    return submission predictions for 10 steps

# Приоритет 2: fallback — rolling mean по историческим данным
else:
    return historical_mean * hour_scaling_factor
```

---

## Логика планирования транспорта

**Типы транспорта:**

| Тип | Ёмкость | Lead time | Стоимость |
|-----|---------|-----------|-----------|
| Газель | 100 | 1.5 ч | 4 000 ₽ |
| Средний | 300 | 2 ч | 10 000 ₽ |
| Фура | 1 000 | 3 ч | 27 000 ₽ |

**Алгоритм:**
1. Взять прогноз маршрута на 10 шагов
2. Суммировать объём за ближайшие 4 шага (2 часа)
3. Если сумма ≥ 70 ёмкостей → создать заявку
4. Тип транспорта: наименьший, в который влезает объём
5. Время подачи = пиковый момент − lead time

---

## Симулятор времени

Позволяет "путешествовать" по историческим данным:
- Глобальное состояние: `current_time`
- По умолчанию: max(train_timestamp) − 24 часа
- Шаг: +30 минут
- Пресеты: начало данных, середина, последние 24ч, дата теста (30.05.2025)

---

## Бизнес-метрики (Dashboard)

| Метрика | Описание |
|---------|----------|
| Утилизация транспорта, % | Загрузка ТС относительно ёмкости |
| On-time dispatch rate, % | Доля заявок, поданных до дедлайна |
| Стоимость за ёмкость, ₽ | Общие расходы / отгруженные ёмкости |
| Активные заявки | Число незавершённых заявок |
