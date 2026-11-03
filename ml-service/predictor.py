"""Load the trained model and turn a set of earthquake parameters into a prediction."""

import json
import math
import warnings
from pathlib import Path

import joblib
import pandas as pd
import sklearn

from common import DISPLAY_LABELS, FEATURE_LIMITS, FEATURES, METADATA_FILENAME, MODEL_DIR, MODEL_FILENAME

ADVISORY_NOTE = (
    "This estimates the likely impact category of the earthquake from its magnitude, depth and epicentre only. "
    "It knows nothing about this SOS request, building damage or injuries, and it is advisory — "
    "it does not decide rescue priority."
)


class ModelNotAvailable(Exception):
    """No trained model on disk (or it could not be read)."""

    def __init__(self, message, code="MODEL_NOT_TRAINED"):
        super().__init__(message)
        self.code = code


class InvalidInput(ValueError):
    """The request's earthquake parameters are missing or out of range."""


def validate_inputs(payload):
    """Return a clean {feature: float} dict or raise InvalidInput."""
    if not isinstance(payload, dict):
        raise InvalidInput("Request body must be a JSON object")
    clean = {}
    for name in FEATURES:
        value = payload.get(name)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise InvalidInput(f"'{name}' is required and must be a finite number")
        low, high = FEATURE_LIMITS[name]
        if not low <= value <= high:
            raise InvalidInput(f"'{name}' must be between {low} and {high}")
        clean[name] = float(value)
    return clean


class SeverityPredictor:
    def __init__(self, model_dir=MODEL_DIR):
        self.model_dir = Path(model_dir)
        self.model = None
        self.metadata = None

    @property
    def loaded(self):
        return self.model is not None

    def load(self):
        model_path = self.model_dir / MODEL_FILENAME
        meta_path = self.model_dir / METADATA_FILENAME
        if not model_path.exists() or not meta_path.exists():
            raise ModelNotAvailable(
                "No trained model found. Run `python train_model.py` in the ml-service folder first."
            )
        try:
            metadata = json.loads(meta_path.read_text(encoding="utf-8"))
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")  # version warnings are surfaced to the caller instead
                model = joblib.load(model_path)
        except Exception as exc:  # corrupted or incompatible file
            raise ModelNotAvailable(f"Model files could not be loaded: {exc}", code="MODEL_LOAD_FAILED") from exc
        self.model, self.metadata = model, metadata
        return self

    def ensure_loaded(self):
        if not self.loaded:
            self.load()

    def _warnings(self, inputs):
        notes = []
        meta = self.metadata
        if meta["dataset"].get("synthetic"):
            notes.append("This model was trained on SYNTHETIC test data, not the real USGS dataset. Do not rely on it.")
        for name, value in inputs.items():
            rng = meta["featureRanges"].get(name)
            if rng and not rng["min"] <= value <= rng["max"]:
                notes.append(
                    f"{name} = {value:g} is outside the range seen in training ({rng['min']:g} to {rng['max']:g}); "
                    "treat this prediction with extra caution."
                )
        trained_with = meta.get("environment", {}).get("scikitLearn")
        if trained_with and trained_with != sklearn.__version__:
            notes.append(f"Model was trained with scikit-learn {trained_with} but this service runs {sklearn.__version__}.")
        return notes

    def predict(self, payload):
        self.ensure_loaded()
        inputs = validate_inputs(payload)
        meta = self.metadata
        classes = meta["classes"]

        frame = pd.DataFrame([[inputs[f] for f in FEATURES]], columns=FEATURES)
        proba = self.model.predict_proba(frame)[0]
        by_class = {str(c): float(p) for c, p in zip(self.model.classes_, proba)}
        probabilities = {c: round(by_class.get(c, 0.0), 4) for c in classes}
        ranked = sorted(probabilities.items(), key=lambda kv: kv[1], reverse=True)
        predicted, confidence = ranked[0]

        importances = sorted(
            ({"feature": f, "importance": round(v, 4)} for f, v in meta["featureImportances"].items()),
            key=lambda d: d["importance"],
            reverse=True,
        )

        explanation = [
            f"The model gives '{DISPLAY_LABELS.get(predicted, predicted)}' the highest probability "
            f"({confidence:.0%}), ahead of '{DISPLAY_LABELS.get(ranked[1][0], ranked[1][0])}' ({ranked[1][1]:.0%}).",
            f"Inputs used: magnitude {inputs['magnitude']:g}, depth {inputs['depth']:g} km, "
            f"epicentre ({inputs['latitude']:.3f}, {inputs['longitude']:.3f}).",
            "Across the whole model the most influential inputs are "
            + ", ".join(f"{d['feature']} ({d['importance']:.2f})" for d in importances[:2])
            + ". This is a model-wide ranking, not an explanation of this single case.",
            ADVISORY_NOTE,
        ]

        rf = meta["metrics"]["randomForest"]
        return {
            "predictedClass": predicted,
            "label": DISPLAY_LABELS.get(predicted, predicted),
            "confidence": confidence,
            "probabilities": probabilities,
            "inputs": inputs,
            "featureImportances": importances,
            "explanation": explanation,
            "warnings": self._warnings(inputs),
            "model": {
                "type": meta["modelType"],
                "trainedAtUtc": meta["trainedAtUtc"],
                "labelScheme": meta["labelScheme"],
                "classes": classes,
                "datasetSource": meta["dataset"].get("source"),
                "datasetSynthetic": bool(meta["dataset"].get("synthetic")),
                "splitStrategy": meta["split"]["strategy"],
                "nTrain": meta["split"]["nTrain"],
                "nTest": meta["split"]["nTest"],
                "testMacroF1": round(rf["macroF1"], 4),
                "testBalancedAccuracy": round(rf["balancedAccuracy"], 4),
                "testAccuracy": round(rf["accuracy"], 4),
            },
        }
