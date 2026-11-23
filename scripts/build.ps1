$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')

function Assert-Success([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed (exit $LASTEXITCODE)." }
}

function Get-Sha256([string]$File) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($File)
    try {
        return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '')
    } finally {
        $stream.Dispose()
        $algorithm.Dispose()
    }
}

function Get-PinnedFile([string]$Url, [string]$File, [string]$Sha256) {
    if ((Test-Path -LiteralPath $File) -and (Get-Sha256 $File) -eq $Sha256) { return }
    $partial = "$File.download"
    try {
        curl.exe --fail --silent --show-error --location --max-time 120 --output $partial $Url
        Assert-Success 'Model download'
        if ((Get-Sha256 $partial) -ne $Sha256) { throw "Hash mismatch for $File." }
        Move-Item -LiteralPath $partial -Destination $File -Force
    } finally {
        if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial }
    }
}

$build = (New-Item -ItemType Directory -Force -Path '.build').FullName
$env:UV_CACHE_DIR = Join-Path $build 'uv-cache'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $build 'python'
$env:UV_LINK_MODE = 'copy'
$env:npm_config_cache = Join-Path $build 'npm-cache'
$env:ELECTRON_CACHE = Join-Path $build 'electron-cache'
$env:ELECTRON_BUILDER_CACHE = Join-Path $build 'builder-cache'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
$env:PYTHONUTF8 = '1'
$ProgressPreference = 'SilentlyContinue'

$python = Join-Path $build 'venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    uv python install 3.13.12 --no-bin
    Assert-Success 'Python download'
    uv venv --python 3.13.12 --managed-python .build/venv
    Assert-Success 'Python environment'
}
& $python -c "import sys; assert sys.version_info[:3] == (3, 13, 12), sys.version"
Assert-Success 'Python version check'
uv pip install --python $python -r engine/requirements.txt
Assert-Success 'Python dependencies'

$models = (New-Item -ItemType Directory -Force -Path '.build/models').FullName
$revision = '48b10fa505aeb51fbd127fc60a5c660040e823b7'
$raw = "https://raw.githubusercontent.com/opencv/opencv_zoo/$revision/models"
$media = "https://media.githubusercontent.com/media/opencv/opencv_zoo/$revision/models"
Get-PinnedFile "$media/image_classification_mobilenet/image_classification_mobilenetv2_2022apr_int8.onnx" (Join-Path $models 'mobilenetv2.onnx') 'cc028fe6cae7bc11a4ff53cfc9b79c920e8be65ce33a904ec3e2a8f66d77f95f'
Get-PinnedFile "$media/human_segmentation_pphumanseg/human_segmentation_pphumanseg_2023mar.onnx" (Join-Path $models 'pphumanseg.onnx') '552d8a984054e59b5d773d24b9b12022b22046ceb2bbc4c9aaeaceb36a9ddf24'
Get-PinnedFile "$raw/human_segmentation_pphumanseg/LICENSE" (Join-Path $models 'LICENSE.txt') 'd9cf3b547fa4232fb9285f2db52e909f10f00781aaf64a6d0bb90c55149f1363'
$labels = Join-Path $models 'imagenet.txt'
$labelHash = '0df974a6fdfba8f5bbb7510f1794a7865206e887f0730a498f548fe48b28f933'
if (-not (Test-Path -LiteralPath $labels) -or (Get-Sha256 $labels) -ne $labelHash) {
    $labelSource = "$labels.download"
    try {
        curl.exe --fail --silent --show-error --location --max-time 45 --output $labelSource "$raw/image_classification_mobilenet/mobilenet.py"
        Assert-Success 'Label download'
        $source = [IO.File]::ReadAllText($labelSource)
        if ($source -notmatch "(?s)LABELS_IMAGENET_1K = '''(.*?)'''") { throw 'ImageNet labels are missing.' }
        $labelText = ($Matches[1].Trim() -replace '\r\n', [string][char]10) + [char]10
        [IO.File]::WriteAllText($labels, $labelText, [Text.UTF8Encoding]::new($false))
        if ((Get-Sha256 $labels) -ne $labelHash) { throw 'ImageNet label hash mismatch.' }
    } finally {
        if (Test-Path -LiteralPath $labelSource) { Remove-Item -LiteralPath $labelSource }
    }
}
@'
Models and ImageNet labels from OpenCV Zoo (Apache License 2.0).
MobileNetV2: https://github.com/opencv/opencv_zoo/tree/main/models/image_classification_mobilenet
PP-HumanSeg: https://github.com/opencv/opencv_zoo/tree/main/models/human_segmentation_pphumanseg
PP-HumanSeg port copyright (C) 2021 Shenzhen Institute of Artificial Intelligence and Robotics for Society.
'@ | Set-Content -LiteralPath (Join-Path $models 'NOTICE.txt') -Encoding utf8

# npm run can pass a user allow-list as a CLI-only environment override.
# This build does not use dependency install hooks.
Remove-Item Env:npm_config_allow_scripts -ErrorAction SilentlyContinue
npm.cmd ci --ignore-scripts --no-audit --no-fund
Assert-Success 'Electron dependencies'

$catalog = (Resolve-Path 'engine/methods.json').Path
& $python -m PyInstaller --noconfirm --onedir --name citra-engine --distpath .build/engine-dist `
    --workpath .build/pyinstaller --specpath .build --add-data "$($catalog):." --add-data "$($models):models" engine/worker.py
Assert-Success 'Engine packaging'

$internal = Join-Path $build 'engine-dist/citra-engine/_internal'
# Webcam capture runs in Chromium. The OpenCV FFmpeg video-file plugin is unused.
Get-ChildItem -LiteralPath (Join-Path $internal 'cv2') -Filter 'opencv_videoio_ffmpeg*.dll' -File |
    Remove-Item
$licenses = (New-Item -ItemType Directory -Force -Path (Join-Path $internal 'licenses')).FullName
$pythonHome = & $python -c "import sys; print(sys.base_prefix)"
Copy-Item -LiteralPath (Join-Path $pythonHome 'LICENSE.txt') -Destination (Join-Path $licenses 'Python.txt')
$opencv = Join-Path $build 'venv/Lib/site-packages/opencv_python_headless-4.13.0.92.dist-info'
Copy-Item -LiteralPath (Join-Path $opencv 'LICENSE.txt') -Destination (Join-Path $licenses 'OpenCV.txt')
Copy-Item -LiteralPath (Join-Path $opencv 'LICENSE-3RD-PARTY.txt') -Destination (Join-Path $licenses 'OpenCV-third-party.txt')
& '.\node_modules\.bin\electron-builder.cmd' --win portable --x64 --publish never
Assert-Success 'Portable packaging'
New-Item -ItemType Directory -Force -Path 'dist' | Out-Null
Copy-Item -LiteralPath '.build/package/Citra-Studio-Windows-x64.exe' -Destination 'dist'
Get-Item -LiteralPath 'dist/Citra-Studio-Windows-x64.exe' | Select-Object FullName,Length
