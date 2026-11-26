import heapq
import math
import struct

import cv2 as cv
import numpy as np

from operations import binary, byte, gray, motion_kernel, shrink


def fft(y):
    height, width = y.shape
    padded = cv.copyMakeBorder(y, 0, cv.getOptimalDFTSize(height) - height,
                               0, cv.getOptimalDFTSize(width) - width, cv.BORDER_REFLECT_101)
    return cv.dft(padded.astype(np.float32), flags=cv.DFT_COMPLEX_OUTPUT)


def inverse_fft(transformed, shape):
    height, width = shape
    return cv.idft(transformed, flags=cv.DFT_SCALE | cv.DFT_REAL_OUTPUT)[:height, :width]


def normalize(image):
    return cv.normalize(image, None, 0, 255, cv.NORM_MINMAX, dtype=cv.CV_8U)


def spectrum(image, p, reference):
    y = gray(image)
    transformed = fft(y)
    if p["variant"] == "Inverse reconstruction":
        return byte(inverse_fft(transformed, y.shape))
    real, imaginary = cv.split(transformed)
    if p["variant"] == "Phase":
        return byte(np.fft.fftshift(cv.phase(real, imaginary, angleInDegrees=True)) * (255 / 360))
    return normalize(np.fft.fftshift(np.log1p(cv.magnitude(real, imaginary))))


def dct(image, p, reference):
    y = gray(image)
    height, width = y.shape
    padded = cv.copyMakeBorder(y, 0, height % 2, 0, width % 2, cv.BORDER_REPLICATE)
    coefficients = cv.dct(padded.astype(np.float32) - 128)
    if p["variant"] == "Coefficients":
        return normalize(np.log1p(np.abs(coefficients)))
    keep = p["keep"] / 100
    coefficient_rows, coefficient_cols = coefficients.shape
    coefficients[max(1, round(coefficient_rows * keep)):, :] = 0
    coefficients[:, max(1, round(coefficient_cols * keep)):] = 0
    return byte(cv.idct(coefficients)[:height, :width] + 128)


def frequencies(shape):
    height, width = shape[:2]
    return np.fft.fftfreq(width).astype(np.float32)[None, :], np.fft.fftfreq(height).astype(np.float32)[:, None]


def frequency(image, p, reference):
    y = gray(image)
    transformed = fft(y)
    x, vertical = frequencies(transformed.shape)
    radius = 2 * np.hypot(x, vertical)
    cutoff = p["cutoff"] / 100

    def lowpass(edge):
        ratio = radius / max(edge, 0.001)
        match p["variant"]:
            case "Ideal":
                return (ratio <= 1).astype(np.float32)
            case "Gaussian":
                return np.exp(-0.5 * ratio * ratio)
            case "Butterworth":
                return 1 / (1 + ratio ** (2 * p["order"]))

    match p["pass"]:
        case "Low-pass":
            mask = lowpass(cutoff)
        case "High-pass":
            mask = 1 - lowpass(cutoff)
        case band:
            width = p["band"] / 200
            mask = lowpass(cutoff + width) - lowpass(cutoff - width)
            if band == "Band-reject":
                mask = 1 - mask
    transformed *= mask[:, :, None]
    offset = 128 if p["pass"] in ("High-pass", "Band-pass") else 0
    return byte(inverse_fft(transformed, y.shape) + offset), {"Filter": f'{p["variant"]} {p["pass"]}'}


def notch(image, p, reference):
    y = gray(image)
    transformed = fft(y)
    x, vertical = frequencies(transformed.shape)
    x = x * transformed.shape[1]
    vertical = vertical * transformed.shape[0]
    first = np.hypot(x - p["x"], vertical - p["y"])
    second = np.hypot(x + p["x"], vertical + p["y"])
    inside = np.minimum(first, second) <= p["width"]
    mask = ~inside if p["variant"] == "Reject" else inside
    transformed *= mask[:, :, None]
    restored = inverse_fft(transformed, y.shape)
    return byte(restored + (128 if p["variant"] == "Pass" else 0))


