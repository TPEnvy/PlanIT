# main.py
import os
import json
import asyncio
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import firebase_admin
from firebase_admin import credentials, firestore
from dotenv import load_dotenv
import logging
from concurrent.futures import ThreadPoolExecutor

load_dotenv()

logger = logging.getLogger("planit-ml")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# Globals for Firestore client
_db = None
_executor = ThreadPoolExecutor(max_workers=1)

# FastAPI app

app = FastAPI(title="PlanIT ML API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Pydantic models

class HistoricalItem(BaseModel):
    completedCount: Optional[int] = 0
    missedCount: Optional[int] = 0
    estimatedMinutes: Optional[int] = None
    actualMinutes: Optional[int] = None

class PredictRequest(BaseModel):
    title: str
    historical: Optional[List[HistoricalItem]] = None
    userId: Optional[str] = None

class PredictResponse(BaseModel):
    normalizedTitle: str
    docCount: int
    total_completed: int
    total_missed: int
    completion_rate: float
    overrun_ratio: float
    adaptiveBoost: float
    suggestSplit: bool
    preventNewTasks: bool
    explanation: Optional[str] = None


# Firebase initialization helpers

def _init_firebase_sync() -> None:

    global _db
    SERVICE_ACCOUNT_PATH = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    SERVICE_ACCOUNT_JSON = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
    FIRESTORE_PROJECT = os.getenv("FIRESTORE_PROJECT")

    if firebase_admin._apps:
        logger.info("Firebase already initialized.")
    else:
        logger.info("Initializing Firebase Admin SDK...")
        if SERVICE_ACCOUNT_PATH and os.path.exists(SERVICE_ACCOUNT_PATH):
            cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
            firebase_admin.initialize_app(cred, {"projectId": FIRESTORE_PROJECT} if FIRESTORE_PROJECT else None)
            logger.info("Initialized Firebase from service account path.")
        elif SERVICE_ACCOUNT_JSON:
            service_dict = json.loads(SERVICE_ACCOUNT_JSON)
            cred = credentials.Certificate(service_dict)
            firebase_admin.initialize_app(cred, {"projectId": FIRESTORE_PROJECT} if FIRESTORE_PROJECT else None)
            logger.info("Initialized Firebase from SERVICE_ACCOUNT_JSON env var.")
        else:
            # Try Application Default Credentials (ADC)
            logger.info("Attempting Application Default Credentials...")
            cred = credentials.ApplicationDefault()
            firebase_admin.initialize_app(cred, {"projectId": FIRESTORE_PROJECT} if FIRESTORE_PROJECT else None)
            logger.info("Initialized Firebase using Application Default Credentials (ADC).")

    # create client
    _db = firestore.client()
    logger.info("Firestore client ready.")

async def init_firebase_async():
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(_executor, _init_firebase_sync)
    except Exception as e:
        logger.exception("Firebase initialization failed: %s", e)
        raise

@app.on_event("startup")
async def on_startup():
    logger.info("PlanIT ML API startup — initializing services...")
    try:
        await init_firebase_async()
        logger.info("Startup complete.")
    except Exception as e:
        logger.exception("Startup failed: %s", e)
        # Reraise so uvicorn logs a failure and aborts startup
        raise

@app.on_event("shutdown")
async def on_shutdown():
    logger.info("PlanIT ML API shutting down.")
    _executor.shutdown(wait=False)


# Utility functions

def normalize_title(title: str) -> str:
    if not isinstance(title, str):
        return ""
    return " ".join(title.strip().lower().split())

def compute_from_history_items(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    docCount = len(items)
    total_completed = sum(int(i.get("completedCount", 0) or 0) for i in items)
    total_missed = sum(int(i.get("missedCount", 0) or 0) for i in items)
    total_est = sum(int(i.get("estimatedMinutes", 0) or 0) for i in items)
    total_act = sum(int(i.get("actualMinutes", 0) or 0) for i in items)

    denom = total_completed + total_missed
    completion_rate = (total_completed / denom) if denom > 0 else 0.0

    if total_est > 0:
        overrun_ratio = (total_act / total_est) if total_act > 0 else 1.0
    else:
        overrun_ratio = 1.0 if total_act == 0 else float(total_act)

    adaptiveBoost = 0.0
    MIN_DOCS_FOR_LEARNING = 5
    if docCount >= MIN_DOCS_FOR_LEARNING:
        if completion_rate >= 0.8:
            adaptiveBoost = -1.0
        elif completion_rate <= 0.4:
            adaptiveBoost = 1.5
        else:
            adaptiveBoost = 0.0
    else:
        adaptiveBoost = 0.0

    MIN_MISSES_TO_SUGGEST_SPLIT = 3
    suggestSplit = total_missed >= MIN_MISSES_TO_SUGGEST_SPLIT and docCount >= 2
    preventNewTasks = False

    explanation = f"docCount={docCount}, completed={total_completed}, missed={total_missed}, completion_rate={completion_rate:.2f}"

    return {
        "docCount": docCount,
        "total_completed": total_completed,
        "total_missed": total_missed,
        "completion_rate": completion_rate,
        "overrun_ratio": overrun_ratio,
        "adaptiveBoost": adaptiveBoost,
        "suggestSplit": suggestSplit,
        "preventNewTasks": preventNewTasks,
        "explanation": explanation,
    }

def aggregate_tasks_for_normalized(userId: str, normalizedTitle: str) -> List[Dict[str, Any]]:
    global _db
    if _db is None:
        raise RuntimeError("Firestore client not initialized.")
    tasks_ref = _db.collection(f"users/{userId}/tasks")
    q = tasks_ref.where("normalizedTitle", "==", normalizedTitle)
    docs = q.stream()
    items = []
    for d in docs:
        data = d.to_dict() or {}
        items.append({
            "completedCount": int(data.get("completedCount", 0) or 0),
            "missedCount": int(data.get("missedCount", 0) or 0),
            "estimatedMinutes": int(data.get("estimatedMinutes")) if data.get("estimatedMinutes") is not None else 0,
            "actualMinutes": int(data.get("totalActualMinutes", 0) or 0),
        })
    return items

def detect_split_parent(userId: str, normalizedTitle: str) -> bool:
    global _db
    if _db is None:
        return False
    try:
        tasks_ref = _db.collection(f"users/{userId}/tasks")
        q = tasks_ref.where("normalizedTitle", "==", normalizedTitle).where("isSplitParent", "==", True).limit(1)
        docs = list(q.stream())
        return len(docs) > 0
    except Exception:
        logger.exception("detect_split_parent error")
        return False

# Endpoints
@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest):
    title = (req.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")

    normalized = normalize_title(title)

    # If historical provided use it
    if req.historical is not None and len(req.historical) > 0:
        hist_items = [h.dict() if hasattr(h, "dict") else dict(h) for h in req.historical]
    else:
        # If no historical array and userId provided, fetch from Firestore
        if req.userId:
            try:
                hist_items = await asyncio.get_running_loop().run_in_executor(_executor, aggregate_tasks_for_normalized, req.userId, normalized)
            except Exception as e:
                logger.exception("Failed to aggregate tasks from Firestore: %s", e)
                raise HTTPException(status_code=500, detail="Failed to read tasks for user")
        else:
            hist_items = []

    pattern = compute_from_history_items(hist_items)
    pattern["normalizedTitle"] = normalized

    if req.userId:
        found_split_parent = await asyncio.get_running_loop().run_in_executor(_executor, detect_split_parent, req.userId, normalized)
        if found_split_parent and pattern.get("suggestSplit"):
            pattern["preventNewTasks"] = True
        # upsert pattern doc (non-blocking write via executor)
        pattern_ref = _db.document(f"users/{req.userId}/patterns/{normalized}")
        to_write = {
            "normalizedTitle": normalized,
            "docCount": int(pattern["docCount"]),
            "total_completed": int(pattern["total_completed"]),
            "total_missed": int(pattern["total_missed"]),
            "completion_rate": float(pattern["completion_rate"]),
            "overrun_ratio": float(pattern["overrun_ratio"]),
            "adaptiveBoost": float(pattern["adaptiveBoost"]),
            "suggestSplit": bool(pattern["suggestSplit"]),
            "preventNewTasks": bool(pattern["preventNewTasks"]),
            "explanation": pattern.get("explanation", ""),
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
        try:
            await asyncio.get_running_loop().run_in_executor(_executor, pattern_ref.set, to_write, True)
        except Exception:
            logger.exception("Failed to write pattern doc, continuing")

    # return summary
    return {
        "normalizedTitle": pattern["normalizedTitle"],
        "docCount": int(pattern["docCount"]),
        "total_completed": int(pattern["total_completed"]),
        "total_missed": int(pattern["total_missed"]),
        "completion_rate": float(pattern["completion_rate"]),
        "overrun_ratio": float(pattern["overrun_ratio"]),
        "adaptiveBoost": float(pattern["adaptiveBoost"]),
        "suggestSplit": bool(pattern["suggestSplit"]),
        "preventNewTasks": bool(pattern["preventNewTasks"]),
        "explanation": pattern.get("explanation", ""),
    }

@app.get("/health")
def health():
    return {"ok": True}
