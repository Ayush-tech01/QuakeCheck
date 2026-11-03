"""Train and evaluate the earthquake-impact severity classifier.

Task     : predict the USGS PAGER impact category of an earthquake from
           magnitude, depth, latitude and longitude.
Dataset  : produced by download_data.py (USGS ComCat events that have a PAGER alert).
Model    : RandomForestClassifier (deployed) — a single DecisionTree and a
           majority-class baseline are evaluated alongside it for comparison.

Outputs (regenerated on every run):
    models/severity_model.joblib             the evaluated Random Forest   (skipped with --no-save-model)
    models/model_metadata.json               features, classes, metrics, ranges, provenance (same)
    reports/evaluation_<labels>_<split>.md   human-readable evaluation (+ .json); the name includes the
                                             settings, so a `--split time` run does not overwrite the
                                             `stratified` report

Usage:
    python train_model.py                              # the model the app uses
    python train_model.py --split time --no-save-model # extra, stricter evaluation; leaves the app's model alone
"""

import argparse
import hashlib
import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
)
from sklearn.model_selection import GridSearchCV, StratifiedKFold, train_test_split
from sklearn.tree import DecisionTreeClassifier

from common import (
    DEFAULT_DATA_PATH,
    FEATURES,
    LABEL_SCHEMES,
    METADATA_FILENAME,
    MODEL_DIR,
    MODEL_FILENAME,
    PAGER_LEVELS,
    REPORT_DIR,
)

REQUIRED_COLUMNS = ["event_id", "magnitude", "depth", "latitude", "longitude", "pager_alert"]
PARAM_GRID = {
    "n_estimators": [200],
    "max_depth": [None, 12],
    "min_samples_leaf": [1, 3, 5],
}


