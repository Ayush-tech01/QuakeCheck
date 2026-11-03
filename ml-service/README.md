# QuakeCheck ML Service — seismic impact severity (advisory)

A small Python service that adds a **machine-learning severity estimate** to the admin dashboard.
An admin clicks **Analyze Severity** on a rescue SOS and sees the predicted impact category of the
related earthquake, the inputs used, an explanation, and how reliable the model was on held-out data.

> **Advisory only.** It never assigns a team, changes an emergency's status, or ranks emergencies.
> The victim-facing workflow (login, map, "I'm Safe", "I Need Rescue") does not use it at all.

---

## 1. What is being predicted — and why not "victim severity"

A `rescue` emergency in QuakeCheck stores only: GPS coordinates, optional free-text notes, status and
timestamps. It has **no** injury, casualty, trapped-person or building-damage fields, and I know of no
public dataset that labels rescue requests with that information. So a model that triages an individual
victim's condition cannot be trained honestly from this data, and none was faked.

**Smallest defensible alternative (what this module does):** predict the **USGS PAGER impact category of the
earthquake** from its **magnitude, depth, latitude and longitude** — exactly the fields QuakeCheck already
stores in `EarthquakeFeed`. The output describes the *earthquake's likely impact level*, not the person
who sent the SOS. When USGS has published its own PAGER alert for the event, the panel shows it and
says to prefer it over the ML estimate.

**How an earthquake is matched to an SOS** (`backend/services/severityService.js`). It uses the SOS's own
coordinates and its own creation timestamp — nothing is assumed about Chandigarh:

| Rule | Default | `backend\.env` setting |
|---|---|---|
| within this distance of the SOS | 300 km | `SEVERITY_MATCH_RADIUS_KM` |
| occurred in this many hours before the SOS was created (never after it) | 24 h | `SEVERITY_QUAKE_WINDOW_HOURS` |
| at least this magnitude | 4.0 | `SEVERITY_MIN_MAGNITUDE` |

These are practical heuristics, not seismological facts, and the panel prints them. The strongest qualifying
event (ties: nearest) is analysed; up to 4 others that also qualified are listed but not analysed. The panel shows the
matched event's **distance from the SOS and how long before the SOS it occurred**, and states that it is matched
*only by location and time* — it does **not** claim the earthquake caused the SOS. The magnitude floor exists because the
model is trained only on events USGS assigned an alert to; tiny tremors would be out of its range.
If nothing qualifies — or the SOS has no valid location/timestamp — the panel says so (and that the feed may
simply not hold the event, because it only stores what USGS reported while your server was running) and offers the
**Manual scenario** form. Nothing is guessed.

## 2. Dataset (real, public, documented)

| | |
|---|---|
| Source | USGS ANSS ComCat earthquake catalogue |
| Access | Public FDSN Event Web Service, no key: `https://earthquake.usgs.gov/fdsnws/event/1/` |
| Selection | Events that USGS assigned a PAGER alert level, via the service's `alertlevel=green\|yellow\|orange\|red` parameter; default years 2000–2025; non-earthquake event types dropped |
| Label | `properties.alert` — the PAGER alert level |
| Retrieval | `python download_data.py` (writes `data/usgs_pager_events.csv` + `data/usgs_pager_events.info.json` with source, parameters, download time and counts) |

The dataset is **not included** in the ZIP; you download it. Events USGS never assigned an alert to have no
label and are not downloaded.

**What the labels mean** (USGS PAGER, Factsheet 2010-3036): the alert is set by the higher of two *modelled*
estimates.

| Alert | Estimated fatalities | Estimated losses (USD) |
|---|---|---|
| Green | 0 | < $1 million |
| Yellow | 1–99 | $1 million – $100 million |
| Orange | 100–999 | $100 million – $1 billion |
| Red | 1,000+ | $1 billion+ |

**Expected class balance.** A USGS PAGER presentation (hosted by the Global Earthquake Model foundation,
author contact `kjaiswal@usgs.gov`) reports 10,513 final alerts for Sept 2010 – Dec 2025: 10,063 green, 333 yellow,
72 orange and 45 red. That is ~96 % green. Your download will differ (different year range, and USGS data are
revised); `download_data.py` and `train_model.py` print the real counts.

