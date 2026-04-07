# ML-пайплайн

Ансамбль из 5 моделей + Ridge стекинг. Финальный LB: **0.2558**.

---

## Архитектура ансамбля

```
train_h28_h27b.py  →  GRU h27b (winsorized target)  ──────────────────┐
train_h33_h23.py   →  GRU h23  (raw target)          ──────────────────┤
train_h41a_h39.py  →  TFT lite                        ──────────────────┤──► Ridge Stack
train_lgbm.py      →  LGBM DIRMO                      ──────────────────┤    make_h41b_stack.py
train_seasonal_naive.py → Seasonal Naive (lag 1w)     ──────────────────┘
```

`run_full_pipeline.py` запускает GRU h27b + GRU h23 + TFT + стек. LGBM и Naive нужно обучить отдельно заранее.

---

## Модели

### GRU h27b — главная нейросетевая модель

| Параметр | Значение |
|----------|----------|
| Архитектура | GRU, 1 слой, hidden=64 |
| LOOKBACK | 24 шага (12 ч истории) |
| N_DAYS | 14 (последние 14 дней трейна) |
| Target | winsorized на 99.5 перцентиле (≈362) |
| Нормализация | z-score по трейну |
| Калибровка | глобальный k ≈ 1.03–1.04 |
| Признаки | target_win, hour_sin/cos, dow_sin/cos + route/office embeddings (12+6 dim) |
| FRIDAY_WEIGHT | 1.0 (без апвейтинга пятниц) |
| Оптимизатор | Adam, LR=1e-3, MAE loss |
| EPOCHS | 8, PATIENCE=2 |

**Особенность:** winsorization убирает выбросы — хвост распределения обрезается на 99.5%. Это значительно снижает BIAS в предсказаниях.

### GRU h23 — дополнительный сигнал

Идентичен h27b, но обучен на **raw target без winsorization**. Из-за разного распределения ошибок даёт дивергентный сигнал — Ridge стек умеет его использовать.

### TFT lite (h39) — Temporal Fusion Transformer

| Параметр | Значение |
|----------|----------|
| N_DAYS | 21 (больше истории для внимания) |
| Future features | hour_sin/cos, dow_sin/cos, horizon_idx |
| Внимание | MultiheadAttention(future_q, hist_key) |
| Hidden | 64, Heads=4 |

Даёт сигнал о будущих временных паттернах благодаря явным future features.

### LGBM DIRMO

| Параметр | Значение |
|----------|----------|
| Стратегия | 3 отдельные модели по группам шагов (g1: 1-3, g2: 4-7, g3: 8-10) |
| Loss | MAE |
| FRIDAY_WEIGHT | **5.0** — сильное взвешивание пятничных сэмплов |
| Лаги | lag_1/2/3/6/12/24/48, rolling means |
| Пятничные лаги | lag_friday_1w/2w/3w/4w, roll_mean_friday_4w, friday_trend |

Добавляет длинный табличный сигнал — недельные ретроспективы, которые нейросети с LOOKBACK=24 не видят.

### Seasonal Naive

Предсказание = значение ровно неделю назад (lag 168 шагов). Служит бейзлайном и anchor-ом для Ridge стека.

### Ridge Stack

```python
FEATURES = [
    "pred_h27b", "pred_h23", "pred_h39", "pred_lgbm", "pred_naive",
    "pred_mean",       # среднее всех 5
    "pred_std",        # дисперсия — мера неопределённости
    "diff_27_39",      # |h27b - h39| — расхождение нейронок
    "diff_23_39",      # |h23 - h39|
]

Ridge(alpha=0.5, positive=True)  # только положительные веса
```

**Time decay:** `weight = 0.97^(days_ago)` — недавние OOF-сэмплы важнее при обучении стека.

**OOF-сплит:** каждый маршрут отдаёт последние 10 базовых позиций в валидацию — честный holdout без утечки.

---

## Запуск

```bash
# Предварительно: данные в папке data/
python train_lgbm.py --train data/train_team_track.parquet --test data/test_team_track.parquet --outdir artifacts
python train_seasonal_naive.py --train data/train_team_track.parquet --test data/test_team_track.parquet --outdir artifacts

# Основной пайплайн (GRU h27b + GRU h23 + TFT + Ridge)
python run_full_pipeline.py \
  --train data/train_team_track.parquet \
  --test data/test_team_track.parquet \
  --artifacts-dir artifacts
```

Время на CPU (M-серия Mac): ~40 минут.

---

## Все протестированные гипотезы

### Сабмиты на публичный LB

| Эксперимент | LB | Примечание |
|---|---|---|
| UUID (исходный репо) | 0.2564 | Стартовая точка |
| **Ridge Stack seed=42** | **0.2558** | **Лучший результат** |
| seed=456 stack | 0.2574 | Seed хуже |
| avg(seed=42, seed=456) | 0.2589 | Усреднение не помогает |
| EPOCHS=12, PATIENCE=3 | 0.2588 | Best checkpoint всё равно epoch 7-8 |
| N_DAYS=21 для GRU | ~0.26 | Больше данных → хуже сходимость |
| Multi-seed GRU (5×h27b + 4×h23) | 0.2600 | Усреднение сидов не помогает |
| TimeXer blend α=0.10 | 0.2624 | Трансформер не улучшает стек |
| seed=123 stack | 0.2621 | — |
| seed=789 stack | 0.2703 | — |

### Ключевой вывод по прокси-валидации

**Proxy (May23/May16 CAL_WAPE) НЕ коррелирует надёжно с LB.**

- seed=123: proxy лучше на May23 → LB хуже
- seed=789: proxy лучше → LB значительно хуже
- seed=42 — лучший на LB несмотря на не лучший proxy

CAL_WAPE = WAPE после идеальной per-Friday калибровки уровня. Убирает шум от level-сдвига майских пятниц относительно тестовой.

### Отвергнутые по прокси (не сабмитили)

| Гипотеза | Результат прокси |
|---|---|
| LGBM Tweedie loss | Хуже |
| LGBM deep lags (lag_96, lag_168, lag_336) | Хуже |
| LGBM friday_hour_profile | Сломал lag computation |
| LGBM morning features (proxy, trend, accel) | Хуже, BIAS вырос до 0.06 |
| CatBoost DIRMO (3 группы) | Хуже UUID |
| Neural ensemble (75% h27b + 15% h23 + 10% h39, без LGBM/Naive) | Прокси хуже |
| Blend UUID + CatBoost | Прокси хуже |

### Не пробовали / перспективные

- Per-route bias correction на OOF пятницах
- FRIDAY_WEIGHT > 1.0 для GRU/TFT (у LGBM = 5.0 работает)
- Status features (status_1..status_8) — leading indicator, не использовали
- Маршрутная кластеризация с отдельными моделями по кластерам
