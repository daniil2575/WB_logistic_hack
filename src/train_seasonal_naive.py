"""
Seasonal Naive base model — 5th signal for the Ridge stack.

For each (route_id, future_timestamp), predicts the target value
from exactly 1 week ago (same route, same hour, -7 days).

OOF format matches h27b/h23/h39/lgbm for Ridge stack integration.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from common import (
    ID_COL,
    PRED_LEN,
    ROUTE_COL,
    TARGET_COL,
    TIME_COL,
    ensure_columns,
    load_df,
    metric_parts,
    save_json,
)

EXPERIMENT_NAME = "SeasonalNaive_1w"
ONE_WEEK = pd.Timedelta(weeks=1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", default="data/train_team_track.parquet")
    parser.add_argument("--test", default="data/test_team_track.parquet")
    parser.add_argument("--oof-ref", default="artifacts/oof_h28_h27b_gru_winsorized_target.csv",
                        help="OOF reference file to align row_id/step structure")
    parser.add_argument("--outdir", default="artifacts")
    return parser.parse_args()


def build_lookup(train: pd.DataFrame) -> dict:
    """Build (route_id, timestamp) -> target lookup from train."""
    train = train.copy()
    train[TIME_COL] = pd.to_datetime(train[TIME_COL])
    lookup = {}
    for _, row in train.iterrows():
        lookup[(int(row[ROUTE_COL]), row[TIME_COL])] = float(row[TARGET_COL])
    return lookup


def main() -> None:
    args = parse_args()
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    print(f"Start experiment: {EXPERIMENT_NAME}")

    train = load_df(args.train)
    test = load_df(args.test)
    train[TIME_COL] = pd.to_datetime(train[TIME_COL])
    test[TIME_COL] = pd.to_datetime(test[TIME_COL])

    print("Building train lookup...")
    # Build vectorized lookup: (route_id, timestamp) -> target
    train_indexed = train.set_index([ROUTE_COL, TIME_COL])[TARGET_COL]
    train_indexed = train_indexed[~train_indexed.index.duplicated(keep='last')]

    # --- OOF ---
    oof_ref = pd.read_csv(args.oof_ref)
    oof_ref['future_timestamp'] = pd.to_datetime(oof_ref['future_timestamp'])
    ensure_columns(oof_ref, {'row_id', 'route_id', 'base_timestamp', 'step', 'future_timestamp', 'y_true'}, "oof_ref")

    print(f"OOF ref: {len(oof_ref)} rows")

    # For each OOF row: look up (route_id, future_timestamp - 1 week) in train
    lookup_ts = oof_ref['future_timestamp'] - ONE_WEEK
    keys = list(zip(oof_ref['route_id'].astype(int), lookup_ts))
    y_pred_oof = np.array([
        float(train_indexed.get((route_id, ts), np.nan))
        for route_id, ts in keys
    ], dtype=np.float32)

    # Fill NaN with route mean from train
    route_means = train.groupby(ROUTE_COL)[TARGET_COL].mean().to_dict()
    nan_mask = np.isnan(y_pred_oof)
    print(f"OOF NaN before fill: {nan_mask.sum()} / {len(y_pred_oof)} ({nan_mask.mean():.1%})")
    for i in np.where(nan_mask)[0]:
        route_id = int(oof_ref.iloc[i]['route_id'])
        y_pred_oof[i] = route_means.get(route_id, float(train[TARGET_COL].mean()))

    oof_df = oof_ref[['row_id', 'route_id', 'base_timestamp', 'step', 'future_timestamp', 'y_true']].copy()
    oof_df['y_pred'] = y_pred_oof
    oof_df['model_name'] = EXPERIMENT_NAME

    valid_mask = ~oof_ref['y_true'].isna()
    score, wape, bias = metric_parts(
        oof_df.loc[valid_mask, 'y_true'].values,
        oof_df.loc[valid_mask, 'y_pred'].values,
    )
    print(f"\nOOF SCORE = {score:.4f}  WAPE = {wape:.4f}  |bias| = {bias:.4f}")

    oof_name = outdir / "oof_seasonal_naive_1w.csv"
    oof_df.to_csv(oof_name, index=False)
    print(f"Saved OOF: {oof_name}")

    # --- Test ---
    test_sorted = test.sort_values([ROUTE_COL, TIME_COL]).copy()
    test_sorted['step'] = test_sorted.groupby(ROUTE_COL).cumcount() + 1

    # future_timestamp for test: we need to infer from step
    # base = first timestamp per route, future = base + step * 30min
    # But simpler: use the test timestamp itself as future_timestamp
    # (test rows ARE the future timestamps we predict)
    test_sorted['future_timestamp'] = test_sorted[TIME_COL]

    lookup_ts_test = test_sorted['future_timestamp'] - ONE_WEEK
    keys_test = list(zip(test_sorted[ROUTE_COL].astype(int), lookup_ts_test))
    y_pred_test = np.array([
        float(train_indexed.get((route_id, ts), np.nan))
        for route_id, ts in keys_test
    ], dtype=np.float32)

    nan_mask_test = np.isnan(y_pred_test)
    print(f"Test NaN before fill: {nan_mask_test.sum()} / {len(y_pred_test)} ({nan_mask_test.mean():.1%})")
    for i in np.where(nan_mask_test)[0]:
        route_id = int(test_sorted.iloc[i][ROUTE_COL])
        y_pred_test[i] = route_means.get(route_id, float(train[TARGET_COL].mean()))

    sub_df = test_sorted[[ID_COL]].copy()
    sub_df['y_pred'] = y_pred_test
    sub_df = sub_df.sort_values(ID_COL).reset_index(drop=True)

    sub_name = outdir / "submission_seasonal_naive_1w.csv"
    sub_df.to_csv(sub_name, index=False)
    print(f"Saved submission: {sub_name}")

    summary = {
        "experiment_name": EXPERIMENT_NAME,
        "oof_score": float(score),
        "oof_wape": float(wape),
        "oof_bias": float(bias),
        "oof_nan_pct": float(nan_mask.mean()),
        "test_nan_pct": float(nan_mask_test.mean()),
    }
    save_json(outdir / "summary_seasonal_naive_1w.json", summary)


if __name__ == "__main__":
    main()