def noise(image, p, reference):
    rng = np.random.default_rng(p["seed"])
    height, width = image.shape[:2]
    shape = height, width
    strength = p["amount"] / 100
    amplitude = strength * 110
    match p["variant"]:
        case "Salt and pepper" | "Salt" | "Pepper":
            mask = rng.random(shape, dtype=np.float32)
            result = image.copy()
            if p["variant"] == "Salt and pepper":
                result[mask < strength / 2] = 0
                result[mask > 1 - strength / 2] = 255
            else:
                result[mask < strength] = 255 if p["variant"] == "Salt" else 0
            return result
        case "Gaussian":
            offsets = rng.standard_normal(shape, dtype=np.float32) * amplitude
        case "Uniform":
            offsets = rng.uniform(-amplitude, amplitude, shape)
        case "Rayleigh":
            offsets = rng.rayleigh(amplitude, shape) - amplitude * math.sqrt(math.pi / 2)
        case "Exponential":
            offsets = rng.exponential(amplitude, shape) - amplitude
        case "Erlang":
            offsets = rng.gamma(3, amplitude / 3, shape) - amplitude
        case "Periodic":
            phases = np.linspace(0, 36 * math.pi, width, endpoint=False)
            offsets = np.broadcast_to(amplitude * np.sin(phases), shape)
        case "Speckle":
            offsets = rng.standard_normal(shape, dtype=np.float32) * strength * gray(image)
        case "Poisson":
            y = gray(image).astype(np.float32)
            scale = max(0.04, 1 - strength)
            offsets = rng.poisson(y * scale) / scale - y
    offsets = offsets.astype(np.float32)
    return byte(image.astype(np.float32) + (offsets[:, :, None] if image.ndim == 3 else offsets))


def denoise(image, p, reference):
    source = gray(image)
    size = p["size"]
    window = (size, size)
    kernel = np.ones(window, np.uint8)
    variant = p["variant"]
    match variant:
        case "Arithmetic mean":
            return cv.blur(source, window)
        case "Median":
            return cv.medianBlur(source, size)
        case "Minimum":
            return cv.erode(source, kernel)
        case "Maximum":
            return cv.dilate(source, kernel)
        case "Midpoint":
            return cv.addWeighted(cv.erode(source, kernel), 0.5, cv.dilate(source, kernel), 0.5, 0)
        case "Adaptive median":
            result = cv.medianBlur(source, size)
            resolved = np.zeros(source.shape, dtype=bool)
            for diameter in range(3, size + 1, 2):
                element = np.ones((diameter, diameter), np.uint8)
                minimum, maximum = cv.erode(source, element), cv.dilate(source, element)
                median = cv.medianBlur(source, diameter)
                good = ~resolved & (minimum < median) & (median < maximum)
                result[good] = np.where((source > minimum) & (source < maximum), source, median)[good]
                resolved |= good
            return result

    raw = source.astype(np.float32)
    positive = np.maximum(raw, 1e-4)
    match variant:
        case "Geometric mean":
            output = np.exp(cv.blur(np.log(positive), window))
            output[cv.erode(source, kernel) == 0] = 0
        case "Harmonic mean":
            output = 1 / cv.blur(1 / positive, window)
        case "Contraharmonic mean":
            order = p["order"]
            output = cv.blur(positive ** (order + 1), window) / cv.blur(positive ** order, window)
        case "Alpha-trimmed mean":
            total = cv.boxFilter(raw, -1, window, normalize=False)
            output = (total - cv.erode(source, kernel) - cv.dilate(source, kernel)) / (size * size - 2)
        case "Adaptive local mean":
            mean = cv.blur(raw, window)
            variance = np.maximum(cv.sqrBoxFilter(raw, cv.CV_32F, window) - mean * mean, 0.01)
            output = raw - np.minimum(p["variance"] / variance, 1) * (raw - mean)
    return byte(output)


