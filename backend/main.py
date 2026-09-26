import json
import math
import os
import re
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import urlparse
from uuid import uuid4


REVIEW_THRESHOLD = 90
TRUST_THRESHOLD = 60
CAMERA_READING_TTL_SECONDS = 15
RECOVERY_DELAY_SECONDS = 8
CONFIRMATION_MIN_LENGTH = 12
SIGNAL_MODE = os.environ.get("CARNIVAL_SIGNAL_MODE", "auto").strip().lower()
if SIGNAL_MODE not in ("auto", "click"):
    SIGNAL_MODE = "auto"
MAX_REQUEST_BYTES = 1_000_000
patients = []
alertness_readings = []
queue_entries = []
review_stats = {"reviewed": 0, "caught": 0, "missed": 0}
click_samples = []
decision_log = []
canary_performance = 100.0
fatigue_latched = False
recovery_delay_until = 0.0
confirmation_required = False
state_lock = Lock()
DASHBOARD_PATH = Path(__file__).resolve().parent.parent / "logic-and-dashboard" / "index.html"


def utc_now():
    return datetime.now(timezone.utc).isoformat()


LOCALE_REQUIRED_FIELDS = {
    "UAE": ("fullName", "emiratesId", "phone", "dateOfBirth", "language"),
    "UK": ("fullName", "nhsNumber", "postcode", "phone", "dateOfBirth"),
    "US": ("fullName", "state", "zipCode", "phone", "dateOfBirth"),
    "India": ("fullName", "aadhaar", "state", "phone", "dateOfBirth"),
}


def is_valid_pattern(field, value):
    if field == "emiratesId":
        return re.fullmatch(r"\d{15}", value.replace("-", "")) is not None
    if field == "nhsNumber":
        return re.fullmatch(r"\d{10}", re.sub(r"\s", "", value)) is not None
    if field == "aadhaar":
        return re.fullmatch(r"\d{12}", re.sub(r"\s", "", value)) is not None
    if field == "zipCode":
        return re.fullmatch(r"\d{5}", value) is not None
    if field == "postcode":
        return re.fullmatch(r"(?:GIR 0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})", value.upper()) is not None
    if field == "phone":
        return (
            re.fullmatch(r"\+?[\d\s()-]{7,20}", value) is not None
            and len(re.sub(r"\D", "", value)) >= 7
        )
    if field == "dateOfBirth":
        return re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) is not None
    return True


def calculate_structure_confidence(country, intake):
    required_fields = LOCALE_REQUIRED_FIELDS.get(country, ())
    deviations = 0
    for field in required_fields:
        value = str(intake.get(field, "")).strip()
        if not value:
            deviations += 1
        elif not is_valid_pattern(field, value):
            deviations += 1
    return max(0, 100 - deviations * 15)


def make_canary(source):
    intake = dict(source.get("intake", {}))
    trap_fields = {
        "UAE": ("emiratesId", "phone", "dateOfBirth"),
        "UK": ("nhsNumber", "postcode", "phone", "dateOfBirth"),
        "US": ("zipCode", "phone", "dateOfBirth"),
        "India": ("aadhaar", "phone", "dateOfBirth"),
    }
    trap_field = None
    for field in trap_fields.get(source.get("country"), ("phone",)):
        original = str(intake.get(field, "")).strip()
        if not original or not is_valid_pattern(field, original):
            continue
        if field == "postcode":
            inward_start = original.rfind(" ") + 1 if " " in original else max(0, len(original) - 3)
            mutated = original[:inward_start] + "O" + original[inward_start + 1:]
        else:
            last_digit = max((index for index, char in enumerate(original) if char.isdigit()), default=-1)
            if last_digit < 0:
                continue
            mutated = original[:last_digit] + "O" + original[last_digit + 1:]
        if is_valid_pattern(field, mutated):
            continue
        intake[field] = mutated
        trap_field = field
        break

    name_parts = source["name"].split()
    canary_name = f"{name_parts[0][0]}. {' '.join(name_parts[1:])}" if len(name_parts) > 1 else source["name"]
    if canary_name == source["name"]:
        canary_name = f"{canary_name} II"
    intake["fullName"] = canary_name
    return {
        "id": str(uuid4()),
        "name": canary_name,
        "country": source.get("country", ""),
        "reason": source.get("reason", ""),
        "priority": source.get("priority", "Routine"),
        "confidence": calculate_structure_confidence(source.get("country", ""), intake),
        "createdAt": utc_now(),
        "intake": intake,
        "status": "pending",
        "is_canary": True,
        "sourceEntryId": source["id"],
        "mutatedField": trap_field,
    }


