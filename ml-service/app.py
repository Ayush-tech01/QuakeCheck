"""QuakeCheck ML service — a small internal HTTP API in front of the severity model.

It is called only by the Node backend (which does the JWT / admin-role checks).
Do NOT expose this port to the internet; by default it binds to 127.0.0.1.

Environment variables (all optional):
    ML_SERVICE_HOST   default 127.0.0.1
    ML_SERVICE_PORT   default 8001
"""

import os

from flask import Flask, jsonify, request

from predictor import InvalidInput, ModelNotAvailable, SeverityPredictor
from similarity import HistoricalDataNotAvailable, SimilarityIndex, validate_similarity_request


def create_app(predictor=None, similarity=None):
    app = Flask(__name__)
    predictor = predictor or SeverityPredictor()
    # Historical-similarity (KNN) index. Loaded lazily on the first /similar request, so a missing
    # dataset never affects /health or the Random Forest /predict endpoint.
    similarity = similarity or SimilarityIndex()
    try:
        predictor.load()
    except ModelNotAvailable as exc:
        # The service still starts so /health can explain what is missing.
        app.logger.warning("Model not loaded at startup: %s", exc)

    @app.get("/health")
    def health():
        if not predictor.loaded:
            try:
                predictor.load()  # picks up a model trained after the service started
            except ModelNotAvailable:
                pass
        meta = predictor.metadata or {}
        return jsonify(
            {
                "status": "ok",
                "service": "quakecheck-ml-service",
                "modelLoaded": predictor.loaded,
                "modelTrainedAtUtc": meta.get("trainedAtUtc"),
                "labelScheme": meta.get("labelScheme"),
            }
        )

    @app.post("/predict")
    def predict():
        payload = request.get_json(silent=True)
        if payload is None:
            return jsonify({"success": False, "code": "INVALID_INPUT", "message": "Request body must be JSON"}), 400
        try:
            result = predictor.predict(payload)
        except InvalidInput as exc:
            return jsonify({"success": False, "code": "INVALID_INPUT", "message": str(exc)}), 400
        except ModelNotAvailable as exc:
            return jsonify({"success": False, "code": exc.code, "message": str(exc)}), 503
        return jsonify({"success": True, **result})

    @app.post("/similar")
    def similar():
        """Five most similar historical earthquakes (KNN). Retrieval only — independent of /predict."""
        payload = request.get_json(silent=True)
        if payload is None:
            return jsonify({"success": False, "code": "INVALID_INPUT", "message": "Request body must be JSON"}), 400
        try:
            inputs, event_id, event_time = validate_similarity_request(payload)
            result = similarity.find_similar(inputs, event_id=event_id, event_time=event_time)
        except InvalidInput as exc:
            return jsonify({"success": False, "code": "INVALID_INPUT", "message": str(exc)}), 400
        except HistoricalDataNotAvailable as exc:
            return jsonify({"success": False, "code": exc.code, "message": str(exc)}), 503
        except Exception:  # never leak internals to the caller; the traceback goes to the service log
            app.logger.exception("Historical similarity analysis failed")
            return jsonify({"success": False, "code": "SIMILARITY_FAILED", "message": "Historical similarity analysis failed"}), 500
        return jsonify({"success": True, **result})

    return app


if __name__ == "__main__":
    create_app().run(
        host=os.environ.get("ML_SERVICE_HOST", "127.0.0.1"),
        port=int(os.environ.get("ML_SERVICE_PORT", "8001")),
        debug=False,
    )
