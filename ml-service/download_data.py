"""Download the training dataset from the USGS earthquake catalogue.

Source : USGS ANSS ComCat, via the public FDSN Event Web Service
         https://earthquake.usgs.gov/fdsnws/event/1/
Labels : the PAGER alert level USGS publishes for an event (green / yellow /
         orange / red), selected with the service's `alertlevel` parameter.
         Events USGS never assigned an alert to are NOT downloaded — there is
         no label for them.

No API key is needed. The script asks the service for the number of matching
events first (`count` method) and splits the time window in half whenever it
would exceed the service's 20,000-event-per-request limit.

Usage (Windows PowerShell or any shell):
    python download_data.py
    python download_data.py --start-year 2010 --end-year 2025
"""

import argparse
import csv
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

from common import DEFAULT_DATA_PATH, PAGER_LEVELS

BASE_URL = "https://earthquake.usgs.gov/fdsnws/event/1"
MAX_PER_REQUEST = 20000  # documented hard limit of the service
CSV_COLUMNS = ["event_id", "time", "magnitude", "depth", "latitude", "longitude", "pager_alert", "place"]


def parse_geojson_features(features):
    """Turn USGS GeoJSON features into flat row dicts.

    Feature layout (same one backend/services/usgsSyncService.js parses):
      properties: mag, place, time (epoch ms), alert, type
      geometry.coordinates: [longitude, latitude, depth_km]
    Rows with a missing magnitude/coordinate/alert, or whose event type is not
    an earthquake (quarry blasts, explosions, ...), are skipped.
    """
    rows = []
    for feature in features:
        props = feature.get("properties") or {}
        coords = (feature.get("geometry") or {}).get("coordinates") or []
        alert = props.get("alert")
        if alert not in PAGER_LEVELS:
            continue
        if props.get("type") not in (None, "earthquake"):
            continue
        if len(coords) < 3 or props.get("mag") is None or props.get("time") is None:
            continue
        lng, lat, depth = coords[0], coords[1], coords[2]
        if lng is None or lat is None or depth is None:
            continue
        when = datetime.fromtimestamp(props["time"] / 1000.0, tz=timezone.utc)
        rows.append(
            {
                "event_id": feature.get("id"),
                "time": when.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "magnitude": props["mag"],
                "depth": depth,
                "latitude": lat,
                "longitude": lng,
                "pager_alert": alert,
                "place": (props.get("place") or "").replace("\n", " "),
            }
        )
    return rows


def split_window(start, end):
    """Split [start, end) into two halves (datetimes). Used when a window has too many events."""
    mid = start + (end - start) / 2
    mid = mid.replace(microsecond=0)
    return (start, mid), (mid, end)


def _get(session, path, params, timeout, retries=3):
    last = None
    for attempt in range(1, retries + 1):
        try:
            resp = session.get(f"{BASE_URL}/{path}", params=params, timeout=timeout)
            if resp.status_code == 200:
                return resp
            last = RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
            if resp.status_code < 500 and resp.status_code != 429:
                break  # client error: retrying will not help
        except requests.RequestException as exc:
            last = exc
        time.sleep(2 * attempt)
    raise RuntimeError(f"USGS request failed ({path}): {last}")


def fetch_window(session, level, start, end, min_magnitude, timeout):
    """All events with PAGER alert `level` in [start, end), splitting if over the limit."""
    params = {
        "starttime": start.strftime("%Y-%m-%dT%H:%M:%S"),
        "endtime": end.strftime("%Y-%m-%dT%H:%M:%S"),
        "alertlevel": level,
        "eventtype": "earthquake",  # documented USGS filter; parse_geojson_features also re-checks
    }
    if min_magnitude is not None:
        params["minmagnitude"] = min_magnitude

    # USGS documents `alertlevel` as "must be used with format=geojson", so the count request
    # asks for GeoJSON too; its body is {"count": N, "maxAllowed": 20000}.
    count = int(_get(session, "count", dict(params, format="geojson"), timeout).json()["count"])
    if count == 0:
        return []
    if count > MAX_PER_REQUEST:
        (a_start, a_end), (b_start, b_end) = split_window(start, end)
        return fetch_window(session, level, a_start, a_end, min_magnitude, timeout) + fetch_window(
            session, level, b_start, b_end, min_magnitude, timeout
        )

    query = dict(params, format="geojson", orderby="time-asc", limit=MAX_PER_REQUEST)
    data = _get(session, "query", query, timeout).json()
    return parse_geojson_features(data.get("features", []))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--start-year", type=int, default=2000)
    parser.add_argument("--end-year", type=int, default=2025, help="inclusive")
    parser.add_argument("--min-magnitude", type=float, default=None, help="optional extra filter; default none")
    parser.add_argument("--out", default=str(DEFAULT_DATA_PATH))
    parser.add_argument("--timeout", type=float, default=60.0)
    args = parser.parse_args(argv)

    session = requests.Session()
    session.headers["User-Agent"] = "QuakeCheck-MCA-ML-project/1.0 (educational)"

    seen, rows = set(), []
    for year in range(args.start_year, args.end_year + 1):
        start = datetime(year, 1, 1)
        end = datetime(year + 1, 1, 1)
        per_level = {}
        for level in PAGER_LEVELS:
            got = fetch_window(session, level, start, end, args.min_magnitude, args.timeout)
            per_level[level] = len(got)
            for row in got:
                if row["event_id"] not in seen:
                    seen.add(row["event_id"])
                    rows.append(row)
            time.sleep(0.2)  # be polite to the public API
        print(f"{year}: " + ", ".join(f"{k}={v}" for k, v in per_level.items()), flush=True)

    if not rows:
        print("No labelled events were downloaded — check your internet connection and the year range.", file=sys.stderr)
        return 1

    rows.sort(key=lambda r: r["time"])
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    counts = {level: sum(1 for r in rows if r["pager_alert"] == level) for level in PAGER_LEVELS}
    info = {
        "synthetic": False,
        "source": "USGS ANSS ComCat via FDSN Event Web Service",
        "endpoint": f"{BASE_URL}/query",
        "documentation": "https://earthquake.usgs.gov/fdsnws/event/1/",
        "label": "PAGER alert level (properties.alert), selected with alertlevel=green|yellow|orange|red",
        "startYear": args.start_year,
        "endYear": args.end_year,
        "minMagnitude": args.min_magnitude,
        "downloadedAtUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "rows": len(rows),
        "pagerCounts": counts,
    }
    info_path = out.with_suffix(".info.json")
    info_path.write_text(json.dumps(info, indent=2), encoding="utf-8")
    print(f"\nSaved {len(rows)} events to {out}\nPAGER counts: {counts}\nSource details: {info_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
