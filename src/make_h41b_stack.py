from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge

from common import ID_COL, ROUTE_COL, TIME_COL, ensure_columns, load_df, metric_parts, save_json

EXPERIMENT_NAME = "H41b_honest_stack_h27b_h39_h23"
TIME_DECAY = 0.97  # per-day decay: recent OOF samples get higher weight

OOF_FILES = {
    "h27b": "oof_h28_h27b_gru_winsorized_target.csv",
    "h23": "oof_h33_h23_lite.csv",
    "h39": "oof_h41a_h39_tft_lite.csv",
    "lgbm": "oof_lgbm_friday.csv",
    "naive": "oof_seasonal_naive_1w.csv",
}
SUB_FILES = {
    "h27b": "submission_h28_h27b_gru_winsorized_target.csv",
    "h23": "submission_h33_h23_lite.csv",
    "h39": "submission_h41a_h39_tft_lite.csv",
    "lgbm": "submission_lgbm_friday.csv",
    "naive": "submission_seasonal_naive_1w.csv",
}
FEATURES = [
    "pred_h27b",
    "pred_h23",
    "pred_h39",
    "pred_lgbm",
    "pred_naive",
    "pred_mean",
    "pred_std",
    "diff_27_39",
    "diff_23_39",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", default="data/test_team_track.parquet")
    parser.add_argument("--artifacts-dir", default="artifacts")
    parser.add_argument("--outdir", default="artifacts")
    return parser.parse_args()



def get_group(step: int) -> str:
    return "all"



def load_required_csvs(artifacts_dir: Path) -> tuple[dict[str, pd.DataFrame], dict[str, pd.DataFrame]]:
    oof_frames = {}
    sub_frames = {}

    for key, name in OOF_FILES.items():
        path = artifacts_dir / name
        if not path.exists():
            raise FileNotFoundError(f"Missing OOF file: {path}")
        oof_frames[key] = pd.read_csv(path)

    for key, name in SUB_FILES.items():
        path = artifacts_dir / name
        if not path.exists():
            raise FileNotFoundError(f"Missing submission file: {path}")
        sub_frames[key] = pd.read_csv(path)

    return oof_frames, sub_frames



def main() -> None:
    args = parse_args()
    artifacts_dir = Path(args.artifacts_dir)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    print(f"Start experiment: {EXPERIMENT_NAME}")

    test = load_df(args.test)
    ensure_columns(test, {ID_COL, ROUTE_COL, TIME_COL}, "test")

    oof_frames, sub_frames = load_required_csvs(artifacts_dir)

    oof_h27b = oof_frames["h27b"].rename(columns={"y_pred": "pred_h27b"})
    oof_h23 = oof_frames["h23"].rename(columns={"y_pred": "pred_h23"})
    oof_h39 = oof_frames["h39"].rename(columns={"y_pred": "pred_h39"})
    oof_lgbm = oof_frames["lgbm"].rename(columns={"y_pred": "pred_lgbm"})
    oof_naive = oof_frames["naive"].rename(columns={"y_pred": "pred_naive"})

    required_oof_cols = {"row_id", "step", "y_true"}
    for name, df in [("h27b", oof_h27b), ("h23", oof_h23), ("h39", oof_h39), ("lgbm", oof_lgbm), ("naive", oof_naive)]:
        ensure_columns(df, required_oof_cols | {f"pred_{name}"}, f"oof_{name}")

    meta = oof_h27b[["row_id", "route_id", "base_timestamp", "step", "future_timestamp", "y_true", "pred_h27b"]].merge(
        oof_h23[["row_id", "step", "pred_h23"]], on=["row_id", "step"], how="inner",
    ).merge(
        oof_h39[["row_id", "step", "pred_h39"]], on=["row_id", "step"], how="inner",
    ).merge(
        oof_lgbm[["row_id", "step", "pred_lgbm"]], on=["row_id", "step"], how="inner",
    ).merge(
        oof_naive[["row_id", "step", "pred_naive"]], on=["row_id", "step"], how="inner",
    )

    base_preds = ["pred_h27b", "pred_h23", "pred_h39", "pred_lgbm", "pred_naive"]
    meta["pred_mean"] = meta[base_preds].mean(axis=1)
    meta["pred_std"] = meta[base_preds].std(axis=1).fillna(0.0)
    meta["diff_27_39"] = np.abs(meta["pred_h27b"] - meta["pred_h39"])
    meta["diff_23_39"] = np.abs(meta["pred_h23"] - meta["pred_h39"])
    meta["group"] = meta["step"].apply(get_group)

    # Time-decay weights: more recent OOF samples get higher weight
    meta["base_timestamp"] = pd.to_datetime(meta["base_timestamp"])
    max_ts = meta["base_timestamp"].max()
    days_ago = (max_ts - meta["base_timestamp"]).dt.total_seconds() / 86400.0
    meta["sample_weight"] = TIME_DECAY ** days_ago

    models: dict[str, Ridge] = {}
    meta_pred = np.zeros(len(meta), dtype=np.float32)
    model_info: dict[str, dict] = {}

    for group in ["all"]:
        part = meta[meta["group"] == group]
        X = part[FEATURES].values
        y = part["y_true"].values
        w = part["sample_weight"].values
        model = Ridge(alpha=0.5, positive=True)
        model.fit(X, y, sample_weight=w)
        pred = np.maximum(0.0, model.predict(X))
        meta_pred[part.index] = pred
        models[group] = model
        model_info[group] = {
            "intercept": float(model.intercept_),
            "coefficients": {feature: float(coef) for feature, coef in zip(FEATURES, model.coef_)},
            "n_rows": int(len(part)),
        }

    score, wape, bias = metric_parts(meta["y_true"].values, meta_pred)
    print("\nHonest stack OOF:")
    print(f"SCORE = {score:.6f}")
    print(f"WAPE  = {wape:.6f}")
    print(f"BIAS  = {bias:.6f}")

    sub_h27b = sub_frames["h27b"].sort_values(ID_COL).reset_index(drop=True)
    sub_h23 = sub_frames["h23"].sort_values(ID_COL).reset_index(drop=True)
    sub_h39 = sub_frames["h39"].sort_values(ID_COL).reset_index(drop=True)
    sub_lgbm = sub_frames["lgbm"].sort_values(ID_COL).reset_index(drop=True)
    sub_naive = sub_frames["naive"].sort_values(ID_COL).reset_index(drop=True)

    for name, df in [("sub_h27b", sub_h27b), ("sub_h23", sub_h23), ("sub_h39", sub_h39),
                     ("sub_lgbm", sub_lgbm), ("sub_naive", sub_naive)]:
        ensure_columns(df, {ID_COL, "y_pred"}, name)

    test_tmp = test.copy()
    test_tmp[TIME_COL] = pd.to_datetime(test_tmp[TIME_COL])
    test_tmp = test_tmp.sort_values([ROUTE_COL, TIME_COL]).copy()
    test_tmp["step"] = test_tmp.groupby(ROUTE_COL).cumcount() + 1
    test_tmp = test_tmp.sort_values(ID_COL).reset_index(drop=True)

    if not (len(sub_h27b) == len(sub_h23) == len(sub_h39) == len(sub_lgbm) == len(sub_naive) == len(test_tmp)):
        raise ValueError("Base submission lengths do not match test length.")

    if not (
        sub_h27b[ID_COL].values.tolist() == sub_h23[ID_COL].values.tolist()
        == sub_h39[ID_COL].values.tolist() == sub_lgbm[ID_COL].values.tolist()
        == sub_naive[ID_COL].values.tolist()
        == test_tmp[ID_COL].values.tolist()
    ):
        raise ValueError("Base submission ids are not aligned.")

    test_meta = pd.DataFrame(
        {
            ID_COL: sub_h27b[ID_COL].values,
            "step": test_tmp["step"].values,
            "pred_h27b": sub_h27b["y_pred"].values,
            "pred_h23": sub_h23["y_pred"].values,
            "pred_h39": sub_h39["y_pred"].values,
            "pred_lgbm": sub_lgbm["y_pred"].values,
            "pred_naive": sub_naive["y_pred"].values,
        }
    )
    base_preds_test = ["pred_h27b", "pred_h23", "pred_h39", "pred_lgbm", "pred_naive"]
    test_meta["pred_mean"] = test_meta[base_preds_test].mean(axis=1)
    test_meta["pred_std"] = test_meta[base_preds_test].std(axis=1).fillna(0.0)
    test_meta["diff_27_39"] = np.abs(test_meta["pred_h27b"] - test_meta["pred_h39"])
    test_meta["diff_23_39"] = np.abs(test_meta["pred_h23"] - test_meta["pred_h39"])
    test_meta["group"] = test_meta["step"].apply(get_group)

    pred = np.zeros(len(test_meta), dtype=np.float32)
    for group in ["all"]:
        part = test_meta[test_meta["group"] == group]
        pred[part.index] = np.maximum(0.0, models[group].predict(part[FEATURES].values))

    submission = pd.DataFrame({ID_COL: test_meta[ID_COL].values, "y_pred": np.maximum(0.0, pred)})
    submission = submission.sort_values(ID_COL).reset_index(drop=True)
    sub_name = outdir / "submission_h41b_stack_h27b_h39_h23.csv"
    submission.to_csv(sub_name, index=False)

    summary = {
        "experiment_name": EXPERIMENT_NAME,
        "score": float(score),
        "wape": float(wape),
        "bias": float(bias),
        "oof_files": {k: str(artifacts_dir / v) for k, v in OOF_FILES.items()},
        "submission_inputs": {k: str(artifacts_dir / v) for k, v in SUB_FILES.items()},
        "output_submission": str(sub_name),
        "models": model_info,
    }
    save_json(outdir / "summary_h41b_stack_h27b_h39_h23.json", summary)

    print(f"Saved submission: {sub_name}")


if __name__ == "__main__":
    main()
