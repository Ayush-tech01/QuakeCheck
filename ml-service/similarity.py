"""Historical earthquake similarity — K-Nearest Neighbours (KNN).

Task     : given a current earthquake (magnitude, depth, latitude, longitude), retrieve the K = 5
           most similar earthquakes from the historical USGS/PAGER dataset.
Dataset  : data/usgs_pager_events.csv, produced by download_data.py and ALSO used to train the
           Random Forest severity model. It is loaded with train_model.load_dataset(), so both
           features apply exactly the same cleaning rules (valid labels, valid coordinates, no
           duplicate event ids). Nothing is generated or hard-coded here.

This is RETRIEVAL, not prediction. It never claims the current earthquake will have the same
impact as a match. The `historicalPagerAlert` shown for each match is USGS's own modelled PAGER
alert for THAT past event; it is unrelated to the Random Forest's prediction for the current one,
and the two are never combined.

──────────────────────────── How "similar" is measured ────────────────────────────
The three ingredients have different units, so none can be compared on its raw scale
(1 km of depth is not comparable to 1 magnitude unit, and a degree of longitude is not a
fixed length). Each is converted to a UNIT-LESS term first:

    g = GEO_SCALE      ->  haversine great-circle distance (km) / GEO_SCALE_KM
    m = magnitude term ->  |Δ magnitude| / σ_magnitude
    z = depth term     ->  |Δ depth|     / σ_depth

  * σ_magnitude and σ_depth are the standard deviations of the historical dataset. Dividing a
    difference by σ is the same as z-scoring both values and subtracting them (standardisation),
    so "1.0" means "one typical spread of the dataset apart".
  * Latitude/longitude are NOT fed to the metric as two ordinary numeric columns. Treating them
    that way would be wrong: 1° of longitude spans ~111 km at the equator but ~55 km at 60°N, and
    longitude wraps at ±180° (170°E and 170°W are neighbours). The haversine formula gives the true
    surface distance in km and handles both. That distance is then scaled by GEO_SCALE_KM (1000 km,
    "the same broad seismic region") instead of a dataset σ, because a km distance already has a
    physical meaning and a global catalogue's σ would be thousands of km and make location nearly
    irrelevant.

The terms are combined as a weighted Euclidean distance:

    D = sqrt( (w_g · g)² + (w_m · m)² + (w_z · z)² )        w_g = 1.0, w_m = 1.0, w_z = 0.5

Depth gets half weight because USGS depths are often poorly constrained (many events carry a
default of 10 km or 33 km), so a depth difference is weaker evidence of dissimilarity than a
magnitude or location difference. The weights are constants in common.py and are returned with every
response, so the result is reproducible and the choice is visible.

KNN step: compute D from the current event to every valid historical record, drop the current
event itself, and keep the K records with the smallest D (an exact, exhaustive search — with ~10⁴
records it takes well under a millisecond, so no approximate index is needed). Ties are broken by
the record's position in the (time-ordered) dataset, so results are deterministic.

If fewer than K records qualify, only those are returned — nothing is added to fill the list.
Matches that are geographically far away are returned but flagged, never silently dropped.
"""

import json
import logging
import threading
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from common import (
    DEFAULT_DATA_PATH,
    DISPLAY_LABELS,
    EARTH_RADIUS_KM,
    FAR_MATCH_KM,
    GEO_SCALE_KM,
    SAME_EVENT_DISTANCE_KM,
    SAME_EVENT_TIME_TOLERANCE_S,
    SIMILARITY_K,
    SIMILARITY_WEIGHTS,
)
from predictor import InvalidInput, validate_inputs
from train_model import load_dataset

logger = logging.getLogger(__name__)

DISCLAIMER = (
    "Historical similarity only. These are past earthquakes that resemble the current one in size, depth and "
    "location. It does not predict this earthquake's impact, and the PAGER alerts shown belong to those past "
    "events — they are not the Random Forest severity estimate and are not combined with it."
)
DATASET_NOTE = (
    "The historical set contains only earthquakes for which USGS issued a PAGER alert (a subset of the full "
    "catalogue, mostly moderate-to-large events), so smaller or unassessed earthquakes can never appear as matches."
)


