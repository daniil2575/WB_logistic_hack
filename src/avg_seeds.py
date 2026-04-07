"""
Averages OOF and submission CSVs across multiple seeds for a given model.

Usage:
    python src/avg_seeds.py --model h27b --seeds 42 123 456
    python src/avg_seeds.py --model h23 --seeds 42 123 456

Reads:  artifacts/oof_{base}{_sX}.csv, artifacts/submission_{base}{_sX}.csv
Writes: artifacts/oof_{base}.csv, artifacts/submission_{base}.csv
        (overwriting the canonical files used by make_h41b_stack.py)
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from common import metric_parts

MODEL_BASES = {
    "h27b": "h28_h27b_gru_winsorized_target",
    "h23":  "h33_h23_lite",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=list(MODEL_BASES.keys()), required=True)
    parser.add_argument("--seeds", type=int, nargs="+", required=True)
    parser.add_argument("--artifacts-dir", default="artifacts")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    base = MODEL_BASES[args.model]
    adir = Path(args.artifacts_dir)

    suffixes = [f"_s{s}" for s in args.seeds]

    # --- OOF ---
    oof_dfs = []
    for suf in suffixes:
        path = adir / f"oof_{base}{suf}.csv"
        if not path.exists():
            raise FileNotFoundError(f"Missing: {path}")
        oof_dfs.append(pd.read_csv(path))

    ref = oof_dfs[0].copy()
    pred_cols = [df["y_pred"].values for df in oof_dfs]
    ref["y_pred"] = np.stack(pred_cols, axis=0).mean(axis=0)

    out_oof = adir / f"oof_{base}.csv"
    ref.to_csv(out_oof, index=False)

    valid = ~ref["y_true"].isna()
    score, wape, bias = metric_parts(ref.loc[valid, "y_true"].values, ref.loc[valid, "y_pred"].values)
    print(f"[{args.model}] Averaged OOF ({len(args.seeds)} seeds): SCORE={score:.4f}  WAPE={wape:.4f}  |bias|={bias:.4f}")
    print(f"Saved: {out_oof}")

    # --- Submission ---
    sub_dfs = []
    for suf in suffixes:
        path = adir / f"submission_{base}{suf}.csv"
        if not path.exists():
            raise FileNotFoundError(f"Missing: {path}")
        sub_dfs.append(pd.read_csv(path))

    ref_sub = sub_dfs[0].copy()
    sub_preds = [df["y_pred"].values for df in sub_dfs]
    ref_sub["y_pred"] = np.stack(sub_preds, axis=0).mean(axis=0)

    out_sub = adir / f"submission_{base}.csv"
    ref_sub.to_csv(out_sub, index=False)
    print(f"Saved: {out_sub}")


if __name__ == "__main__":
    main()
