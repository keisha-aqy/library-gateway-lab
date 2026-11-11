# Library Gateway Lab

Sistem perpustakaan sederhana untuk belajar **Apache APISIX** (API gateway dan load balancer) dan **Keycloak** (login, SSO, dan role). Backend memakai Node.js (Express), data disimpan di PostgreSQL, dan frontend dibuat dengan React (Vite).

> **Proyek belajar.** Semua password, secret, dan pengaturan keamanan di repo ini hanya untuk lab lokal. Jangan dipakai apa adanya di lingkungan produksi.

## Apa yang didemokan

- **Load balancing**: APISIX membagi request secara round robin ke dua backend. Di pojok halaman ada badge "Dilayani oleh: POD 1/POD 2".
- **Autentikasi**: login lewat Keycloak (OpenID Connect + PKCE). APISIX memvalidasi token JWT sebelum request mencapai backend.
- **Otorisasi berbasis role**: `member`, `librarian`, dan `admin` punya hak akses berbeda.
- **Rate limiting**: APISIX membatasi jumlah request dan membalas `429` bila terlampaui.
- **High availability**: satu backend dimatikan, aplikasi tetap berjalan.

## Arsitektur

```
React :5173 ──login──► Keycloak :8080
   │  (mendapat token JWT)
   ▼
APISIX :9080 ──── etcd          (rute disimpan di etcd)
   │  validasi token, CORS, rate limit
   ├──► backend-1 ┐
   └──► backend-2 ┴──► PostgreSQL (db: library)

Keycloak ──► PostgreSQL (db: keycloak)
```

Backend **tidak dibuka ke luar**. Satu-satunya jalan masuk adalah APISIX, yang sudah memvalidasi token. Karena itu backend hanya membaca isi token (ID pengguna dan role) tanpa memvalidasi ulang tanda tangannya.

## Teknologi

| Komponen                   | Fungsi                                                 |
| -------------------------- | ------------------------------------------------------ |
| Apache APISIX + etcd       | API gateway, load balancer, rate limit, validasi token |
| Keycloak                   | Identity provider (login, registrasi, role)            |
| Node.js + Express          | REST API perpustakaan                                  |
| PostgreSQL                 | Data buku, peminjaman, dan data Keycloak               |
| React + Vite + keycloak-js | Antarmuka web                                          |
| Docker Compose             | Menjalankan seluruh layanan                            |

## Fitur aplikasi

| Peran              | Hak akses                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Tamu (belum login) | Melihat dan mencari katalog                                                              |
| `member`           | Meminjam dan mengembalikan buku, melihat pinjaman sendiri                                |
| `librarian`        | Semua hak member, ditambah menambah/mengubah/menghapus buku dan melihat semua peminjaman |
| `admin`            | Semua hak librarian, ditambah statistik                                                  |

Aturan peminjaman: maksimal 3 buku aktif per anggota, masa pinjam 7 hari, dan buku dengan stok 0 tidak bisa dipinjam.

## Struktur repo

```
library-gateway-lab/
├── docker-compose.yml
├── .env.example              # contoh variabel lingkungan
├── apisix/
│   ├── config.yaml           # konfigurasi APISIX (etcd, Admin API)
│   ├── setup-routes.ps1      # pasang rute (PowerShell)
│   └── setup-routes.sh       # pasang rute (bash)
├── keycloak/
│   └── realm-export.json     # realm, client, role, dan user demo
├── postgres/
│   └── init.sql              # membuat database keycloak
├── backend/                  # Node.js + Express
├── frontend/                 # React + Vite
└── docs/                     # screenshot
```

## Prasyarat

- Docker Desktop (atau Docker Engine + Compose)
- Node.js 20 atau lebih baru
- Git

## Cara menjalankan

### 1. Clone dan siapkan environment

```bash
git clone https://github.com/USERNAME/library-gateway-lab.git
cd library-gateway-lab
```

Salin `.env.example` menjadi `.env`, lalu isi nilainya:

```powershell
# PowerShell
Copy-Item .env.example .env
```

```bash
# bash
cp .env.example .env
```

Isi `.env`, **tanpa tanda kutip** dan disimpan sebagai UTF-8:

```
POSTGRES_PASSWORD=isi_password_anda
KC_ADMIN_PASSWORD=isi_password_admin_keycloak
APISIX_ADMIN_KEY=isi_kunci_acak_panjang
```

