"""
Backend entry point. Run with:
    uvicorn main:app --reload --port 8000

This file only wires the pieces together - the logic lives in
canary.py / queue_manager.py / trust.py so each concern stays swappable.
See README.md for the full API contract each teammate integrates against.
"""

import time
from typing import Any, Dict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import config
from canary import CanaryGenerator
from models import EntryStatus
from queue_manager import ReviewQueue
from trust import TrustTracker

app = FastAPI(title="Fatigue-Aware Review Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # hackathon-only; lock this down for anything real
    allow_methods=["*"],
    allow_headers=["*"],
)

canary_gen = CanaryGenerator()
queue = ReviewQueue(canary_gen)
trust = TrustTracker()
decision_log = []


class SubmitRequest(BaseModel):
    data: Dict[str, Any]     # raw form fields, any schema the form team uses
    confidence: float         # 0..1, computed by the Adaptive Form


class ReviewRequest(BaseModel):
    decision: str              # "approve" | "reject"


class AlertnessRequest(BaseModel):
    score: float                # 0..1, from whichever alertness signal you end up shipping


# ---- Adaptive Form -> Backend ----

@app.post("/submit")
def submit_entry(req: SubmitRequest):
    if not 0.0 <= req.confidence <= 1.0:
        raise HTTPException(400, "confidence must be between 0 and 1")
    entry = queue.submit(req.data, req.confidence)
    return {
        "id": entry.id,
        "status": entry.status.value,
        "auto_accepted": entry.status == EntryStatus.AUTO_ACCEPTED,
    }


# ---- CV / click-timing module -> Backend ----

@app.post("/alertness")
def push_alertness(req: AlertnessRequest):
    trust.update_alertness(req.score)
    return {"trust": round(trust.trust, 3), "low_trust": trust.is_low}


# ---- Dashboard -> Backend ----

@app.get("/queue")
def get_queue():
    # is_canary / source_entry_id are deliberately stripped: the reviewer
    # must never be able to tell a canary from a real entry.
    return [
        {"id": e.id, "data": e.data, "confidence": round(e.confidence, 3)}
        for e in queue.pending()
    ]


@app.post("/review/{entry_id}")
def review_entry(entry_id: str, req: ReviewRequest):
    entry = queue.get(entry_id)
    if entry is None or entry.status != EntryStatus.PENDING:
        raise HTTPException(404, "entry not found or already resolved")
    if req.decision not in ("approve", "reject"):
        raise HTTPException(400, "decision must be 'approve' or 'reject'")

    entry.status = EntryStatus.APPROVED if req.decision == "approve" else EntryStatus.REJECTED
    entry.decided_at = time.time()

    caught = None
    if entry.is_canary:
        caught = req.decision == "reject"  # correct move on a fake entry is to reject it
        entry.decision_correct = caught
        trust.record_canary_result(caught, canary_id=entry.id)

    decision_log.append({
        "entry_id": entry.id,
        "decision": req.decision,
        "is_canary": entry.is_canary,
        "canary_caught": caught,
        "ts": entry.decided_at,
    })

    response = {"id": entry.id, "status": entry.status.value, "trust": round(trust.trust, 3)}
    if entry.is_canary:
        response["was_canary"] = True
        response["caught"] = caught
    return response


@app.get("/trust")
def get_trust():
    return {
        "trust": round(trust.trust, 3),
        "low_trust": trust.is_low,
        "friction": {
            "freeze_buttons": trust.is_low,
            "require_written_confirmation": trust.is_low,
        },
    }


@app.get("/stats")
def get_stats():
    canaries = [d for d in decision_log if d["is_canary"]]
    return {
        "reviewed": len(decision_log),
        "canaries_shown": len(canaries),
        "canaries_caught": sum(1 for d in canaries if d["canary_caught"]),
        "canaries_missed": sum(1 for d in canaries if d["canary_caught"] is False),
    }
