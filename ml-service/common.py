"""Shared constants for the QuakeCheck severity ML service.

Everything that the downloader, the trainer and the prediction service must
agree on lives here, so the feature list and label mapping cannot drift apart.
"""

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
MODEL_DIR = BASE_DIR / "models"
REPORT_DIR = BASE_DIR / "reports"

DEFAULT_DATA_PATH = DATA_DIR / "usgs_pager_events.csv"
MODEL_FILENAME = "severity_model.joblib"
METADATA_FILENAME = "model_metadata.json"

# Model inputs. These are exactly the earthquake fields QuakeCheck already
# stores in its EarthquakeFeed collection (backend/models/EarthquakeFeed.js),
# so a prediction can be made for any event in the live feed.
#
# Deliberately NOT used: USGS `sig`, `mmi`, `cdi`, `felt`. They are computed
# after the event (and `sig` is partly derived from the alert itself), so using
# them would leak the answer into the features.
FEATURES = ["magnitude", "depth", "latitude", "longitude"]

# Plausible physical ranges, used to validate prediction requests.
FEATURE_LIMITS = {
    "magnitude": (0.0, 10.0),
    "depth": (-10.0, 800.0),   # km; USGS reports small negative depths for shallow events
    "latitude": (-90.0, 90.0),
    "longitude": (-180.0, 180.0),
}

# USGS PAGER alert levels (the labels in the dataset).
PAGER_LEVELS = ["green", "yellow", "orange", "red"]

# Two label schemes. `severity3` is the default because orange and red alerts
# are rare in the catalogue; keeping them separate leaves too few examples to
# train or evaluate on. `pager4` keeps the original four classes.
LABEL_SCHEMES = {
    "severity3": {
        "mapping": {"green": "low", "yellow": "moderate", "orange": "high", "red": "high"},
        "classes": ["low", "moderate", "high"],
    },
    "pager4": {
        "mapping": {level: level for level in PAGER_LEVELS},
        "classes": list(PAGER_LEVELS),
    },
}

DISPLAY_LABELS = {
    "low": "Low",
    "moderate": "Moderate",
    "high": "High",
    "green": "Green (PAGER)",
    "yellow": "Yellow (PAGER)",
    "orange": "Orange (PAGER)",
    "red": "Red (PAGER)",
}

# ── Historical earthquake similarity (KNN) — see similarity.py ───────────────
# Number of historical neighbours returned.
SIMILARITY_K = 5

# The similarity distance is a weighted Euclidean combination of three UNIT-LESS terms
# (geography, magnitude, depth). See similarity.py for the formula and the reasoning.
SIMILARITY_WEIGHTS = {"geographic": 1.0, "magnitude": 1.0, "depth": 0.5}

# One unit of geographic distance = this many km of great-circle (haversine) separation.
# Latitude/longitude in degrees cannot be standardised like magnitude (a degree of longitude is
# ~111 km at the equator and ~0 km at the poles), so geography is scaled by a physical length
# instead: ~1000 km is "the same broad seismic region" (it is also the radius QuakeCheck's own
# regional feed uses, backend/config/feedRegion.js).
GEO_SCALE_KM = 1000.0

EARTH_RADIUS_KM = 6371.0

# A historical record is treated as the SAME physical event as the current one (and excluded)
# when it has the same USGS event id, or when it is within this time AND distance of the current
# event. USGS sometimes lists one earthquake under more than one id.
SAME_EVENT_TIME_TOLERANCE_S = 60
SAME_EVENT_DISTANCE_KM = 50.0

# Matches farther away than this get a "weak geographic similarity" warning (never silently dropped).
FAR_MATCH_KM = 2000.0
