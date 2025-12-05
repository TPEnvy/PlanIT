
import argparse
import os
import json
from datetime import datetime, timezone
from dateutil import parser as dateparser

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, accuracy_score
import xgboost as xgb
import joblib

# -------------------------
# Helpers
# -------------------------
def safe_get(row, keys, default=None):
    """Return first present key value from row (pandas Series / dict)."""
    for k in keys:
        if k in row and pd.notna(row[k]):
            return row[k]
    return default

def to_dt(val):
    """Parse timestamp-like values into timezone-aware datetime (UTC)."""
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    if isinstance(val, datetime):
        return val.astimezone(timezone.utc)
    try:
        # dateutil parse handles many formats incl. Firestore stringified timestamps
        dt = dateparser.parse(str(val))
        if dt.tzinfo is None:
            # assume UTC if none
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt
    except Exception:
        return None

def map_urgency(v):
    if pd.isna(v) or v is None: return 0
    v = str(v).lower()
    if "urgent" in v and "somewhat" not in v: return 2
    if "somewhat" in v: return 1
    return 0

def map_importance(v):
    if pd.isna(v) or v is None: return 0
    v = str(v).lower()
    if "important" in v and "somewhat" not in v: return 2
    if "somewhat" in v: return 1
    return 0

def map_difficulty(v):
    if pd.isna(v) or v is None: return 1
    v = str(v).lower()
    if v.startswith("easy"): return 0
    if v.startswith("medium"): return 1
    if v.startswith("hard"): return 2
    return 1

def compute_label(row, grace_hours=2):
    """
    Heuristic label:
      completed_on_time = 1 when:
        - status == "completed" AND lastCompletedAt <= dueDate + grace_hours
      else 0.

    If dueDate missing:
      - if completed and totalActualMinutes <= 1.5 * estimatedMinutes -> 1
      - else 0
    """
    status = safe_get(row, ["status", "state"], "").lower()
    due = to_dt(safe_get(row, ["dueDate", "endAt", "endAt_iso", "end_date_iso"], None))
    last_completed = to_dt(safe_get(row, ["lastCompletedAt", "last_completed_at", "lastCompletedAt_iso"], None))
    est = safe_get(row, ["estimatedMinutes", "estimated_minutes", "estimatedMinutesValue"], None)
    total_actual = safe_get(row, ["totalActualMinutes", "total_actual_minutes"], None)

    if status == "completed":
        if due and last_completed:
            if last_completed <= due + pd.Timedelta(hours=grace_hours):
                return 1
            else:
                return 0
        if due and not last_completed:
            return 0
        # no due date: use estimated / actual heuristic
        if est and total_actual:
            try:
                est = float(est)
                total_actual = float(total_actual)
                if total_actual <= est * 1.5:
                    return 1
                return 0
            except Exception:
                return 0
        # fallback: completed with no further info -> treat as positive
        return 1
    # not completed -> negative
    return 0

