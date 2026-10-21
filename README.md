# Run Timing — Pencatat Waktu Lari Lokal (Mobile-First MVP)

Aplikasi web mobile-first untuk membantu satu operator di garis start/finish mencatat daftar nomor bib per batch, menjalankan stopwatch presisi, merekam waktu finish peserta secara cepat, meninjau hasil, serta mengekspor data ke **CSV** dan **Backup JSON**.

---

## Cara Menjalankan Aplikasi

Pastikan **Node.js** (v18+) dan **npm** sudah terpasang.

```bash
# 1. Pasang dependensi
npm install

# 2. Jalankan server pengembangan lokal
npm run dev

# 3. Jalankan seluruh pengujian otomatis (Unit + Simulasi Lapangan UI)
npm test

# 4. Bangun bundel produksi
npm run build

# 5. Pratinjau bundel produksi secara lokal
npm run preview
```

---

## Fitur Utama (MVP)

1. **Dasbor Kegiatan (Layar A)**
   - Menampilkan nama & tanggal kegiatan aktif, status penyimpanan lokal, jumlah batch selesai, total catatan finish, dan jumlah finish yang perlu diidentifikasi.
   - Mendukung pembuatan kegiatan baru atau pergantian kegiatan tanpa menghapus kegiatan sebelumnya.
2. **Penyusunan Batch & Input Nomor Bib Cepat (Layar B)**
   - Mendukung 5 warna bib standar inventaris fisik: **Putih (`P`)**, **Hijau (`H`)**, **Merah (`M`)**, **Biru (`B`)**, dan **Kuning (`K`)** dengan rentang nomor **1–50** per warna (contoh kode: `B12`, `M07`, `P01`).
   - Pilihan warna tetap terkunci saat menambah beberapa peserta berwarna sama untuk menghemat ketukan.
   - Tersedia dua metode input cepat: **Keypad / Ketik** (dengan tombol angka sentuh besar di layar) dan **Grid Cepat 1–50** (satu ketukan per nomor).
   - Mencegah duplikasi warna + nomor yang sama di dalam satu batch, namun mengizinkan penggunaan ulang nomor bib yang sama pada batch berikutnya tanpa menimpa hasil batch terdahulu.
3. **Pencatatan Waktu Berjalan / Stopwatch (Layar C)**
   - **Mode Catat Waktu Dulu (`TIMESTAMP_FIRST` — Disarankan):** Tombol utama ekstra besar **`CATAT FINISH`** langsung merekam urutan (`F-001`, `F-002`, ...) dan waktu tempuh seketika tanpa membuka dialog modal. Identifikasi nomor bib dilakukan setelahnya dari daftar peserta batch tersebut.
   - **Mode Ketuk Kartu Nomor Langsung (`DIRECT_CARD`):** Menampilkan kartu peserta dalam posisi stabil (tidak berpindah urutan saat peserta finish) dan mencegah ketukan ganda yang tidak disengaja.
   - Dilengkapi tombol **Urungkan Finish Terakhir** berkonfirmasi aman dan indikator **Screen Wake Lock** (jika didukung browser).
4. **Tinjau Hasil & Penanganan DNS/DNF (Layar D)**
   - Menampilkan peringatan kualitas data (finish belum teridentifikasi, peserta belum berstatus, atau ketukan finish yang sangat berdekatan).
   - Mendukung penandaan peserta sebagai **`DNS`**, **`DNF`**, atau **`Perlu Diperiksa` (`NEEDS_REVIEW`)** secara individual maupun massal untuk sisa peserta yang belum finish.
5. **Riwayat Hasil, Pencarian Bib & Koreksi Teraudit (Layar E)**
   - Menampilkan daftar batch dari yang terbaru ke terlama serta pencarian lintas batch berdasarkan kode/warna nomor bib.
   - Setiap koreksi penugasan bib atau koreksi waktu tempuh wajib disertai alasan dan dicatat ke **Riwayat Audit & Koreksi** tanpa menghapus nilai lama.
