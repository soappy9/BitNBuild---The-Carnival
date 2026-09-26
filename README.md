# Vigil

Vigil is a local hospital operations demo with a country-aware patient intake flow, a human-review queue, and a webcam fatigue estimate for care teams.

## Run locally

Requirements: Python 3.12+, Node.js 20.19+ or 22.12+, and a webcam for the fatigue monitor.

1. Create the Python environment if needed:

	```powershell
	python -m venv Fatigue-CV\venv
	```

2. Start the local API from the project root:

	```powershell
	Fatigue-CV\venv\Scripts\python.exe backend\main.py
	```

3. In a second terminal, install and start the frontend:

	```powershell
	cd frontend
	npm install
	npm run dev
	```

4. Open the local URL printed by Vite. The app requests camera permission on startup; if allowed, monitoring stays active across pages until you stop it or leave the site. If permission is denied, the click-timing fallback remains available. Video frames stay in the browser; only score summaries are posted to the local service.

The **Logic & dashboard** view is part of the main React page and reuses the live queue, trust, and decision state without replacing the dashboard shell. Switching to it does not stop the camera session. The standalone source page is in `logic-and-dashboard/index.html`. When alertness drops below 80%, an optional 20-second refocus prompt appears; it does not change the score or bypass review friction.

## Review workflow

High-confidence intake submissions are auto-accepted; low-confidence entries enter the in-memory review queue. As the number and ambiguity of pending low-confidence entries rise, the API deterministically increases the target canary count by mutating locale-specific fields from those submissions.

The review page polls `GET /queue`, `GET /trust`, and `GET /stats` every two seconds. Decisions use `POST /review/{id}` with `{"decision":"approve"}` or `{"decision":"reject"}`. In the default `CARNIVAL_SIGNAL_MODE=auto`, fresh camera alertness is combined with click speed/rhythm and recent canary performance; stale or unavailable camera readings fall back to click timing. At the CV checkpoint, restart the API with `CARNIVAL_SIGNAL_MODE=click` to lock in the timing fallback. If trust falls below 60%, the API and UI freeze decisions. After recovery, an eight-second pause and a written confirmation (at least 12 characters) are required before review resumes. Decision responses flash whether a canary was caught or missed, and stats count reviewed, caught, and missed entries.

Canary identity and source links are stored only on the server and deliberately omitted from `GET /queue`. Reviewers can inspect the same submitted locale fields for every queue item, but receive no canary marker.

## Demo boundaries

Patient entries and fatigue readings are held in API process memory and are cleared when the service restarts. The intake confidence score checks form structure and common identifier formats; it does not validate clinical information. Fatigue estimates are experimental decision support and are not a diagnosis. This demo has no authentication, access controls, encryption, or clinical-system integration; do not enter real patient information or use it for care decisions.