def featurize(df):
    # copy to avoid mutating original
    D = df.copy()

    # timestamps
    D["createdAt_dt"] = D.apply(lambda r: to_dt(safe_get(r, ["createdAt", "created_at", "createdAt_iso"])), axis=1)
    D["startAt_dt"] = D.apply(lambda r: to_dt(safe_get(r, ["startAt", "startAt_iso", "start_at"])), axis=1)
    D["endAt_dt"] = D.apply(lambda r: to_dt(safe_get(r, ["endAt", "endAt_iso", "end_at", "dueDate"])), axis=1)
    D["dueDate_dt"] = D.apply(lambda r: to_dt(safe_get(r, ["dueDate", "dueDate_iso", "endAt", "due_date"])), axis=1)
    D["lastCompleted_dt"] = D.apply(lambda r: to_dt(safe_get(r, ["lastCompletedAt", "last_completed_at"])), axis=1)

    # core numeric features
    D["estimated_minutes"] = D.apply(lambda r: safe_get(r, ["estimatedMinutes", "estimated_minutes", "estimated_minutes_raw"], np.nan), axis=1).astype(float).fillna(0)

    # hours to due: difference between due/end and created; if negative -> 0
    def hours_to_due(row):
        if row["dueDate_dt"] and row["createdAt_dt"]:
            return max(0.0, (row["dueDate_dt"] - row["createdAt_dt"]).total_seconds() / 3600.0)
        if row["dueDate_dt"] and not row["createdAt_dt"]:
            return max(0.0, (row["dueDate_dt"] - datetime.now(timezone.utc)).total_seconds() / 3600.0)
        return 9999.0  # essentially floating/todo task
    D["hours_to_due"] = D.apply(hours_to_due, axis=1)

    # ordinals
    D["urgency_v"] = D.apply(lambda r: map_urgency(safe_get(r, ["urgencyLevel", "urgency_level", "urgency"])), axis=1)
    D["importance_v"] = D.apply(lambda r: map_importance(safe_get(r, ["importanceLevel", "importance_level", "importance"])), axis=1)
    D["difficulty_v"] = D.apply(lambda r: map_difficulty(safe_get(r, ["difficultyLevel", "difficulty_level", "difficulty"])), axis=1)

    # pattern / user aggregates if present (fall back to 0)
    D["pattern_completion_rate"] = D.apply(lambda r: safe_get(r, ["pattern_completion_rate", "completion_rate", "pattern.completion_rate"], 0.0), axis=1).astype(float).fillna(0.0)
    D["pattern_overrun_ratio"] = D.apply(lambda r: safe_get(r, ["pattern_overrun_ratio", "overrun_ratio", "pattern.overrun_ratio"], 1.0), axis=1).astype(float).fillna(1.0)

    # simple recent activity features
    D["completed_count"] = D.apply(lambda r: safe_get(r, ["completedCount", "completed_count", "completedCount_total"], 0), axis=1).astype(float).fillna(0.0)
    D["missed_count"] = D.apply(lambda r: safe_get(r, ["missedCount", "missed_count"], 0), axis=1).astype(float).fillna(0.0)

    # day of week, hour of day features (from startAt or dueDate)
    def dow(row):
        dt = row["startAt_dt"] or row["dueDate_dt"] or row["createdAt_dt"]
        if not dt: return -1
        return dt.weekday()  # 0=Mon .. 6=Sun
    def hod(row):
        dt = row["startAt_dt"] or row["dueDate_dt"] or row["createdAt_dt"]
        if not dt: return -1
        return dt.hour
    D["dow"] = D.apply(dow, axis=1)
    D["hod"] = D.apply(hod, axis=1)

    # derived / interaction features
    D["est_by_hours_to_due"] = D["estimated_minutes"] / (D["hours_to_due"] * 60.0 + 1.0)
    D["completion_rate_userpattern"] = D["pattern_completion_rate"]  # alias

    # label
    D["label_completed_on_time"] = D.apply(lambda r: compute_label(r), axis=1)

    return D

