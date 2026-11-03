"""Tests for the ML service: downloader parsing, training, model loading, prediction, HTTP API.

Run from the ml-service folder:   python -m unittest discover -s tests -v

IMPORTANT: model/training tests use a SYNTHETIC fixture (tests/synthetic_data.py) so they run
offline. They prove the code works; they say nothing about accuracy on real USGS data.
"""

import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pandas as pd  # noqa: E402

import download_data  # noqa: E402
import train_model  # noqa: E402
from app import create_app  # noqa: E402
from common import FEATURES  # noqa: E402
from predictor import InvalidInput, ModelNotAvailable, SeverityPredictor, validate_inputs  # noqa: E402
from synthetic_data import make_synthetic_dataset  # noqa: E402

# Keep the grid search tiny so the suite runs in seconds.
train_model.PARAM_GRID = {"n_estimators": [30], "max_depth": [None, 6], "min_samples_leaf": [1, 3]}


# ── downloader (no network: fixtures and a fake HTTP session) ────────────────
def feature(event_id, mag, lng, lat, depth, alert, time_ms=1_500_000_000_000, type_="earthquake"):
    """Constructed to mirror the USGS GeoJSON layout; NOT real catalogue data."""
    return {
        "id": event_id,
        "properties": {"mag": mag, "place": "somewhere", "time": time_ms, "alert": alert, "type": type_},
        "geometry": {"coordinates": [lng, lat, depth]},
    }


class ParseTests(unittest.TestCase):
    def test_parse_maps_coordinates_and_filters(self):
        rows = download_data.parse_geojson_features(
            [
                feature("a", 6.1, 79.5, 30.1, 12.0, "yellow"),
                feature("b", 5.0, 10.0, 20.0, 5.0, None),            # no alert → no label → skipped
                feature("c", 5.0, 10.0, 20.0, 5.0, "green", type_="quarry blast"),
                feature("d", None, 10.0, 20.0, 5.0, "green"),        # missing magnitude
                {"id": "e", "properties": {"mag": 5, "time": 1, "alert": "red"}, "geometry": {"coordinates": [1, 2]}},
            ]
        )
        self.assertEqual([r["event_id"] for r in rows], ["a"])
        r = rows[0]
        # GeoJSON order is [longitude, latitude, depth]
        self.assertEqual((r["longitude"], r["latitude"], r["depth"]), (79.5, 30.1, 12.0))
        self.assertEqual(r["pager_alert"], "yellow")
        self.assertEqual(r["time"], "2017-07-14T02:40:00Z")

    def test_split_window_halves(self):
        (a0, a1), (b0, b1) = download_data.split_window(datetime(2020, 1, 1), datetime(2021, 1, 1))
        self.assertEqual(a0, datetime(2020, 1, 1))
        self.assertEqual(a1, b0)
        self.assertEqual(b1, datetime(2021, 1, 1))
        self.assertTrue(a0 < a1 < b1)


class FakeResponse:
    def __init__(self, text="", payload=None):
        self.status_code, self.text, self._payload = 200, text, payload

    def json(self):
        return self._payload


class FakeSession:
    """Pretends the full window has too many events, so it must be split in two."""

    def __init__(self):
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url.rsplit("/", 1)[-1], dict(params)))
        if url.endswith("/count"):
            span = datetime.fromisoformat(params["endtime"]) - datetime.fromisoformat(params["starttime"])
            # Real USGS count response for format=geojson: {"count": N, "maxAllowed": 20000}
            assert params.get("format") == "geojson", "alertlevel requires format=geojson"
            return FakeResponse(payload={"count": 25000 if span.days > 200 else 2, "maxAllowed": 20000})
        return FakeResponse(payload={"features": [feature(f"id{len(self.calls)}", 5.0, 1.0, 2.0, 3.0, "green")]})


class FetchWindowTests(unittest.TestCase):
    def test_splits_when_count_exceeds_service_limit(self):
        session = FakeSession()
        rows = download_data.fetch_window(
            session, "green", datetime(2020, 1, 1), datetime(2021, 1, 1), None, 5
        )
        queries = [c for c in session.calls if c[0] == "query"]
        self.assertEqual(len(queries), 2)  # one per half
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(q[1]["alertlevel"] == "green" and q[1]["format"] == "geojson" for q in queries))
        self.assertTrue(all(q[1]["limit"] == 20000 for q in queries))