def maybe_inject_canary(source):
    low_confidence = [
        entry for entry in queue_entries
        if entry["status"] == "pending"
        and not entry["is_canary"]
        and entry["confidence"] <= REVIEW_THRESHOLD
    ]
    if not low_confidence:
        return False

    average_confidence = sum(entry["confidence"] for entry in low_confidence) / len(low_confidence)
    queue_pressure = min(1.0, len(low_confidence) / 5)
    ambiguity = max(0.0, min(1.0, (REVIEW_THRESHOLD - average_confidence + 10) / 50))
    target_canaries = max(1, math.ceil(len(low_confidence) * (0.1 + 0.9 * queue_pressure * ambiguity)))
    pending_canaries = sum(
        entry["status"] == "pending" and entry["is_canary"]
        for entry in queue_entries
    )
    if pending_canaries >= target_canaries:
        return False

    queue_entries.insert(0, make_canary(source))
    return True


def click_timing_score_locked():
    recent = click_samples[-8:]
    if not recent:
        return 100.0

    elapsed = [sample["elapsedMs"] for sample in recent]
    speed_scores = [max(55.0, 100.0 - max(0, 1200 - value) / 1200 * 45) for value in elapsed]
    intervals = [sample["intervalMs"] for sample in recent if sample["intervalMs"] is not None]
    rhythm_score = 100.0
    if len(intervals) >= 2:
        average = sum(intervals) / len(intervals)
        deviation = math.sqrt(sum((value - average) ** 2 for value in intervals) / len(intervals))
        irregularity = deviation / average if average else 1.5
        cadence_penalty = max(0.0, 1000 - average) / 1000 * 25
        rhythm_score = max(45.0, 100.0 - min(55.0, irregularity * 30 + cadence_penalty))
    return round(sum(speed_scores) / len(speed_scores) * 0.65 + rhythm_score * 0.35, 1)


def calculate_trust_locked():
    global fatigue_latched, recovery_delay_until, confirmation_required
    now = datetime.now(timezone.utc).timestamp()
    latest = alertness_readings[-1] if alertness_readings else None
    camera_is_fresh = bool(
        SIGNAL_MODE == "auto"
        and latest
        and now - latest["timestamp"] <= CAMERA_READING_TTL_SECONDS
    )
    click_score = click_timing_score_locked()
    camera_score = latest["score"] if camera_is_fresh else None
    alertness = camera_score if camera_score is not None else click_score
    if SIGNAL_MODE == "click":
        trust_score = click_score * 0.85 + canary_performance * 0.15
        source = "click-timing locked"
    elif camera_score is None:
        trust_score = click_score * 0.85 + canary_performance * 0.15
        source = "click-timing fallback"
    else:
        trust_score = camera_score * 0.75 + click_score * 0.1 + canary_performance * 0.15
        source = "camera + click timing"

    trust_score = round(trust_score, 1)
    fatigue_detected = trust_score < TRUST_THRESHOLD
    if fatigue_detected:
        if not fatigue_latched:
            confirmation_required = True
            recovery_delay_until = 0.0
        fatigue_latched = True
    elif fatigue_latched:
        fatigue_latched = False
        recovery_delay_until = now + RECOVERY_DELAY_SECONDS

    cooldown = max(0, math.ceil(recovery_delay_until - now))
    return {
        "trust": trust_score,
        "alertness": round(alertness, 1),
        "cameraAlertness": round(camera_score, 1) if camera_score is not None else None,
        "clickTiming": click_score,
        "canaryPerformance": round(canary_performance, 1),
        "mode": SIGNAL_MODE,
        "source": source,
        "fatigueDetected": fatigue_detected,
        "threshold": TRUST_THRESHOLD,
        "frictionSeconds": cooldown,
        "confirmationRequired": confirmation_required,
        "decisionLocked": fatigue_detected or cooldown > 0 or confirmation_required,
        "updatedAt": latest["createdAt"] if latest else None,
    }


