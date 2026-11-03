"""SYNTHETIC data generator — for plumbing tests ONLY.

This is NOT the training dataset and its numbers mean nothing scientifically.
It exists so the downloader-output → trainer → predictor → API chain can be
tested without internet access. The sidecar .info.json marks it `synthetic: true`,
which the trainer copies into the model metadata and the service turns into a
visible warning, so a model built from it cannot be mistaken for a real one.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd


def make_synthetic_dataset(path, n=1500, seed=0):
    rng = np.random.default_rng(seed)
    magnitude = np.round(rng.uniform(4.0, 8.5, n), 1)
    depth = np.round(rng.uniform(0, 300, n), 1)
    latitude = np.round(rng.uniform(-60, 60, n), 3)
    longitude = np.round(rng.uniform(-180, 180, n), 3)
    score = magnitude + rng.normal(0, 0.4, n) - depth / 400
    alert = np.where(score < 6.2, "green", np.where(score < 7.0, "yellow", np.where(score < 7.6, "orange", "red")))
    times = pd.date_range("2010-01-01", periods=n, freq="1D").strftime("%Y-%m-%dT%H:%M:%SZ")
    frame = pd.DataFrame(
        {
            "event_id": [f"synthetic{i:05d}" for i in range(n)],
            "time": times,
            "magnitude": magnitude,
            "depth": depth,
            "latitude": latitude,
            "longitude": longitude,
            "pager_alert": alert,
            "place": "synthetic",
        }
    )
    path = Path(path)
    frame.to_csv(path, index=False)
    path.with_suffix(".info.json").write_text(
        json.dumps({"synthetic": True, "source": "SYNTHETIC test fixture (not real data)"}), encoding="utf-8"
    )
    return frame
