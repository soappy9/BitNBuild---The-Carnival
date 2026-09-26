"""
Tunable knobs. Change these during the demo without touching logic.
"""

# Entries at/above this confidence skip human review entirely.
CONFIDENCE_AUTO_ACCEPT_THRESHOLD = 0.8

# Canary injection rate scales between these two values based on how
# full the queue is with low-confidence (hard) entries.
CANARY_BASE_RATE = 0.05   # queue is mostly easy cases -> inject rarely
CANARY_MAX_RATE = 0.40    # queue is mostly hard cases -> inject often

# Trust score below this triggers friction (frozen buttons, confirmation).
TRUST_LOW_THRESHOLD = 0.4

# How much a caught/missed canary moves the "hard evidence" trust component.
TRUST_RECOVERY_ON_CATCH = 0.15
TRUST_PENALTY_ON_MISS = 0.35

# Blend weights for combining canary performance with live alertness.
# Must sum to 1.0.
CANARY_WEIGHT = 0.5
ALERTNESS_WEIGHT = 0.5