class HospitalApiHandler(BaseHTTPRequestHandler):
    server_version = "VigilHospitalAPI/1.0"

    def _send_json(self, status, payload):
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(encoded)

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None, "Invalid content length"
        if length <= 0 or length > MAX_REQUEST_BYTES:
            return None, "Request body must be between 1 byte and 1 MB"
        try:
            return json.loads(self.rfile.read(length)), None
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None, "Request body must be valid JSON"

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/logic-and-dashboard", "/logic-and-dashboard/"):
            try:
                page = DASHBOARD_PATH.read_bytes()
            except OSError:
                self._send_json(404, {"error": "Logic dashboard not found"})
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(page)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(page)
            return
        if path == "/api/health":
            self._send_json(200, {"status": "ok", "mode": "local-demo"})
            return
        if path == "/api/patients":
            with state_lock:
                self._send_json(200, {"patients": list(patients)})
            return
        if path == "/queue":
            public_fields = ("id", "name", "country", "reason", "priority", "confidence", "createdAt", "intake")
            with state_lock:
                queue = [
                    {field: entry[field] for field in public_fields}
                    for entry in queue_entries
                    if entry["status"] == "pending"
                ]
            self._send_json(200, {"queue": queue})
            return
        if path == "/trust":
            with state_lock:
                snapshot = calculate_trust_locked()
            self._send_json(200, snapshot)
            return
        if path == "/stats":
            with state_lock:
                self._send_json(200, dict(review_stats))
            return
        if path in ("/api/alertness", "/alertness"):
            with state_lock:
                self._send_json(200, {"readings": list(alertness_readings[-200:])})
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        global canary_performance, confirmation_required
        path = urlparse(self.path).path
        payload, error = self._read_json()
        if error:
            self._send_json(400, {"error": error})
            return
        if not isinstance(payload, dict):
            self._send_json(400, {"error": "Request body must be a JSON object"})
            return

        if path.startswith("/review/"):
            entry_id = path[len("/review/"):]
            decision = payload.get("decision")
            if not entry_id or "/" in entry_id:
                self._send_json(404, {"error": "Queue entry not found"})
                return
            if decision not in ("approve", "reject"):
                self._send_json(400, {"error": "Decision must be approve or reject"})
                return
            confirmation = str(payload.get("confirmation", "")).strip()
            with state_lock:
                trust_state = calculate_trust_locked()
                if trust_state["fatigueDetected"]:
                    self._send_json(423, {
                        "error": "Fatigue detected. Reviews are paused until trust recovers.",
                        "trust": trust_state["trust"],
                        "retryAfterSeconds": 0,
                    })
                    return
                if trust_state["frictionSeconds"] > 0:
                    self._send_json(423, {
                        "error": "Recovery pause. Please wait before reviewing.",
                        "trust": trust_state["trust"],
                        "retryAfterSeconds": trust_state["frictionSeconds"],
                    })
                    return
                if confirmation_required and len(confirmation) < CONFIRMATION_MIN_LENGTH:
                    self._send_json(428, {
                        "error": f"Add a written confirmation of at least {CONFIRMATION_MIN_LENGTH} characters to resume reviewing.",
                        "confirmationRequired": True,
                    })
                    return
                entry = next((item for item in queue_entries if item["id"] == entry_id), None)
                if entry is None:
                    self._send_json(404, {"error": "Queue entry not found"})
                    return
                if entry["status"] != "pending":
                    self._send_json(409, {"error": "Queue entry has already been reviewed"})
                    return
                entry["status"] = "resolved"
                entry["decision"] = decision
                entry["reviewedAt"] = utc_now()
                review_stats["reviewed"] += 1
                outcome = None
                if entry["is_canary"]:
                    outcome = "caught" if decision == "reject" else "missed"
                    review_stats[outcome] += 1
                    canary_performance = max(0.0, min(100.0, canary_performance + (20.0 if outcome == "caught" else -35.0)))
                try:
                    elapsed_ms = max(0, min(300_000, int(payload.get("elapsedMs", 1800))))
                    interval_value = payload.get("intervalMs")
                    interval_ms = None if interval_value is None else max(0, min(300_000, int(interval_value)))
                except (TypeError, ValueError):
                    elapsed_ms = 1800
                    interval_ms = None
                click_samples.append({"elapsedMs": elapsed_ms, "intervalMs": interval_ms})
                del click_samples[:-20]
                decision_log.append({
                    "id": entry_id,
                    "decision": decision,
                    "outcome": outcome,
                    "confidence": entry["confidence"],
                    "reviewedAt": entry["reviewedAt"],
                    "confirmation": confirmation if confirmation_required else None,
                })
                del decision_log[:-1000]
                confirmation_required = False
            message = (
                "Canary caught" if outcome == "caught"
                else "Canary missed" if outcome == "missed"
                else "Entry approved" if decision == "approve"
                else "Entry rejected"
            )
            self._send_json(200, {
                "id": entry_id,
                "decision": decision,
                "outcome": outcome,
                "message": message,
            })
            return

        if path == "/api/patients":
            name = str(payload.get("name", "")).strip()
            if not name:
                self._send_json(400, {"error": "Patient name is required"})
                return
            if len(name) > 120:
                self._send_json(400, {"error": "Patient name must be 120 characters or fewer"})
                return
            country = str(payload.get("country", ""))
            if country not in LOCALE_REQUIRED_FIELDS:
                self._send_json(400, {"error": "Select a supported patient background"})
                return
            try:
                deviations = int(payload.get("deviations", 0))
            except (TypeError, ValueError):
                self._send_json(400, {"error": "Deviations must be an integer"})
                return
            if deviations < 0 or deviations > 100:
                self._send_json(400, {"error": "Deviations must be between 0 and 100"})
                return
            intake = payload.get("intake", {})
            if not isinstance(intake, dict):
                self._send_json(400, {"error": "Intake details must be an object"})
                return
            intake = {
                str(key)[:50]: str(value)[:500]
                for key, value in intake.items()
                if isinstance(value, (str, int, float, bool))
            }
            confidence = calculate_structure_confidence(country, intake)
            deviations = (100 - confidence) // 15
            priority = str(payload.get("priority", "Routine"))
            if priority not in ("Routine", "Same day", "Urgent"):
                self._send_json(400, {"error": "Priority must be Routine, Same day, or Urgent"})
                return
            patient = {
                "id": str(uuid4()),
                "name": name,
                "country": country,
                "dateOfBirth": str(payload.get("dateOfBirth", ""))[:20],
                "phone": str(payload.get("phone", ""))[:40],
                "reason": str(payload.get("reason", ""))[:500],
                "priority": priority,
                "confidence": confidence,
                "deviations": deviations,
                "reviewRequired": confidence <= REVIEW_THRESHOLD,
                "routing": "human-review" if confidence <= REVIEW_THRESHOLD else "auto-accepted",
                "intake": intake,
                "createdAt": utc_now(),
            }
            with state_lock:
                patients.insert(0, patient)
                del patients[500:]
                if patient["reviewRequired"]:
                    real_entry = {
                        "id": patient["id"],
                        "name": patient["name"],
                        "country": patient["country"],
                        "reason": patient["reason"],
                        "priority": patient["priority"],
                        "confidence": patient["confidence"],
                        "createdAt": patient["createdAt"],
                        "intake": patient["intake"],
                        "patientId": patient["id"],
                        "status": "pending",
                        "is_canary": False,
                    }
                    queue_entries.insert(0, real_entry)
                    maybe_inject_canary(real_entry)
                    del queue_entries[500:]
            self._send_json(201, {"patient": patient, "routing": patient["routing"]})
            return

        if path in ("/api/alertness", "/alertness"):
            try:
                score = float(payload.get("score"))
            except (TypeError, ValueError):
                self._send_json(400, {"error": "Score must be a number between 0 and 1"})
                return
            if not math.isfinite(score) or not 0 <= score <= 1:
                self._send_json(400, {"error": "Score must be a number between 0 and 1"})
                return
            reading = {
                "id": str(uuid4()),
                "score": round(score * 100, 1),
                "blinkCount": payload.get("blinkCount"),
                "longClosure": bool(payload.get("longClosure", False)),
                "patientId": payload.get("patientId"),
                "createdAt": utc_now(),
                "timestamp": datetime.now(timezone.utc).timestamp(),
            }
            with state_lock:
                alertness_readings.append(reading)
                del alertness_readings[:-1000]
            self._send_json(201, {"reading": reading})
            return

        self._send_json(404, {"error": "Not found"})

    def log_message(self, format_string, *args):
        print(f"{self.log_date_time_string()} {self.address_string()} {format_string % args}")


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8000), HospitalApiHandler)
    print("Vigil local API is running at http://127.0.0.1:8000")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping the local API")
    finally:
        server.server_close()