class HistoricalDataNotAvailable(Exception):
    """The historical dataset is missing, unreadable or contains no usable records."""

    def __init__(self, message, code="HISTORICAL_DATA_NOT_AVAILABLE"):
        super().__init__(message)
        self.code = code


# ── Request validation ──────────────────────────────────────────────────────
def validate_similarity_request(payload):
    """Return (inputs, event_id, event_time) or raise InvalidInput.

    `inputs` is the validated {magnitude, depth, latitude, longitude} (same rules as /predict).
    `event_id` (str) and `time` (ISO-8601 string) are optional; they only let the search recognise and
    exclude the current event itself if it also appears in the historical dataset.
    """
    inputs = validate_inputs(payload)

    event_id = payload.get("eventId")
    if event_id is not None:
        if not isinstance(event_id, str) or not event_id.strip() or len(event_id) > 128:
            raise InvalidInput("'eventId' must be a non-empty string of at most 128 characters")
        event_id = event_id.strip()

    event_time = payload.get("time")
    if event_time is not None:
        if not isinstance(event_time, str):
            raise InvalidInput("'time' must be an ISO-8601 date-time string")
        try:
            stamp = pd.Timestamp(event_time)
        except (ValueError, TypeError, OverflowError):
            raise InvalidInput("'time' must be an ISO-8601 date-time string") from None
        if pd.isna(stamp):
            raise InvalidInput("'time' must be an ISO-8601 date-time string")
        event_time = stamp.tz_localize("UTC") if stamp.tzinfo is None else stamp.tz_convert("UTC")

    return inputs, event_id, event_time


# ── The index ───────────────────────────────────────────────────────────────
@dataclass
class _Index:
    """Pre-processed historical records. Built once, then only read."""

    signature: tuple
    event_ids: np.ndarray
    magnitude: np.ndarray
    depth: np.ndarray
    lat_rad: np.ndarray
    lon_rad: np.ndarray
    cos_lat: np.ndarray
    epoch_s: np.ndarray            # NaN where the record has no valid time
    time_text: list                # ISO strings or None
    place: list                    # strings or None
    latitude: np.ndarray
    longitude: np.ndarray
    alert: list
    sigma_magnitude: float
    sigma_depth: float
    reference: dict = field(default_factory=dict)
    notes: list = field(default_factory=list)


def _clean_text(series):
    out = []
    for value in series:
        text = None if value is None or pd.isna(value) else str(value).strip()
        out.append(text or None)
    return out


