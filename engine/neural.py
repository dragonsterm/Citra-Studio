from functools import lru_cache
from pathlib import Path

import cv2 as cv
import numpy as np

from operations import byte


BUNDLED = Path(__file__).with_name("models")
MODEL_DIR = BUNDLED if BUNDLED.is_dir() else Path(__file__).parent.parent / ".build" / "models"


@lru_cache(maxsize=2)
def load_network(name):
    path = MODEL_DIR / (name + ".onnx")
    if not path.is_file():
        raise ValueError("Run the project build to prepare the local CNN models.")
    # Open from bytes so Windows paths with non-ASCII characters work as well.
    net = cv.dnn.readNetFromONNX(np.frombuffer(path.read_bytes(), dtype=np.uint8))
    net.setPreferableBackend(cv.dnn.DNN_BACKEND_OPENCV)
    net.setPreferableTarget(cv.dnn.DNN_TARGET_CPU)
    return net


@lru_cache(maxsize=1)
def class_names():
    return (MODEL_DIR / "imagenet.txt").read_text(encoding="utf-8").splitlines()


def classify(image, p, reference):
    height, width = image.shape[:2]
    side = min(height, width)
    top, left = (height - side) // 2, (width - side) // 2
    rgb = cv.cvtColor(cv.resize(image[top:top + side, left:left + side], (224, 224)), cv.COLOR_BGR2RGB)
    normalized = (rgb.astype(np.float32) / 255 - np.float32([0.485, 0.456, 0.406])) / np.float32([0.229, 0.224, 0.225])
    network = load_network("mobilenetv2")
    network.setInput(cv.dnn.blobFromImage(normalized))
    scores = network.forward().ravel()
    if not (scores.min() >= 0 and abs(float(scores.sum()) - 1) < 0.001):
        scores = np.exp(scores - scores.max())
        scores /= scores.sum()
    labels = class_names()
    ranks = np.argsort(scores)[-3:][::-1]
    predictions = [f"{labels[i]} ({scores[i]:.1%})" for i in ranks]
    output = image
    if p["variant"] == "Label overlay" and min(height, width) >= 40:
        output = image.copy()
        label = predictions[0]
        size = min(1.3, max(0.35, min(width, height) / 470))
        thickness = 1 if size < 0.8 else 2
        text_width, text_height = cv.getTextSize(label, cv.FONT_HERSHEY_SIMPLEX, size, thickness)[0]
        if text_width > width - 20:
            size *= (width - 20) / text_width
            text_width, text_height = cv.getTextSize(label, cv.FONT_HERSHEY_SIMPLEX, size, thickness)[0]
        box = output[max(0, height - text_height - 24):max(0, height - 5), 5:text_width + 16]
        box[:] = cv.convertScaleAbs(box, alpha=0.25)
        cv.putText(output, label, (10, height - 12), cv.FONT_HERSHEY_SIMPLEX, size, (252, 252, 252), thickness, cv.LINE_AA)
    return output, {"Model": "MobileNetV2 · ImageNet", "Top 1": predictions[0], "Top 2": predictions[1], "Top 3": predictions[2]}


def semantic(image, p, reference):
    network = load_network("pphumanseg")
    normalized = cv.resize(image, (192, 192)).astype(np.float32) * (2 / 255) - 1
    network.setInput(cv.dnn.blobFromImage(normalized, swapRB=True))
    scores = network.forward()[0]
    height, width = image.shape[:2]
    foreground = cv.resize(scores[1] - scores[0], (width, height), interpolation=cv.INTER_LINEAR) > 0
    if p["variant"] == "Mask":
        output = foreground.astype(np.uint8) * 255
    elif p["variant"] == "Foreground only":
        output = cv.bitwise_and(image, image, mask=foreground.astype(np.uint8))
    else:
        output = image.copy()
        output[foreground] = byte(0.68 * image[foreground] + 0.32 * np.float32([249, 145, 98]))
    return output, {"Model": "PP-HumanSeg", "Person pixels": int(foreground.sum()), "Coverage": f"{foreground.mean():.1%}"}
