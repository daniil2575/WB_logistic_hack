from __future__ import annotations

import argparse
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch.utils.data import DataLoader

from common import (
    GRULite,
    ID_COL,
    OFFICE_COL,
    PRED_LEN,
    ROUTE_COL,
    SeqDataset,
    TARGET_COL,
    TIME_COL,
    add_time_features,
    build_route_and_office_indices,
    choose_global_k,
    ensure_columns,
    load_df,
    metric_parts,
    run_epoch_gru,
    save_json,
    seed_everything,
)

EXPERIMENT_NAME = "H33_save_honest_oof_h23_lite"
LOOKBACK = 24
N_DAYS = 14
FRIDAY_WEIGHT = 1.0
BATCH_SIZE = 256
HIDDEN_SIZE = 64
LR = 1e-3
EPOCHS = 8
PATIENCE = 2
RANDOM_STATE = 42


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", default="data/train_team_track.parquet")
    parser.add_argument("--test", default="data/test_team_track.parquet")
    parser.add_argument("--outdir", default="artifacts")
    parser.add_argument("--device", default=("cuda" if torch.cuda.is_available() else "cpu"))
    parser.add_argument("--seed", type=int, default=RANDOM_STATE)
    parser.add_argument("--suffix", type=str, default="", help="suffix for output filenames, e.g. '_s1'")
    return parser.parse_args()



