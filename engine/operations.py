import math
from functools import lru_cache

import cv2 as cv
import numpy as np


def gray(image):
    return image if image.ndim == 2 else cv.cvtColor(image, cv.COLOR_BGR2GRAY)


def byte(image):
    return np.clip(np.rint(image), 0, 255).astype(np.uint8)


def shrink(image, maximum):
    height, width = image.shape[:2]
    if max(height, width) <= maximum:
        return image
    ratio = maximum / max(height, width)
    return cv.resize(image, (max(1, round(width * ratio)), max(1, round(height * ratio))), interpolation=cv.INTER_AREA)


def apply_kernel(image, kernel, depth=-1, delta=0):
    # OpenCV filter2D performs correlation, so flip the kernel for convolution.
    return cv.filter2D(image, depth, np.asarray(kernel, dtype=np.float32)[::-1, ::-1], delta=delta)


def binary(image, value):
    return cv.threshold(gray(image), value, 255, cv.THRESH_BINARY)[1]


def ref_image(reference, shape):
    if reference is None:
        raise ValueError("Choose a reference photo in the inspector.")
    height, width = shape[:2]
    return cv.resize(reference, (width, height), interpolation=cv.INTER_LINEAR)


def luminance(image, transform, grayscale=False):
    if image.ndim == 2 or grayscale:
        return transform(gray(image))
    ycc = cv.cvtColor(image, cv.COLOR_BGR2YCrCb)
    ycc[:, :, 0] = transform(ycc[:, :, 0])
    return cv.cvtColor(ycc, cv.COLOR_YCrCb2BGR)


def grayscale(image, p, reference):
    if p["variant"] == "Average" and image.ndim == 3:
        return byte(np.mean(image, axis=2, dtype=np.float32))
    return gray(image)


def threshold(image, p, reference):
    return binary(image, p["threshold"])


def double(image, p, reference):
    low, high = sorted((p["low"], p["high"]))
    return cv.inRange(gray(image), low, high)


def negative(image, p, reference):
    return cv.bitwise_not(image)


def brightness(image, p, reference):
    values = np.arange(256, dtype=np.int16)
    return cv.LUT(image, byte(values + p["amount"]))


def contrast(image, p, reference):
    if p["variant"] == "Stretch":
        return luminance(image, lambda y: cv.normalize(y, None, 0, 255, cv.NORM_MINMAX) if y.max() > y.min() else y)
    values = np.arange(256, dtype=np.float32)
    return cv.LUT(image, byte((values - 128) * p["gain"] + 128))


def tone(image, p, reference):
    values = np.arange(256)
    unit = values / 255
    match p["variant"]:
        case "Gamma":
            curve = 255 * unit ** p["gamma"]
        case "Root":
            curve = 255 * np.sqrt(unit)
        case "Log":
            curve = 255 * np.log1p(values) / math.log(256)
        case "Inverse log":
            curve = np.expm1(unit * math.log(256))
        case "Gray-level slicing":
            low, high = sorted((p["low"], p["high"]))
            return cv.inRange(gray(image), low, high)
        case "Bit-plane slicing":
            return ((gray(image) >> p["bit"]) & 1) * 255
    return cv.LUT(image, byte(curve))


def quantize(image, p, reference):
    unit = np.arange(256) / 255
    levels = p["levels"] - 1
    if p["variant"] == "Logarithmic":
        unit = np.log1p(15 * unit) / math.log(16)
        unit = np.expm1(np.rint(unit * levels) / levels * math.log(16)) / 15
    else:
        unit = np.rint(unit * levels) / levels
    return cv.LUT(gray(image), byte(unit * 255))


def arithmetic(image, p, reference):
    other = p["value"]
    variant = p["variant"]
    if p["operand"] == "Scalar":
        values = np.arange(256, dtype=np.float32)
        if variant in ("Multiply", "Divide"):
            other /= 100
        curves = {"Add": np.add, "Subtract": np.subtract, "Multiply": np.multiply, "Divide": np.divide}
        return cv.LUT(image, byte(curves[variant](values, other)))
    other = ref_image(reference, image.shape)
    if image.ndim == 2:
        other = gray(other)
    match variant:
        case "Add":
            return cv.add(image, other)
        case "Subtract":
            return cv.subtract(image, other)
        case "Multiply":
            return cv.multiply(image, other, scale=1 / 255)
        case "Divide":
            return cv.divide(image, other, scale=255)


def boolean(image, p, reference):
    mask = binary(image, p["threshold"])
    if p["variant"] == "NOT":
        return cv.bitwise_not(mask)
    other = binary(ref_image(reference, image.shape), p["threshold"])
    operations = {"AND": cv.bitwise_and, "OR": cv.bitwise_or, "XOR": cv.bitwise_xor}
    return operations[p["variant"]](mask, other)


