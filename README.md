# Velover Image Extractor - Cloudflare Worker

Konversi gambar ke format string terkompresi untuk Roblox `EditableImage`, diadaptasi langsung dari C++ **Velover Template** (`ExtactImageData`).

## Alur Konversi (Sesuai Velover Template)
1. **Decode & Resize**: Gambar (PNG/JPEG) dibaca dan di-resize jika lebar/tinggi > 1024 (aspect ratio tetap).
2. **QOI Encoding**: Raw pixel dienkode ke format spesifikasi QOI (Little-Endian header sesuai Velover Template).
3. **Base64 (Step 1)**: Buffer biner QOI di-encode ke Base64 string.
4. **ZLib Deflate (Step 2)**: String Base64 dikompresi dengan raw Deflate (RFC 1951, level 5, fixed strategy).
5. **Base64 (Step 3)**: Hasil kompresi biner di-encode lagi ke Base64 string akhir.

Di Roblox, string ini di-decode dengan alur:
`fromBase64 -> zLib.Deflate.Decompress -> fromBase64 -> QoiDecode -> EditableImage`

---

## Catatan Tentang Library OpenCV & Cloudflare Worker
- Di C++ asli, OpenCV (`cv::imread` & `cv::resize`) hanya digunakan untuk membaca pixel dan me-resize gambar ke <= 1024x1024.
- Library OpenCV WebAssembly (`@techstark/opencv-js`) berukuran ~8-15 MB, yang dapat melebihi batas bundle Cloudflare Workers Free Plan (1 MB) dan memerlukan polyfill DOM Canvas.
- Worker ini menyertakan dependensi `@techstark/opencv-js` (jika Anda memiliki Worker Paid/Enterprise atau environment container) **serta** engine bawaan berbasis WebAssembly/Pure-JS yang menjalankan algoritma resize bilinear (identik dengan `cv::INTER_LINEAR` OpenCV) dengan ukuran bundle ultra-kecil (< 200 KB) sehingga dijamin 100% lolos deploy di Cloudflare Workers.

---

## Cara Deploy ke GitHub dan Cloudflare Worker

### 1. Buat Repositori GitHub Baru
Copy folder `velover-cf-worker` ini ke repositori baru Anda:
```bash
git init
git add .
git commit -m "feat: initial commit velover cloudflare worker"
git branch -M main
git remote add origin https://github.com/<username>/<repo-name>.git
git push -u origin main
```

### 2. Dapatkan Kredensial Cloudflare
1. Buka [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Masuk ke **My Profile** -> **API Tokens** -> **Create Token**.
3. Pilih template **Edit Cloudflare Workers** -> Buat token dan simpan.
4. Salin **Account ID** dari dashboard Workers Anda.

### 3. Simpan Secret di Repositori GitHub
Buka GitHub Repo -> **Settings** -> **Secrets and variables** -> **Actions** -> Buat Secrets:
- `CLOUDFLARE_API_TOKEN` = `<Token API Anda>`
- `CLOUDFLARE_ACCOUNT_ID` = `<Account ID Anda>`

Setiap kali Anda push ke branch `main`, GitHub Actions akan otomatis mendeploy Worker Anda.

---

## Cara Menggunakan API

### Endpoint: `POST /convert`

#### Opsi 1: Menggunakan cURL (Multipart Form Data)
```bash
curl -X POST "https://<your-worker>.<subdomain>.workers.dev/convert" \
  -F "image=@sample.png"
```

#### Opsi 2: Menggunakan cURL (Raw Image Binary)
```bash
curl -X POST "https://<your-worker>.<subdomain>.workers.dev/convert" \
  --data-binary "@sample.png" \
  -H "Content-Type: image/png"
```

#### Opsi 3: Menggunakan JSON (Base64)
```bash
curl -X POST "https://<your-worker>.<subdomain>.workers.dev/convert" \
  -H "Content-Type: application/json" \
  -d '{"imageBase64": "data:image/png;base64,iVBORw0KGgo..."}'
```

#### Format Response JSON:
```json
{
  "success": true,
  "name": "sample.png",
  "width": 512,
  "height": 512,
  "channels": 4,
  "data": "eJztwTEBAAAAwqD1T20JT6AAAHgbCWAAAQ==",
  "size": 36
}
```

Jika header `Accept: text/plain` dikirim, Worker akan langsung mengembalikan string `data` saja (sama persis dengan isi file `.txt` hasil output `VeloverTemplate.exe`).
