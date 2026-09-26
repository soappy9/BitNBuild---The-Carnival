"""
Turns a real, low-confidence entry into a plausible-looking fake ("canary").

Because the backend doesn't control the form's field names, mutation rules
are registered per field name, with a generic fallback for any field we've
never seen. This means the form team can add/rename/remove fields at any
point in the hackathon without you having to touch this file.
"""

import copy
import random
from typing import Any, Callable, Dict

from models import Entry

MutatorFn = Callable[[Any], Any]


class CanaryGenerator:
    def __init__(self):
        self._mutators: Dict[str, MutatorFn] = {}
        self._default_mutator: MutatorFn = self._generic_mutator

    def register_mutator(self, field_name: str, fn: MutatorFn) -> None:
        """Optional: register a smarter, field-aware mutation.
        e.g. register_mutator("date_of_birth", lambda v: shift_day(v, 1))
        """
        self._mutators[field_name] = fn

    def set_default_mutator(self, fn: MutatorFn) -> None:
        self._default_mutator = fn

    def _generic_mutator(self, value: Any) -> Any:
        """Type-based fallback mutation - works on any field it's never seen."""
        if isinstance(value, bool):
            return not value
        if isinstance(value, (int, float)):
            return value * random.choice([0.9, 1.1]) if value else value + 1
        if isinstance(value, str) and len(value) > 3:
            i = random.randint(0, len(value) - 2)
            chars = list(value)
            chars[i], chars[i + 1] = chars[i + 1], chars[i]
            return "".join(chars)
        if isinstance(value, str):
            return value.swapcase()
        return value

    def make_canary(self, source: Entry) -> Entry:
        mutated = copy.deepcopy(source.data)
        keys = list(mutated.keys())
        n_fields = min(len(keys), random.choice([1, 1, 2])) if keys else 0
        for key in random.sample(keys, n_fields):
            mutator = self._mutators.get(key, self._default_mutator)
            mutated[key] = mutator(mutated[key])

        return Entry(
            data=mutated,
            confidence=source.confidence,
            is_canary=True,
            source_entry_id=source.id,
        )
