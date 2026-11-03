# Setting up OSRM for real road routing (Windows)

QuakeCheck's routing service (`routing-service/main.py`) now calls a real
routing engine called OSRM instead of drawing straight lines. OSRM itself is
**not** a Python package — it's a separate program that needs its own map
data and its own running process. This guide gets it running on Windows.

## Why Docker, not a native install

OSRM is written in C++. Building it from source on Windows requires Visual
Studio's C++ build tools, Boost, TBB, and CMake — the same category of pain
we already hit getting `pydantic-core` to compile (worse, actually). Docker
sidesteps all of that: the official `osrm/osrm-backend` image ships
pre-built, and you just run it. This is also the path OSRM's own
documentation recommends.

## Step 1 — Install Docker Desktop

1. Go to https://www.docker.com/products/docker-desktop/ and download Docker
   Desktop for Windows.
2. Run the installer. It will typically enable WSL2 (Windows Subsystem for
   Linux) automatically if it isn't already.
3. **If Docker's installer complains about virtualization not being
   enabled**: this means it needs to be turned on in your PC's BIOS/UEFI
   settings (not something Docker or this app can do for you) — usually
   called "Virtualization Technology (VT-x)" or "SVM Mode", under a
   Security or Advanced tab. This varies by motherboard; search your PC or
   motherboard model + "enable virtualization" if you hit this.
4. After install, **restart your PC** if prompted, then open Docker Desktop
   and wait for it to say it's running (whale icon in the system tray,
   solid not animated).
5. Verify from PowerShell:
   ```
   docker --version
   ```

## Step 2 — Get an OSM extract that covers Chandigarh

Chandigarh doesn't have its own dedicated extract file — you need a
regional one that contains it (Chandigarh is a small enclave inside
Punjab/Haryana).

1. Go to https://download.geofabrik.de/asia/india.html
2. Look for a **Punjab** sub-region `.osm.pbf` file (this should fully
   contain Chandigarh, since Chandigarh sits inside Punjab's borders). If
   Punjab isn't listed as its own file when you check, fall back to the
   full **India** `.osm.pbf` from the parent page — bigger (order of
   several hundred MB to ~1GB) and slower to process, but works the same
   way, just takes longer in Step 3.
   
   *(I can't fetch this page myself to confirm today's exact file name/size
   — Geofabrik's exact sub-region list does shift over time, so please
   check what's actually listed rather than trust a specific filename from
   me.)*
3. Download it into a new folder, e.g. `C:\Users\ayush\osrm-data\`, and
   note the exact filename (e.g. `punjab-latest.osm.pbf`).

### Optional but recommended: clip it down to just Chandigarh

A full state extract works, but processing is faster with a smaller file.
This project already has an exact Chandigarh boundary
(`backend/data/chandigarh-boundary.geojson`) you can reuse to clip the
extract down:

```
docker run --rm -v "C:\Users\ayush\osrm-data:/data" -v "C:\Users\ayush\Downloads\QuakeCheck-Phase1\backend\data:/boundary" osrm/osrm-backend osmium extract -p /boundary/chandigarh-boundary.geojson /data/punjab-latest.osm.pbf -o /data/chandigarh.osm.pbf
```

If that command errors (the osrm-backend image doesn't always include
`osmium`), skip this — it's an optimization, not a requirement. Just use
the full Punjab (or India) file directly in Step 3 below, substituting its
filename wherever you see `chandigarh.osm.pbf`.

## Step 3 — Preprocess the map data

From PowerShell, in the folder containing your `.osm.pbf` file:

```
cd C:\Users\ayush\osrm-data

docker run -t -v "${PWD}:/data" osrm/osrm-backend osrm-extract -p /opt/car.lua /data/chandigarh.osm.pbf
docker run -t -v "${PWD}:/data" osrm/osrm-backend osrm-partition /data/chandigarh.osrm
docker run -t -v "${PWD}:/data" osrm/osrm-backend osrm-customize /data/chandigarh.osrm
```

Run these **one at a time**, waiting for each to finish (`osrm-extract` is
the slowest — could take a few minutes depending on the extract size). This
is a **one-time step** — you don't repeat this every time you start working
on the project, only if you change the map data.

If Docker can't find the file, double check the volume path — on Windows,
`${PWD}` works in PowerShell; if it doesn't resolve correctly, replace it
with the full literal path, e.g. `-v "C:\Users\ayush\osrm-data:/data"`.

## Step 4 — Run the OSRM server

```
docker run -t -i -p 5001:5000 -v "${PWD}:/data" osrm/osrm-backend osrm-routed --algorithm mld /data/chandigarh.osrm
```

Leave this terminal running — this is now a 4th permanent terminal
alongside routing-service, backend, and frontend. You should see it log
something like `running and waiting for requests`.

Note the port mapping: `5001:5000` — OSRM listens on 5000 *inside* the
container, mapped to 5001 on your machine, because port 5000 is already
taken by the Node backend.

## Step 5 — Verify OSRM is actually responding

In a separate terminal:
```
curl "http://localhost:5001/route/v1/driving/76.7794,30.7333;76.7828,30.7410"
```
(Note: OSRM takes coordinates as `longitude,latitude` — backwards from how
this app writes them everywhere else. That conversion is already handled
inside `routing-service/main.py`, you don't need to do anything about it
yourself — this is just for manually testing OSRM directly.)

You should get back a JSON response with `"code":"Ok"` and a `"routes"`
array. If you get a connection error, OSRM isn't running or the port isn't
mapped correctly — check Step 4.

## Step 6 — Point the routing service at it

Already done — `routing-service/.env` defaults to `OSRM_URL=http://localhost:5001`,
matching Step 4's port mapping. No changes needed unless you used a
different port.

Restart your routing-service terminal (`Ctrl+C`, then `uvicorn main:app
--reload --port 8000` again) so it picks up the new OSRM connection, then
check:
```
curl http://localhost:8000/health
```
Look for `"osrm_status":"ok"` in the response. If it says `"unreachable"`,
OSRM isn't running or reachable — go back to Step 4/5.

## Your normal daily startup, once this is all set up

Four terminals now, not three:

```
# Terminal 1 — OSRM (only needed once you've done Steps 1-3 already)
docker run -t -i -p 5001:5000 -v "C:\Users\ayush\osrm-data:/data" osrm/osrm-backend osrm-routed --algorithm mld /data/chandigarh.osrm

# Terminal 2 — routing-service
cd routing-service
venv\Scripts\activate
uvicorn main:app --reload --port 8000

# Terminal 3 — backend
cd backend
npm run dev

# Terminal 4 — frontend
cd frontend
npm run dev
```