## 3. Features and target

- **Features (4):** `magnitude`, `depth` (km), `latitude`, `longitude`.
- **Not used on purpose:** USGS `sig`, `mmi`, `cdi`, `felt` — computed after the event and (for `sig`) partly derived
  from the alert itself, so they would leak the answer.
- **Target, default `severity3`:** green → **low**, yellow → **moderate**, orange + red → **high**.
  Orange and red are merged because together they are only ~1 % of events; separate classes leave too few
  examples to train or evaluate on. `python train_model.py --labels pager4` keeps all four.

## 4. Pipeline (`train_model.py`)

1. **Preprocessing:** coerce numeric types; drop rows with unknown labels, missing/invalid features
   (or lat/lon out of range) and duplicate event IDs; counts of everything dropped are saved in the metadata.
   No scaling is needed for tree models.
2. **Split:** stratified 80 / 20 (`random_state=42`) so every class appears in both parts.
   `--split time` instead trains on the oldest 80 % and tests on the newest 20 %.
3. **Imbalance:** `class_weight="balanced_subsample"`. Accuracy is reported but **macro-F1, balanced
   accuracy and per-class recall are the headline metrics**, because "always predict green" already scores
   ~96 % accuracy.
4. **Model:** `RandomForestClassifier`. Its settings (`max_depth`, `min_samples_leaf`) are picked from a small grid by
   5-fold stratified cross-validation on the **training set only**; the test set is never used for tuning.
5. **Comparison on the same test set:** a single `DecisionTreeClassifier` (reference) and a majority-class baseline.
   The Random Forest is deployed by design, not picked by test score.
6. **Outputs:** `models/severity_model.joblib` (the exact model that was evaluated), `models/model_metadata.json`,
   and `reports/evaluation_<labels>_<split>.md` / `.json` (metrics, per-class table, confusion matrix, impurity and
   permutation importance, dataset SHA-256, library versions). The report name includes the settings, so running
   `--split time` does not overwrite the `stratified` report; add `--no-save-model` to a second run so it
   can't overwrite the model the app uses.

## 5. Evaluation results

**There are no real results in this ZIP, and none have been invented.** The environment this was built in had
no internet access, so the USGS dataset could not be downloaded or trained on. The real numbers are produced on
your machine by the commands in section 6 and written to `reports\evaluation_severity3_stratified.md` (and
`..._time.md`) — quote those, with the dataset download date, in your report. Report **both** splits and say
which is which: the random split is optimistic, the time split is the more honest estimate.

What *was* run: the full pipeline end-to-end on a clearly labelled **synthetic** fixture
(`tests/synthetic_data.py`) to prove the code works. Metrics from that run are meaningless. A model trained
on synthetic data is flagged `datasetSynthetic: true`; the service returns a warning and the admin panel
shows it, so it can't be mistaken for a real one.

## 6. Setup on Windows (PowerShell)

Needs Python 3.11+ (developed on 3.12) and internet access for steps 3–4.

```powershell
cd ml-service
py -3 -m venv venv
.\venv\Scripts\Activate.ps1          # if blocked: Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
pip install -r requirements.txt

python download_data.py              # step 3: downloads the real USGS dataset (several hundred small requests; allow a few minutes)
python train_model.py                # step 4a: trains + evaluates the model the app uses -> reports\evaluation_severity3_stratified.md
python train_model.py --split time --no-save-model   # step 4b: stricter forward-in-time check -> reports\evaluation_severity3_time.md
python app.py                        # step 5: starts the service on http://127.0.0.1:8001
```

Expected on success: step 3 prints one line per year and finally `Saved N events` with the per-alert counts;
step 4 prints class counts, the split sizes, the chosen parameters and the test accuracy / balanced accuracy / macro-F1.
**If a step fails, copy the full error text** — the downloader names the request that failed.

Optional variants: `python download_data.py --start-year 2010`, `python train_model.py --labels pager4 --no-save-model`
(4-class report), `python train_model.py --no-grid` (skip tuning).

Check it: open <http://127.0.0.1:8001/health> — `"modelLoaded": true`.

### Running the whole project

Open separate terminals: (1) MongoDB, (2) `routing-service` as before, (3) **`ml-service`: `python app.py`**,
(4) `backend`: `npm run dev`, (5) `frontend`: `npm run dev`. Add to `backend\.env` (see `.env.example`; the
matching settings are optional and default to the table in section 1):

