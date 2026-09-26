"""
Routing + queue. High confidence -> auto-accept, never seen by a human.
Low confidence -> queue, with canaries injected more often as the queue
fills with hard (low-confidence) cases.
"""

import random
from typing import Dict, List, Optional

import config
from canary import CanaryGenerator
from models import Entry, EntryStatus


class ReviewQueue:
    def __init__(self, canary_generator: CanaryGenerator):
        self._entries: Dict[str, Entry] = {}
        self._order: List[str] = []
        self.canary_gen = canary_generator

    def submit(self, data: dict, confidence: float) -> Entry:
        entry = Entry(data=data, confidence=confidence)
        if confidence >= config.CONFIDENCE_AUTO_ACCEPT_THRESHOLD:
            entry.status = EntryStatus.AUTO_ACCEPTED
            return entry

        self._enqueue(entry)
        self._maybe_inject_canary()
        return entry

    def _enqueue(self, entry: Entry) -> None:
        self._entries[entry.id] = entry
        self._order.append(entry.id)

    def _low_confidence_ratio(self) -> float:
        pending = self.pending()
        if not pending:
            return 0.0
        low = [e for e in pending if e.confidence < config.CONFIDENCE_AUTO_ACCEPT_THRESHOLD]
        return len(low) / len(pending)

    def _maybe_inject_canary(self) -> None:
        ratio = self._low_confidence_ratio()
        rate = config.CANARY_BASE_RATE + ratio * (config.CANARY_MAX_RATE - config.CANARY_BASE_RATE)
        if random.random() > rate:
            return

        candidates = [e for e in self.pending() if not e.is_canary]
        if not candidates:
            return
        source = min(candidates, key=lambda e: e.confidence)  # hardest real case is most convincing
        self._enqueue(self.canary_gen.make_canary(source))

    def pending(self) -> List[Entry]:
        return [self._entries[i] for i in self._order if self._entries[i].status == EntryStatus.PENDING]

    def get(self, entry_id: str) -> Optional[Entry]:
        return self._entries.get(entry_id)
