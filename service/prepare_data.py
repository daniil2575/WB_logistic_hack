"""
Prepare submission.csv for the backend service.

Joins submission (id, y_pred) with test (id, route_id, timestamp)
and adds step column (1..10 per route, ordered by timestamp).

Run once before starting the service:
    python service/prepare_data.py
"""

import pandas as pd
from pathlib import Path

ROOT = Path(__file__).parent.parent
TEST_PATH = ROOT / 'Dd2WPGKz' / 'test_team_track.parquet'

# Use best available submission
SUBMISSION_CANDIDATES = [
    ROOT / 'run_h41b' / 'submission_h41b_stack_h27b_h39_h23.csv',
    ROOT / 'submission_b_team.csv',
    ROOT / 'submission_team.csv',
]

OUT_PATH = Path(__file__).parent / 'backend' / 'app' / 'data' / 'submission.csv'


def main():
    # Find submission
    sub_path = None
    for p in SUBMISSION_CANDIDATES:
        if p.exists():
            sub_path = p
            break
    if sub_path is None:
        raise FileNotFoundError(f"No submission file found. Tried: {SUBMISSION_CANDIDATES}")
    print(f"Using submission: {sub_path}")

    sub = pd.read_csv(sub_path)
    test = pd.read_parquet(TEST_PATH)
    test['timestamp'] = pd.to_datetime(test['timestamp'])

    merged = sub.merge(test[['id', 'route_id', 'timestamp']], on='id', how='left')
    merged = merged.sort_values(['route_id', 'timestamp'])
    merged['step'] = merged.groupby('route_id').cumcount() + 1

    result = merged[['id', 'route_id', 'step', 'y_pred']]

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(OUT_PATH, index=False)
    print(f"Saved {len(result)} rows to {OUT_PATH}")
    print(result.head(12).to_string(index=False))


if __name__ == '__main__':
    main()
