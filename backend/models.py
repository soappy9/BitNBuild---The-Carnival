"""
Schema-agnostic entry model. `data` is a raw dict so the Adaptive Form
team can change their fields/countries/ruleset freely without ever
touching backend code.
"""

from dataclasses import dataclass, field
from enum import Enum
from time import time
from typing import Any, Dict, Optional
import uuid


class EntryStatus(str, Enum):
    PENDING = "pending"
    AUTO_ACCEPTED = "auto_accepted"
    APPROVED = "approved"
    REJECTED = "rejected"


@dataclass
class Entry:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    data: Dict[str, Any] = field(default_factory=dict)
    confidence: float = 1.0
    is_canary: bool = False
    source_entry_id: Optional[str] = None   # set on canaries: the real entry they were mutated from
    status: EntryStatus = EntryStatus.PENDING
    created_at: float = field(default_factory=time)
    decided_at: Optional[float] = None
    decision_correct: Optional[bool] = None  # for canaries: True = reviewer caught it
