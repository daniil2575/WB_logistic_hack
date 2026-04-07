"""
LightGBM base model — 4th signal for the Ridge stack.

Key ideas from M5/research:
- Friday-specific lag features (same hour last friday, rolling mean 4 weeks)
- DIRMO strategy: 3 separate LightGBM models per step group (1-3, 4-7, 8-10)
- MAE loss (directly optimizes WAPE numerator)
- Higher sample weight for Friday 11:00-15:30 samples
- Trains on ALL data (not just last 14 days) — more Friday examples

OOF format matches h27b/h23/h39 for Ridge stack integration.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

from common import (
    ID_COL,
    OFFICE_COL,
    PRED_LEN,
    ROUTE_COL,
    TARGET_COL,
    TIME_COL,
    choose_global_k,
    ensure_columns,
    load_df,
    metric_parts,
    save_json,
    seed_everything,
)

EXPERIMENT_NAME = "LGBM_friday_dirmo"
RANDOM_STATE = 42
FRIDAY_WEIGHT = 5.0  # upweight friday 11:00-15:30 samples

# DIRMO groups: separate LightGBM per step group
STEP_GROUPS = {
    "g1": [1, 2, 3],
    "g2": [4, 5, 6, 7],
    "g3": [8, 9, 10],
}

LGB_PARAMS = {
    "objective": "regression_l1",  # MAE — directly optimizes WAPE
    "learning_rate": 0.05,
    "num_leaves": 64,
    "max_depth": 6,
    "min_child_samples": 30,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "reg_alpha": 0.1,
    "reg_lambda": 1.0,
    "n_estimators": 1000,
    "random_state": RANDOM_STATE,
    "verbose": -1,
    "n_jobs": -1,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", default="data/train_team_track.parquet")
    parser.add_argument("--test", default="data/test_team_track.parquet")
    parser.add_argument("--outdir", default="artifacts")
    return parser.parse_args()


def add_features(df: pd.DataFrame, is_train: bool = True) -> pd.DataFrame:
    df = df.copy()
    df[TIME_COL] = pd.to_datetime(df[TIME_COL])
    df = df.sort_values([ROUTE_COL, TIME_COL]).reset_index(drop=True)

    df["hour"] = df[TIME_COL].dt.hour.astype(np.int8)
    df["dow"] = df[TIME_COL].dt.dayofweek.astype(np.int8)
    df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24.0).astype(np.float32)
    df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24.0).astype(np.float32)
    df["dow_sin"] = np.sin(2 * np.pi * df["dow"] / 7.0).astype(np.float32)
    df["dow_cos"] = np.cos(2 * np.pi * df["dow"] / 7.0).astype(np.float32)
    df["is_friday"] = (df["dow"] == 4).astype(np.int8)
    df["is_friday_lunch"] = ((df["dow"] == 4) & (df["hour"] >= 11) & (df["hour"] <= 15)).astype(np.int8)

    if is_train:
        # Standard lags (previous steps)
        for lag in [1, 2, 3, 6, 12, 24, 48]:
            df[f"lag_{lag}"] = df.groupby(ROUTE_COL)[TARGET_COL].shift(lag).astype(np.float32)

        # Rolling means
        for window in [3, 6, 12, 24, 48]:
            df[f"roll_mean_{window}"] = (
                df.groupby(ROUTE_COL)[TARGET_COL]
                .transform(lambda s: s.shift(1).rolling(window, min_periods=1).mean())
                .astype(np.float32)
            )

        # Friday-specific lags: same hour, N fridays ago (48 steps = 24h, 1 week = 336 steps)
        # lag_336 = same time last week (same day of week, same hour)
        for weeks in [1, 2, 3, 4]:
            lag_steps = weeks * 336  # 1 week = 7 days * 48 steps/day
            df[f"lag_friday_{weeks}w"] = (
                df.groupby(ROUTE_COL)[TARGET_COL].shift(lag_steps).astype(np.float32)
            )

        # Rolling mean of friday-specific lags (same hour, last 4 fridays)
        friday_lags = [f"lag_friday_{w}w" for w in [1, 2, 3, 4]]
        existing = [c for c in friday_lags if c in df.columns]
        if existing:
            df["roll_mean_friday_4w"] = df[existing].mean(axis=1).astype(np.float32)

        # Friday trend: slope over last 4 fridays
        df["friday_trend"] = (
            df[[f"lag_friday_{w}w" for w in [1, 2, 3, 4]]].apply(
                lambda row: np.polyfit([1, 2, 3, 4], row.values[::-1], 1)[0]
                if row.notna().sum() >= 2 else 0.0,
                axis=1
            ).astype(np.float32)
        )

    return df


N_VAL_BASES = 10  # last N base positions per route used for OOF validation


def build_samples_split(
    train_df: pd.DataFrame,
    step_group: list[int],
    n_val_bases: int = N_VAL_BASES,
) -> tuple[tuple, tuple]:
    """
    For each route, split base positions into train (earlier) and val (last n_val_bases).
    Both sets use the full route data so future rows are always available.
    Returns (X_tr, y_tr, w_tr, meta_tr), (X_val, y_val, w_val, meta_val).
    """
    feature_cols = [
        "hour", "dow", "hour_sin", "hour_cos", "dow_sin", "dow_cos",
        "is_friday", "is_friday_lunch",
        "lag_1", "lag_2", "lag_3", "lag_6", "lag_12", "lag_24", "lag_48",
        "roll_mean_3", "roll_mean_6", "roll_mean_12", "roll_mean_24", "roll_mean_48",
        "lag_friday_1w", "lag_friday_2w", "lag_friday_3w", "lag_friday_4w",
        "roll_mean_friday_4w", "friday_trend",

        ROUTE_COL, OFFICE_COL,
    ]
    feature_cols = [c for c in feature_cols if c in train_df.columns]

    X_tr, y_tr, w_tr, meta_tr = [], [], [], []
    X_val, y_val, w_val, meta_val = [], [], [], []

    for route_id, grp in train_df.groupby(ROUTE_COL):
        grp = grp.sort_values(TIME_COL).reset_index(drop=True)
        n = len(grp)

        max_base = n - PRED_LEN  # last valid base index (exclusive)
        if max_base <= 0:
            continue

        val_start = max(0, max_base - n_val_bases)

        for base_idx in range(max_base):
            base_row = grp.iloc[base_idx]
            base_ts = base_row[TIME_COL]
            feat = base_row[feature_cols].values.astype(np.float32)

            for step in step_group:
                future_idx = base_idx + step
                if future_idx >= n:
                    continue
                y_value = float(grp.iloc[future_idx][TARGET_COL])
                if np.isnan(y_value):
                    continue

                future_ts = base_ts + pd.Timedelta(minutes=30 * step)
                is_fri_lunch = (future_ts.dayofweek == 4 and 11 <= future_ts.hour <= 15)
                weight = FRIDAY_WEIGHT if is_fri_lunch else 1.0
                feat_with_step = np.append(feat, [float(step)])
                meta = {
                    "route_id": int(route_id),
                    "base_timestamp": base_ts,
                    "step": int(step),
                    "future_timestamp": future_ts,
                    "y_true": y_value,
                }

                if base_idx < val_start:
                    X_tr.append(feat_with_step)
                    y_tr.append(y_value)
                    w_tr.append(weight)
                    meta_tr.append(meta)
                else:
                    X_val.append(feat_with_step)
                    y_val.append(y_value)
                    w_val.append(weight)
                    meta_val.append(meta)

    to_arrays = lambda lst: np.array(lst, dtype=np.float32) if lst else np.empty((0,), dtype=np.float32)
    return (
        (to_arrays(X_tr), to_arrays(y_tr), to_arrays(w_tr), meta_tr),
        (to_arrays(X_val), to_arrays(y_val), to_arrays(w_val), meta_val),
    )


def main() -> None:
    args = parse_args()
    seed_everything(RANDOM_STATE)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    print(f"Start experiment: {EXPERIMENT_NAME}")

    train_raw = load_df(args.train)
    test_raw = load_df(args.test)
    ensure_columns(train_raw, {TARGET_COL, ROUTE_COL, TIME_COL, OFFICE_COL}, "train")
    ensure_columns(test_raw, {ROUTE_COL, TIME_COL, ID_COL}, "test")

    # Add office to test
    route_to_office = train_raw[[ROUTE_COL, OFFICE_COL]].drop_duplicates(subset=[ROUTE_COL])
    test_raw = test_raw.merge(route_to_office, on=ROUTE_COL, how="left")

    # Encode route/office as integer categories
    all_routes = sorted(train_raw[ROUTE_COL].unique().tolist())
    all_offices = sorted(train_raw[OFFICE_COL].dropna().unique().tolist())
    route2idx = {r: i for i, r in enumerate(all_routes)}
    office2idx = {o: i for i, o in enumerate(all_offices)}

    train_raw[ROUTE_COL] = train_raw[ROUTE_COL].map(route2idx).fillna(0).astype(np.int32)
    train_raw[OFFICE_COL] = train_raw[OFFICE_COL].map(office2idx).fillna(0).astype(np.int32)
    test_raw[ROUTE_COL] = test_raw[ROUTE_COL].map(route2idx).fillna(0).astype(np.int32)
    test_raw[OFFICE_COL] = test_raw[OFFICE_COL].map(office2idx).fillna(0).astype(np.int32)

    # Add features (only on train — test handled separately)
    print("Building features...")
    train_feat = add_features(train_raw, is_train=True)
    train_feat = train_feat.sort_values([ROUTE_COL, TIME_COL]).reset_index(drop=True)

    # Train one LGBM per step group, generate OOF
    models = {}
    all_oof_rows = []
    all_oof_preds = []
    all_oof_true = []

    for group_name, steps in STEP_GROUPS.items():
        print(f"\nTraining group {group_name} (steps {steps})...")
        (X_tr, y_tr, w_tr, _), (X_val, y_val, w_val, meta_val) = build_samples_split(train_feat, steps)

        print(f"  Train: {len(X_tr)}, Val: {len(X_val)}")
        if len(X_tr) == 0 or len(X_val) == 0:
            print(f"  Skipping {group_name} — not enough samples")
            continue

        model = lgb.LGBMRegressor(**LGB_PARAMS)
        model.fit(
            X_tr, y_tr,
            sample_weight=w_tr,
            eval_set=[(X_val, y_val)],
            callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(100)],
        )
        models[group_name] = model

        val_preds = np.maximum(0.0, model.predict(X_val))
        s, wape, bias = metric_parts(y_val, val_preds)
        print(f"  Val SCORE={s:.4f} WAPE={wape:.4f} BIAS={bias:.4f}")

        for i, meta in enumerate(meta_val):
            all_oof_rows.append({
                "row_id": -1,  # will assign later
                "route_id": meta["route_id"],
                "base_timestamp": str(meta["base_timestamp"]),
                "step": meta["step"],
                "future_timestamp": str(meta["future_timestamp"]),
                "y_true": meta["y_true"],
                "y_pred": float(val_preds[i]),
                "model_name": EXPERIMENT_NAME,
            })
        all_oof_preds.extend(val_preds.tolist())
        all_oof_true.extend(y_val.tolist())

    # Assign row_id: align with h27b OOF by (route_id, base_timestamp, step)
    # Load h27b OOF as reference to get row_id mapping
    ref_oof_path = outdir / "oof_h28_h27b_gru_winsorized_target.csv"
    oof_df = pd.DataFrame(all_oof_rows)
    if ref_oof_path.exists():
        ref = pd.read_csv(ref_oof_path)
        ref["base_timestamp"] = pd.to_datetime(ref["base_timestamp"]).astype(str)
        ref_key = ref.set_index(["route_id", "step"])[["row_id", "base_timestamp"]].copy()

        # Build row_id from reference
        oof_df["base_timestamp_dt"] = pd.to_datetime(oof_df["base_timestamp"])
        ref2 = ref[["row_id", "route_id", "step", "base_timestamp"]].copy()
        ref2["base_timestamp"] = pd.to_datetime(ref2["base_timestamp"]).dt.floor("min")
        oof_df["base_timestamp_floor"] = pd.to_datetime(oof_df["base_timestamp"]).dt.floor("min")

        merged = oof_df.merge(
            ref2,
            left_on=["route_id", "step", "base_timestamp_floor"],
            right_on=["route_id", "step", "base_timestamp"],
            how="left",
            suffixes=("", "_ref"),
        )
        oof_df["row_id"] = merged["row_id_ref"].fillna(-1).astype(int)
        oof_df = oof_df.drop(columns=["base_timestamp_dt", "base_timestamp_floor"])

        # Keep only rows that matched reference (so stack merge works)
        oof_df = oof_df[oof_df["row_id"] >= 0].copy()
        print(f"\nOOF rows matched to reference: {len(oof_df)}")
    else:
        print("WARNING: reference OOF not found, using sequential row_id")
        oof_df["row_id"] = np.arange(len(oof_df))

    if len(all_oof_true) > 0:
        score, wape, bias = metric_parts(
            np.array(all_oof_true), np.array(all_oof_preds)
        )
        print(f"\nOverall OOF: SCORE={score:.6f} WAPE={wape:.6f} BIAS={bias:.6f}")

    # Calibration
    if len(all_oof_true) > 0:
        best_k, _, _, _ = choose_global_k(
            np.array(all_oof_true), np.array(all_oof_preds)
        )
        print(f"Calibration k: {best_k:.4f}")
        oof_df["y_pred"] = np.maximum(0.0, oof_df["y_pred"].values * best_k)
    else:
        best_k = 1.0

    oof_name = outdir / "oof_lgbm_friday.csv"
    oof_df.to_csv(oof_name, index=False)
    print(f"Saved OOF: {oof_name} ({len(oof_df)} rows)")

    # Test predictions
    print("\nGenerating test predictions...")
    test_feat = add_features(test_raw, is_train=False)

    # For test: build features using train history for lags
    # We need to compute lags from train for test rows
    # Strategy: append test to train, compute lags, take test rows
    train_for_lags = train_feat[[ROUTE_COL, TIME_COL, TARGET_COL]].copy()
    test_for_lags = test_feat[[ROUTE_COL, TIME_COL]].copy()
    test_for_lags[TARGET_COL] = np.nan

    combined = pd.concat([train_for_lags, test_for_lags], ignore_index=True)
    combined = combined.sort_values([ROUTE_COL, TIME_COL]).reset_index(drop=True)

    # Add lag features on combined
    combined_feat = add_features(combined, is_train=True)
    # Take only test rows (where TARGET_COL is nan)
    test_with_lags = combined_feat[combined_feat[TARGET_COL].isna()].copy()
    test_with_lags = test_with_lags.merge(
        test_raw[[ROUTE_COL, TIME_COL, ID_COL, OFFICE_COL]],
        on=[ROUTE_COL, TIME_COL], how="left"
    )

    # Build test feature matrix
    feature_cols_base = [
        "hour", "dow", "hour_sin", "hour_cos", "dow_sin", "dow_cos",
        "is_friday", "is_friday_lunch",
        "lag_1", "lag_2", "lag_3", "lag_6", "lag_12", "lag_24", "lag_48",
        "roll_mean_3", "roll_mean_6", "roll_mean_12", "roll_mean_24", "roll_mean_48",
        "lag_friday_1w", "lag_friday_2w", "lag_friday_3w", "lag_friday_4w",
        "roll_mean_friday_4w", "friday_trend",

        ROUTE_COL, OFFICE_COL,
    ]
    feature_cols_base = [c for c in feature_cols_base if c in test_with_lags.columns]

    test_with_lags = test_with_lags.fillna(0)
    test_with_lags = test_with_lags.sort_values([ROUTE_COL, TIME_COL]).reset_index(drop=True)
    test_with_lags["step"] = test_with_lags.groupby(ROUTE_COL).cumcount() + 1

    # Predict per step group
    test_preds_by_id = {}
    for group_name, steps in STEP_GROUPS.items():
        if group_name not in models:
            continue
        mask = test_with_lags["step"].isin(steps)
        subset = test_with_lags[mask].copy()
        X_test = np.column_stack([
            subset[feature_cols_base].values.astype(np.float32),
            subset["step"].values.astype(np.float32),
        ])
        preds = np.maximum(0.0, models[group_name].predict(X_test) * best_k)
        for idx, pred in zip(subset[ID_COL].values, preds):
            test_preds_by_id[int(idx)] = float(pred)

    test_raw_sorted = test_raw.sort_values(ID_COL).reset_index(drop=True)
    final_preds = [test_preds_by_id.get(int(i), 0.0) for i in test_raw_sorted[ID_COL].values]

    submission = pd.DataFrame({ID_COL: test_raw_sorted[ID_COL].values, "y_pred": final_preds})
    sub_name = outdir / "submission_lgbm_friday.csv"
    submission.to_csv(sub_name, index=False)
    print(f"Saved submission: {sub_name}")

    save_json(outdir / "summary_lgbm_friday.json", {
        "experiment_name": EXPERIMENT_NAME,
        "best_k": float(best_k),
        "n_groups": len(models),
    })


if __name__ == "__main__":
    main()
