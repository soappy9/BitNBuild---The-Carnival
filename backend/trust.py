"""
Combines two independent signals into one trust score:
  - canary_trust: "hard evidence" - did the reviewer catch or miss traps?
  - latest_alertness: "leading indicator" - live blink/click-rhythm score from CV

Either signal alone is noisy (one weak signal shouldn't trigger friction).
Both dropping together is what should trip the escalation.
"""

import time
from typing import List, Optional

import config


class TrustTracker:
    def __init__(self):
        self.canary_trust: float = 1.0
        self.latest_alertness: float = 1.0
        self.history: List[dict] = []

    def update_alertness(self, score: float) -> None:
        self.latest_alertness = max(0.0, min(1.0, score))

    def record_canary_result(self, caught: bool, canary_id: Optional[str] = None) -> None:
        if caught:
            self.canary_trust = min(1.0, self.canary_trust + config.TRUST_RECOVERY_ON_CATCH)
        else:
            self.canary_trust = max(0.0, self.canary_trust - config.TRUST_PENALTY_ON_MISS)
        self.history.append({"canary_id": canary_id, "caught": caught, "ts": time.time()})

    @property
    def trust(self) -> float:
        return (
            config.CANARY_WEIGHT * self.canary_trust
            + config.ALERTNESS_WEIGHT * self.latest_alertness
        )

    @property
    def is_low(self) -> bool:
        return self.trust < config.TRUST_LOW_THRESHOLD