### 2. Jalankan semua layanan

```bash
docker compose up -d --build
```

Tunggu sekitar 30 detik sampai Keycloak siap. Cek dengan:

```bash
docker compose ps
docker compose logs keycloak --tail 20
```

### 3. Pasang rute APISIX

Rute disimpan di etcd, jadi perlu dipasang setiap kali data etcd kosong (pertama kali, atau setelah `down -v`).

```powershell
# PowerShell
powershell -ExecutionPolicy Bypass -File .\apisix\setup-routes.ps1
```

```bash
# bash / Git Bash
bash apisix/setup-routes.sh
```

Hasilnya harus menampilkan `Route 1 OK` sampai `Route 4 OK`.

### 4. Jalankan frontend

```bash
cd frontend
npm install
npm run dev
```

Buka **http://localhost:5173**. Pastikan Vite berjalan di port 5173, karena CORS dan redirect Keycloak diatur untuk port itu.

## Akun demo

| Username | Password   | Role                     |
| -------- | ---------- | ------------------------ |
| `budi`   | `budi123`  | member                   |
| `sari`   | `sari123`  | member, librarian        |
| `admin1` | `admin123` | member, librarian, admin |

Admin console Keycloak: http://localhost:8080/admin (username `admin`, password sesuai `KC_ADMIN_PASSWORD` di `.env`).

### Registrasi akun baru

Halaman login Keycloak punya tombol **Register**. Agar akun baru otomatis berstatus `member`, role itu harus menjadi default role di realm. Jika setelah mendaftar kamu mendapat pesan `403: Butuh role member` saat meminjam buku:

1. Buka admin console, pilih realm **library**.
2. **Realm settings → User registration → Default roles → Assign role**, lalu pilih `member`.
3. Untuk akun yang sudah terlanjur dibuat: **Users → (akun) → Role mapping → Assign role → member**.
4. Logout lalu login ulang, karena role tersimpan di dalam token.

## Route APISIX

| Path                                      | Akses                                 | Plugin                                  |
| ----------------------------------------- | ------------------------------------- | --------------------------------------- |
| `/api/info`, `/api/books`, `/api/books/*` | Publik                                | `cors`, `limit-count`                   |
| `/api/loans`, `/api/loans/*`              | Login                                 | `cors`, `openid-connect`, `limit-count` |
| `/api/manage/*`                           | Login (role dicek backend: librarian) | `cors`, `openid-connect`, `limit-count` |
| `/api/admin/*`                            | Login (role dicek backend: admin)     | `cors`, `openid-connect`, `limit-count` |

## Endpoint API

| Endpoint                       | Akses     | Fungsi                           |
| ------------------------------ | --------- | -------------------------------- |
| `GET /api/info`                | Publik    | Identitas POD yang melayani      |
| `GET /api/books?q=`            | Publik    | Katalog dan pencarian            |
| `GET /api/books/:id`           | Publik    | Detail buku                      |
| `POST /api/loans`              | member    | Meminjam buku (`{"book_id": 1}`) |
| `GET /api/loans/me`            | member    | Riwayat pinjaman sendiri         |
| `POST /api/loans/:id/return`   | member    | Mengembalikan buku               |
| `POST /api/manage/books`       | librarian | Menambah buku                    |
| `PUT /api/manage/books/:id`    | librarian | Mengubah buku                    |
| `DELETE /api/manage/books/:id` | librarian | Menghapus buku                   |
| `GET /api/manage/loans`        | librarian | Semua peminjaman                 |
| `GET /api/admin/stats`         | admin     | Statistik perpustakaan           |

## Skenario demo

1. Buka katalog tanpa login. Refresh beberapa kali dan badge POD berganti-ganti.
2. Login sebagai `budi`, lalu pinjam sebuah buku. Stok berkurang.
3. Panggil `/api/manage/loans` dengan token budi. Hasilnya **403**.
4. Tanpa token, panggil `/api/loans/me`. Hasilnya **401**.
5. Tembak `/api/books` berulang kali. Setelah melewati batas, hasilnya **429**.
6. Login sebagai `sari`, tab **Kelola Buku** muncul. Tambahkan buku baru.
7. Login sebagai `admin1`, tab **Admin** menampilkan statistik.
8. Matikan satu backend: `docker compose stop backend-1`. Aplikasi tetap berjalan dan badge hanya menampilkan POD 2. Nyalakan lagi dengan `docker compose start backend-1`.

