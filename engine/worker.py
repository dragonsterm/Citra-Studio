import json
import math
import os
import struct
import sys
from collections import Counter
from pathlib import Path
from time import perf_counter

os.environ.setdefault("OPENCV_IO_MAX_IMAGE_PIXELS", "24000000")
# OpenCV controls its own worker pool. Avoid a second pool for small NumPy operations.
os.environ["OPENBLAS_NUM_THREADS"] = "1"

import cv2 as cv
import numpy as np

import advanced
import neural
import operations as basic


cv.setNumThreads(2)
cv.ocl.setUseOpenCL(False)

CATALOG = json.loads(Path(__file__).with_name("methods.json").read_text(encoding="utf-8"))
METHODS = {method["id"]: method for group in CATALOG for method in group["methods"]}
FUNCTIONS = {key: getattr(basic, key, None) or getattr(advanced, key, None) or getattr(neural, key) for key in METHODS}
# These methods expect color channels or draw colored overlays.
COLOR_INPUTS = {"channel", "hsv", "hough", "contours", "corners", "kmeans", "watershed", "classify", "semantic", "lsb"}
HEADER = struct.Struct("<II")
FILE_LIMIT = 48 * 1024 * 1024
PREVIEW_EDGE = 1000
MAX_FRAME = 1280 * 960
MAX_RESULT = 128 * 1024 * 1024


def clean_parameters(method, values):
    if not isinstance(values, dict):
        raise ValueError("Method parameters must be an object.")
    result = {}
    for spec in method["params"]:
        key = spec["key"]
        value = values.get(key, spec["default"])
        if spec["type"] == "select":
            value = value if value in spec["options"] else spec["default"]
        elif spec["type"] == "text":
            value = str(value)[:spec["maxLength"]]
        else:
            if not isinstance(value, (int, float)) or not math.isfinite(value):
                value = spec["default"]
            value = max(spec["min"], min(spec["max"], value))
            steps = round((value - spec["min"]) / spec["step"])
            value = round(spec["min"] + steps * spec["step"], 6)
            if isinstance(spec["step"], int):
                value = int(value)
        result[key] = value
    return result


def index_jobs(jobs):
    if not isinstance(jobs, list) or len(jobs) > 12:
        raise ValueError("Use at most 12 result widgets.")
    by_id = {}
    for job in jobs:
        identifier = job.get("id") if isinstance(job, dict) else None
        if not isinstance(identifier, str) or not identifier or identifier == "source" or identifier in by_id:
            raise ValueError("Invalid result widget.")
        if not isinstance(job.get("input", "source"), str):
            raise ValueError("Invalid input image.")
        by_id[identifier] = job
    return by_id


def job_chain(jobs, target):
    chain = []
    seen = set()
    while target != "source":
        if target in seen:
            raise ValueError("The method inputs form a loop.")
        job = jobs.get(target)
        if job is None:
            raise ValueError("The selected input image is missing.")
        chain.append(job)
        seen.add(target)
        target = job.get("input", "source")
    return chain[::-1]


def uses_reference(job):
    params = job.get("params", {})
    match job["method"]:
        case "arithmetic":
            return params.get("operand") == "Reference photo"
        case "matching":
            return params.get("variant") == "Reference photo"
        case "boolean":
            return params.get("variant", "NOT") in ("AND", "OR", "XOR")
    return False


def decode_photo(data):
    try:
        decoded = cv.imdecode(np.frombuffer(data, np.uint8), cv.IMREAD_COLOR)
    except cv.error as error:
        raise ValueError("The photo exceeds 24 megapixels or cannot be decoded.") from error
    if decoded is None or decoded.size == 0:
        raise ValueError("This file is not a readable photo.")
    return decoded


def load_photo(path):
    file = Path(path)
    if not file.is_file():
        raise ValueError("Choose a regular photo file.")
    with file.open("rb") as handle:
        data = handle.read(FILE_LIMIT + 1)
    if len(data) > FILE_LIMIT:
        raise ValueError("Choose a photo smaller than 48 MB.")
    if not data:
        raise ValueError("The selected photo is empty.")
    return data, decode_photo(data)


def frame_image(request, payload):
    width, height = request["width"], request["height"]
    if not (isinstance(width, int) and isinstance(height, int)
            and width > 0 and height > 0 and width * height <= MAX_FRAME
            and len(payload) == width * height * 4):
        raise ValueError("Invalid webcam frame dimensions.")
    rgba = np.frombuffer(payload, np.uint8).reshape(height, width, 4)
    return cv.cvtColor(rgba, cv.COLOR_RGBA2BGR)