# ── Data ────────────────────────────────────────────────────────────────────
def load_dataset(path):
    """Read the CSV, coerce types and drop unusable rows. Returns (df, cleaning_summary)."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(
            f"Dataset not found: {path}\nRun `python download_data.py` first (needs internet access)."
        )
    df = pd.read_csv(path)
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Dataset is missing required column(s): {missing}")

    summary = {"rowsRead": int(len(df))}
    for col in FEATURES:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["pager_alert"] = df["pager_alert"].astype(str).str.strip().str.lower()

    before = len(df)
    df = df[df["pager_alert"].isin(PAGER_LEVELS)]
    summary["droppedUnknownLabel"] = int(before - len(df))

    before = len(df)
    df = df.dropna(subset=FEATURES)
    df = df[(df["latitude"].between(-90, 90)) & (df["longitude"].between(-180, 180))]
    summary["droppedMissingOrInvalidFeatures"] = int(before - len(df))

    before = len(df)
    df = df.drop_duplicates(subset="event_id")
    summary["droppedDuplicateEvents"] = int(before - len(df))

    summary["rowsUsed"] = int(len(df))
    return df.reset_index(drop=True), summary


def apply_labels(df, scheme):
    out = df.copy()
    out["label"] = out["pager_alert"].map(LABEL_SCHEMES[scheme]["mapping"])
    return out


def check_class_counts(df, classes, minimum):
    counts = df["label"].value_counts().reindex(classes, fill_value=0)
    too_few = [c for c in classes if counts[c] < minimum]
    if too_few:
        raise ValueError(
            f"Too few examples for class(es) {too_few} (need at least {minimum}; counts: {counts.to_dict()}). "
            "Download more years, lower --min-class-samples, or use --labels severity3 to merge the rare classes."
        )
    return {c: int(counts[c]) for c in classes}


def split_data(df, strategy, test_size, seed):
    if strategy == "stratified":
        train, test = train_test_split(df, test_size=test_size, stratify=df["label"], random_state=seed)
        return train.reset_index(drop=True), test.reset_index(drop=True)
    if strategy == "time":
        if "time" not in df.columns:
            raise ValueError("--split time needs a `time` column in the dataset")
        ordered = df.assign(_t=pd.to_datetime(df["time"], utc=True)).sort_values("_t").drop(columns="_t")
        cut = int(round(len(ordered) * (1 - test_size)))
        return ordered.iloc[:cut].reset_index(drop=True), ordered.iloc[cut:].reset_index(drop=True)
    raise ValueError(f"Unknown split strategy: {strategy}")


# ── Evaluation ──────────────────────────────────────────────────────────────
def evaluate(y_true, y_pred, classes):
    report = classification_report(y_true, y_pred, labels=classes, output_dict=True, zero_division=0)
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "balancedAccuracy": float(balanced_accuracy_score(y_true, y_pred)),
        "macroF1": float(f1_score(y_true, y_pred, labels=classes, average="macro", zero_division=0)),
        "perClass": {
            c: {
                "precision": float(report[c]["precision"]),
                "recall": float(report[c]["recall"]),
                "f1": float(report[c]["f1-score"]),
                "support": int(report[c]["support"]),
            }
            for c in classes
        },
        "confusionMatrix": confusion_matrix(y_true, y_pred, labels=classes).tolist(),
    }


def fit_random_forest(X_train, y_train, seed, use_grid):
    """Fit the Random Forest; tune a small grid by stratified CV on the TRAINING data only."""
    base = RandomForestClassifier(class_weight="balanced_subsample", random_state=seed, n_jobs=-1)
    min_class = int(y_train.value_counts().min())
    n_splits = min(5, min_class)
    if not use_grid or n_splits < 2:
        model = base.set_params(n_estimators=200, min_samples_leaf=3).fit(X_train, y_train)
        return model, {"tuned": False, "params": {"n_estimators": 200, "min_samples_leaf": 3}}

    search = GridSearchCV(
        base,
        PARAM_GRID,
        scoring="f1_macro",
        cv=StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=seed),
        n_jobs=1,  # the forest itself already uses all cores
        refit=True,
    )
    search.fit(X_train, y_train)
    return search.best_estimator_, {
        "tuned": True,
        "cvFolds": n_splits,
        "cvScoring": "f1_macro",
        "bestCvMacroF1": float(search.best_score_),
        "params": dict(search.best_params_),
    }


# ── Orchestration ───────────────────────────────────────────────────────────
def run_training(
    data_path=DEFAULT_DATA_PATH,
    out_dir=MODEL_DIR,
    report_dir=REPORT_DIR,
    label_scheme="severity3",
    split="stratified",
    test_size=0.2,
    seed=42,
    min_class_samples=10,
    use_grid=True,
    save_model=True,
    log=print,
):
    data_path, out_dir, report_dir = Path(data_path), Path(out_dir), Path(report_dir)
    classes = LABEL_SCHEMES[label_scheme]["classes"]

    df, cleaning = load_dataset(data_path)
    df = apply_labels(df, label_scheme)
    class_counts = check_class_counts(df, classes, min_class_samples)
    log(f"Loaded {len(df)} events. Class counts ({label_scheme}): {class_counts}")

    train, test = split_data(df, split, test_size, seed)
    X_train, y_train = train[FEATURES], train["label"]
    X_test, y_test = test[FEATURES], test["label"]
    for c in classes:
        if (y_train == c).sum() == 0:
            raise ValueError(f"Class '{c}' has no training examples after the '{split}' split.")
    log(f"Split ({split}): {len(train)} train / {len(test)} test")

    model, tuning = fit_random_forest(X_train, y_train, seed, use_grid)
    log(f"Random Forest fitted. Parameters: {tuning['params']}")

    rf_metrics = evaluate(y_test, model.predict(X_test), classes)

    tree = DecisionTreeClassifier(max_depth=8, min_samples_leaf=3, class_weight="balanced", random_state=seed)
    tree.fit(X_train, y_train)
    dt_metrics = evaluate(y_test, tree.predict(X_test), classes)

    majority = y_train.value_counts().idxmax()
    baseline = evaluate(y_test, np.full(len(y_test), majority), classes)
    baseline["predictsAlways"] = majority

    perm = permutation_importance(
        model, X_test, y_test, scoring="f1_macro", n_repeats=5, random_state=seed, n_jobs=1
    )

    dataset_info = {}
    info_path = data_path.with_suffix(".info.json")
    if info_path.exists():
        dataset_info = json.loads(info_path.read_text(encoding="utf-8"))
    else:
        dataset_info = {"synthetic": None, "note": "No .info.json next to the dataset; provenance unknown."}

    metadata = {
        "modelType": "RandomForestClassifier",
        "trainedAtUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "task": "Predict the USGS PAGER impact category of an earthquake from magnitude, depth, latitude, longitude",
        "features": FEATURES,
        "labelScheme": label_scheme,
        "labelMapping": LABEL_SCHEMES[label_scheme]["mapping"],
        "classes": classes,
        "dataset": {
            **dataset_info,
            "file": data_path.name,
            "sha256": hashlib.sha256(data_path.read_bytes()).hexdigest(),
            "cleaning": cleaning,
        },
        "split": {
            "strategy": split,
            "testSize": test_size,
            "seed": seed,
            "nTrain": int(len(train)),
            "nTest": int(len(test)),
            "classCountsAll": class_counts,
            "classCountsTrain": {c: int((y_train == c).sum()) for c in classes},
            "classCountsTest": {c: int((y_test == c).sum()) for c in classes},
        },
        "tuning": tuning,
        "metrics": {
            "randomForest": rf_metrics,
            "decisionTreeReference": dt_metrics,
            "majorityBaseline": baseline,
        },
        "featureImportances": dict(zip(FEATURES, (float(v) for v in model.feature_importances_))),
        "permutationImportanceMacroF1": {
            f: {"mean": float(m), "std": float(s)}
            for f, m, s in zip(FEATURES, perm.importances_mean, perm.importances_std)
        },
        "featureRanges": {
            f: {"min": float(X_train[f].min()), "max": float(X_train[f].max())} for f in FEATURES
        },
        "environment": {
            "python": platform.python_version(),
            "scikitLearn": sklearn.__version__,
            "pandas": pd.__version__,
            "numpy": np.__version__,
        },
    }

    report_dir.mkdir(parents=True, exist_ok=True)
    stem = f"evaluation_{label_scheme}_{split}"
    if save_model:
        out_dir.mkdir(parents=True, exist_ok=True)
        joblib.dump(model, out_dir / MODEL_FILENAME)
        (out_dir / METADATA_FILENAME).write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        log(f"Saved model to {out_dir / MODEL_FILENAME}")
    else:
        log("--no-save-model: the model used by the app was NOT changed")
    (report_dir / f"{stem}.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    (report_dir / f"{stem}.md").write_text(render_report(metadata), encoding="utf-8")
    log(f"Saved report to {report_dir / (stem + '.md')}")
    return metadata


def _table(rows, header):
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join(["---"] * len(header)) + "|"]
    lines += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(lines)


def render_report(m):
    classes, metrics = m["classes"], m["metrics"]
    synthetic = m["dataset"].get("synthetic")
    out = ["# Severity model — evaluation report", ""]
    if synthetic:
        out += [
            "> **SYNTHETIC SMOKE-TEST DATA — these numbers are NOT real results.** "
            "This model was trained on generated data only to test the code. Do not quote or deploy it.",
            "",
        ]
    out += [
        f"Trained (UTC): {m['trainedAtUtc']}  ",
        f"Model: {m['modelType']}  ·  scikit-learn {m['environment']['scikitLearn']}  ·  Python {m['environment']['python']}",
        "",
        "## Dataset",
        f"- Source: {m['dataset'].get('source', 'unknown')}",
        f"- Endpoint: {m['dataset'].get('endpoint', 'n/a')}",
        f"- Downloaded (UTC): {m['dataset'].get('downloadedAtUtc', 'n/a')}  ·  years {m['dataset'].get('startYear', '?')}–{m['dataset'].get('endYear', '?')}",
        f"- File: `{m['dataset']['file']}`  ·  SHA-256 `{m['dataset']['sha256'][:16]}…`",
        f"- Cleaning: {json.dumps(m['dataset']['cleaning'])}",
        "",
        "## Task, features, labels",
        f"- Features: {', '.join(m['features'])}",
        f"- Target scheme `{m['labelScheme']}`: {json.dumps(m['labelMapping'])}",
        f"- Class counts (all / train / test): {m['split']['classCountsAll']} / {m['split']['classCountsTrain']} / {m['split']['classCountsTest']}",
        "",
        "## Split and training",
        f"- Strategy: `{m['split']['strategy']}`, test size {m['split']['testSize']}, seed {m['split']['seed']} → {m['split']['nTrain']} train / {m['split']['nTest']} test",
        f"- Random Forest parameters: {json.dumps(m['tuning']['params'])}"
        + (
            f" (chosen by {m['tuning']['cvFolds']}-fold stratified CV on the training set, macro-F1 {m['tuning']['bestCvMacroF1']:.3f})"
            if m["tuning"].get("tuned")
            else " (no tuning)"
        ),
        "- `class_weight=balanced_subsample` is used because the classes are heavily imbalanced.",
        "",
        "## Test-set results",
        _table(
            [
                [
                    name,
                    f"{metrics[key]['accuracy']:.3f}",
                    f"{metrics[key]['balancedAccuracy']:.3f}",
                    f"{metrics[key]['macroF1']:.3f}",
                ]
                for name, key in [
                    ("Random Forest (deployed)", "randomForest"),
                    ("Decision Tree (reference)", "decisionTreeReference"),
                    (f"Majority baseline (always '{metrics['majorityBaseline']['predictsAlways']}')", "majorityBaseline"),
                ]
            ],
            ["Model", "Accuracy", "Balanced accuracy", "Macro-F1"],
        ),
        "",
        "Accuracy alone is misleading here: a model that always predicts the most common class scores high accuracy "
        "but has zero recall on the rare, important classes. Compare **macro-F1** and the per-class recall below.",
        "",
        "### Per-class results (Random Forest)",
        _table(
            [
                [
                    c,
                    f"{metrics['randomForest']['perClass'][c]['precision']:.3f}",
                    f"{metrics['randomForest']['perClass'][c]['recall']:.3f}",
                    f"{metrics['randomForest']['perClass'][c]['f1']:.3f}",
                    metrics["randomForest"]["perClass"][c]["support"],
                ]
                for c in classes
            ],
            ["Class", "Precision", "Recall", "F1", "Test support"],
        ),
        "",
        "### Confusion matrix (rows = actual, columns = predicted)",
        _table(
            [[c] + row for c, row in zip(classes, metrics["randomForest"]["confusionMatrix"])],
            ["actual \\ predicted"] + classes,
        ),
        "",
        "## Feature importance",
        _table(
            [
                [
                    f,
                    f"{m['featureImportances'][f]:.3f}",
                    f"{m['permutationImportanceMacroF1'][f]['mean']:.3f} ± {m['permutationImportanceMacroF1'][f]['std']:.3f}",
                ]
                for f in m["features"]
            ],
            ["Feature", "Impurity importance", "Permutation importance (macro-F1 drop, test set)"],
        ),
        "",
        "## Limitations",
        "- The labels are USGS's own *modelled* PAGER estimates, not measured casualties or damage.",
        "- Only four basic inputs are used, so the model approximates PAGER; it cannot see population density, building stock or local geology.",
        "- A random split can place events from the same earthquake sequence in both train and test, which flatters the scores; "
        "re-run with `--split time` for a stricter, forward-in-time check.",
        "- Rare classes have few test examples, so their per-class numbers are noisy.",
        "",
    ]
    return "\n".join(out)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", default=str(DEFAULT_DATA_PATH))
    p.add_argument("--out-dir", default=str(MODEL_DIR))
    p.add_argument("--report-dir", default=str(REPORT_DIR))
    p.add_argument("--labels", choices=list(LABEL_SCHEMES), default="severity3")
    p.add_argument("--split", choices=["stratified", "time"], default="stratified")
    p.add_argument("--test-size", type=float, default=0.2)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--min-class-samples", type=int, default=10)
    p.add_argument("--no-grid", action="store_true", help="skip the small hyper-parameter search")
    p.add_argument(
        "--no-save-model",
        action="store_true",
        help="write only the evaluation report; do not overwrite the model the app uses",
    )
    a = p.parse_args(argv)
    try:
        meta = run_training(
            a.data, a.out_dir, a.report_dir, a.labels, a.split, a.test_size, a.seed, a.min_class_samples, not a.no_grid,
            save_model=not a.no_save_model,
        )
    except (FileNotFoundError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    rf = meta["metrics"]["randomForest"]
    print(
        f"\nTest accuracy {rf['accuracy']:.3f} | balanced accuracy {rf['balancedAccuracy']:.3f} | macro-F1 {rf['macroF1']:.3f}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
