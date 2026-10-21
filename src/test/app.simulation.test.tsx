import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import {
  clearAllStores,
  resetDbConnectionForTests,
  setSimulatedWriteFailure,
} from '../db/indexedDb';
import { clearActiveSessionBatchesForTests } from '../services/timekeeper';
import { BatchRepository, FinishEventRepository } from '../db/repositories';
import { ExportService } from '../services/exportService';

describe('Run Timing Full UI & Field Simulation Tests', () => {
  beforeEach(async () => {
    setSimulatedWriteFailure(null);
    clearActiveSessionBatchesForTests();
    await resetDbConnectionForTests();
    await clearAllStores();
  });

  it('executes complete field simulation with 12 bibs, rapid finishes, identification, correction, DNF, CSV/JSON export, and bib reuse in Batch 2', async () => {
    const user = userEvent.setup();
    render(<App />);

    // 1. Wait for dashboard to load
    await waitFor(() => {
      expect(
        screen.getByText(/Data tersimpan di perangkat ini/i)
      ).toBeInTheDocument();
    });

    // Click Buat Batch Baru (Batch #1)
    await user.click(
      screen.getByRole('button', { name: /Buat Batch Baru \(Batch #1\)/i })
    );

    // 2. Add 12 bib entries across multiple colors
    await waitFor(() => {
      expect(screen.getByText(/1\. Pilih Warna Bib/i)).toBeInTheDocument();
    });

    // Switch to Grid Cepat 1-50 for rapid entry
    await user.click(screen.getByRole('tab', { name: /Grid Cepat 1–50/i }));

    // Add Putih 1, 2, 3
    await user.click(screen.getByRole('button', { name: 'Tambah P01' }));
    await user.click(screen.getByRole('button', { name: 'Tambah P02' }));
    await user.click(screen.getByRole('button', { name: 'Tambah P03' }));

    // Select Biru and add 10, 11, 12
    await user.click(screen.getByRole('radio', { name: /Biru/i }));
    await user.click(screen.getByRole('button', { name: 'Tambah B10' }));
    await user.click(screen.getByRole('button', { name: 'Tambah B11' }));
    await user.click(screen.getByRole('button', { name: 'Tambah B12' }));

    // Select Merah and add 5, 6, 7
    await user.click(screen.getByRole('radio', { name: /Merah/i }));
    await user.click(screen.getByRole('button', { name: 'Tambah M05' }));
    await user.click(screen.getByRole('button', { name: 'Tambah M06' }));
    await user.click(screen.getByRole('button', { name: 'Tambah M07' }));

    // Select Kuning and add 20, 21, 22 via Keypad
    await user.click(screen.getByRole('radio', { name: /Kuning/i }));
    await user.click(screen.getByRole('tab', { name: /Keypad \/ Ketik/i }));
    const numInput = screen.getByLabelText(/Nomor Bib \(1 sampai 50\)/i);

    await user.type(numInput, '20');
    await user.click(screen.getByRole('button', { name: /Tambah Nomor/i }));

    await user.type(numInput, '21');
    await user.click(screen.getByRole('button', { name: /Tambah Nomor/i }));

    await user.type(numInput, '22');
    await user.click(screen.getByRole('button', { name: /Tambah Nomor/i }));

    // Attempt duplicate K22 -> must reject with clear message
    await user.type(numInput, '22');
    await user.click(screen.getByRole('button', { name: /Tambah Nomor/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/sudah terdaftar/i);
    });

    // Verify 12 participants in roster
    const startBtn1 = await screen.findByRole('button', {
      name: /MULAI BATCH #1 \(12 Peserta\)/i,
    });
    expect(startBtn1).toBeInTheDocument();

    // 3. Start Batch #1
    await user.click(startBtn1);
    await user.click(
      await screen.findByRole('button', { name: /Mulai Batch Sekarang/i })
    );

    // 4. Record 4 finishes in quick succession using CATAT FINISH without modals
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /CATAT FINISH/i })
      ).toBeInTheDocument();
    });

    const catatBtn = screen.getByRole('button', { name: /CATAT FINISH/i });
    await user.click(catatBtn);
    await user.click(catatBtn);
    await user.click(catatBtn);
    await user.click(catatBtn);

    await waitFor(() => {
      expect(screen.getByText('F-004')).toBeInTheDocument();
      expect(screen.getByText('F-001')).toBeInTheDocument();
    });

    // 5. Identify F-001 as B12 (initially mistaken), F-002 as M07, F-003 as P01
    // Find F-001 item and click Identifikasi Nomor
    const queueList = screen.getByRole('region', {
      name: /Antrean Catatan Waktu Finish/i,
    });
    const f001Row = within(queueList).getByText('F-001').closest('li')!;
    await user.click(
      within(f001Row).getByRole('button', { name: /Identifikasi Nomor/i })
    );
    await user.click(within(f001Row).getByRole('button', { name: /B12/i }));

    // Correct F-001 mistaken identity from B12 to B10
    await waitFor(() => {
      expect(
        within(f001Row).getByRole('button', { name: /Ubah/i })
      ).toBeInTheDocument();
    });
    await user.click(within(f001Row).getByRole('button', { name: /Ubah/i }));
    await user.click(within(f001Row).getByRole('button', { name: /B10/i }));

    // Identify F-002 as B12 (now available again!)
    const f002Row = within(queueList).getByText('F-002').closest('li')!;
    await user.click(
      within(f002Row).getByRole('button', { name: /Identifikasi Nomor/i })
    );
    await user.click(within(f002Row).getByRole('button', { name: /B12/i }));

    // Identify F-003 as M07
    const f003Row = within(queueList).getByText('F-003').closest('li')!;
    await user.click(
      within(f003Row).getByRole('button', { name: /Identifikasi Nomor/i })
    );
    await user.click(within(f003Row).getByRole('button', { name: /M07/i }));

    // Leave F-004 unidentified for now and move to Review screen
    await user.click(screen.getByRole('button', { name: /Tinjau Hasil/i }));
    await user.click(
      screen.getByRole('button', { name: /Lanjut ke Tinjau Hasil/i })
    );

    // 6. On Review screen, identify F-004 as P01 and mark remaining waiting participants as DNF
    await waitFor(() => {
      expect(screen.getByText(/Tinjau Hasil Batch #1/i)).toBeInTheDocument();
    });

    const reviewFinishSection = screen.getByRole('region', {
      name: /Daftar Catatan Waktu Finish/i,
    });
    const revF004Row = within(reviewFinishSection)
      .getByText('F-004')
      .closest('li')!;
    await user.click(
      within(revF004Row).getByRole('button', { name: /Pilih Nomor/i })
    );
    await user.click(within(revF004Row).getByRole('button', { name: /P01/i }));

    // Bulk mark remaining 8 waiting participants as DNF
    const bulkDnfBtn = await screen.findByRole('button', {
      name: /Tandai Semua Sisa \(8\) DNF/i,
    });
    await waitFor(() => {
      expect(bulkDnfBtn).not.toBeDisabled();
    });
    await user.click(bulkDnfBtn);

    // Complete Batch #1
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Selesaikan Batch #1/i })
      ).not.toBeDisabled();
    });
    await user.click(
      screen.getByRole('button', { name: /Selesaikan Batch #1/i })
    );
    await user.click(
      screen.getByRole('button', { name: /Ya, Selesaikan Batch/i })
    );

    // 7. Verify Results screen opens and shows Batch #1 as Selesai
    await waitFor(() => {
      expect(screen.getByText(/Rincian Hasil Batch #1/i)).toBeInTheDocument();
    });

    // Save Batch #1 B12 elapsed time for comparison after Batch #2
    const batchesAfter1 = await BatchRepository.listBatchesByEvent(
      (await BatchRepository.listBatchesByEvent((await ExportService.buildJsonBackup()).events[0].id))[0].eventId
    );
    const batch1Id = batchesAfter1[0].id;
    const batch1ResBefore = await FinishEventRepository.getBatchResults(batch1Id);
    const b12Batch1ElapsedBefore = batch1ResBefore.results.find(
      (r) => r.entry.bibLabel === 'B12'
    )?.finishEvent?.elapsedMs;
    expect(b12Batch1ElapsedBefore).toBeDefined();

    // 8. Go to Export screen and verify CSV & JSON preview generation
    await user.click(screen.getByRole('button', { name: /Ekspor\/Backup/i }));
    await user.click(
      screen.getByRole('button', { name: /Tampilkan Pratinjau CSV/i })
    );
    const csvTextarea = await screen.findByLabelText(/Isi CSV \(UTF-8\):/i);
    expect((csvTextarea as HTMLTextAreaElement).value).toContain('B12');
    expect((csvTextarea as HTMLTextAreaElement).value).toContain('DNF');

    await user.click(
      screen.getByRole('button', { name: /Tampilkan JSON Backup/i })
    );
    const jsonTextarea = await screen.findByLabelText(/Isi Backup JSON:/i);
    expect((jsonTextarea as HTMLTextAreaElement).value).toContain(
      '"appName": "Run Timing"'
    );

    // 9. Return to Beranda and create Batch #2 reusing B12 and P01
    await user.click(screen.getByRole('button', { name: /← Beranda/i }));
    await user.click(
      await screen.findByRole('button', { name: /Buat Batch Baru \(Batch #2\)/i })
    );

    await user.click(
      await screen.findByRole('tab', { name: /Grid Cepat 1–50/i })
    );
    await user.click(screen.getByRole('button', { name: 'Tambah P01' }));
    await user.click(screen.getByRole('radio', { name: /Biru/i }));
    await user.click(screen.getByRole('button', { name: 'Tambah B12' }));

    await user.click(
      await screen.findByRole('button', { name: /MULAI BATCH #2 \(2 Peserta\)/i })
    );
    await user.click(
      await screen.findByRole('button', { name: /Mulai Batch Sekarang/i })
    );

    await waitFor(() => {
      expect(screen.getByText(/BATCH #2/i)).toBeInTheDocument();
    });

    // Verify Batch #1 B12 result is completely unchanged
    const batch1ResAfter = await FinishEventRepository.getBatchResults(batch1Id);
    const b12Batch1ElapsedAfter = batch1ResAfter.results.find(
      (r) => r.entry.bibLabel === 'B12'
    )?.finishEvent?.elapsedMs;
    expect(b12Batch1ElapsedAfter).toBe(b12Batch1ElapsedBefore);
  });

  it('shows Pulihkan Batch workflow after page reload while batch is RUNNING, and handles storage write failures visibly with retry', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Buat Batch Baru/i })
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole('button', { name: /Buat Batch Baru/i })
    );
    await user.click(
      await screen.findByRole('tab', { name: /Grid Cepat 1–50/i })
    );
    await user.click(screen.getByRole('button', { name: 'Tambah P01' }));

    await user.click(
      await screen.findByRole('button', { name: /MULAI BATCH #1 \(1 Peserta\)/i })
    );
    await user.click(
      await screen.findByRole('button', { name: /Mulai Batch Sekarang/i })
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /CATAT FINISH/i })
      ).toBeInTheDocument();
    });

    // Simulate IndexedDB write failure when tapping CATAT FINISH
    setSimulatedWriteFailure('Simulasi penyimpanan penuh');
    await user.click(screen.getByRole('button', { name: /CATAT FINISH/i }));

    // Verify blocking error banner appears and does NOT falsely claim saved
    await waitFor(() => {
      expect(
        screen.getByText(/PERINGATAN KRITIS: 1 Catatan Finish Belum Tersimpan/i)
      ).toBeInTheDocument();
    });

    // Restore IndexedDB write capability and click retry button
    setSimulatedWriteFailure(null);
    await user.click(
      screen.getByRole('button', { name: /Simpan Ulang Sekarang \(1 Catatan\)/i })
    );

    await waitFor(() => {
      expect(
        screen.queryByText(/PERINGATAN KRITIS/i)
      ).not.toBeInTheDocument();
      expect(screen.getByText('F-001')).toBeInTheDocument();
    });

    // Now simulate browser reload: unmount App, clear in-memory session batch IDs, remount App
    unmount();
    clearActiveSessionBatchesForTests();
    render(<App />);

    // Verify dashboard shows "Perlu Pemulihan" and "Pulihkan Batch #1"
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Pulihkan Batch #1/i })
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Pulihkan Batch #1/i }));

    // Verify explicit Pulihkan Batch #1 screen appears with all 3 recovery options
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /Pulihkan Batch #1/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: /Lanjutkan Batch dengan Jam Perangkat \(Fallback\)/i,
        })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: /Tandai Perlu Diperiksa & Tinjau Hasil Batch/i,
        })
      ).toBeInTheDocument();
    });
  });

  it('maintains stable card order in Direct-Card mode, prevents duplicate finish taps, and restores JSON backup via UI', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Buat Batch Baru/i })
      ).toBeInTheDocument();
    });

    // Select Direct Card mode on Dashboard
    await user.click(
      screen.getByRole('radio', { name: /Ketuk Kartu Nomor Langsung/i })
    );
    await user.click(
      screen.getByRole('button', { name: /Buat Batch Baru/i })
    );

    await user.click(
      await screen.findByRole('tab', { name: /Grid Cepat 1–50/i })
    );
    await user.click(screen.getByRole('button', { name: 'Tambah P01' }));
    await user.click(screen.getByRole('button', { name: 'Tambah P02' }));
    await user.click(screen.getByRole('button', { name: 'Tambah P03' }));

    await user.click(
      await screen.findByRole('button', { name: /MULAI BATCH #1 \(3 Peserta\)/i })
    );
    await user.click(
      await screen.findByRole('button', { name: /Mulai Batch Sekarang/i })
    );

    const cardRegion = await screen.findByRole('region', {
      name: /Ketuk Kartu Peserta/i,
    });

    // Tap P02 first (middle card)
    const p02CardBefore = within(cardRegion).getByRole('button', {
      name: /P02/i,
    });
    await user.click(p02CardBefore);

    await waitFor(() => {
      expect(within(cardRegion).getByText(/F-001/i)).toBeInTheDocument();
    });

    // Verify card order remains P01, P02, P03 (stable order, no automatic reordering)
    const allCardLabels = within(cardRegion)
      .getAllByRole('button')
      .filter((btn) => btn.classList.contains('participant-tap-card'))
      .map((btn) => btn.textContent ?? '');
    expect(allCardLabels[0]).toContain('P01');
    expect(allCardLabels[1]).toContain('P02');
    expect(allCardLabels[2]).toContain('P03');

    // Tapping P02 a second time must NOT create F-002; instead it opens the undo confirmation dialog
    await user.click(within(cardRegion).getByRole('button', { name: /P02/i }));
    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: /Urungkan \/ Batalkan F-001/i })
      ).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Kembali/i }));
    expect(
      within(cardRegion).queryByText(/F-002 • Sudah Finish/i)
    ).not.toBeInTheDocument();
    expect(
      within(cardRegion).getByRole('button', {
        name: /\+ Finish Tanpa Nomor \(F-002\)/i,
      })
    ).toBeInTheDocument();

    // Backup JSON, clear stores, and restore via UI
    const backupJson = await ExportService.buildJsonBackupString();
    await clearAllStores();

    await user.click(screen.getByRole('button', { name: /Ekspor\/Backup/i }));
    const manualTextarea = await screen.findByLabelText(
      /Atau Tempel Isi JSON Backup:/i
    );
    await user.clear(manualTextarea);
    await user.click(manualTextarea);
    await user.paste(backupJson);

    await user.click(
      screen.getByRole('button', { name: /Periksa & Tampilkan Pratinjau Impor/i })
    );
    await user.click(
      await screen.findByRole('button', {
        name: /Ya, Pulihkan Data Backup Ini/i,
      })
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Backup JSON berhasil dipulihkan/i)
      ).toBeInTheDocument();
    });
  });
});