def equalize(image, p, reference):
    transform = cv.equalizeHist
    if p["variant"] == "CLAHE":
        transform = cv.createCLAHE(clipLimit=2, tileGridSize=(8, 8)).apply
    return luminance(image, transform, p["output"] == "Grayscale")


def matching(image, p, reference):
    if p["variant"] == "Reference photo":
        if reference is None:
            raise ValueError("Choose a reference photo in the inspector.")
        target = cv.calcHist([gray(reference)], [0], None, [256], [0, 256]).ravel()
    else:
        target = np.exp(-0.5 * ((np.arange(256) - 130) / 40) ** 2)
    target = np.cumsum(target, dtype=np.float64)
    target /= target[-1]

    def remap(y):
        source = np.cumsum(cv.calcHist([y], [0], None, [256], [0, 256]).ravel(), dtype=np.float64)
        mapping = np.searchsorted(target, source / source[-1]).clip(0, 255).astype(np.uint8)
        return cv.LUT(y, mapping)

    return luminance(image, remap)


@lru_cache(maxsize=48)
def motion_kernel(size, angle):
    kernel = np.zeros((size, size), np.float32)
    center = size // 2
    theta = math.radians(angle)
    dx, dy = round(center * math.cos(theta)), round(center * math.sin(theta))
    cv.line(kernel, (center - dx, center - dy), (center + dx, center + dy), 1, 1)
    return kernel / kernel.sum()


def blur(image, p, reference):
    size = p["size"]
    window = (size, size)
    match p["variant"]:
        case "Gaussian":
            return cv.GaussianBlur(image, window, 0)
        case "Mean":
            return cv.blur(image, window)
        case "Weighted mean":
            weights = np.bartlett(size + 2)[1:-1].astype(np.float32)
            weights /= weights.sum()
            return cv.sepFilter2D(image, -1, weights, weights)
        case "Median":
            return cv.medianBlur(image, size)
        case "Minimum":
            return cv.erode(image, np.ones(window, np.uint8))
        case "Maximum":
            return cv.dilate(image, np.ones(window, np.uint8))
        case "Bilateral":
            return cv.bilateralFilter(image, min(15, size), 65, 65)
        case "Motion":
            return apply_kernel(image, motion_kernel(size, p["angle"]))


def sharpen(image, p, reference):
    amount = p["amount"]
    if p["variant"] == "Laplacian kernel":
        return apply_kernel(image, [[0, -amount, 0], [-amount, 1 + 4 * amount, -amount], [0, -amount, 0]])
    smooth = cv.GaussianBlur(image, (p["size"], p["size"]), 0)
    if p["variant"] == "High boost":
        return cv.addWeighted(image, 1 + amount, smooth, -1, 0)
    return cv.addWeighted(image, 1 + amount, smooth, -amount, 0)


def convolution(image, p, reference):
    kernels = {
        "Identity": [0, 0, 0, 0, 1, 0, 0, 0, 0],
        "Low-pass": [1 / 9] * 9,
        "High-pass": [-1, -1, -1, -1, 8, -1, -1, -1, -1],
    }
    if p["variant"] == "Custom":
        try:
            values = [float(value) for value in p["kernel"].replace(",", " ").split()]
        except ValueError as error:
            raise ValueError("Enter nine numeric kernel values.") from error
        if len(values) != 9 or not all(math.isfinite(value) and abs(value) <= 100 for value in values):
            raise ValueError("Enter nine kernel values between −100 and 100.")
    else:
        values = kernels[p["variant"]]
    kernel = np.array(values, dtype=np.float32).reshape(3, 3) / p["divisor"]
    return apply_kernel(image, kernel), {"Kernel": " / ".join(" ".join(f"{v:.3g}" for v in row) for row in kernel)}


def emboss(image, p, reference):
    return apply_kernel(gray(image), [[2, 1, 0], [1, 0, -1], [0, -1, -2]], delta=128)


def sketch(image, p, reference):
    y = gray(image)
    denominator = cv.bitwise_not(cv.GaussianBlur(cv.bitwise_not(y), (p["size"], p["size"]), 0))
    return cv.divide(y, cv.max(denominator, 1), scale=255)


