import logging
from typing import Any, Dict, List, Optional

import numpy as np
from sklearn.linear_model import LogisticRegression

logger = logging.getLogger("planit-ml")

try:
    from xgboost import XGBClassifier
except ImportError:  # pragma: no cover - depends on deployment image
    XGBClassifier = None


def normalize_title(title: str) -> str:
    if not isinstance(title, str):
        return ""
    return " ".join(title.strip().lower().split())


def build_dataset(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not items:
        return {
            "X": None,
            "y": None,
            "docCount": 0,
            "total_completed": 0,
            "total_missed": 0,
            "completion_rate": 0.0,
            "overrun_ratio": 1.0,
        }

    total_completed = 0
    total_missed = 0
    total_est = 0.0
    total_act = 0.0
    x_rows = []
    y_rows = []

    for item in items:
        completed = int(item.get("completedCount", 0) or 0)
        missed = int(item.get("missedCount", 0) or 0)
        est = float(item.get("estimatedMinutes", 0) or 0)
        act = float(item.get("actualMinutes", 0) or 0)
        status = (item.get("status") or "").lower()
        is_split_parent = 1.0 if item.get("isSplitParent") else 0.0
        is_split_segment = 1.0 if item.get("isSplitSegment") else 0.0

        total_completed += completed
        total_missed += missed
        total_est += est
        total_act += act

        denom_local = completed + missed
        completion_local = (completed / denom_local) if denom_local > 0 else 0.0

        if est > 0:
            overrun_local = (act / est) if act > 0 else 1.0
        else:
            overrun_local = 1.0 if act == 0 else float(act)

        risky = 1 if (missed > completed or status == "missed") else 0
        x_rows.append(
            [
                float(est),
                float(act),
                float(completed),
                float(missed),
                float(completion_local),
                float(overrun_local),
                float(is_split_parent),
                float(is_split_segment),
            ]
        )
        y_rows.append(risky)

    doc_count = len(items)
    denom = total_completed + total_missed
    completion_rate = (total_completed / denom) if denom > 0 else 0.0

    if total_est > 0:
        overrun_ratio = (total_act / total_est) if total_act > 0 else 1.0
    else:
        overrun_ratio = 1.0 if total_act == 0 else float(total_act)

    return {
        "X": np.array(x_rows, dtype=np.float32),
        "y": np.array(y_rows, dtype=np.int32),
        "docCount": doc_count,
        "total_completed": total_completed,
        "total_missed": total_missed,
        "completion_rate": completion_rate,
        "overrun_ratio": overrun_ratio,
    }


def _train_xgb_risk(x: Optional[np.ndarray], y: Optional[np.ndarray]) -> float:
    if XGBClassifier is None:
        logger.warning("xgboost is not installed; using logistic-regression-only risk scoring.")
        return 0.0

    if x is None or y is None or x.shape[0] < 5 or len(np.unique(y)) < 2:
        return 0.0

    model = XGBClassifier(
        n_estimators=80,
        max_depth=3,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        objective="binary:logistic",
        eval_metric="logloss",
        n_jobs=1,
        reg_lambda=1.0,
    )
    model.fit(x, y)
    return float(np.mean(model.predict_proba(x)[:, 1]))


def _train_lr_risk(x: Optional[np.ndarray], y: Optional[np.ndarray]) -> float:
    if x is None or y is None or x.shape[0] < 5 or len(np.unique(y)) < 2:
        return 0.0

    model = LogisticRegression(max_iter=200)
    try:
        model.fit(x, y)
        return float(np.mean(model.predict_proba(x)[:, 1]))
    except Exception:
        logger.exception("Logistic regression training failed.")
        return 0.0


def compute_adaptive_boost(
    doc_count: int,
    completion_rate: float,
    overrun_ratio: float,
    ml_risk_score: float,
) -> float:
    base = 0.0
    if doc_count >= 5:
        if completion_rate >= 0.8:
            base -= 1.0
        elif completion_rate <= 0.4:
            base += 1.5

        if overrun_ratio > 1.2:
            base += 0.5
        elif overrun_ratio < 0.8:
            base -= 0.3

    ml_part = (ml_risk_score - 0.5) * 4.0
    adaptive = max(-3.0, min(3.0, base + ml_part))
    return float(round(adaptive, 2))


def evaluate_history(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    dataset = build_dataset(items)
    x = dataset["X"]
    y = dataset["y"]

    risk_xgb = _train_xgb_risk(x, y)
    risk_lr = _train_lr_risk(x, y)

    model_count = 1 if risk_lr > 0 or (x is not None and y is not None and x.shape[0] >= 5 and len(np.unique(y)) >= 2) else 0
    if XGBClassifier is not None and x is not None and y is not None and x.shape[0] >= 5 and len(np.unique(y)) >= 2:
        model_count += 1

    ml_risk_score = (risk_xgb + risk_lr) / model_count if model_count > 0 else 0.0
    adaptive_boost = compute_adaptive_boost(
        doc_count=dataset["docCount"],
        completion_rate=dataset["completion_rate"],
        overrun_ratio=dataset["overrun_ratio"],
        ml_risk_score=ml_risk_score,
    )
    suggest_split = dataset["total_missed"] >= 3 and dataset["docCount"] >= 2
    prevent_new_tasks = False

    explanation = (
        f"docCount={dataset['docCount']}, completed={dataset['total_completed']}, "
        f"missed={dataset['total_missed']}, completion_rate={dataset['completion_rate']:.2f}, "
        f"overrun_ratio={dataset['overrun_ratio']:.2f}, risk_xgb={risk_xgb:.2f}, "
        f"risk_lr={risk_lr:.2f}, mlRiskScore={ml_risk_score:.2f}, adaptiveBoost={adaptive_boost:.2f}"
    )

    return {
        "docCount": dataset["docCount"],
        "total_completed": dataset["total_completed"],
        "total_missed": dataset["total_missed"],
        "completion_rate": dataset["completion_rate"],
        "overrun_ratio": dataset["overrun_ratio"],
        "adaptiveBoost": adaptive_boost,
        "mlRiskScore": ml_risk_score,
        "suggestSplit": suggest_split,
        "preventNewTasks": prevent_new_tasks,
        "explanation": explanation,
    }
