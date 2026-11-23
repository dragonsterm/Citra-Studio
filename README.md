# Citra Studio

Citra Studio adalah aplikasi pengolahan citra desktop untuk Windows x64. Antarmukanya memakai Electron dan pemrosesan berjalan lokal di Python 3.13.12 dengan OpenCV dan NumPy.

## Pakai aplikasi

1. Jalankan `dist/Citra-Studio-Windows-x64.exe`. Paket portabel sudah membawa Electron, Python, dan model CNN.
2. Pilih **Pick a photo**, jatuhkan foto dari Explorer, atau tekan **Start webcam**. **Open sample image** menyediakan citra latihan.
3. Klik metode atau seret ke kanvas. Tahan **Ctrl** saat memilih beberapa metode, lalu seret pilihan atau tekan **Add**. Maksimal 12 widget hasil aktif, masing-masing memproses sumber yang sama.
4. Tahan dan seret badan atau judul widget untuk memindahkannya di grid. Gunakan pin untuk mempertahankan widget di bagian atas saat menggulir hasil lain. Seret sudut kanan bawah untuk mengatur ukuran atau gunakan **Focus** untuk memperbesar satu widget.
5. Pilih widget untuk melihat histogram, rumus, parameter, dan hasil perhitungannya. **Debug** menunjukkan waktu pemrosesan, waktu bolak-balik, FPS hasil webcam, dimensi, dan log sesi. Tambahkan **Reference photo** untuk operasi dua citra.
6. Gunakan tombol unduh pada widget atau **Ctrl+S** untuk menyimpan hasil. **Freeze webcam frame** mengubah frame kamera menjadi foto yang dapat diproses dan disimpan.
7. Buka **Compare live telemetry** dari tombol gelombang di dock bawah. Panel ini memperlihatkan histogram dan statistik untuk sumber serta semua hasil. Seret atau pin kartu histogram secara terpisah dari kanvas. Pilih **Luma** atau **RGB**, arahkan kursor ke grafik untuk membandingkan bin yang sama, dan klik untuk menguncinya.

Foto dapat dibuka dalam format PNG, JPEG, WebP, BMP, dan TIFF hingga 48 MB dan 24 megapiksel. Hasil dapat disimpan sebagai PNG, JPEG, atau WebP. LSB memakai PNG agar bit pesan tetap utuh. Ekspor foto diproses ulang dari sumber asli. Dimensi hasil mengikuti operasinya, termasuk batas ukuran kerja pada metode seperti kompresi fraktal dan beberapa filter frekuensi.

Tombol minimize menurunkan jendela ke taskbar. Tombol **X** dan **Alt+F4** menyembunyikan jendela ke tray. Klik ikon tray untuk membuka kembali workspace, atau klik kanan dan pilih **Exit Citra Studio** untuk menutup aplikasi sepenuhnya. Pintasan taskbar **Pick a photo**, **Start webcam**, dan **Show telemetry** tersedia melalui Jump List. Webcam dilepas ketika jendela diminimalkan atau disembunyikan.

## Metode

Katalog berisi 52 jenis widget dengan varian yang dapat dipilih di dalam widget. Histogram luminans dan RGB tersedia pada sumber dan hasil.

| Keluarga | Cakupan |
| --- | --- |
| Intensitas dan histogram | Grayscale, ambang tunggal dan ganda, negatif, brightness, contrast, gamma, log, bit plane, kuantisasi, aritmetika, Boolean, equalization, dan spesifikasi histogram |
| Filter spasial dan CNN | Blur, smoothing, sharpening, konvolusi, emboss, sketch, feature map CNN, dan klasifikasi MobileNetV2 |
| Geometri dan warna | Mirroring, rotasi, translasi, sampling, crop, koreksi geometrik, kanal model warna, pengaturan HSV, dan pseudo-color |
| Tepi dan frekuensi | Gradien, Sobel, Prewitt, Roberts, Laplacian, LoG, DoG, Canny, kernel laporan, Hough, kontur, sudut, Fourier, DCT, dan filter frekuensi |
| Derau dan restorasi | Derau aditif, impuls, periodik dan lainnya, peredam derau spasial, serta deblur Wiener, inverse filtering dan Richardson–Lucy |
| Segmentasi dan biner | Otsu, multi-Otsu, ambang iteratif dan adaptif, region growing, split & merge, K-means, watershed, PP-HumanSeg, morfologi dan komponen terhubung |
| Kompresi dan penyisipan | JPEG, PNG, WebP, Huffman, RLE, quadtree, DPCM, fraktal, watermark dan LSB |

Acuan metode dan istilah berasal dari foto kelas, RPS, 26 modul, dan contoh proyek Mini Photoshop. [Folder materi Pengolahan Citra](https://drive.google.com/drive/folders/1jea0er4VFqNAwYMPu3uK_meaErxzBni5) · [Contoh proyek](https://drive.google.com/file/d/1qExm3pfyIgjp874wQNkqzUFNZ1QAhymk/view)

Klasifikasi dan segmentasi semantik memakai model terlatih. Widget feature map memperlihatkan konvolusi, ReLU dan pooling sebagai simulasi pembelajaran. [MobileNetV2](https://github.com/opencv/opencv_zoo/tree/main/models/image_classification_mobilenet) · [PP-HumanSeg](https://github.com/opencv/opencv_zoo/tree/main/models/human_segmentation_pphumanseg)

## Build dari kode sumber

Pada Windows x64 dengan Node.js dan `uv` tersedia di PATH, jalankan dari folder proyek.

```powershell
npm.cmd run build
```

Build menyiapkan Python 3.13.12 dengan `uv`, memverifikasi checksum model, lalu membuat `dist/Citra-Studio-Windows-x64.exe`. Build pertama memerlukan internet. Sesudah build, gunakan `npm.cmd start` untuk menjalankan versi pengembangan dan `npm.cmd run check` untuk memeriksa sintaks JavaScript.

`app/` memuat antarmuka dan integrasi Windows. `engine/` memuat katalog, algoritma, dan mesin Python. `scripts/` memuat perakitan. Cache, dependensi terpasang, dan hasil build diabaikan oleh Git.
