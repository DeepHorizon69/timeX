# TimeX

Aplikasi pencatat waktu lomba untuk satu operator di HP. Data disimpan di IndexedDB pada browser perangkat yang digunakan.

## Menjalankan lokal

```sh
npm install
npm run dev
```

Untuk mencoba versi produksi beserta dukungan offline

```sh
npm run build
npm run preview
```

Gunakan URL yang ditampilkan terminal. Aplikasi perlu dibuka online sekali sampai halaman Perangkat menampilkan kesiapan offline. Service worker menyimpan aset aplikasi dan menunda aktivasi pembaruan selama pencatatan atau antrean penyimpanan masih aktif.

## Workflow operator

1. **Kegiatan** menampilkan kegiatan terpilih dan tindakan berikutnya. Kelola nama, tanggal, serta kegiatan tersimpan melalui **Kelola kegiatan**.
2. **Siapkan gelombang** membuka grid bib. Pilih warna, lalu ketuk nomor 1–50. Warna tetap terpilih dan bib duplikat diblokir. Nama peserta dapat ditambahkan melalui input ketik atau detail daftar.
3. **Siap start** menampilkan ringkasan peserta. **Mulai sekarang** menangkap waktu start dan menjalankan stopwatch setelah penyimpanan berhasil.
4. **Catat finish** merekam waktu setiap ketukan. Pilih **Isi bib** saat ada jeda untuk menghubungkan catatan dengan peserta. Tombol finish tetap tersedia selama identifikasi.
5. **Akhiri pencatatan** membuka pemeriksaan. Periksa identitas, ketukan berdekatan, serta peserta yang membutuhkan status DNS, DNF, atau Perlu diperiksa.
6. **Simpan dan lanjutkan** menyimpan hasil. **Simpan untuk diperiksa** mengakui hasil yang tertunda sehingga gelombang berikutnya dapat disiapkan. Ringkasan selesai menyediakan **Unduh backup** untuk mengunduh backup JSON seluruh kegiatan langsung dari layar hasil.

Satu gelombang dapat berjalan pada satu waktu. Gelombang lama dengan mode ketuk bib langsung tetap dapat diselesaikan melalui tampilan peserta. Koreksi waktu, pembatalan, serta perubahan status memiliki riwayat audit.

## Penyimpanan dan pemulihan

- Antrean finish berada di tingkat aplikasi dan bertahan ketika layar berganti. Setiap ketukan memiliki ID tetap sehingga retry menggunakan waktu asli dan menghindari catatan ganda.
- Salinan darurat antrean disimpan di sessionStorage jika browser mengizinkan. Jika penyimpanan gagal, gunakan **Simpan ulang** atau **Unduh penyelamatan** sebelum menutup halaman.
- File penyelamatan dapat diimpor melalui **Perangkat → Pulihkan backup** setelah kegiatan yang sesuai tersedia. Impor mengenali ID finish yang sudah tersimpan.
- **Backup lengkap** mengekspor kegiatan, gelombang, bib, hasil, audit, dan catatan tertunda sebagai JSON skema v2. Backup v1 dari Run Timing tetap didukung.
- Pemulihan backup menampilkan pratinjau dan menggantikan data lokal melalui satu transaksi. Pencatatan aktif harus ditutup terlebih dahulu.
- Data lama otomatis terbaca pada origin browser yang sama. Jika berpindah alamat, port, atau perangkat, gunakan backup JSON.
- Tab tambahan menggunakan mode baca ketika tab lain memegang akses pencatatan. Saat tab pemegang akses ditutup, tab ini mencoba memperoleh akses secara otomatis. Tombol **Coba akses pencatatan** memeriksa kembali akses tanpa memuat ulang halaman.
- Untuk memulai ulang, buka **Perangkat → Hapus seluruh riwayat**. Konfirmasi menampilkan jumlah kegiatan, gelombang, peserta, finish, dan audit yang akan dihapus. Penghapusan membuat satu kegiatan kosong baru dan memerlukan pencatatan serta antrean finish sudah ditutup atau tersimpan.

Waktu normal dihitung menggunakan `performance.now()`. Setelah reload, operator memilih pemulihan menggunakan jam perangkat atau menutup pencatatan untuk diperiksa. Pemulihan jam perangkat diberi penanda di UI dan laporan karena perubahan jam HP dapat memengaruhi waktu.

Waktu finish mengikuti saat operator mengetuk layar. Unduh backup dan simpan salinannya di luar perangkat untuk pemulihan jika data browser atau perangkat hilang.

## Hasil dan ekspor

Halaman **Hasil** menyediakan pencarian bib lintas gelombang, riwayat hasil, koreksi beralasan, serta audit. **Perangkat** menyediakan laporan CSV, Excel, PDF, backup JSON, pemulihan data, dan status penyimpanan.

Pilih **Perangkat → Tema tampilan → Terang / Gelap** untuk mengganti tema. Pilihan disimpan di browser dan diterapkan saat halaman dibuka kembali.

Modul Excel dan PDF dimuat saat laporan diminta. Laporan menandai hasil yang memerlukan pemeriksaan.

## Verifikasi

```sh
npm test
npm run build
```

Tes mencakup simulasi 12 bib, finish beruntun, identifikasi saat pencatatan berjalan, koreksi, DNF massal, penggunaan ulang bib, kegagalan penyimpanan, pemulihan jurnal, fallback waktu, kompatibilitas backup, ekspor, serta akses keyboard dialog.

Stack menggunakan React, TypeScript, Vite, Vitest, dan IndexedDB melalui `idb`.
