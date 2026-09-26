import cv2
import time
import requests
from collections import deque
import mediapipe as mp
from ear_utils import eye_aspect_ratio, LEFT_EYE, RIGHT_EYE

mp_face_mesh = mp.solutions.face_mesh
mp_drawing = mp.solutions.drawing_utils

face_mesh = mp_face_mesh.FaceMesh(refine_landmarks=True)
cap = cv2.VideoCapture(0)

EAR_THRESHOLD = 0.21
CONSEC_FRAMES = 2
LONG_CLOSURE_FRAMES = 15    # roughly half a second at ~30fps — tune if needed
WINDOW_SECONDS = 15         # shorter window reacts faster for demo purposes

closed_frame_count = 0
blink_count = 0
blink_timestamps = deque()   # rolling record of when each blink happened
long_closure_detected = False

BACKEND_URL = "http://127.0.0.1:5000/alertness"  # update once your teammate's endpoint is ready
last_sent = time.time()

while True:
    success, frame = cap.read()
    if not success:
        break

    frame = cv2.flip(frame, 1)
    results = face_mesh.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))

    if results.multi_face_landmarks:
        for face_landmarks in results.multi_face_landmarks:
            mp_drawing.draw_landmarks(
                frame, face_landmarks, mp_face_mesh.FACEMESH_CONTOURS
            )
            landmarks = face_landmarks.landmark
            h, w, _ = frame.shape
            left_ear = eye_aspect_ratio(landmarks, LEFT_EYE, w, h)
            right_ear = eye_aspect_ratio(landmarks, RIGHT_EYE, w, h)
            avg_ear = (left_ear + right_ear) / 2

            if avg_ear < EAR_THRESHOLD:
                closed_frame_count += 1
                if closed_frame_count == LONG_CLOSURE_FRAMES:
                    long_closure_detected = True
            else:
                if closed_frame_count >= CONSEC_FRAMES:
                    blink_count += 1
                    blink_timestamps.append(time.time())
                closed_frame_count = 0

            # drop blinks older than WINDOW_SECONDS so the rate reflects "right now"
            while blink_timestamps and time.time() - blink_timestamps[0] > WINDOW_SECONDS:
                blink_timestamps.popleft()

            blinks_in_window = len(blink_timestamps)

            cv2.putText(frame, f"EAR: {avg_ear:.3f}", (30, 50),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
            cv2.putText(frame, f"Blinks/{WINDOW_SECONDS}s: {blinks_in_window}", (30, 90),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
            if long_closure_detected:
                cv2.putText(frame, "LONG CLOSURE DETECTED", (30, 130),
                            cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)

            # send the current score to the backend every 2 seconds
            if time.time() - last_sent > 2:
                payload = {
                    "blinks_in_window": blinks_in_window,
                    "window_seconds": WINDOW_SECONDS,
                    "long_closure": long_closure_detected
                }
                try:
                    requests.post(BACKEND_URL, json=payload, timeout=1)
                except requests.exceptions.RequestException:
                    pass  # backend not up yet — fine to ignore for now
                last_sent = time.time()
                long_closure_detected = False  # reset after sending

    cv2.imshow("Face Mesh Test", frame)
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()