# ── training / loading / prediction ─────────────────────────────────────────
class TrainedModelCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.tmp = Path(cls._tmp.name)
        cls.data = cls.tmp / "synthetic.csv"
        make_synthetic_dataset(cls.data)
        cls.out = cls.tmp / "models"
        cls.reports = cls.tmp / "reports"
        cls.meta = train_model.run_training(cls.data, cls.out, cls.reports, log=lambda *_: None)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()


class TrainingTests(TrainedModelCase):
    def test_artifacts_written(self):
        for name in ["severity_model.joblib", "model_metadata.json"]:
            self.assertTrue((self.out / name).exists(), name)
        report = self.reports / "evaluation_severity3_stratified.md"
        self.assertTrue(report.exists())
        self.assertIn("SYNTHETIC", report.read_text(encoding="utf-8"))

    def test_second_evaluation_run_does_not_overwrite_report_or_model(self):
        model_file = self.out / "severity_model.joblib"
        before = model_file.read_bytes()
        with tempfile.TemporaryDirectory() as other_models:
            train_model.run_training(
                self.data, other_models, self.reports, split="time", save_model=False, log=lambda *_: None
            )
            self.assertEqual(list(Path(other_models).iterdir()), [])        # nothing saved
        self.assertTrue((self.reports / "evaluation_severity3_time.md").exists())
        self.assertTrue((self.reports / "evaluation_severity3_stratified.md").exists())
        self.assertEqual(model_file.read_bytes(), before)

    def test_metadata_documents_the_run(self):
        m = self.meta
        self.assertEqual(m["features"], FEATURES)
        self.assertEqual(m["classes"], ["low", "moderate", "high"])
        self.assertEqual(m["split"]["nTrain"] + m["split"]["nTest"], 1500)
        self.assertTrue(m["dataset"]["synthetic"])
        self.assertEqual(len(m["dataset"]["sha256"]), 64)
        self.assertTrue(m["tuning"]["tuned"])
        for key in ["accuracy", "balancedAccuracy", "macroF1", "perClass", "confusionMatrix"]:
            self.assertIn(key, m["metrics"]["randomForest"])
        self.assertAlmostEqual(sum(m["featureImportances"].values()), 1.0, places=3)

    def test_model_learns_from_data_beyond_majority_baseline(self):
        # Sanity check that a fitted model beats "always predict the majority class".
        rf, base = self.meta["metrics"]["randomForest"], self.meta["metrics"]["majorityBaseline"]
        self.assertGreater(rf["macroF1"], base["macroF1"] + 0.2)

    def test_split_has_no_overlap_and_keeps_every_class(self):
        df, _ = train_model.load_dataset(self.data)
        df = train_model.apply_labels(df, "severity3")
        train, test = train_model.split_data(df, "stratified", 0.2, 42)
        self.assertFalse(set(train["event_id"]) & set(test["event_id"]))
        self.assertEqual(set(train["label"]), set(test["label"]))

    def test_time_split_is_forward_in_time(self):
        df, _ = train_model.load_dataset(self.data)
        df = train_model.apply_labels(df, "severity3")
        train, test = train_model.split_data(df, "time", 0.2, 42)
        self.assertLessEqual(pd.to_datetime(train["time"]).max(), pd.to_datetime(test["time"]).min())

    def test_label_schemes(self):
        df, _ = train_model.load_dataset(self.data)
        three = train_model.apply_labels(df, "severity3")
        four = train_model.apply_labels(df, "pager4")
        self.assertEqual(set(three["label"]), {"low", "moderate", "high"})
        self.assertEqual(set(four["label"]), {"green", "yellow", "orange", "red"})

    def test_rare_class_is_rejected_with_helpful_message(self):
        df, _ = train_model.load_dataset(self.data)
        df = train_model.apply_labels(df, "pager4")
        df = df[~((df["label"] == "red") & (df.groupby("label").cumcount() >= 3))]
        with self.assertRaisesRegex(ValueError, "Too few examples"):
            train_model.check_class_counts(df, ["green", "yellow", "orange", "red"], 10)

    def test_missing_dataset_message(self):
        with self.assertRaisesRegex(FileNotFoundError, "download_data.py"):
            train_model.load_dataset(self.tmp / "nope.csv")


