"""
Quake-Check Routing Microservice
FastAPI service that computes real road routes for Chandigarh disaster
response by calling a self-hosted OSRM instance, rather than approximating
routes with straight-line interpolation.

Why OSRM, and why this service still exists as a layer in front of it:
  - OSRM gives real road-network geometry, distance, and duration — the
    thing the interpolation approach could never actually provide.
  - This FastAPI layer keeps the business logic (picking the nearest
    available shelter, shaping responses the Node backend already expects,
    handling OSRM being unreachable) separate from raw routing, and means
    the Node backend's calling code didn't need to change when we swapped
    the underlying routing engine.
  - The previous NetworkX/Dijkstra graph endpoint has been removed: nothing
    in the app ever called it, and it had no real road graph behind it — so
    it existed for presentation only, which we were explicitly asked not to
    do. Real shortest-path-on-a-real-graph routing is what OSRM provides.

See README / setup notes for how to run OSRM itself (Docker + a Chandigarh
OSM extract) — this service expects it reachable at OSRM_URL.
"""

import os
import math
from typing import List

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

OSRM_URL = os.getenv("OSRM_URL", "http://localhost:5001")
# OSRM was built for driving/car routing by default in the setup we
# recommend; exposed as a setting rather than hardcoded in case a
# walking/foot profile extract is used instead.
OSRM_PROFILE = os.getenv("OSRM_PROFILE", "driving")
OSRM_TIMEOUT_SECONDS = 8.0

app = FastAPI(
    title="Quake-Check Routing Service",
    description="Real road-network routing for Chandigarh disaster response, backed by OSRM",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────
# Pydantic Models
# ─────────────────────────────────────────

class Shelter(BaseModel):
    id: str
    name: str
    lat: float
    lng: float
    capacity: int
    currentOccupancy: int


class NearestShelterRequest(BaseModel):
    userLat: float
    userLng: float
    shelters: List[Shelter]


class RouteCoord(BaseModel):
    lat: float
    lng: float


class NearestShelterResponse(BaseModel):
    shelter: dict
    distance: float
    unit: str = "km"
    estimatedTimeMinutes: float
    route: List[RouteCoord]


# ─────────────────────────────────────────
# Utility Functions
# ─────────────────────────────────────────

def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """
    Great-circle distance in kilometres between two points. Used only to pick
    which shelter is nearest by straight-line distance as a cheap first pass
    (so we don't have to ask OSRM to route to every candidate shelter) —
    NOT used as the actual route or the distance/time shown to users, which
    always come from OSRM's real road routing below.
    """
    R = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)

    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


class OSRMUnavailableError(Exception):
    """Raised when OSRM can't be reached, or returns no usable route."""
    pass


def osrm_route(lat1: float, lng1: float, lat2: float, lng2: float) -> dict:
    """
    Call OSRM's HTTP routing API for a real road route between two points.

    OSRM's API takes coordinates as "lng,lat" (opposite of this whole app's
    lat/lng convention everywhere else) — that ordering is handled entirely
    inside this function so nothing outside it needs to think about it.

    Returns: {"route": [{"lat","lng"}, ...], "distance_km": float, "duration_min": float}
    Raises: OSRMUnavailableError if OSRM is unreachable or has no route.
    """
    url = f"{OSRM_URL}/route/v1/{OSRM_PROFILE}/{lng1},{lat1};{lng2},{lat2}"
    params = {"overview": "full", "geometries": "geojson"}

    try:
        resp = httpx.get(url, params=params, timeout=OSRM_TIMEOUT_SECONDS)
    except httpx.RequestError as e:
        raise OSRMUnavailableError(f"Could not reach OSRM at {OSRM_URL}: {e}")

    if resp.status_code != 200:
        raise OSRMUnavailableError(f"OSRM returned HTTP {resp.status_code}")

    data = resp.json()
    if data.get("code") != "Ok" or not data.get("routes"):
        # OSRM's own failure codes, e.g. "NoRoute" (points not connected by
        # road), "NoSegment" (a point is too far from any mapped road).
        raise OSRMUnavailableError(f"OSRM could not find a route: {data.get('code')}")

    best = data["routes"][0]
    coords = best["geometry"]["coordinates"]  # [[lng, lat], ...]
    route = [RouteCoord(lat=c[1], lng=c[0]) for c in coords]

    return {
        "route": route,
        "distance_km": round(best["distance"] / 1000.0, 4),
        "duration_min": round(best["duration"] / 60.0, 1),
    }


# ─────────────────────────────────────────
# Routes
# ─────────────────────────────────────────

@app.get("/health", tags=["System"])
def health_check():
    """
    Service health check. Also pings OSRM with a trivial in-Chandigarh
    sample route so failures are visible here rather than only surfacing
    as confusing errors deeper in the app — useful for local setup/debugging.
    """
    osrm_status = "ok"
    try:
        # Two points a few hundred metres apart, both inside Chandigarh —
        # just a connectivity/sanity probe, not a real request.
        osrm_route(30.7410, 76.7828, 30.7295, 76.7776)
    except OSRMUnavailableError as e:
        osrm_status = f"unreachable ({e})"

    return {
        "status": "ok",
        "service": "quake-check-routing",
        "version": "2.0.0",
        "osrm_url": OSRM_URL,
        "osrm_status": osrm_status,
    }


@app.post("/nearest-shelter", response_model=NearestShelterResponse, tags=["Routing"])
def nearest_shelter(req: NearestShelterRequest):
    """
    Find the nearest available shelter to the user's coordinates and return
    a real road route to it, with distance and estimated travel time from OSRM.

    Shelters where `currentOccupancy >= capacity` are excluded. The nearest
    candidate is picked by straight-line (haversine) distance first — a
    cheap in-memory comparison — then routed for real via OSRM. This means
    the shelter picked is "nearest as the crow flies", not necessarily
    "shortest by road" among close candidates; for a small, dense area like
    Chandigarh the two rarely diverge meaningfully, and it avoids calling
    OSRM once per shelter on every request.
    """
    available = [s for s in req.shelters if s.currentOccupancy < s.capacity]

    if not available:
        raise HTTPException(status_code=404, detail="No available shelters found")

    def dist_to_shelter(s: Shelter) -> float:
        return haversine(req.userLat, req.userLng, s.lat, s.lng)

    nearest = min(available, key=dist_to_shelter)

    try:
        result = osrm_route(req.userLat, req.userLng, nearest.lat, nearest.lng)
    except OSRMUnavailableError as e:
        # The Node backend's routingService caller already has its own
        # haversine-based fallback for exactly this case (see
        # backend/controllers/emergencyController.js), so failing loudly
        # here is the right call rather than silently interpolating.
        raise HTTPException(status_code=503, detail=f"Routing unavailable: {e}")

    return NearestShelterResponse(
        shelter=nearest.model_dump(),
        distance=result["distance_km"],
        estimatedTimeMinutes=result["duration_min"],
        route=result["route"],
    )


@app.post("/route-between", tags=["Routing"])
def route_between(source: RouteCoord, target: RouteCoord):
    """
    Real road route between two arbitrary coordinates — used for both
    user→shelter (via /nearest-shelter above) and rescue-team→victim routing.
    """
    try:
        result = osrm_route(source.lat, source.lng, target.lat, target.lng)
    except OSRMUnavailableError as e:
        raise HTTPException(status_code=503, detail=f"Routing unavailable: {e}")

    return {
        "route": result["route"],
        "distance": result["distance_km"],
        "unit": "km",
        "estimatedTimeMinutes": result["duration_min"],
    }