6. **Ekspor Hasil (CSV, Excel `.xlsx`, PDF `.pdf`) & Backup/Restore JSON (Layar F)**
   - **Ekspor CSV (UTF-8):** Data tabel untuk spreadsheet atau pemrosesan lanjutan (termasuk kutipan aman untuk koma, tanda kutip, dan baris baru).
   - **Laporan Excel (`.xlsx`):** Laporan hasil yang mudah dibaca dan dianalisis untuk penyelenggara acara, dilengkapi judul terformat, baris header terkunci (*freeze row*), filter tabel otomatis (*auto-filter*), lebar kolom proporsional, serta pemisahan lembar kerja antara **Hasil Lari Valid** dan **Perlu Diperiksa** (`laporan-lari-[nama-acara]-[tanggal].xlsx`).
   - **Laporan PDF (`.pdf`):** Laporan siap dibagikan atau dicetak dengan ringkasan peserta tervalidasi, header tabel berulang di setiap halaman, bagian khusus untuk catatan yang perlu diperiksa, dan legenda status (`DNS`, `DNF`, `Perlu Diperiksa`) (`laporan-lari-[nama-acara]-[tanggal].pdf`).
   - **Backup & Impor JSON:** Menyimpan seluruh basis data IndexedDB beserta versi skema dan menampilkan pratinjau perbandingan sebelum pemulihan data dikonfirmasi.

---

## Penyimpanan Lokal & Prosedur Backup

- **100% Penyimpanan Lokal (`IndexedDB`):** Seluruh data kegiatan, batch, daftar peserta, waktu finish, dan log audit disimpan di dalam browser perangkat yang digunakan operator.
- **Tidak Ada Sinkronisasi Cloud Otomatis:** Data tidak dikirim ke server eksternal atau perangkat lain secara otomatis.
- **Kewajiban Ekspor Berkala:** Operator sangat disarankan untuk mengunduh file **Ekspor CSV** dan **Backup JSON** setiap kali satu atau beberapa batch selesai, lalu menyalin/mengirimkan file tersebut ke luar perangkat (misalnya ke email, aplikasi pesan, atau penyimpanan eksternal) agar data tetap aman apabila ponsel kehabisan baterai, browser terhapus, atau perangkat mengalami gangguan.

---

## Batasan Penting & Pemulihan Muat Ulang (`Pulihkan Batch`)

1. **Akurasi Ketukan Manual Operator:**
   - Aplikasi ini mencatat waktu pada saat operator menekan tombol di layar ponsel, **bukan** sistem sensor garis finish otomatis atau kamera *photo-finish*. Waktu reaksi manusia tetap berlaku.
2. **Pemulihan Setelah Muat Ulang Halaman (`Reload Recovery`):**
   - Selama halaman tidak dimuat ulang, waktu tempuh dihitung menggunakan sumber waktu monotonik (`performance.now()`).
   - Apabila halaman browser dimuat ulang atau ditutup lalu dibuka kembali saat suatu batch masih berstatus **`RUNNING`**, referensi waktu monotonik halaman sebelumnya tidak lagi berlaku.
   - Aplikasi **tidak akan** mengklaim kesinambungan waktu monotonik secara diam-diam. Sebaliknya, aplikasi menampilkan alur **`Pulihkan Batch`** yang memberikan 3 opsi eksplisit kepada operator:
     1. Mengekspor/mem-backup data yang sudah tersimpan terlebih dahulu.
     2. Melanjutkan batch menggunakan **Fallback Jam Perangkat (`WALL_CLOCK_FALLBACK`)** dengan peringatan jelas bahwa perubahan jam sistem perangkat dapat memengaruhi perhitungan.
     3. Menandai batch untuk ditinjau (`Tinjau Hasil` / `Perlu Diperiksa`).
3. **Integrasi PortgasDB & Google Sheets:**
   - Sesuai rencana implementasi MVP, integrasi **PortgasDB** dan **Google Sheets API** ditangguhkan (*deferred*) pada fase MVP ini. Lapisan akses data telah dipisahkan di dalam modul repositori (`src/db/repositories.ts`) agar siap dihubungkan ke adapter API backend di masa mendatang tanpa menulis ulang komponen antarmuka.