# -------------------------
# Main training routine
# -------------------------
def train(args):
    print("Loading data:", args.input)
    # allow csv or json
    if args.input.lower().endswith(".csv"):
        df = pd.read_csv(args.input)
    else:
        # try json lines or json array
        try:
            df = pd.read_json(args.input, lines=True)
        except ValueError:
            df = pd.read_json(args.input)

    print("Rows:", len(df))

    # featurize
    D = featurize(df)
    print("Featurized. Sample columns:", list(D.columns)[:20])

    # Choose feature list (you can extend)
    features = [
        "estimated_minutes",
        "hours_to_due",
        "urgency_v",
        "importance_v",
        "difficulty_v",
        "pattern_completion_rate",
        "pattern_overrun_ratio",
        "completed_count",
        "missed_count",
        "est_by_hours_to_due",
        "dow",
        "hod",
    ]

    # Fill NaN and simple cleaning
    Xraw = D[features].fillna(0.0).astype(float)
    y = D["label_completed_on_time"].astype(int).values

    # Time-based split alternative: if 'createdAt_dt' exists split by recency.
    if "createdAt_dt" in D.columns and args.test_days is not None:
        try:
            latest = D["createdAt_dt"].dropna().max()
            cutoff = latest - pd.Timedelta(days=int(args.test_days))
            mask_train = D["createdAt_dt"].apply(lambda dt: dt is not None and dt <= cutoff)
            if mask_train.sum() < 20 or (~mask_train).sum() < 20:
                # fallback to random
                print("Time split produced too-small groups; falling back to random split.")
                X_train, X_val, y_train, y_val = train_test_split(Xraw, y, test_size=0.15, random_state=42, stratify=y)
            else:
                X_train = Xraw[mask_train.values]
                y_train = y[mask_train.values]
                X_val = Xraw[~mask_train.values]
                y_val = y[~mask_train.values]
                print(f"Time-based split: train {len(X_train)}, val {len(X_val)} (cutoff {cutoff})")
        except Exception as e:
            print("Time-based split failed:", e)
            X_train, X_val, y_train, y_val = train_test_split(Xraw, y, test_size=0.15, random_state=42, stratify=y)
    else:
        X_train, X_val, y_train, y_val = train_test_split(Xraw, y, test_size=0.15, random_state=42, stratify=y)

    # scale numeric features (trees don't need it but scaler is useful if using MLP later)
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_val_scaled = scaler.transform(X_val)

    # xgboost DMatrix
    dtrain = xgb.DMatrix(X_train_scaled, label=y_train, feature_names=features)
    dval = xgb.DMatrix(X_val_scaled, label=y_val, feature_names=features)

    params = {
        "objective": "binary:logistic",
        "eval_metric": "auc",
        "tree_method": "hist",
        "learning_rate": args.lr,
        "max_depth": args.max_depth,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "seed": 42,
    }

    evals = [(dtrain, "train"), (dval, "val")]
    print("Training XGBoost with params:", params)
    bst = xgb.train(params, dtrain, num_boost_round=args.num_rounds, evals=evals, early_stopping_rounds=30, verbose_eval=50)

    # evaluate
    pred_val = bst.predict(dval)
    auc = roc_auc_score(y_val, pred_val)
    acc = accuracy_score(y_val, (pred_val > 0.5).astype(int))
    print(f"Validation AUC: {auc:.4f}, Accuracy: {acc:.4f}")

    # save artifacts
    os.makedirs(args.out, exist_ok=True)
    model_path = os.path.join(args.out, "xgb_completed_on_time.json")
    bst.save_model(model_path)
    joblib.dump(scaler, os.path.join(args.out, "scaler.pkl"))
    joblib.dump(features, os.path.join(args.out, "features.pkl"))
    print("Saved model ->", model_path)
    print("Saved scaler & features in", args.out)

    # also save a small metadata file
    meta = {
        "trained_at": datetime.utcnow().isoformat() + "Z",
        "n_train": len(X_train),
        "n_val": len(X_val),
        "val_auc": float(auc),
        "val_acc": float(acc),
        "features": features,
    }
    with open(os.path.join(args.out, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print("Saved meta.json")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True, help="CSV or JSONL export file from Firestore")
    p.add_argument("--out", default="models", help="output folder for models & artifacts")
    p.add_argument("--test-days", type=int, default=14, help="use most recent N days as validation set (time split); set 0 to disable")
    p.add_argument("--num-rounds", type=int, default=500, help="xgboost num_boost_round")
    p.add_argument("--lr", type=float, default=0.05, help="learning rate")
    p.add_argument("--max-depth", type=int, default=6, help="max tree depth")
    args = p.parse_args()

    if args.test_days == 0:
        args.test_days = None

    train(args)