def deblur(image, p, reference):
    y = gray(image)
    size = min(p["size"], (min(y.shape) - 1) // 2 * 2 + 1)
    if size < 3:
        return y
    if p["psf"] == "Motion":
        psf = motion_kernel(size, p["angle"])
    else:
        vector = cv.getGaussianKernel(size, size / 5, cv.CV_32F)
        psf = vector @ vector.T
    if p["variant"] == "Richardson–Lucy":
        observed = y.astype(np.float32) / 255
        estimate = np.full(y.shape, 0.5, np.float32)
        for _ in range(p["iterations"]):
            predicted = cv.filter2D(estimate, -1, psf)
            estimate *= cv.filter2D(observed / np.maximum(predicted, 1e-6), -1, psf[::-1, ::-1])
        return byte(estimate * 255), {"PSF": p["psf"], "Iterations": p["iterations"]}
    observed = fft(y)
    kernel = np.zeros(observed.shape[:2], np.float32)
    kernel[:size, :size] = psf
    kernel = np.roll(kernel, (-(size // 2), -(size // 2)), axis=(0, 1))
    transfer = cv.dft(kernel, flags=cv.DFT_COMPLEX_OUTPUT)
    real, imaginary = cv.split(transfer)
    power = real * real + imaginary * imaginary
    corrected = cv.mulSpectrums(observed, transfer, 0, conjB=True)
    regularizer = p["regularizer"]
    if p["variant"] == "Inverse filtering":
        corrected /= np.maximum(power, regularizer)[:, :, None]
        corrected[power < regularizer] = 0
    else:
        corrected /= (power + regularizer)[:, :, None]
    return byte(inverse_fft(corrected, y.shape)), {"PSF": p["psf"], "Regularization": regularizer}


def multi_otsu(y):
    counts = cv.calcHist([y], [0], None, [256], [0, 256]).ravel()
    weight = np.r_[0, np.cumsum(counts, dtype=np.float64)]
    moment = np.r_[0, np.cumsum(counts * np.arange(256), dtype=np.float64)]
    low, high = np.triu_indices(255, k=1)
    lower, upper = low + 1, high + 1
    w = np.array([weight[lower], weight[upper] - weight[lower], weight[-1] - weight[upper]])
    m = np.array([moment[lower], moment[upper] - moment[lower], moment[-1] - moment[upper]])
    valid = (w > 0).all(axis=0)
    if not valid.any():
        cutoff, result = cv.threshold(y, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU)
        return result, {"Threshold": int(cutoff)}
    best = np.argmax(np.where(valid, (m * m / np.maximum(w, 1)).sum(axis=0), -1))
    t1, t2 = int(low[best]), int(high[best])
    return np.uint8([0, 127, 255])[np.digitize(y, (t1 + 1, t2 + 1))], {"Thresholds": f"{t1}, {t2}"}


def auto_threshold(image, p, reference):
    y = gray(image)
    match p["variant"]:
        case "Otsu":
            threshold, output = cv.threshold(y, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU)
            return output, {"Threshold": int(threshold)}
        case "Multi-Otsu":
            return multi_otsu(y)
        case "Iterative":
            values = np.arange(256)
            counts = cv.calcHist([y], [0], None, [256], [0, 256]).ravel()
            threshold = int(round(y.mean()))
            for iteration in range(1, 33):
                cut = threshold + 1
                lower, higher = counts[:cut], counts[cut:]
                if lower.sum() == 0 or higher.sum() == 0:
                    break
                update = round((np.average(values[:cut], weights=lower) + np.average(values[cut:], weights=higher)) / 2)
                if update == threshold:
                    break
                threshold = update
            return binary(y, threshold), {"Threshold": int(threshold), "Iterations": iteration}
        case mode:
            method = cv.ADAPTIVE_THRESH_MEAN_C if mode == "Adaptive mean" else cv.ADAPTIVE_THRESH_GAUSSIAN_C
            return cv.adaptiveThreshold(y, 255, method, cv.THRESH_BINARY, p["size"], p["offset"])


def label_colors(labels):
    value = labels.astype(np.uint32)
    colors = np.stack((77 + value * 71 % 174, 62 + value * 127 % 190, 55 + value * 163 % 195), axis=-1)
    return colors.astype(np.uint8)


def region(image, p, reference):
    y = gray(image)
    height, width = y.shape
    tolerance = p["tolerance"]
    if p["variant"] == "Seeded":
        x = round((width - 1) * p["x"] / 100)
        row = round((height - 1) * p["y"] / 100)
        mask = np.zeros((height + 2, width + 2), np.uint8)
        flags = 4 | cv.FLOODFILL_FIXED_RANGE | cv.FLOODFILL_MASK_ONLY | (255 << 8)
        count, _, mask, _ = cv.floodFill(y, mask, (x, row), 0, tolerance, tolerance, flags)
        return mask[1:-1, 1:-1], {"Seed intensity": int(y[row, x]), "Selected pixels": count}
    labels = np.zeros(y.shape, np.int32)
    count = 0
    for lower in range(0, 256, tolerance):
        mask = cv.inRange(y, lower, min(255, lower + tolerance - 1))
        regions, components = cv.connectedComponents(mask, connectivity=4)
        selected = components > 0
        labels[selected] = components[selected] + count
        count += regions - 1
    return label_colors(labels), {"Connected intensity regions": count}


def split(image, p, reference):
    y = gray(image)
    height, width = y.shape
    values, squares = cv.integral2(y, sdepth=cv.CV_64F, sqdepth=cv.CV_64F)
    labels = np.empty(y.shape, np.int32)
    sums, counts = [], []
    threshold, minimum = p["tolerance"], p["minimum"]

    def area_sum(integral, x0, y0, x1, y1):
        return integral[y1, x1] - integral[y0, x1] - integral[y1, x0] + integral[y0, x0]

    def partition(x0, y0, x1, y1):
        count = (x1 - x0) * (y1 - y0)
        total = area_sum(values, x0, y0, x1, y1)
        variance = area_sum(squares, x0, y0, x1, y1) / count - (total / count) ** 2
        if min(x1 - x0, y1 - y0) >= 2 * minimum and variance > threshold ** 2:
            xmid, ymid = (x1 + x0) // 2, (y1 + y0) // 2
            for left, right in ((x0, xmid), (xmid, x1)):
                for top, bottom in ((y0, ymid), (ymid, y1)):
                    partition(left, top, right, bottom)
        else:
            labels[y0:y1, x0:x1] = len(sums)
            sums.append(total)
            counts.append(count)

    partition(0, 0, width, height)
    leaves = len(sums)
    parents = list(range(leaves))

    def root(node):
        while parents[node] != node:
            parents[node] = parents[parents[node]]
            node = parents[node]
        return node

    pairs = set()
    for a, b in ((labels[:, :-1], labels[:, 1:]), (labels[:-1, :], labels[1:, :])):
        different = a != b
        left, right = a[different], b[different]
        keys = np.unique(np.minimum(left, right) * leaves + np.maximum(left, right))
        pairs.update(divmod(int(key), leaves) for key in keys)
    for left, right in sorted(pairs, key=lambda pair: (abs(sums[pair[0]] / counts[pair[0]] - sums[pair[1]] / counts[pair[1]]), pair)):
        a, b = root(left), root(right)
        if a != b and abs(sums[a] / counts[a] - sums[b] / counts[b]) <= threshold:
            parents[b] = a
            sums[a] += sums[b]
            counts[a] += counts[b]
    merged = np.array([root(node) for node in range(leaves)])
    levels = np.array(sums) / np.array(counts)
    return byte(levels[merged[labels]]), {"Blocks": leaves, "Merged regions": len(set(merged))}


def kmeans(image, p, reference):
    height, width = image.shape[:2]
    pixels = image.reshape(-1, 3).astype(np.float32)
    features = pixels
    if p["spatial"]:
        positions = np.indices((height, width), dtype=np.float32).reshape(2, -1).T
        positions *= np.float32([255 / height, 255 / width]) * p["spatial"]
        features = np.column_stack((pixels, positions))
    stride = max(1, len(features) // 10000)
    sample = features[::stride].copy()
    clusters = min(p["clusters"], len(sample))
    if clusters < 2:
        return image, {"Clusters": clusters}
    cv.setRNGSeed(17)
    criteria = (cv.TERM_CRITERIA_EPS | cv.TERM_CRITERIA_MAX_ITER, 14, 0.5)
    _, _, centers = cv.kmeans(sample, clusters, None, criteria, 1, cv.KMEANS_PP_CENTERS)
    output = np.empty_like(image.reshape(-1, 3))
    palette = byte(centers[:, :3])
    for start in range(0, len(features), 16384):
        chunk = features[start:start + 16384]
        _, indices = cv.batchDistance(chunk, centers, cv.CV_32F, normType=cv.NORM_L2SQR, K=1)
        output[start:start + len(chunk)] = palette[indices[:, 0]]
    return output.reshape(image.shape), {"Clusters": clusters, "Training pixels": len(sample)}


def watershed(image, p, reference):
    mode = cv.THRESH_BINARY_INV if p["foreground"] == "Dark" else cv.THRESH_BINARY
    cutoff, mask = cv.threshold(gray(image), 0, 255, mode | cv.THRESH_OTSU)
    element = np.ones((3, 3), np.uint8)
    clean = cv.morphologyEx(mask, cv.MORPH_OPEN, element)
    background = cv.dilate(clean, element, iterations=2)
    distance = cv.distanceTransform(clean, cv.DIST_L2, 5)
    foreground = (distance > distance.max() * p["ratio"]).astype(np.uint8)
    count, markers = cv.connectedComponents(foreground)
    markers += 1
    markers[(background != 0) & (foreground == 0)] = 0
    cv.watershed(image, markers)
    output = image.copy()
    inside = markers > 1
    output[inside] = byte(0.6 * image[inside] + 0.4 * label_colors(markers[inside]))
    output[markers == -1] = (234, 188, 88)
    return output, {"Markers": count - 1, "Otsu threshold": int(cutoff)}


def morphology(image, p, reference):
    mask = binary(image, p["threshold"])
    if p["variant"] == "Hit or miss":
        pattern = np.int8([[-1, -1, -1], [0, 1, 0], [1, 1, 1]])
        return cv.morphologyEx(mask // 255, cv.MORPH_HITMISS, pattern) * 255
    shape = {"Ellipse": cv.MORPH_ELLIPSE, "Rectangle": cv.MORPH_RECT, "Cross": cv.MORPH_CROSS}[p["shape"]]
    element = cv.getStructuringElement(shape, (p["size"], p["size"]))
    operation = {
        "Erosion": cv.MORPH_ERODE, "Dilation": cv.MORPH_DILATE, "Opening": cv.MORPH_OPEN,
        "Closing": cv.MORPH_CLOSE, "Gradient": cv.MORPH_GRADIENT,
        "Top hat": cv.MORPH_TOPHAT, "Black hat": cv.MORPH_BLACKHAT,
    }[p["variant"]]
    return cv.morphologyEx(mask, operation, element, iterations=p["iterations"])


def components(image, p, reference):
    mask = binary(image, p["threshold"])
    count, labels, stats, _ = cv.connectedComponentsWithStats(mask, connectivity=int(p["connectivity"]))
    keep = stats[:, cv.CC_STAT_AREA] >= mask.size * p["area"] / 100
    keep[0] = False
    output = label_colors(labels)
    output[~keep[labels]] = (18, 18, 18)
    for index in np.flatnonzero(keep)[:250]:
        x, y, w, h, _ = stats[index]
        cv.rectangle(output, (x, y), (x + w - 1, y + h - 1), (220, 220, 220), 1)
    return output, {"Components": count - 1, "Above area limit": int(keep.sum())}


def quality(original, restored):
    psnr = cv.PSNR(original, restored)
    return "Exact" if psnr > 100 else f"{psnr:.2f} dB"


def encode_codec(image, p):
    fmt = p["variant"]
    if fmt == "PNG":
        extension, settings = ".png", [cv.IMWRITE_PNG_COMPRESSION, 3]
    elif fmt == "WebP":
        extension, settings = ".webp", [cv.IMWRITE_WEBP_QUALITY, p["quality"]]
    else:
        extension, settings = ".jpg", [cv.IMWRITE_JPEG_QUALITY, p["quality"]]
    ok, encoded = cv.imencode(extension, image, settings)
    if not ok:
        raise ValueError("The selected codec could not encode this image.")
    return extension, encoded


def compression(image, p, reference):
    _, encoded = encode_codec(image, p)
    output = cv.imdecode(encoded, cv.IMREAD_GRAYSCALE if image.ndim == 2 else cv.IMREAD_COLOR)
    return output, {"Encoded bytes": int(encoded.size), "Raw / encoded": f"{image.nbytes / encoded.size:.2f}×",
                    "PSNR": quality(image, output)}


def huffman_roundtrip(flat):
    values, counts = np.unique(flat, return_counts=True)
    heap = [(int(count), index, int(value)) for index, (value, count) in enumerate(zip(values, counts))]
    heapq.heapify(heap)
    serial = len(heap)
    while len(heap) > 1:
        a, _, left = heapq.heappop(heap)
        b, _, right = heapq.heappop(heap)
        heapq.heappush(heap, (a + b, serial, (left, right)))
        serial += 1
    root = heap[0][2]
    codes = {}
    agenda = [(root, 0, 0)]
    while agenda:
        node, code, length = agenda.pop()
        if isinstance(node, int):
            codes[node] = (code, max(1, length))
        else:
            agenda.extend(((node[0], code << 1, length + 1), (node[1], (code << 1) | 1, length + 1)))
    pack = bytearray()
    pending = bits = length = 0
    for value in flat.tolist():
        code, count = codes[value]
        pending = (pending << count) | code
        bits += count
        length += count
        while bits >= 8:
            bits -= 8
            pack.append(pending >> bits)
            pending &= (1 << bits) - 1
    if bits:
        pack.append(pending << (8 - bits))

    if isinstance(root, int):
        return np.full(flat.shape, root, flat.dtype), len(pack), length, len(codes)
    restored = []
    node = root
    for index in range(length):
        node = node[(pack[index // 8] >> (7 - index % 8)) & 1]
        if isinstance(node, int):
            restored.append(node)
            node = root
    return np.asarray(restored, flat.dtype), len(pack), length, len(codes)


def quadtree(mask):
    # Preorder code: a split is one bit, a uniform leaf is a leaf bit plus its value.
    height, width = mask.shape
    table = cv.integral(mask // 255, sdepth=cv.CV_32S)
    flags = bytearray()

    def encode(x0, y0, x1, y1):
        total = int(table[y1, x1] - table[y1, x0] - table[y0, x1] + table[y0, x0])
        if total in (0, (x1 - x0) * (y1 - y0)):
            flags.extend((0, int(total > 0)))
        else:
            flags.append(1)
            for box in quarters(x0, y0, x1, y1):
                encode(*box)

    def quarters(x0, y0, x1, y1):
        xmid, ymid = (x0 + x1) // 2, (y0 + y1) // 2
        return [(a, b, c, d) for a, c in ((x0, xmid), (xmid, x1))
                for b, d in ((y0, ymid), (ymid, y1)) if a < c and b < d]

    encode(0, 0, width, height)
    packed = np.packbits(np.frombuffer(flags, dtype=np.uint8))
    stream = iter(np.unpackbits(packed))
    output = np.empty_like(mask)

    def decode(x0, y0, x1, y1):
        if next(stream):
            for box in quarters(x0, y0, x1, y1):
                decode(*box)
        else:
            output[y0:y1, x0:x1] = int(next(stream)) * 255

    decode(0, 0, width, height)
    return output, packed.nbytes


def lossless(image, p, reference):
    variant = p["variant"]
    y = gray(image)
    if variant.startswith("Binary"):
        y = binary(shrink(y, 256) if variant == "Binary quadtree" else y, p["threshold"])
    flat = y.ravel()
    header = 8  # Width and height as two uint32 values.
    if variant == "Binary quadtree":
        output, encoded = quadtree(y)
    elif variant in ("RLE", "Binary RLE"):
        starts = np.r_[0, np.flatnonzero(flat[1:] != flat[:-1]) + 1]
        lengths = np.diff(np.r_[starts, len(flat)]).astype("<u4")
        if variant == "Binary RLE":
            symbols = (np.arange(len(starts), dtype=np.uint32) % 2).astype(np.uint8) * 255
            if flat[0] == 255:
                symbols = 255 - symbols
            encoded = lengths.nbytes + 1
        else:
            symbols = flat[starts]
            encoded = lengths.nbytes + symbols.nbytes
        output = np.repeat(symbols, lengths).reshape(y.shape)
    else:
        differential = variant == "DPCM"
        samples = np.diff(flat.astype(np.int16), prepend=np.int16(0)) if differential else flat
        restored, encoded, _, symbols = huffman_roundtrip(samples)
        # Store the Huffman tree as one flag per node and one fixed-width symbol per leaf.
        encoded += math.ceil((symbols * (17 if differential else 9) + symbols - 1) / 8)
        output = (np.cumsum(restored).astype(np.uint8) if differential else restored).reshape(y.shape)
    _, counts = np.unique(flat, return_counts=True)
    probability = counts / flat.size
    encoded += header
    return output, {"Encoded bytes (with header)": int(encoded), "Raw / encoded": f"{flat.nbytes / encoded:.2f}×",
                    "Entropy": f"{-(probability * np.log2(probability)).sum():.3f} bits/pixel",
                    "Exact round-trip": bool(np.array_equal(output, y))}


def fractal(image, p, reference):
    y = gray(image)
    height, width = y.shape
    size = p["size"]
    block = size * 2
    hpad, wpad = (-height) % block, (-width) % block
    source = cv.copyMakeBorder(y, 0, hpad, 0, wpad, cv.BORDER_REPLICATE).astype(np.float32)
    h, w = source.shape
    rows, cols = h // size, w // size

    def domains(matrix):
        small = cv.resize(matrix, (w // 2, h // 2), interpolation=cv.INTER_AREA)
        windows = np.lib.stride_tricks.sliding_window_view(small, (size, size))
        return np.ascontiguousarray(windows[::size, ::size]).reshape(-1, size * size)

    domain = domains(source)
    ranges = np.ascontiguousarray(source.reshape(rows, size, cols, size).transpose(0, 2, 1, 3)).reshape(-1, size * size)
    dmean, rmean = domain.mean(axis=1), ranges.mean(axis=1)
    dc, rc = domain - dmean[:, None], ranges - rmean[:, None]
    dot = cv.gemm(rc, dc, 1, None, 0, flags=cv.GEMM_2_T)
    energy = (dc * dc).sum(axis=1)
    gain = (dot / np.maximum(energy, 1)).clip(-0.9, 0.9)
    error = gain * gain * energy - 2 * gain * dot
    selected = error.argmin(axis=1)
    slope = np.rint(gain[np.arange(len(selected)), selected] * 127) / 127
    intercept = np.rint(rmean - slope * dmean[selected])
    decoded = np.full((h, w), 128, np.float32)
    for _ in range(p["iterations"]):
        blocks = (domains(decoded)[selected] * slope[:, None] + intercept[:, None]).clip(0, 255)
        decoded = blocks.reshape(rows, cols, size, size).transpose(0, 2, 1, 3).reshape(h, w)
    output = byte(decoded[:height, :width])
    bits = math.ceil(math.log2(len(domain))) + 8 + 16
    encoded = 9 + math.ceil(bits * len(selected) / 8)
    return output, {"Range blocks": len(selected), "Code size": f"{encoded} bytes", "PSNR": quality(y, output)}


def watermark(image, p, reference):
    text = p["message"].strip()
    if not text:
        return image
    height, width = image.shape[:2]
    size = max(0.3, min(height, width) / 570)
    text_width, _ = cv.getTextSize(text, cv.FONT_HERSHEY_DUPLEX, size, 1)[0]
    if text_width > width * 0.82:
        size *= width * 0.82 / max(1, text_width)
    text_width, text_height = cv.getTextSize(text, cv.FONT_HERSHEY_DUPLEX, size, 1)[0]
    pad = max(2, min(height, width) // 33)
    x, y = max(0, width - text_width - pad), max(text_height, height - pad)
    overlay = image.copy()
    cv.putText(overlay, text, (x + 1, y + 1), cv.FONT_HERSHEY_DUPLEX, size, (18, 18, 18), 2, cv.LINE_AA)
    cv.putText(overlay, text, (x, y), cv.FONT_HERSHEY_DUPLEX, size, (245, 245, 245), 1, cv.LINE_AA)
    return cv.addWeighted(image, 1 - p["opacity"], overlay, p["opacity"], 0)


def lsb(image, p, reference):
    header = struct.Struct(">4sH")
    plane = image[:, :, 0]
    if p["variant"] == "Embed":
        message = p["message"].encode("utf-8")
        stream = header.pack(b"CTRL", len(message)) + message
        bits = np.unpackbits(np.frombuffer(stream, dtype=np.uint8))
        if bits.size > plane.size:
            raise ValueError("The image is too small for this message.")
        result = image.copy()
        target = result[:, :, 0].flat
        target[:bits.size] = (target[:bits.size] & 254) | bits
        return result, {"Embedded bytes": len(message), "Safe export": "PNG"}
    if plane.size < header.size * 8:
        return image, {"Message": "No embedded message found"}
    marker, count = header.unpack(np.packbits(plane.flat[:header.size * 8] & 1).tobytes())
    if marker != b"CTRL" or count > 384 or (header.size + count) * 8 > plane.size:
        return image, {"Message": "No embedded message found"}
    payload = np.packbits(plane.flat[header.size * 8:(header.size + count) * 8] & 1).tobytes()
    return image, {"Decoded message": payload.decode("utf-8", errors="replace"), "Message bytes": count}
