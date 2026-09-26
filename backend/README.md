# Backend — Fatigue-Aware Review System

## Run it

```
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Docs auto-generate at `http://localhost:8000/docs` — hand that link to
whoever's building the form/dashboard/CV pieces so they can test against
you without reading this file line by line.

## Why it's built this way

You don't control the other three pieces (form fields, webcam pipeline,
dashboard styling), and all of that will keep changing until the demo.
So the backend is deliberately dumb about everything except the *shape*
of the messages it gets. As long as each teammate hits the right endpoint
with the right shape, they can rewrite their internals as much as they want.

## How the four pieces interlink

```
Adaptive Form              Backend                    CV Module
  builds a form    --data+confidence-->  routes:
  field-by-field                          conf >= 0.8 -> auto-accept
                                           conf <  0.8 -> queue
                                              |
                                     injects canaries into the
                                     queue (rate rises as the
                                     queue fills with hard cases)     --score-->  alertness score
                                              |                                    (blink EAR or
                                              v                                    click-timing)
                                        Dashboard <--queue-- 
                                        reviewer approves/rejects
                                              |
                                     canary caught/missed  ---+
                                     alertness score      ----+--> trust score
                                              |
                                        trust low -> friction
                                        (freeze buttons dashboard-side,
                                         backend just reports the flag)
```

The backend is the only piece that has to know about *all four* other
pieces; that's the point of you owning it.

## API contract (what each teammate needs to hit)

### Form team → `POST /submit`
```json
{ "data": { "...anything...": "..." }, "confidence": 0.42 }
```
`data` can be any JSON object — the backend never reads specific field
names, so the form team can change their schema at any time.
Response:
```json
{ "id": "...", "status": "pending" | "auto_accepted", "auto_accepted": bool }
```

### CV team → `POST /alertness`
```json
{ "score": 0.73 }
```
`score` is 0–1, "how alert right now." Send it however often makes sense
(the code polls, it doesn't need sockets). The backend doesn't care whether
this number comes from blink tracking or the click-timing fallback — it's
just a float, so you can swap the source without touching this contract.

### Dashboard team → `GET /queue`, `POST /review/{id}`, `GET /trust`, `GET /stats`
- `GET /queue` — list of `{id, data, confidence}`. Canary flags are
  stripped on purpose; the dashboard should never be able to tell which
  entries are fake, or the whole test is pointless.
- `POST /review/{id}` with `{"decision": "approve" | "reject"}` (single-reviewer
  demo, so no reviewer ID needed) — returns
  `was_canary` + `caught` *after* the decision is made, so the dashboard
  can flash "canary caught!" / "canary missed" without knowing in advance.
- `GET /trust` — current trust score + a `friction` object
  (`freeze_buttons`, `require_written_confirmation`) the dashboard should
  act on.
- `GET /stats` — running counters for reviewed / caught / missed.

## Making it more realistic (optional, if you have time)

Right now canary mutations are generic (type-based: flip a bool, jitter a
number, swap two characters in a string). If you know the form's real
field names by then, register smarter mutators without touching any other
file:

```python
from main import canary_gen

canary_gen.register_mutator("date_of_birth", lambda v: v[:-1] + "9")
canary_gen.register_mutator("national_id", lambda v: v[:-2] + v[-2:][::-1])
```

## Config

All thresholds (auto-accept cutoff, canary injection rate, trust weights,
low-trust threshold) live in `config.py` — tune those live during the demo
instead of touching logic.

## Known hackathon shortcuts

- Storage is in-memory (`dict`/`list`) — restarting the server wipes
  everything. Fine for a demo; swap in a real DB only if you have spare time.
- CORS is wide open (`allow_origins=["*"]`) — fine for localhost, not for
  anything real.
- No auth on any endpoint.