def cnn(image, p, reference):
    kernels = {
        "Vertical edge": [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]],
        "Horizontal edge": [[-1, -2, -1], [0, 0, 0], [1, 2, 1]],
        "Detail": [[0, -1, 0], [-1, 4, -1], [0, -1, 0]],
    }
    activated = cv.filter2D(gray(image), cv.CV_32F, np.array(kernels[p["kernel"]], np.float32))
    np.maximum(activated, 0, out=activated)
    size = min(p["size"], *activated.shape)
    if p["variant"] != "Convolution + ReLU" and size > 1:
        height, width = activated.shape
        rows, cols = height // size, width // size
        blocks = activated[:rows * size, :cols * size].reshape(rows, size, cols, size)
        activated = blocks.max(axis=(1, 3)) if p["variant"] == "Max pooling" else blocks.mean(axis=(1, 3))
    return cv.normalize(activated, None, 0, 255, cv.NORM_MINMAX, dtype=cv.CV_8U)


def mirror(image, p, reference):
    return cv.flip(image, {"Horizontal": 1, "Vertical": 0, "Both": -1}[p["axis"]])


def interpolation(p):
    return {"Nearest": cv.INTER_NEAREST, "Bilinear": cv.INTER_LINEAR, "Bicubic": cv.INTER_CUBIC}[p["interpolation"]]


def rotate(image, p, reference):
    angle = p["angle"] % 360
    if angle == 0:
        return image
    if angle % 90 == 0:
        return cv.rotate(image, {90: cv.ROTATE_90_COUNTERCLOCKWISE, 180: cv.ROTATE_180, 270: cv.ROTATE_90_CLOCKWISE}[angle])
    height, width = image.shape[:2]
    matrix = cv.getRotationMatrix2D(((width - 1) / 2, (height - 1) / 2), angle, 1)
    cosine, sine = np.abs(matrix[0, :2])
    out_width = math.ceil(height * sine + width * cosine)
    out_height = math.ceil(height * cosine + width * sine)
    matrix[:, 2] += [(out_width - width) / 2, (out_height - height) / 2]
    if out_width * out_height > 32_000_000:
        raise ValueError("This angle produces an image over 32 megapixels.")
    return cv.warpAffine(image, matrix, (out_width, out_height), flags=interpolation(p))


def translate(image, p, reference):
    height, width = image.shape[:2]
    matrix = np.array([[1, 0, width * p["x"] / 100], [0, 1, height * p["y"] / 100]], dtype=np.float32)
    return cv.warpAffine(image, matrix, (width, height), flags=interpolation(p))


def scale(image, p, reference):
    height, width = image.shape[:2]
    factor = p["scale"] / 100
    size = max(1, round(width * factor)), max(1, round(height * factor))
    if size[0] * size[1] > 32_000_000:
        raise ValueError("This scale produces an image over 32 megapixels.")
    return cv.resize(image, size, interpolation=interpolation(p))


def crop(image, p, reference):
    height, width = image.shape[:2]
    x = min(width - 1, int(width * p["x"] / 100))
    y = min(height - 1, int(height * p["y"] / 100))
    return image[y:y + max(1, round(height * p["height"] / 100)), x:x + max(1, round(width * p["width"] / 100))]


def warp(image, p, reference):
    height, width = image.shape[:2]
    amount = p["amount"]
    if min(width, height) < 2:
        return image
    if p["variant"] == "Lens":
        focal = max(width, height) / 2
        matrix = np.array([[focal, 0, width / 2], [0, focal, height / 2], [0, 0, 1]], dtype=np.float64)
        x, y = cv.initUndistortRectifyMap(matrix, np.array([amount, 0, 0, 0, 0]), None, matrix, (width, height), cv.CV_32FC1)
        return cv.remap(image, x, y, interpolation(p))
    if p["variant"] == "Shear":
        matrix = np.array([[1, amount, -amount * height / 2], [0, 1, 0]], dtype=np.float32)
        return cv.warpAffine(image, matrix, (width, height), flags=interpolation(p))
    source = np.float32([[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]])
    target = source.copy()
    target[:2, 0] += [width * amount, -width * amount]
    return cv.warpPerspective(image, cv.getPerspectiveTransform(source, target), (width, height), flags=interpolation(p))