class SimilarityIndex:
    """Loads the historical dataset once and answers nearest-neighbour queries against it.

    The dataset is re-read automatically if the CSV (or its .info.json) changes on disk, so
    running `download_data.py` while the service is up needs no restart.
    """

    def __init__(self, data_path=DEFAULT_DATA_PATH):
        self.data_path = Path(data_path)
        self._index = None
        self._lock = threading.Lock()

    @property
    def info_path(self):
        return self.data_path.with_suffix(".info.json")

    @property
    def loaded(self):
        return self._index is not None

    def _signature(self):
        def stamp(path):
            try:
                st = path.stat()
                return (st.st_mtime_ns, st.st_size)
            except OSError:
                return None

        data = stamp(self.data_path)
        return None if data is None else (data, stamp(self.info_path))

    def ensure_loaded(self):
        signature = self._signature()
        with self._lock:
            if signature is None:
                self._index = None
                raise HistoricalDataNotAvailable(
                    "The historical earthquake dataset has not been downloaded. "
                    "Run `python download_data.py` in the ml-service folder first."
                )
            if self._index is None or self._index.signature != signature:
                self._index = self._build(signature)
            return self._index

    def _read_provenance(self):
        try:
            return json.loads(self.info_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def _build(self, signature):
        try:
            df, summary = load_dataset(self.data_path)
        except Exception as exc:  # unreadable / wrong columns — details go to the log, not the client
            logger.exception("Historical dataset could not be read: %s", exc)
            raise HistoricalDataNotAvailable(
                "The historical earthquake dataset could not be read. Re-run `python download_data.py`.",
                code="HISTORICAL_DATA_LOAD_FAILED",
            ) from exc

        # Optional columns the downloader writes; tolerate their absence.
        times = pd.to_datetime(df["time"], utc=True, errors="coerce") if "time" in df else pd.Series(pd.NaT, index=df.index, dtype="datetime64[ns, UTC]")
        df = df.assign(_time=times, _place=df["place"] if "place" in df else None)

        # Remove the same earthquake listed under several ids (identical time + magnitude + depth + position).
        before = len(df)
        df = df.drop_duplicates(subset=["_time", "magnitude", "depth", "latitude", "longitude"])
        summary["droppedDuplicateRecords"] = int(before - len(df))
        summary["rowsUsed"] = int(len(df))

        if df.empty:
            raise HistoricalDataNotAvailable(
                "The historical earthquake dataset contains no usable records.", code="HISTORICAL_DATA_EMPTY"
            )

        # Deterministic order (oldest first, unknown times last, then event id) so ties break reproducibly.
        df = df.sort_values(["_time", "event_id"], kind="stable", na_position="last").reset_index(drop=True)

        magnitude = df["magnitude"].to_numpy(dtype=float)
        depth = df["depth"].to_numpy(dtype=float)
        latitude = df["latitude"].to_numpy(dtype=float)
        longitude = df["longitude"].to_numpy(dtype=float)
        lat_rad, lon_rad = np.radians(latitude), np.radians(longitude)

        notes = []

        def spread(values, name):
            sigma = float(np.std(values))  # population σ; only the scale matters
            if not np.isfinite(sigma) or sigma < 1e-9:
                notes.append(f"All historical {name} values are identical, so its scale was set to 1.0.")
                return 1.0
            return sigma

        epoch = (df["_time"] - pd.Timestamp("1970-01-01", tz="UTC")).dt.total_seconds().to_numpy(dtype=float)
        time_text = [None if pd.isna(t) else t.strftime("%Y-%m-%dT%H:%M:%SZ") for t in df["_time"]]

        provenance = self._read_provenance()
        valid_times = df["_time"].dropna()
        reference = {
            "records": int(len(df)),
            "source": (provenance or {}).get("source"),
            "synthetic": None if provenance is None else bool(provenance.get("synthetic")),
            "downloadedAtUtc": (provenance or {}).get("downloadedAtUtc"),
            "startYear": (provenance or {}).get("startYear"),
            "endYear": (provenance or {}).get("endYear"),
            "magnitudeRange": {"min": float(magnitude.min()), "max": float(magnitude.max())},
            "earliest": None if valid_times.empty else valid_times.min().strftime("%Y-%m-%d"),
            "latest": None if valid_times.empty else valid_times.max().strftime("%Y-%m-%d"),
            "cleaning": summary,
            "note": DATASET_NOTE,
        }

        return _Index(
            signature=signature,
            event_ids=np.asarray(df["event_id"].astype(str).tolist(), dtype=object),
            magnitude=magnitude,
            depth=depth,
            lat_rad=lat_rad,
            lon_rad=lon_rad,
            cos_lat=np.cos(lat_rad),
            epoch_s=epoch,
            time_text=time_text,
            place=_clean_text(df["_place"]),
            latitude=latitude,
            longitude=longitude,
            alert=df["pager_alert"].tolist(),
            sigma_magnitude=spread(magnitude, "magnitude"),
            sigma_depth=spread(depth, "depth"),
            reference=reference,
            notes=notes,
        )

    # ── Distance ────────────────────────────────────────────────────────────
    @staticmethod
    def _distances(idx, inputs):
        """Vectorised distance from the current event to every historical record.

        Returns (geo_km, d_magnitude, d_depth, combined) — see the module docstring for the formula.
        """
        lat1, lon1 = np.radians(inputs["latitude"]), np.radians(inputs["longitude"])
        # Haversine: true great-circle distance on a sphere; handles longitude wrap-around at ±180°.
        a = np.sin((idx.lat_rad - lat1) / 2.0) ** 2 + np.cos(lat1) * idx.cos_lat * np.sin((idx.lon_rad - lon1) / 2.0) ** 2
        geo_km = 2.0 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))

        d_mag = idx.magnitude - inputs["magnitude"]   # signed: historical − current
        d_depth = idx.depth - inputs["depth"]

        g = SIMILARITY_WEIGHTS["geographic"] * geo_km / GEO_SCALE_KM
        m = SIMILARITY_WEIGHTS["magnitude"] * d_mag / idx.sigma_magnitude
        z = SIMILARITY_WEIGHTS["depth"] * d_depth / idx.sigma_depth
        return geo_km, d_mag, d_depth, np.sqrt(g * g + m * m + z * z)

    # ── Query ───────────────────────────────────────────────────────────────
    def find_similar(self, inputs, event_id=None, event_time=None, k=SIMILARITY_K):
        """The k historical earthquakes most similar to `inputs` (already validated)."""
        idx = self.ensure_loaded()
        geo_km, d_mag, d_depth, combined = self._distances(idx, inputs)

        # Never return the current earthquake as its own "historical" match.
        excluded = np.zeros(len(combined), dtype=bool)
        if event_id:
            excluded |= idx.event_ids == event_id
        if event_time is not None:
            # Same event filed under a different id: practically the same time AND place.
            close_in_time = np.abs(idx.epoch_s - event_time.timestamp()) <= SAME_EVENT_TIME_TOLERANCE_S  # NaN → False
            excluded |= close_in_time & (geo_km <= SAME_EVENT_DISTANCE_KM)

        candidates = np.flatnonzero(~excluded)
        nearest = candidates[np.argsort(combined[candidates], kind="stable")[:k]]

        matches = [
            {
                "rank": rank,
                "eventId": str(idx.event_ids[i]),
                "time": idx.time_text[i],
                "place": idx.place[i],
                "magnitude": round(float(idx.magnitude[i]), 2),
                "depth": round(float(idx.depth[i]), 1),
                "latitude": round(float(idx.latitude[i]), 4),
                "longitude": round(float(idx.longitude[i]), 4),
                "distanceKm": round(float(geo_km[i]), 1),
                "magnitudeDifference": round(float(d_mag[i]), 2) + 0.0,
                "depthDifferenceKm": round(float(d_depth[i]), 1) + 0.0,
                "matchDistance": round(float(combined[i]), 3),
                "historicalPagerAlert": idx.alert[i],
                "historicalPagerLabel": DISPLAY_LABELS.get(idx.alert[i], idx.alert[i]),
            }
            for rank, i in enumerate(nearest, start=1)
        ]

        warnings = list(idx.notes)
        ref = idx.reference
        if ref["synthetic"]:
            warnings.append("These historical records come from a SYNTHETIC test fixture, not real USGS data. Do not rely on them.")
        elif ref["synthetic"] is None:
            warnings.append("No .info.json file sits next to the dataset, so its source cannot be confirmed.")
        low, high = ref["magnitudeRange"]["min"], ref["magnitudeRange"]["max"]
        if not low <= inputs["magnitude"] <= high:
            warnings.append(
                f"magnitude {inputs['magnitude']:g} is outside the range in the historical set ({low:g} to {high:g}), "
                "so the closest matches may differ noticeably in size."
            )
        far = sum(1 for m in matches if m["distanceKm"] > FAR_MATCH_KM)
        if far:
            warnings.append(
                f"{far} of the {len(matches)} matches are more than {FAR_MATCH_KM:,.0f} km away, so their geographic "
                "similarity is weak; they resemble this earthquake mainly in magnitude and depth."
            )

        message = None
        if len(matches) < k:
            message = (
                f"Only {len(matches)} valid historical record(s) were available"
                f"{' after excluding the current event' if excluded.any() else ''}, so fewer than {k} matches are shown."
                if matches
                else "No valid historical records were available to compare against."
            )

        return {
            "inputs": inputs,
            "k": k,
            "returned": len(matches),
            "matches": matches,
            "message": message,
            "excludedCurrentEvent": int(excluded.sum()),
            "method": {
                "algorithm": "K-Nearest Neighbours (exact search)",
                "geographicDistance": "haversine great-circle distance",
                "formula": "D = sqrt((w_g·km/geoScale)² + (w_m·Δmagnitude/σ_magnitude)² + (w_z·Δdepth/σ_depth)²)",
                "weights": dict(SIMILARITY_WEIGHTS),
                "geoScaleKm": GEO_SCALE_KM,
                "magnitudeSigma": round(idx.sigma_magnitude, 4),
                "depthSigmaKm": round(idx.sigma_depth, 2),
            },
            "reference": ref,
            "warnings": warnings,
            "disclaimer": DISCLAIMER,
        }