class PredictorTests(TrainedModelCase):
    def test_missing_model_raises(self):
        with tempfile.TemporaryDirectory() as empty:
            with self.assertRaises(ModelNotAvailable) as ctx:
                SeverityPredictor(empty).load()
            self.assertEqual(ctx.exception.code, "MODEL_NOT_TRAINED")

    def test_corrupt_model_raises(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "severity_model.joblib").write_bytes(b"not a model")
            (Path(d) / "model_metadata.json").write_text("{}", encoding="utf-8")
            with self.assertRaises(ModelNotAvailable) as ctx:
                SeverityPredictor(d).load()
            self.assertEqual(ctx.exception.code, "MODEL_LOAD_FAILED")

    def test_predict_shape_and_probabilities(self):
        p = SeverityPredictor(self.out).load()
        out = p.predict({"magnitude": 7.8, "depth": 10, "latitude": 30.7, "longitude": 76.8})
        self.assertIn(out["predictedClass"], ["low", "moderate", "high"])
        self.assertAlmostEqual(sum(out["probabilities"].values()), 1.0, places=2)
        self.assertEqual(out["inputs"]["magnitude"], 7.8)
        self.assertEqual(len(out["explanation"]), 4)
        self.assertTrue(any("SYNTHETIC" in w for w in out["warnings"]))  # synthetic model must be flagged
        self.assertTrue(out["model"]["datasetSynthetic"])

    def test_a_clearly_small_and_a_clearly_large_event_differ(self):
        p = SeverityPredictor(self.out).load()
        small = p.predict({"magnitude": 4.2, "depth": 150, "latitude": 0, "longitude": 0})
        large = p.predict({"magnitude": 8.4, "depth": 5, "latitude": 0, "longitude": 0})
        self.assertEqual(small["predictedClass"], "low")
        self.assertEqual(large["predictedClass"], "high")

    def test_out_of_training_range_warning(self):
        p = SeverityPredictor(self.out).load()
        out = p.predict({"magnitude": 1.0, "depth": 10, "latitude": 30.7, "longitude": 76.8})
        self.assertTrue(any("outside the range seen in training" in w for w in out["warnings"]))

    def test_input_validation(self):
        good = {"magnitude": 5, "depth": 10, "latitude": 30, "longitude": 76}
        self.assertEqual(validate_inputs(good)["magnitude"], 5.0)
        bad_cases = [
            {**good, "magnitude": 11},
            {**good, "magnitude": "5"},
            {**good, "depth": None},
            {**good, "latitude": 91},
            {**good, "longitude": float("nan")},
            {**good, "magnitude": True},
            {k: v for k, v in good.items() if k != "depth"},
            [1, 2, 3],
        ]
        for bad in bad_cases:
            with self.subTest(bad=bad), self.assertRaises(InvalidInput):
                validate_inputs(bad)


class ApiTests(TrainedModelCase):
    BODY = {"magnitude": 6.5, "depth": 20, "latitude": 30.7, "longitude": 76.8}

    def test_health_and_predict_without_model(self):
        with tempfile.TemporaryDirectory() as empty:
            client = create_app(SeverityPredictor(empty)).test_client()
            health = client.get("/health").get_json()
            self.assertEqual(health["status"], "ok")
            self.assertFalse(health["modelLoaded"])
            res = client.post("/predict", json=self.BODY)
            self.assertEqual(res.status_code, 503)
            self.assertEqual(res.get_json()["code"], "MODEL_NOT_TRAINED")

    def test_predict_ok(self):
        client = create_app(SeverityPredictor(self.out)).test_client()
        self.assertTrue(client.get("/health").get_json()["modelLoaded"])
        res = client.post("/predict", json=self.BODY)
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        self.assertTrue(body["success"])
        self.assertIn(body["predictedClass"], ["low", "moderate", "high"])

    def test_model_trained_after_startup_is_picked_up(self):
        with tempfile.TemporaryDirectory() as d:
            client = create_app(SeverityPredictor(d)).test_client()
            self.assertEqual(client.post("/predict", json=self.BODY).status_code, 503)
            for f in ["severity_model.joblib", "model_metadata.json"]:
                (Path(d) / f).write_bytes((self.out / f).read_bytes())
            self.assertEqual(client.post("/predict", json=self.BODY).status_code, 200)

    def test_bad_requests(self):
        client = create_app(SeverityPredictor(self.out)).test_client()
        bad = client.post("/predict", json={**self.BODY, "magnitude": 99})
        self.assertEqual((bad.status_code, bad.get_json()["code"]), (400, "INVALID_INPUT"))
        not_json = client.post("/predict", data="hello", content_type="text/plain")
        self.assertEqual(not_json.status_code, 400)
        self.assertEqual(client.get("/predict").status_code, 405)


if __name__ == "__main__":
    unittest.main()