### Menguji dari terminal (PowerShell)

```powershell
# Ambil token (hanya untuk uji; token berlaku sekitar 5 menit)
$resp = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:8080/realms/library/protocol/openid-connect/token" `
  -Body @{ grant_type = "password"; client_id = "library-frontend"; username = "budi"; password = "budi123" }
$TOKEN = $resp.access_token

# Load balancing: hasilnya bergantian POD 1 / POD 2
1..4 | ForEach-Object { (Invoke-RestMethod http://localhost:9080/api/info).pod }

# Endpoint terlindungi dengan token
Invoke-RestMethod http://localhost:9080/api/loans/me -Headers @{ Authorization = "Bearer $TOKEN" }
```

## Perintah yang berguna

```bash
docker compose ps                    # status container
docker compose logs apisix --tail 30 # log APISIX
docker compose down                  # hentikan (data tetap aman)
docker compose down -v               # hentikan DAN hapus semua data
```

> `down -v` menghapus volume: database (akun yang didaftarkan, data pinjaman), data etcd (rute APISIX), dan data Keycloak. Setelah itu, jalankan ulang langkah 2 dan 3. Realm Keycloak dan data buku contoh akan terisi otomatis lagi.

## Troubleshooting

| Gejala                                       | Kemungkinan penyebab dan solusi                                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `Unable to connect` ke port 9180/9080        | Container APISIX belum jalan. Cek `docker compose ps -a` dan `docker compose logs apisix`.                                                   |
| Log APISIX menyebut etcd di `127.0.0.1:2379` | APISIX tidak membaca `apisix/config.yaml`. Pastikan file ada (bukan folder), berencoding UTF-8 tanpa BOM, dan ter-mount di compose.          |
| Katalog kosong atau CORS error               | Rute APISIX belum dipasang. Jalankan skrip rute (langkah 3).                                                                                 |
| `Client not found` saat login                | Realm diimpor tanpa client. Pastikan `keycloak/realm-export.json` memuat `library-frontend` dan `apisix`, lalu impor ulang dengan `down -v`. |
| 401 padahal sudah login                      | Token kedaluwarsa, atau _issuer mismatch_ (periksa `KC_HOSTNAME` dan `KC_HOSTNAME_BACKCHANNEL_DYNAMIC` di compose). Ambil token baru.        |
| `403: Butuh role member`                     | Akun belum punya role `member`. Lihat bagian registrasi di atas.                                                                             |
| Realm atau data awal tidak berubah           | File realm dan `init.sql` hanya diproses saat database masih kosong. Gunakan `docker compose down -v`.                                       |
| Vite pindah ke port 5174                     | Port 5173 terpakai. Hentikan proses yang memakainya, karena CORS dan redirect Keycloak diatur untuk 5173.                                    |

## Catatan keamanan

Pengaturan berikut disengaja untuk kemudahan lab dan **harus diubah** sebelum dipakai di luar lokal:

- Keycloak berjalan dengan `start-dev` (tanpa HTTPS) dan `sslRequired: none`.
- Admin API APISIX terbuka untuk semua alamat (`allow_admin: 0.0.0.0/0`).
- Password user demo dan `client_secret` `apisix-secret` tertulis di repo.
- `directAccessGrantsEnabled` aktif pada client frontend (untuk uji lewat terminal).
- Backend tidak memvalidasi tanda tangan token sendiri dan hanya mengandalkan APISIX di depannya.

Jangan pernah meng-commit file `.env` atau menaruh password asli di file yang masuk Git.

## Ide pengembangan

- Tambahkan Prometheus dan Grafana untuk memantau trafik APISIX.
- Pindahkan penegakan role dari backend ke gateway dengan plugin `authz-keycloak`.
- Tambahkan denda keterlambatan dan notifikasi.
- Ganti penyimpanan sesi dan data demo dengan konfigurasi yang siap produksi.

## Screenshot

Tambahkan screenshot ke folder `docs/`, lalu tampilkan di sini, misalnya:

```markdown
![Katalog](docs/katalog.png)
![Login Keycloak](docs/login.png)
```

## Lisensi

Tambahkan file `LICENSE` sesuai pilihanmu (misalnya MIT).