def channel(image, p, reference):
    space = p["space"]
    component = p["component"]
    standard = {
        "HSV": (cv.COLOR_BGR2HSV_FULL, cv.COLOR_HSV2BGR_FULL, ["H", "S", "V"]),
        "HSL": (cv.COLOR_BGR2HLS_FULL, cv.COLOR_HLS2BGR_FULL, ["H", "L", "S"]),
        "YUV": (cv.COLOR_BGR2YUV, cv.COLOR_YUV2BGR, ["Y", "U", "V"]),
        "YCbCr": (cv.COLOR_BGR2YCrCb, cv.COLOR_YCrCb2BGR, ["Y", "Cr", "Cb"]),
        "Lab": (cv.COLOR_BGR2Lab, cv.COLOR_Lab2BGR, ["L*", "a*", "b*"]),
    }
    if space in standard:
        forward, backward, names = standard[space]
        converted = cv.cvtColor(image, forward)
        if component == "RGB round-trip":
            return cv.cvtColor(converted, backward), {"Conversion": f"RGB → {space} → RGB"}
        if space in ("HSL", "YCbCr"):
            converted = converted[:, :, [0, 2, 1]]
            names = [names[0], names[2], names[1]]
    else:
        rgb = cv.cvtColor(image, cv.COLOR_BGR2RGB).astype(np.float32) / 255
        if space == "RGB":
            converted, names = rgb, ["R", "G", "B"]
            rebuilt = rgb
        elif space in ("CMY", "CMYK"):
            converted = 1 - rgb
            names = ["C", "M", "Y"]
            if space == "CMYK":
                black = converted.min(axis=2, keepdims=True)
                cmy = (converted - black) / np.maximum(1 - black, 1e-6)
                converted = np.concatenate((cmy, black), axis=2)
                rebuilt = (1 - cmy) * (1 - black)
                names.append("K")
            else:
                rebuilt = 1 - converted
        elif space == "HSI":
            r, g, b = (rgb[:, :, i] for i in range(3))
            intensity = (r + g + b) / 3
            saturation = np.where(intensity > 0, 1 - rgb.min(axis=2) / np.maximum(intensity, 1e-6), 0)
            radians = np.mod(np.arctan2(math.sqrt(3) * (g - b), 2 * r - g - b), 2 * math.pi)
            hue = radians / (2 * math.pi)
            converted, names = np.stack((hue, saturation, intensity), axis=-1), ["H", "S", "I"]
            if component == "RGB round-trip":
                rebuilt = np.empty_like(rgb)
                for sector in range(3):
                    theta = radians - sector * 2 * math.pi / 3
                    mask = (theta >= 0) & (theta < 2 * math.pi / 3)
                    t, s, i = theta[mask], saturation[mask], intensity[mask]
                    low = i * (1 - s)
                    high = i * (1 + s * np.cos(t) / np.cos(math.pi / 3 - t))
                    rebuilt[mask] = np.roll(np.stack((high, 3 * i - low - high, low), axis=1), sector, axis=1)
        else:
            if space == "XYZ":
                linear = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
                matrix = np.float32([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
                xyz = cv.transform(linear, matrix)
                converted, names = xyz / np.float32([0.95047, 1.0, 1.08883]), ["X", "Y", "Z"]
                raw = np.maximum(cv.transform(xyz, cv.invert(matrix)[1]), 0)
                rebuilt = np.where(raw <= 0.0031308, 12.92 * raw, 1.055 * raw ** (1 / 2.4) - 0.055)
            else:
                matrix = np.float32([[0.299, 0.587, 0.114], [0.596, -0.275, -0.321], [0.212, -0.523, 0.311]])
                yiq = cv.transform(rgb, matrix)
                converted, names = yiq / np.float32([1, 1.192, 1.046]) + np.float32([0, 0.5, 0.5]), ["Y", "I", "Q"]
                rebuilt = cv.transform(yiq, cv.invert(matrix)[1])
        if component == "RGB round-trip":
            return cv.cvtColor(byte(rebuilt * 255), cv.COLOR_RGB2BGR), {"Conversion": f"RGB → {space} → RGB"}
        converted = byte(converted * 255)
    index = int(component) - 1
    if index >= len(names):
        raise ValueError(f"{space} has {len(names)} channels. Select a different component.")
    return converted[:, :, index], {"Conversion": f"RGB → {space} → {names[index]}"}


def hsv(image, p, reference):
    output = cv.cvtColor(image, cv.COLOR_BGR2HSV)
    hue, saturation, value = cv.split(output)
    hue = ((hue.astype(np.int16) + round(p["hue"] / 2)) % 180).astype(np.uint8)
    return cv.cvtColor(cv.merge((hue, cv.convertScaleAbs(saturation, alpha=p["sat"]),
                                 cv.convertScaleAbs(value, alpha=p["value"]))), cv.COLOR_HSV2BGR)


def pseudocolor(image, p, reference):
    palettes = {"Turbo": cv.COLORMAP_TURBO, "Viridis": cv.COLORMAP_VIRIDIS, "Inferno": cv.COLORMAP_INFERNO, "Jet": cv.COLORMAP_JET}
    y = gray(image)
    if p["variant"] == "Intensity slices":
        colors = np.uint8([[73, 38, 37], [175, 77, 76], [143, 168, 40], [41, 213, 237]])
        return colors[y >> 6]
    return cv.applyColorMap(y, palettes[p["variant"]])


def edge(image, p, reference):
    y = gray(image)
    method = p["variant"]
    if method == "Canny":
        low, high = sorted((p["low"], p["high"]))
        return cv.Canny(cv.GaussianBlur(y, (5, 5), 1.2), low, high, L2gradient=True)
    if method == "Difference of Gaussians":
        return cv.absdiff(cv.GaussianBlur(y, (5, 5), 0.9), cv.GaussianBlur(y, (11, 11), 2.1))
    if method in ("Laplacian", "LoG", "Zero crossing", "Report kernel"):
        if method == "Report kernel":
            return apply_kernel(y, [[-1, -1, -1], [-1, 8, -1], [-1, -1, -1]])
        smooth = cv.GaussianBlur(y, (5, 5), 1.1) if method != "Laplacian" else y
        laplace = cv.Laplacian(smooth, cv.CV_32F)
        if method == "Zero crossing":
            nearby_min, nearby_max = cv.erode(laplace, None), cv.dilate(laplace, None)
            return ((nearby_min < 0) & (nearby_max > 0) & (nearby_max - nearby_min >= 8)).astype(np.uint8) * 255
        return cv.convertScaleAbs(laplace)
    if method == "Sobel":
        dx = cv.Sobel(y, cv.CV_32F, 1, 0, scale=0.25)
        dy = cv.Sobel(y, cv.CV_32F, 0, 1, scale=0.25)
    else:
        kernels = {
            "Forward gradient": ([[-1, 1]], [[-1], [1]], 1),
            "Central gradient": ([[-1, 0, 1]], [[-1], [0], [1]], 0.5),
            "Prewitt": ([[-1, 0, 1]] * 3, [[-1, -1, -1], [0, 0, 0], [1, 1, 1]], 1 / 3),
            "Roberts": ([[1, 0], [0, -1]], [[0, 1], [-1, 0]], 1),
        }
        kx, ky, factor = kernels[method]
        dx = cv.filter2D(y, cv.CV_32F, np.float32(kx) * factor)
        dy = cv.filter2D(y, cv.CV_32F, np.float32(ky) * factor)
    display = p["direction"]
    return cv.convertScaleAbs(dx if display == "X gradient" else dy if display == "Y gradient" else cv.magnitude(dx, dy))


def hough(image, p, reference):
    output = image.copy()
    y = cv.GaussianBlur(gray(image), (5, 5), 1.2)
    votes = p["votes"]
    color = (246, 205, 77)
    limit = min(y.shape)
    if limit < 8:
        return output, {"Detections": 0}
    if p["variant"] == "Lines":
        segments = cv.HoughLinesP(cv.Canny(y, 45, 135), 1, math.pi / 180, votes,
                                  minLineLength=max(6, limit // 12), maxLineGap=max(3, limit // 55))
        detections = [] if segments is None else segments[:150, 0].tolist()
        for x1, y1, x2, y2 in detections:
            cv.line(output, (x1, y1), (x2, y2), color, 2, cv.LINE_AA)
    else:
        circles = cv.HoughCircles(y, cv.HOUGH_GRADIENT, 1.5, max(8, limit // 12), param1=110, param2=votes,
                                 minRadius=max(2, limit // 40), maxRadius=limit // 2)
        detections = [] if circles is None else np.rint(circles[0, :100]).astype(int).tolist()
        for x, y, radius in detections:
            cv.circle(output, (x, y), radius, color, 2, cv.LINE_AA)
    return output, {"Detections shown": len(detections)}


def contours(image, p, reference):
    mask = binary(image, p["threshold"])
    contours_found, _ = cv.findContours(mask, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)
    area = p["area"] * mask.size / 100
    output = np.zeros_like(image)
    selected = [contour for contour in contours_found if cv.contourArea(contour) >= area]
    cv.drawContours(output, selected, -1, (246, 205, 77), 1, cv.LINE_8)
    return output, {"Contours": len(selected)}


def corners(image, p, reference):
    output = image.copy()
    if min(image.shape[:2]) < 3:
        return output, {"Corners": 0}
    points = cv.goodFeaturesToTrack(gray(image), 180, p["quality"], 5, blockSize=3,
                                    useHarrisDetector=p["variant"] == "Harris")
    if points is None:
        return output, {"Corners": 0}
    for x, y in np.rint(points[:, 0]).astype(int):
        cv.circle(output, (x, y), 3, (249, 179, 94), 1, cv.LINE_AA)
    return output, {"Corners": len(points)}
