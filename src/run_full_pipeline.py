from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", default="data/train_team_track.parquet")
    parser.add_argument("--test", default="data/test_team_track.parquet")
    parser.add_argument("--artifacts-dir", default="artifacts")
    parser.add_argument("--device", default=None, help="cuda or cpu; if omitted each script chooses automatically")
    return parser.parse_args()


def run(cmd: list[str]) -> None:
    print("\n>>>", " ".join(cmd))
    subprocess.run(cmd, check=True)



H27B_SEEDS = [42]
H23_SEEDS  = [42]


def main() -> None:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    src_dir = repo_root / "src"

    common_args = ["--train", args.train, "--test", args.test, "--outdir", args.artifacts_dir]
    if args.device:
        common_args.extend(["--device", args.device])

    # Train h27b across seeds
    for seed in H27B_SEEDS:
        run([sys.executable, str(src_dir / "train_h28_h27b.py"), *common_args,
             "--seed", str(seed), "--suffix", f"_s{seed}"])
    run([sys.executable, str(src_dir / "avg_seeds.py"),
         "--model", "h27b", "--seeds", *[str(s) for s in H27B_SEEDS],
         "--artifacts-dir", args.artifacts_dir])

    # Train h23 across seeds
    for seed in H23_SEEDS:
        run([sys.executable, str(src_dir / "train_h33_h23.py"), *common_args,
             "--seed", str(seed), "--suffix", f"_s{seed}"])
    run([sys.executable, str(src_dir / "avg_seeds.py"),
         "--model", "h23", "--seeds", *[str(s) for s in H23_SEEDS],
         "--artifacts-dir", args.artifacts_dir])

    run([sys.executable, str(src_dir / "train_h41a_h39_tft.py"), *common_args])
    run([sys.executable, str(src_dir / "train_h43_nbeats.py"), *common_args])
    run([
        sys.executable,
        str(src_dir / "make_h41b_stack.py"),
        "--test", args.test,
        "--artifacts-dir", args.artifacts_dir,
        "--outdir", args.artifacts_dir,
    ])

    print("\nDone.")
    print(f"Final file: {Path(args.artifacts_dir) / 'submission_h41b_stack_h27b_h39_h23.csv'}")


if __name__ == "__main__":
    main()