def main() -> None:
    args = parse_args()
    seed_everything(args.seed)

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    print(f"Start experiment: {EXPERIMENT_NAME} (seed={args.seed})")
    print(f"Device: {args.device}")

    train = load_df(args.train)
    test = load_df(args.test)
    ensure_columns(train, {TARGET_COL, ROUTE_COL, TIME_COL, OFFICE_COL}, "train")
    ensure_columns(test, {ROUTE_COL, TIME_COL, ID_COL}, "test")

    train_h = train.copy()
    test_h = test.copy()
    train_h[TIME_COL] = pd.to_datetime(train_h[TIME_COL])
    test_h[TIME_COL] = pd.to_datetime(test_h[TIME_COL])

    cutoff = train_h[TIME_COL].max() - pd.Timedelta(days=N_DAYS)
    train_h = train_h[train_h[TIME_COL] >= cutoff].copy()
    train_h = train_h.sort_values([ROUTE_COL, TIME_COL]).reset_index(drop=True)
    test_h = test_h.sort_values([ROUTE_COL, TIME_COL]).reset_index(drop=True)

    train_h = add_time_features(train_h)
    test_h = add_time_features(test_h)

    route_to_office = train[[ROUTE_COL, OFFICE_COL]].drop_duplicates(subset=[ROUTE_COL]).copy()
    test_h = test_h.merge(route_to_office, on=ROUTE_COL, how="left")

    train_h, test_h, route2idx, office2idx = build_route_and_office_indices(train_h, test_h)

    train_seq_features = [TARGET_COL, "hour_sin", "hour_cos", "dow_sin", "dow_cos"]
    feature_means = train_h[train_seq_features].mean()
    feature_stds = train_h[train_seq_features].std().replace(0, 1.0)
    # Save raw target BEFORE normalization for metric computation
    train_h["target_raw"] = train_h[TARGET_COL].values.copy()
    train_h[train_seq_features] = ((train_h[train_seq_features] - feature_means) / feature_stds).astype(np.float32)

    target_mean = float(feature_means[TARGET_COL])
    target_std = float(feature_stds[TARGET_COL])

    train_samples: list[dict] = []
    valid_samples: list[dict] = []

    for route_id, grp in train_h.groupby(ROUTE_COL):
        grp = grp.sort_values(TIME_COL).reset_index(drop=True)
        x_seq = grp[train_seq_features].values.astype(np.float32)
        y_norm = grp[TARGET_COL].values.astype(np.float32)
        y_true_raw = grp["target_raw"].values.astype(np.float32)
        route_idx = int(grp["route_idx"].iloc[0])
        office_idx = int(grp["office_idx"].iloc[0])

        local_samples: list[dict] = []
        max_start = len(grp) - LOOKBACK - PRED_LEN + 1
        if max_start <= 0:
            continue

        for start in range(max_start):
            base_ts = grp.loc[start + LOOKBACK - 1, TIME_COL]
            # Upweight samples whose first predicted step lands on Friday 11:00-15:30
            is_fri_lunch = (
                base_ts.dayofweek == 4 and 10 <= base_ts.hour <= 14
            )
            local_samples.append(
                {
                    "x": x_seq[start : start + LOOKBACK],
                    "y": y_norm[start + LOOKBACK : start + LOOKBACK + PRED_LEN],
                    "y_true_raw": y_true_raw[start + LOOKBACK : start + LOOKBACK + PRED_LEN],
                    "route_idx": route_idx,
                    "office_idx": office_idx,
                    "route_id": int(route_id),
                    "base_timestamp": base_ts,
                    "weight": np.float32(FRIDAY_WEIGHT if is_fri_lunch else 1.0),
                }
            )

        if len(local_samples) <= 10:
            valid_samples.extend(local_samples)
        else:
            train_samples.extend(local_samples[:-10])
            valid_samples.extend(local_samples[-10:])

    if not train_samples or not valid_samples:
        raise RuntimeError("Not enough train/valid samples to run H33.")

    print("Train samples:", len(train_samples))
    print("Valid samples:", len(valid_samples))

    train_loader = DataLoader(SeqDataset(train_samples), batch_size=BATCH_SIZE, shuffle=True, num_workers=0)
    valid_loader = DataLoader(SeqDataset(valid_samples), batch_size=BATCH_SIZE, shuffle=False, num_workers=0)

    model = GRULite(
        seq_input_dim=len(train_seq_features),
        n_routes=len(route2idx),
        n_offices=len(office2idx),
        hidden_size=HIDDEN_SIZE,
        pred_len=PRED_LEN,
    ).to(args.device)

    criterion = torch.nn.L1Loss()
    optimizer = torch.optim.Adam(model.parameters(), lr=LR)

    best_val = float("inf")
    best_state = None
    bad_epochs = 0
    train_start = time.time()

    for epoch in range(1, EPOCHS + 1):
        tr_loss = run_epoch_gru(model, optimizer, criterion, train_loader, args.device, train_mode=True)
        va_loss = run_epoch_gru(model, optimizer, criterion, valid_loader, args.device, train_mode=False)
        print(f"Epoch {epoch:02d} | train_mae={tr_loss:.5f} | valid_mae={va_loss:.5f}")
        if va_loss < best_val:
            best_val = va_loss
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            bad_epochs = 0
        else:
            bad_epochs += 1
            if bad_epochs >= PATIENCE:
                print("Early stopping")
                break

    print(f"Total training time: {(time.time() - train_start) / 60:.2f} min")
    if best_state is not None:
        model.load_state_dict(best_state)

    model.eval()
    valid_preds, valid_true_raw = [], []
    with torch.no_grad():
        for batch in valid_loader:
            pred = model(
                batch["x"].to(args.device),
                batch["route_idx"].to(args.device),
                batch["office_idx"].to(args.device),
            ).cpu().numpy()
            valid_preds.append(pred)
            valid_true_raw.append(batch["y_true_raw"].numpy())

    valid_preds = np.concatenate(valid_preds, axis=0)
    valid_true_raw = np.concatenate(valid_true_raw, axis=0)
    valid_preds_denorm = np.maximum(0.0, valid_preds * target_std + target_mean)

    base_score, base_wape, base_bias = metric_parts(valid_true_raw.reshape(-1), valid_preds_denorm.reshape(-1))
    best_k, cal_score, cal_wape, cal_bias = choose_global_k(valid_true_raw.reshape(-1), valid_preds_denorm.reshape(-1))
    valid_cal = np.maximum(0.0, valid_preds_denorm * best_k)

    print("\nBefore calibration:")
    print(f"SCORE = {base_score:.6f}")
    print(f"WAPE  = {base_wape:.6f}")
    print(f"BIAS  = {base_bias:.6f}")
    print("\nAfter calibration:")
    print(f"k     = {best_k:.4f}")
    print(f"SCORE = {cal_score:.6f}")
    print(f"WAPE  = {cal_wape:.6f}")
    print(f"BIAS  = {cal_bias:.6f}")

    oof_rows = []
    for i, sample in enumerate(valid_samples):
        base_ts = sample["base_timestamp"]
        for h in range(1, PRED_LEN + 1):
            oof_rows.append(
                {
                    "row_id": int(i),
                    "route_id": int(sample["route_id"]),
                    "base_timestamp": str(base_ts),
                    "step": int(h),
                    "future_timestamp": str(base_ts + pd.Timedelta(minutes=30 * h)),
                    "y_true": float(sample["y_true_raw"][h - 1]),
                    "y_pred": float(valid_cal[i][h - 1]),
                    "model_name": EXPERIMENT_NAME,
                }
            )

    oof_df = pd.DataFrame(oof_rows)
    oof_name = outdir / f"oof_h33_h23_lite{args.suffix}.csv"
    oof_df.to_csv(oof_name, index=False)

    test_rows = []
    for route_id, grp in train_h.groupby(ROUTE_COL):
        grp = grp.sort_values(TIME_COL).reset_index(drop=True)
        if len(grp) < LOOKBACK:
            continue
        test_rows.append(
            {
                "route_id": int(route_id),
                "x": grp[train_seq_features].values.astype(np.float32)[-LOOKBACK:],
                "route_idx": int(grp["route_idx"].iloc[0]),
                "office_idx": int(grp["office_idx"].iloc[0]),
            }
        )

    test_loader = DataLoader(SeqDataset(test_rows), batch_size=BATCH_SIZE, shuffle=False, num_workers=0)
    route_preds: dict[int, np.ndarray] = {}
    with torch.no_grad():
        for batch in test_loader:
            pred = model(
                batch["x"].to(args.device),
                batch["route_idx"].to(args.device),
                batch["office_idx"].to(args.device),
            ).cpu().numpy()
            pred_real = np.maximum(0.0, pred * target_std + target_mean)
            pred_real = np.maximum(0.0, pred_real * best_k)
            for j, route_id in enumerate(batch["route_id"].cpu().numpy()):
                route_preds[int(route_id)] = pred_real[j]

    test_sorted = test_h.sort_values([ROUTE_COL, TIME_COL]).copy()
    test_sorted["step"] = test_sorted.groupby(ROUTE_COL).cumcount() + 1
    preds = [float(route_preds[int(r)][int(s) - 1]) for r, s in zip(test_sorted[ROUTE_COL].values, test_sorted["step"].values)]

    submission = pd.DataFrame({ID_COL: test_sorted[ID_COL].values, "y_pred": preds}).sort_values(ID_COL).reset_index(drop=True)
    sub_name = outdir / f"submission_h33_h23_lite{args.suffix}.csv"
    submission.to_csv(sub_name, index=False)

    ckpt_name = outdir / "h33_h23_lite.pt"
    torch.save(
        {
            "model_state_dict": model.state_dict(),
            "route2idx": route2idx,
            "office2idx": office2idx,
            "target_mean": target_mean,
            "target_std": target_std,
            "best_k": best_k,
            "train_seq_features": train_seq_features,
            "lookback": LOOKBACK,
        },
        ckpt_name,
    )

    summary = {
        "experiment_name": EXPERIMENT_NAME,
        "device": args.device,
        "lookback": LOOKBACK,
        "n_days": N_DAYS,
        "base_score": base_score,
        "base_wape": base_wape,
        "base_bias": base_bias,
        "best_k": best_k,
        "calibrated_score": cal_score,
        "calibrated_wape": cal_wape,
        "calibrated_bias": cal_bias,
        "oof_file": str(oof_name),
        "submission_file": str(sub_name),
        "checkpoint_file": str(ckpt_name),
    }
    save_json(outdir / "summary_h33_h23_lite.json", summary)

    print(f"Saved OOF: {oof_name}")
    print(f"Saved submission: {sub_name}")


if __name__ == "__main__":
    main()