```
ML_SERVICE_URL=http://localhost:8001
```

Log in as `admin@qc.com` → Admin Dashboard → on a **Rescue SOS** row click **Analyze Severity**.
If you start the service before training, it says the model isn't trained; train, then click **Re-run**
(no restart needed).

### Demo (3 minutes)

1. Admin panel → **Analyze Severity** on a rescue SOS. Real recent quakes within 300 km of Chandigarh are rare, so you will
   usually see "no earthquake matched" — that honest empty state is itself worth showing.
2. Click **Manual scenario**, enter e.g. magnitude `6.5`, depth `10`, and click **Run scenario**: category, probabilities,
   explanation and the model's held-out test scores appear. Try magnitude `4.2` (expect *Low*) for contrast.
3. *Optional — show real matching with a clearly labelled demo event.* In `mongosh <your database name>`:
   ```js
   db.earthquakefeeds.insertOne({ eventId: "demo-quake-1", magnitude: 5.2, place: "DEMO - simulated earthquake near Shimla",
     depth: 12, location: { lat: 31.10, lng: 77.17 }, time: new Date(Date.now() - 3*3600*1000), tsunami: false, alert: null,
     source: "demo", createdAt: new Date(), updatedAt: new Date() })
   ```
   Then raise a **new** "I Need Rescue" SOS (it must be created *after* the quake time) and click **Analyze Severity**:
   the panel shows the ~55 km distance and "3 h … before". **Afterwards remove it** — it also appears on the
   user-facing earthquake map: `db.earthquakefeeds.deleteMany({ source: "demo" })`.

## 7. Service API (internal)

The Node backend calls this; browsers never do. It binds to `127.0.0.1` — **don't expose port 8001**.
Authentication/authorization is done by the backend route `POST /api/admin/emergencies/:id/severity`
(the existing JWT `protect` + `authorize("admin")` middleware).

| | |
|---|---|
| `GET /health` | `{status, modelLoaded, modelTrainedAtUtc, labelScheme}` |
| `POST /predict` | body `{magnitude, depth, latitude, longitude}` (numbers, range-checked) → `{success, predictedClass, label, confidence, probabilities, inputs, featureImportances, explanation[], warnings[], model{…test metrics…}}`; errors `400 INVALID_INPUT`, `503 MODEL_NOT_TRAINED` / `MODEL_LOAD_FAILED` |

The explanation shows class probabilities, the inputs, the model's *global* feature importance (labelled as not a
per-case explanation) and the held-out test metrics. Inputs outside the training range produce a warning.

## 8. Tests

```powershell
cd ml-service ; python -m unittest discover -s tests -v     # 62 tests (3 are skipped until the real dataset is downloaded)
cd ..\backend ; npm test                                    # 48 tests (24 severity + 24 similarity)
```

- `ml-service` tests: downloader parsing and window-splitting (offline fixtures, fake HTTP session), training on the
  synthetic fixture, split correctness, metadata, model-loading failures, prediction, input validation, Flask API,
  and the KNN similarity feature (`tests/test_similarity.py`, section 10).
- `backend` tests: real admin router + JWT + role checks with stubbed Mongoose models and a mock ML server — 401/403,
  validation, quake selection, error mapping, and a check that the endpoints perform no writes.

## 9. Limitations

- **Not tested against the live USGS API** (no internet where this was built). Its parsing and window-splitting
  logic is unit-tested with fixtures; the live requests are not. If `download_data.py` errors, the message says which request failed.
- Predicts the *earthquake's modelled impact category*, not an individual victim's condition or rescue priority.
- Labels are USGS's own modelled estimates, not measured casualties; four inputs cannot capture population density or
  building stock, so the model only *approximates* PAGER. Official USGS alerts should be preferred when available.
- A random split can put events from one earthquake sequence on both sides of the split and flatter the scores —
  also run `--split time` and report both. Rare classes have few test examples, so their per-class numbers are noisy.
- The model is trained globally and is not calibrated for Chandigarh specifically.
- An SOS is matched to an earthquake only by distance and time (defaults 300 km / 24 h / M ≥ 4.0). That is a heuristic; it is
  not evidence the earthquake caused or relates to the SOS, and the panel says so. The feed only holds events your server
  fetched from USGS while it was running, so a missing match does not prove no earthquake occurred.