def chart_sample():
    width, height = 1200, 750
    x = np.linspace(0, 1, width, dtype=np.float32)[None, :]
    y = np.linspace(0, 1, height, dtype=np.float32)[:, None]
    halo = np.exp(-7 * ((x - 0.72) ** 2 + (y - 0.32) ** 2))
    upper, lower = np.float32([88, 50, 46]), np.float32([166, 180, 239])
    sky = lower * y[:, :, None] + upper * (1 - y[:, :, None]) + 22 * halo[:, :, None]
    image = basic.byte(sky + np.random.default_rng(19).standard_normal((height, width, 1), dtype=np.float32) * 1.7)
    cv.circle(image, (862, 211), 82, (182, 207, 255), -1, cv.LINE_AA)

    ridges = [
        ((136, 108, 118), [(0, 392), (126, 303), (257, 410), (434, 250), (580, 359), (710, 298), (830, 400), (1043, 273), (1199, 375)]),
        ((108, 77, 83), [(0, 465), (170, 382), (291, 476), (480, 326), (623, 454), (800, 355), (987, 431), (1102, 346), (1199, 382)]),
        ((88, 62, 59), [(0, 490), (101, 455), (262, 529), (392, 452), (532, 499), (683, 445), (838, 506), (1036, 418), (1199, 482)]),
        ((75, 61, 45), [(0, 552), (173, 531), (324, 557), (590, 530), (777, 526), (1018, 507), (1199, 548)]),
    ]
    for color, points in ridges:
        cv.fillPoly(image, [np.int32([*points, (1199, 749), (0, 749)])], color, cv.LINE_AA)
    cv.fillPoly(image, [np.int32([(381, 349), (434, 250), (503, 302), (470, 295), (449, 306), (427, 295)])],
                (176, 184, 204), cv.LINE_AA)
    cv.fillPoly(image, [np.int32([(405, 388), (480, 326), (548, 387), (502, 368), (484, 380), (455, 369)])],
                (153, 149, 161), cv.LINE_AA)
    cv.fillPoly(image, [np.int32([(0, 608), (115, 588), (318, 609), (540, 584), (808, 576), (1017, 588),
                                 (1199, 559), (1199, 749), (0, 749)])], (49, 45, 33), cv.LINE_AA)
    rng = np.random.default_rng(9)
    for tree_x in rng.integers(0, 1200, 115):
        base = int(rng.integers(569, 643))
        tree_height = int(rng.integers(15, 93))
        shade = int(rng.integers(14, 33))
        for section in range(3):
            tip = base - tree_height + section * tree_height // 5
            span = tree_height * (3 + section) // 16
            outline = np.int32([(tree_x, tip), (tree_x - span, tip + tree_height // 2),
                                (tree_x + span, tip + tree_height // 2)])
            cv.fillConvexPoly(image, outline, (shade + 12, shade + 8, shade), cv.LINE_AA)
    cv.rectangle(image, (653, 560), (770, 627), (73, 93, 137), -1)
    cv.fillConvexPoly(image, np.int32([(633, 565), (707, 517), (788, 565)]), (39, 44, 63), cv.LINE_AA)
    cv.rectangle(image, (673, 579), (696, 602), (85, 189, 250), -1)
    cv.rectangle(image, (724, 579), (750, 602), (85, 189, 250), -1)
    cv.line(image, (684, 579), (684, 602), (58, 66, 85), 2)
    cv.line(image, (737, 579), (737, 602), (58, 66, 85), 2)
    for i, color in enumerate([(110, 99, 240), (230, 153, 89), (119, 209, 113), (171, 113, 223), (220, 215, 211)]):
        cv.rectangle(image, (40 + 32 * i, 676), (67 + 32 * i, 703), color, -1)
    return image


def encode(image, extension, quality=92, preview=False):
    settings = {
        ".png": [cv.IMWRITE_PNG_COMPRESSION, 1 if preview else 3],
        ".jpg": [cv.IMWRITE_JPEG_QUALITY, quality],
        ".webp": [cv.IMWRITE_WEBP_QUALITY, quality],
    }
    if extension not in settings:
        raise ValueError("Choose PNG, JPEG or WebP.")
    ok, array = cv.imencode(extension, image, settings[extension])
    if not ok:
        raise ValueError("The image could not be encoded.")
    return array


def statistics(image):
    y = basic.gray(image)
    bins = {"Y": cv.calcHist([y], [0], None, [64], [0, 256]).ravel().astype(int).tolist()}
    if image.ndim == 3:
        for channel, key in enumerate(("B", "G", "R")):
            bins[key] = cv.calcHist([image], [channel], None, [64], [0, 256]).ravel().astype(int).tolist()
    min_value, max_value, _, _ = cv.minMaxLoc(y)
    mean, stddev = cv.meanStdDev(y)
    return {
        "bins": bins, "pixels": int(y.size), "width": y.shape[1], "height": y.shape[0],
        "min": int(min_value), "max": int(max_value), "mean": round(float(mean[0, 0]), 2),
        "stddev": round(float(stddev[0, 0]), 2), "format": "BGR8 / RGB display" if image.ndim == 3 else "Gray8",
    }


class Reply:
    def __init__(self):
        self.items = []
        self.parts = []
        self.offset = 0

    def preview(self, identifier, result, ms, details=None):
        width_limit = PREVIEW_EDGE if identifier == "source" else 900
        view = basic.shrink(result, width_limit)
        extension = ".png" if result.ndim == 2 else ".jpg"
        encoded = encode(view, extension, quality=86, preview=True)
        self.items.append({
            "id": identifier, "width": result.shape[1], "height": result.shape[0],
            "previewWidth": view.shape[1], "previewHeight": view.shape[0], "ms": round(ms, 2),
            "details": details or {}, "offset": self.offset, "length": int(encoded.nbytes),
            "mime": "image/png" if extension == ".png" else "image/jpeg",
        })
        self.parts.append(encoded)
        self.offset += encoded.nbytes


class Engine:
    def __init__(self):
        self.clear_source()
        self.reference = self.reference_bytes = None

    def clear_source(self):
        self.kind = None
        self.preview = self.stored = self.last_frame = None

    def set_source(self, kind, image, stored, name):
        preview = basic.shrink(image, PREVIEW_EDGE)
        reply = Reply()
        reply.preview("source", preview, 0)
        self.kind, self.preview, self.stored, self.last_frame = kind, preview, stored, None
        return {"name": name, "width": image.shape[1], "height": image.shape[0],
                "items": reply.items, "stats": statistics(preview)}, reply.parts

    def full_source(self):
        if self.kind == "photo":
            return decode_photo(self.stored)
        if self.kind in ("sample", "snapshot"):
            return self.stored
        return self.last_frame

    def apply(self, job, source, reference):
        key = job.get("method")
        if key not in METHODS:
            raise ValueError("Unknown processing method.")
        method = METHODS[key]
        p = clean_parameters(method, job.get("params", {}))
        if "workingLimit" in method:
            source = basic.shrink(source, method["workingLimit"])
        if source.ndim == 2 and key in COLOR_INPUTS:
            source = cv.cvtColor(source, cv.COLOR_GRAY2BGR)
        value = FUNCTIONS[key](source, p, reference)
        return value if isinstance(value, tuple) else (value, {})

    def apply_chain(self, chain, source, reference):
        details = {}
        for job in chain:
            source, details = self.apply(job, source, reference)
        return source, details

    def full_reference(self, chain):
        if self.reference_bytes and any(uses_reference(job) for job in chain):
            return decode_photo(self.reference_bytes)
        return self.reference

    def render(self, request, payload):
        start = perf_counter()
        if payload:
            self.last_frame = frame_image(request, payload)
            source = self.last_frame
        else:
            source = self.preview
        if source is None:
            raise ValueError("Open a photo or start the webcam first.")
        jobs = index_jobs(request.get("jobs", []))
        output_ids = request.get("outputIds", list(jobs))
        if (not isinstance(output_ids, list) or len(output_ids) > len(jobs)
                or any(not isinstance(key, str) or key not in jobs for key in output_ids)):
            raise ValueError("Invalid result selection.")
        outputs = set(output_ids)
        inspect = request.get("inspect") if isinstance(request.get("inspect"), str) else None
        requested = request.get("inspectMany")
        inspect_many = {key for key in requested[:13] if isinstance(key, str)} if isinstance(requested, list) else set()
        if inspect is not None:
            inspect_many.add(inspect)
        stats_by_id = {"source": statistics(source)} if "source" in inspect_many else {}
        plan = {}
        for identifier in dict.fromkeys([*output_ids, *(key for key in jobs if key in inspect_many)]):
            for job in job_chain(jobs, identifier):
                plan[job["id"]] = job
        # Hold raw pixels only until their last consumer, and encode previews only for requested outputs.
        consumers = Counter(job.get("input", "source") for job in plan.values())
        images, failures = {}, {}
        full = None
        reply = Reply()
        for identifier, job in plan.items():
            input_id = job.get("input", "source")
            try:
                begin = perf_counter()
                # Read embedded data on the full pixel grid, including any preceding methods.
                exact = not payload and job["method"] == "lsb" and job.get("params", {}).get("variant") == "Read"
                if exact:
                    if full is None:
                        full = self.full_source()
                    chain = job_chain(jobs, identifier)
                    image, details = self.apply_chain(chain, full, self.full_reference(chain))
                elif input_id in failures:
                    failures[identifier] = failures[input_id]
                    continue
                else:
                    image, details = self.apply(job, source if input_id == "source" else images[input_id], self.reference)
                if identifier in outputs:
                    reply.preview(identifier, image, (perf_counter() - begin) * 1000, details)
                if identifier in inspect_many:
                    stats_by_id[identifier] = statistics(basic.shrink(image, PREVIEW_EDGE))
                if consumers[identifier]:
                    images[identifier] = image
            except (ValueError, cv.error) as error:
                failures[identifier] = str(error).splitlines()[0][:240]
            finally:
                consumers[input_id] -= 1
                if not consumers[input_id]:
                    images.pop(input_id, None)
        issues = []
        for identifier, reason in failures.items():
            if identifier in outputs or identifier in inspect_many:
                prefix = "Input image failed. " if plan[identifier].get("input", "source") in failures else ""
                issues.append({"id": identifier, "message": prefix + reason})
        return {"items": reply.items, "issues": issues, "stats": stats_by_id.get(inspect), "statsById": stats_by_id,
                "engineMs": round((perf_counter() - start) * 1000, 2),
                "width": source.shape[1], "height": source.shape[0]}, reply.parts

    def export(self, request):
        source = self.full_source()
        if source is None:
            raise ValueError("There is no frame to save yet.")
        target = request.get("target", "source")
        if not isinstance(target, str):
            raise ValueError("Choose a result to save.")
        chain = job_chain(index_jobs(request.get("jobs", [])), target)
        ext = request["extension"]
        if chain:
            reference = self.full_reference(chain)
            source, _ = self.apply_chain(chain[:-1], source, reference)
            job = chain[-1]
            if job["method"] == "compression":
                codec_ext, data = advanced.encode_codec(source, clean_parameters(METHODS["compression"], job["params"]))
                if codec_ext == ext:
                    return {"width": source.shape[1], "height": source.shape[0]}, [data]
            source, _ = self.apply(job, source, reference)
        return {"width": source.shape[1], "height": source.shape[0]}, [encode(source, ext)]

    def dispatch(self, request, payload):
        match request["command"]:
            case "hello":
                return {"python": ".".join(map(str, sys.version_info[:3])), "opencv": cv.__version__}, []
            case "photo":
                data, image = load_photo(request["path"])
                return self.set_source("photo", image, data, Path(request["path"]).name)
            case "sample":
                image = chart_sample()
                return self.set_source("sample", image, image, "Alpine Signal")
            case "snapshot":
                image = frame_image(request, payload)
                return self.set_source("snapshot", image, image, "Webcam snapshot")
            case "reference":
                data, image = load_photo(request["path"])
                self.reference, self.reference_bytes = basic.shrink(image, PREVIEW_EDGE), data
                return {"name": Path(request["path"]).name, "width": image.shape[1], "height": image.shape[0]}, []
            case "clearReference":
                self.reference = self.reference_bytes = None
                return {}, []
            case "clear":
                self.clear_source()
                return {}, []
            case "render":
                return self.render(request, payload)
            case "export":
                return self.export(request)
            case _:
                raise ValueError("Unknown engine command.")


def read_bytes(stream, count):
    data = stream.read(count)
    if len(data) != count:
        raise EOFError
    return data


def main():
    source, sink = sys.stdin.buffer, sys.stdout.buffer
    engine = Engine()
    while True:
        try:
            json_length, binary_length = HEADER.unpack(read_bytes(source, HEADER.size))
            if not 0 < json_length <= 96 * 1024 or binary_length > MAX_FRAME * 4:
                raise ValueError("Invalid request packet size.")
            request = json.loads(read_bytes(source, json_length))
            payload = read_bytes(source, binary_length)
        except (EOFError, BrokenPipeError):
            return
        try:
            metadata, parts = engine.dispatch(request, payload)
            size = sum(memoryview(part).nbytes for part in parts)
            if size > MAX_RESULT:
                raise ValueError("The encoded result is too large to return.")
            response = {"ok": True, **metadata}
        except (ValueError, OSError, KeyError, cv.error) as error:
            response = {"ok": False, "error": str(error).splitlines()[0][:360]}
            size, parts = 0, []
        encoded = json.dumps(response, ensure_ascii=False, allow_nan=False).encode("utf-8")
        try:
            sink.write(HEADER.pack(len(encoded), size))
            sink.write(encoded)
            for part in parts:
                sink.write(part)
            sink.flush()
        except (EOFError, BrokenPipeError):
            return


if __name__ == "__main__":
    main()
