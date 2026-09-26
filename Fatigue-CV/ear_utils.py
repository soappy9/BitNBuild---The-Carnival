import math

LEFT_EYE = {"top": 159, "bottom": 145, "left": 33, "right": 133}
RIGHT_EYE = {"top": 386, "bottom": 374, "left": 362, "right": 263}

def to_pixel(landmark, frame_width, frame_height):
    return (landmark.x * frame_width, landmark.y * frame_height)

def distance(p1, p2):
    return math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2)

def eye_aspect_ratio(landmarks, eye, frame_width, frame_height):
    top = to_pixel(landmarks[eye["top"]], frame_width, frame_height)
    bottom = to_pixel(landmarks[eye["bottom"]], frame_width, frame_height)
    left = to_pixel(landmarks[eye["left"]], frame_width, frame_height)
    right = to_pixel(landmarks[eye["right"]], frame_width, frame_height)

    vertical = distance(top, bottom)
    horizontal = distance(left, right)
    return vertical / horizontal