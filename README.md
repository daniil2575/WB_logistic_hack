# WB Logistics Hackathon — Система автоматического вызова транспорта

Решение хакатона Wildberries по прогнозированию логистической нагрузки и автоматизации транспортного планирования.

**Публичный LB:** 0.2558 (метрика: WAPE + |Relative Bias|, меньше — лучше)

---

## Структура репозитория

```
├── src/          # ML-пайплайн (обучение и инференс моделей)
├── service/      # Веб-сервис (FastAPI backend + React frontend)
└── README.md     # Этот файл
```

---

## Задача

Предсказать количество отгруженных ёмкостей по каждому маршруту (`route_id`) за следующие 5 часов с шагом 30 минут — **10 шагов прогноза**.

- **Момент прогноза:** пятница, 11:00–15:30
- **Тест:** пятница 30.05.2025
- **Маршруты:** уникальные пары склад → направление
- **Целевая переменная:** `target_2h` — ёмкости, отгруженные за последние 2 часа

### Метрика

```
SCORE = WAPE + |Relative Bias|

WAPE  = Σ|y - ŷ| / Σy       (точность формы)
Bias  = |Σŷ / Σy - 1|        (смещение уровня)
```

---

## Архитектура системы

```
Исторические данные (train_team_track.parquet)
         │
         ▼
  ┌─────────────────────────────────────────┐
  │           ML-пайплайн (src/)            │
  │                                         │
  │  GRU h27b ──┐                           │
  │  GRU h23  ──┤                           │
  │  TFT h39  ──┼──► Ridge Stack ──► submission.csv
  │  LGBM     ──┤                           │
  │  Naive    ──┘                           │
  └─────────────────────────────────────────┘
         │
         ▼
  ┌─────────────────────────────────────────────────────────┐
  │                   Сервис (service/)                     │
  │                                                         │
  │  FastAPI backend                                        │
  │    ├── /api/forecast/{route_id}                         │
  │    │     └── Live GRU inference (checkpoint .pt)        │
  │    │         Fallback: rolling mean если нет истории    │
  │    ├── /api/transport/orders  (транспортный планировщик)│
  │    ├── /api/metrics/          (KPI-сводка)              │
  │    └── /api/simulate/*        (симулятор времени)       │
  │                                                         │
  │  React frontend                                         │
  │    ├── Dashboard (KPI)                                  │
  │    ├── Forecast (прогноз по маршруту)                   │
  │    ├── Orders (транспортные заявки)                     │
  │    ├── Analytics (аналитика)                            │
  │    └── Simulator (time travel по историческим данным)   │
  └─────────────────────────────────────────────────────────┘
```

---

## Быстрый старт

### 1. Обучение модели

```bash
# Запускать из корня репозитория

# Шаг 1: LGBM и Naive (не входят в run_full_pipeline)
python src/train_lgbm.py \
  --train data/train_team_track.parquet \
  --test data/test_team_track.parquet \
  --outdir artifacts

python src/train_seasonal_naive.py \
  --train data/train_team_track.parquet \
  --test data/test_team_track.parquet \
  --outdir artifacts

# Шаг 2: GRU + TFT + Ridge Stack
python src/run_full_pipeline.py \
  --train data/train_team_track.parquet \
  --test data/test_team_track.parquet \
  --artifacts-dir artifacts
```

Итоговый сабмит: `artifacts/submission_h41b_stack_h27b_h39_h23.csv`

### 2. Запуск сервиса

Перед запуском в корне репозитория должны лежать:

```
data/
  train_team_track.parquet        # данные хакатона (скачать с платформы)
artifacts/
  h28_h27b_gru_winsorized_target.pt   # появляется после шага 1
  h33_h23_lite.pt
  h41a_h39_tft_lite.pt
  lgbm_friday.joblib
  ridge_stack.joblib
```

```bash
cd service && docker-compose up --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- Swagger: http://localhost:8000/docs

> Первый запрос к API (Dashboard) занимает ~8 секунд — прогревается ML-инференс. Последующие — мгновенные (кеш).

---

## Результаты

| Подход | LB Score |
|--------|----------|
| Seasonal Naive (baseline) | ~0.38 |
| LGBM DIRMO | ~0.32 |
| GRU h27b (seed=42) | ~0.28 |
| **Ridge Stack (seed=42)** | **0.2558** |

Подробнее об экспериментах — в [src/README.md](src/README.md).

# С уважением и любовью,  команда Submission impossible DS CLUB 🧡

Мы представляем студенческий клуб REU Data Science Club (РЭУ им. Г.В. Плеханова) — сообщество, которое помогает студентам и начинающим специалистам развиваться в Data Science, Machine Learning, Data Engineering и аналитике.

## Наши площадки
- VK: сообщество REU Data Science Club (ссылка доступна в разделе «Ресурсы» в описании TG-канала)
- Telegram: [@reu_data_science_club](https://t.me/reu_data_science_club)
- YouTube: [REU Data Science Club](https://www.youtube.com/@reudatascienceclub7070)

## Участники команды

| Роль                       | Имя               | Вуз     | Telegram                                                                 |
|---------------------------|-------------------|---------|--------------------------------------------------------------------------|
| Team Lead, ML Engineer, Backend | Даниил Садчиков | РЭУ     | [@sdd4cop](https://t.me/sdd4cop)                    |
| ML engineer, Solution Architect              | Мария Касимцева   | РЭУ     | [@Maria_Kasim](https://t.me/Maria_Kasim)                                        |
| ML engineer              | Даниил Кокорев | РЭУ | [@drkokorev](https://t.me/drkokorev)                                |
