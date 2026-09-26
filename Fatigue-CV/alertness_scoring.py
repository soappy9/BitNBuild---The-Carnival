NORMAL_MIN_BLINKS = 2    # lowered to match the shorter 8s window
LONG_CLOSURE_PENALTY = 40
EMA_ALPHA = 0.3          # how quickly the score reacts to new readings (0 = never, 1 = instant)

def raw_score_from_blinks(blinks_in_window):
    """
    Maps blink count in the current window to a 0-100 alertness score.
    Staying at or above the normal minimum = full score.
    Dropping toward zero blinks (staring, zoning out) drags the score down.
    """
    if blinks_in_window >= NORMAL_MIN_BLINKS:
        return 100.0
    return (blinks_in_window / NORMAL_MIN_BLINKS) * 100.0

def apply_long_closure_penalty(score, long_closure_active):
    if long_closure_active:
        return max(0.0, score - LONG_CLOSURE_PENALTY)
    return score

class AlertnessTracker:
    """Keeps a smoothed alertness score across frames instead of a jumpy raw number."""
    def __init__(self):
        self.smoothed_score = 100.0

    def update(self, blinks_in_window, long_closure_active):
        raw = raw_score_from_blinks(blinks_in_window)
        raw = apply_long_closure_penalty(raw, long_closure_active)
        self.smoothed_score = (EMA_ALPHA * raw) + ((1 - EMA_ALPHA) * self.smoothed_score)
        return round(self.smoothed_score, 1)