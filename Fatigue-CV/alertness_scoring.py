NORMAL_MIN_BLINKS = 2
LONG_CLOSURE_PENALTY = 40
ALPHA_DOWN = 0.4   # reacts quickly when alertness drops
ALPHA_UP = 0.1     # recovers slowly, so a demo "fatigue" moment actually holds

def raw_score_from_blinks(blinks_in_window):
    if blinks_in_window >= NORMAL_MIN_BLINKS:
        return 100.0
    return (blinks_in_window / NORMAL_MIN_BLINKS) * 100.0

def apply_long_closure_penalty(score, long_closure_active):
    if long_closure_active:
        return max(0.0, score - LONG_CLOSURE_PENALTY)
    return score

class AlertnessTracker:
    def __init__(self):
        self.smoothed_score = 100.0

    def update(self, blinks_in_window, long_closure_active):
        raw = raw_score_from_blinks(blinks_in_window)
        raw = apply_long_closure_penalty(raw, long_closure_active)

        alpha = ALPHA_DOWN if raw < self.smoothed_score else ALPHA_UP
        self.smoothed_score = (alpha * raw) + ((1 - alpha) * self.smoothed_score)
        return round(self.smoothed_score, 1)