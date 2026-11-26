# Citra Studio

Citra Studio is a desktop lab for learning and experimenting with digital image processing on Windows x64. The interface runs in Electron, and the app processes images locally using Python 3.13.12, OpenCV, and NumPy.

## Download and run

Open [GitHub Releases](https://github.com/dragonsterm/Citra-Studio/releases) and download `Citra-Studio-Windows-x64.exe` from the latest release's **Assets** section. Run the downloaded file to open the app. The portable build bundles Electron, the Python engine, and the pretrained models, so no separate installation is required.

## Use the workspace

1. Select **Pick a photo**, drag a photo in from File Explorer, or select **Start webcam**. Select **Open sample image** to try the app with a built-in image.
2. Use **New methods use** in the library to choose **Original source** or an existing result. Click a method or drag it onto the canvas. Hold **Ctrl** to select multiple methods, then drag the selection or click **Add**. You can keep up to 12 result widgets active.
3. Drag a widget by its body or title to move it in the grid. Pin it to keep it at the top while you scroll through other results. Drag its bottom-right corner to resize it or select **Focus** to enlarge it.
4. Select a widget to see its histogram, formula, parameters, and calculated values. Change **Input image** to switch its source. Downstream results update when an upstream method changes. If you remove a widget, any direct dependents switch to its input. Open **Debug** to see processing time, round-trip time, webcam output FPS, dimensions, and session logs. Select **Reference photo** for operations that use two images.
5. Use a widget's download button or press **Ctrl+S** to save a result. Select **Freeze webcam frame** to turn the current camera frame into a photo you can process and save.
6. Use the waveform button in the bottom dock to open **Compare live telemetry**. Drag the top edge up or down to resize the panel, or select **Pop out comparison** to move it to its own window. Select **Dock comparison in workspace** to bring it back with its current settings. The panel shows histograms and statistics for the source and each result. You can arrange and pin the histogram cards independently of the canvas. Choose **Luma** or **RGB**, hover over a chart to compare the same bin across cards, and click to lock the comparison.

The app opens PNG, JPEG, WebP, BMP, and TIFF images up to 48 MB and 24 megapixels. Results can be saved as PNG, JPEG, or WebP. LSB output uses PNG to preserve the embedded bits. Photo export runs the selected result's method chain from the full-resolution original. Output dimensions depend on the method, including working-size limits for fractal compression and some frequency filters.

Minimizing sends the window to the taskbar. **X** and **Alt+F4** hide it in the system tray. Click the tray icon to reopen the workspace, or right-click it and choose **Exit Citra Studio** to quit. The taskbar Jump List offers **Pick a photo**, **Start webcam**, and **Show telemetry**. The app releases the webcam when you minimize or hide the window.

## Processing methods

The catalog includes 52 widget types. Some widgets offer multiple variants. Luminance and RGB histograms are available for both the source and results.

| Category | Methods |
| --- | --- |
| Intensity and histograms | Grayscale, single and dual thresholding, negative, brightness, contrast, gamma and logarithmic transforms, bit planes, quantization, arithmetic and Boolean operations, histogram equalization, and histogram specification |
| Spatial filters and CNNs | Blur, smoothing, sharpening, convolution, emboss, sketch, CNN feature maps, and MobileNetV2 classification |
| Geometry and color | Mirroring, rotation, translation, sampling, cropping, geometric correction, color model channels, HSV adjustments, and pseudocolor |
| Edges and frequency | Gradients, Sobel, Prewitt, Roberts, Laplacian, LoG, DoG, Canny, kernels from the course report, Hough transforms, contours, corners, Fourier transforms, DCT, and frequency filters |
| Noise and restoration | Additive, impulse, periodic, and other noise types, spatial denoising, and deblurring with Wiener filtering, inverse filtering, and Richardson-Lucy deconvolution |
| Segmentation and binary images | Otsu, multi-Otsu, iterative and adaptive thresholding, region growing, split and merge, K-means, watershed, PP-HumanSeg, morphology, and connected components |
| Compression and data embedding | JPEG, PNG, WebP, Huffman coding, RLE, quadtree, DPCM, fractal compression, watermarking, and LSB |

The methods and terminology draw on images used in class, the course syllabus, 26 modules, and the Mini Photoshop example project. [Image processing course materials](https://drive.google.com/drive/folders/1jea0er4VFqNAwYMPu3uK_meaErxzBni5) · [Example project](https://drive.google.com/file/d/1qExm3pfyIgjp874wQNkqzUFNZ1QAhymk/view)

Image classification and human segmentation use pretrained models. The feature map widget demonstrates convolution, ReLU, and pooling in an educational simulation. [MobileNetV2](https://github.com/opencv/opencv_zoo/tree/main/models/image_classification_mobilenet) · [PP-HumanSeg](https://github.com/opencv/opencv_zoo/tree/main/models/human_segmentation_pphumanseg)

## Build from source

On Windows x64, make sure Node.js and `uv` are on your PATH. From the project directory, run the build command.

```powershell
npm.cmd run build
```

The first build requires an internet connection. The build sets up Python 3.13.12 with `uv`, verifies the model checksums, and creates `dist/Citra-Studio-Windows-x64.exe`. If an earlier build is running, the new EXE includes its version in the filename. After building, use `npm.cmd start` to run the development version and `npm.cmd run check` to check JavaScript syntax.

- `app/` contains the interface and Windows integration.
- `engine/` contains the method catalog, algorithms, and Python engine.
- `scripts/` contains the packaging script.

Git ignores caches, installed dependencies, and build output.

## License

The project is available under the [MIT License](LICENSE).