- Only `admin` accounts can call it (the panel lives on the admin dashboard); rescue-team accounts get 403.
- `models/*.joblib` files are Python pickles — only load files you trained yourself.

---

## 10. Historical earthquake similarity (KNN)

An admin opening **Analyze Severity** on a rescue SOS also sees a second, separate panel, **Historical earthquake
similarity**. Pressing **Find Similar Historical Earthquakes** lists the five earthquakes in the historical USGS/PAGER
dataset most similar to the one matched to that SOS (the *same* earthquake the severity panel analyses).

> **Retrieval, not prediction.** It never says the current earthquake will behave like a match. The PAGER alert on each
> match belongs to *that past event*; it is not the Random Forest estimate and the two are never combined. It does not
> assign teams, change status or set priority, and the Random Forest code is untouched.

**Data.** The same `data/usgs_pager_events.csv` the Random Forest trains on (so `python download_data.py` is the only setup),
read through `train_model.load_dataset()` so both features apply identical cleaning. Extra step for KNN: records with
identical time + magnitude + depth + position under different ids are collapsed. The set contains only events USGS
assigned a PAGER alert to, so small or unassessed earthquakes never appear as matches. If `data/*.info.json` is missing or
says `synthetic: true`, every response carries a warning.

**Distance.** Latitude/longitude are *not* fed in as two ordinary columns (a degree of longitude has no fixed length, and
longitude wraps at ±180°). Each ingredient becomes a unit-less term, then they are combined as a weighted Euclidean distance:

```
g = haversine_km(current, past) / 1000          # great-circle km; 1000 km = "same broad seismic region"
m = |Δ magnitude| / σ_magnitude                  # σ = standard deviation of the historical dataset
z = |Δ depth|     / σ_depth
D = sqrt( (1.0·g)² + (1.0·m)² + (0.5·z)² )       # lower D = more similar
```

Dividing by σ is the same as z-scoring both values and subtracting. Depth has half weight because USGS depths are often
poorly constrained (many are default 10 km / 33 km values). Weights and the 1000 km scale are constants in `common.py`
and are returned with every response. The KNN step is an exact scan: compute D to every record, remove the current event,
keep the 5 smallest (ties broken by record order, so results are reproducible). With about 10⁴ records this takes well under
a millisecond, so no approximate index is needed, and nothing is fitted or saved to disk — the cleaned dataset is held in memory
and reloaded automatically if the CSV changes.

**Exclusions and honesty rules.** The current event is excluded by event id, and also if a record has practically the same time
(±60 s) and place (≤50 km) under a different id. Fewer than 5 qualifying records → only those are returned, with an explanation;
nothing pads the list. Matches more than 2000 km away are returned but flagged. Missing time/place stay "unknown".

**Service API** (`ml-service/app.py`; called only by the Node backend, which does the admin check):

| | |
|---|---|
| `POST /similar` | body `{magnitude, depth, latitude, longitude, eventId?, time?}` → `{success, matches[5], returned, message, warnings[], method{…}, reference{…}, disclaimer, …}`; `400 INVALID_INPUT`, `503 HISTORICAL_DATA_NOT_AVAILABLE / HISTORICAL_DATA_EMPTY / HISTORICAL_DATA_LOAD_FAILED`, `500 SIMILARITY_FAILED` (generic, no internals) |

Backend route: `POST /api/admin/emergencies/:id/similar-earthquakes` (admin only; optional `{scenario:{…}}` for a
clearly-labelled *hypothetical* comparison). `/health` and `/predict` are unchanged, and `/similar` works without a trained model.
No new dependencies, no new environment variables, no extra network calls. After updating, **restart `python app.py`** (an
old running service answers the backend with `ML_SERVICE_OUTDATED`).

**Limitations.** Similarity is only as good as three numbers; it ignores tectonic setting, population and buildings. The
geographic scale (1000 km) and weights are documented judgement calls, not fitted values. It has been run only on synthetic
fixtures where it was built (no internet): run the `RealDatasetTests` (they run automatically once the CSV exists) and look at a
few results before relying on it.
