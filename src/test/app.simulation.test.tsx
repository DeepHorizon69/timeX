import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { clearAllStores, setSimulatedWriteFailure } from '../db/indexedDb';
import {
  BatchRepository,
  EventRepository,
  FinishEventRepository,
} from '../db/repositories';
import { ExportService } from '../services/exportService';
import {
  clearActiveSessionBatchesForTests,
  registerSessionStartedBatch,
} from '../services/timekeeper';
import {
  getPendingCaptures,
  restorePendingCaptures,
  retryCaptures,
} from '../services/captureSession';

async function startGelombang(
  user: ReturnType<typeof userEvent.setup>,
  count = 1
) {
  await user.click(
    await screen.findByRole('button', { name: 'Siapkan gelombang' })
  );
  for (let number = 1; number <= count; number++) {
    await user.click(
      await screen.findByRole('button', {
        name: `Tambah P${String(number).padStart(2, '0')}`,
      })
    );
  }
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Siap start' })).toBeEnabled()
  );
  await user.click(screen.getByRole('button', { name: 'Siap start' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Mulai sekarang',
    })
  );
  await screen.findByRole('button', { name: /Catat finish/i });
}

async function currentBatch() {
  const event = await EventRepository.getActiveEvent();
  return (await BatchRepository.listBatchesByEvent(event!.id))[0];
}

describe('TimeX operator workflow', () => {
  beforeEach(async () => {
    setSimulatedWriteFailure(null);
    clearActiveSessionBatchesForTests();
    sessionStorage.clear();
    await clearAllStores();
  });

  afterEach(async () => {
    cleanup();
    setSimulatedWriteFailure(null);
    await retryCaptures();
    vi.restoreAllMocks();
  });

  it('renames a saved preparation and keeps the name and bib after reopening', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.click(
      await screen.findByRole('button', { name: 'Siapkan gelombang' })
    );
    await user.click(await screen.findByRole('button', { name: 'Tambah P01' }));
    await screen.findByText('P01 ditambahkan');
    const batch = await currentBatch();
    await user.click(screen.getByRole('button', { name: 'Kembali' }));

    const card = within(
      screen.getByRole('region', { name: 'Langkah berikutnya' })
    );
    const editButton = () => card.getByRole('button', { name: 'Edit nama' });
    const openEditor = () => user.click(editButton());
    await openEditor();
    let input = card.getByRole('textbox', { name: 'Nama gelombang' });
    expect(input).toHaveValue('Gelombang #1');
    expect(input).toHaveFocus();
    await user.clear(input);
    expect(card.getByRole('button', { name: 'Simpan nama' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(editButton()).toHaveFocus();

    await openEditor();
    input = card.getByRole('textbox', { name: 'Nama gelombang' });
    await user.clear(input);
    await user.type(input, '  Lari 5K Pagi  ');
    setSimulatedWriteFailure('Penyimpanan sedang tidak tersedia.');
    await user.keyboard('{Enter}');
    expect(await card.findByRole('alert')).toHaveTextContent(
      'Penyimpanan sedang tidak tersedia.'
    );
    expect(await BatchRepository.getBatchById(batch.id)).not.toHaveProperty(
      'name'
    );

    setSimulatedWriteFailure(null);
    await user.click(card.getByRole('button', { name: 'Simpan nama' }));
    await card.findByRole('heading', { name: 'Lari 5K Pagi' });
    await waitFor(() => expect(editButton()).toHaveFocus());
    expect(await BatchRepository.getBatchById(batch.id)).toMatchObject({
      batchNumber: batch.batchNumber,
      status: batch.status,
      name: 'Lari 5K Pagi',
    });
    const backup = await ExportService.validateAndPreviewBackupJson(
      await ExportService.buildJsonBackupString()
    );
    expect(backup.payload.batches[0].name).toBe('Lari 5K Pagi');

    unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lari 5K Pagi' });
    await user.click(screen.getByRole('button', { name: 'Lanjutkan persiapan' }));
    expect(
      screen.getByRole('heading', { name: 'Lari 5K Pagi', level: 1 })
    ).toBeInTheDocument();
    expect(await BatchRepository.listBibEntriesByBatch(batch.id)).toMatchObject([
      { bibLabel: 'P01' },
    ]);
  });

  it('prepares 12 bibs, captures rapid finishes, identifies without blocking capture, corrects time and saves DNF with exports and bib reuse', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startGelombang(user, 12);
    const batch = await currentBatch();
    const finishButton = screen.getByRole('button', { name: /Catat finish/i });
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
    act(() => {
      for (let index = 0; index < 3; index++) fireEvent.click(finishButton);
    });
    await screen.findByRole('button', { name: 'Isi bib F-003' });
    expect(
      transactions.mock.calls.filter(([stores, mode]) => {
        const names = typeof stores === 'string' ? [stores] : Array.from(stores);
        return (
          mode !== 'readwrite' &&
          (names.includes('finishEvents') || names.includes('batchBibEntries'))
        );
      })
    ).toHaveLength(0);
    transactions.mockRestore();
    expect(
      screen.getAllByRole('button', { name: /^Isi bib F-/ }).map(
        (button) => button.getAttribute('aria-label')
      )
    ).toEqual(['Isi bib F-003', 'Isi bib F-002', 'Isi bib F-001']);
    await waitFor(async () =>
      expect(
        (await FinishEventRepository.listFinishEventsByBatch(batch.id)).length
      ).toBe(3)
    );
    await user.click(
      await screen.findByRole('button', { name: 'Isi bib F-001' })
    );
    await user.click(screen.getByRole('button', { name: 'Pilih P01' }));
    await user.click(screen.getByRole('button', { name: /Catat finish/i }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('button', { name: 'Isi bib F-001' })).getByText(
          'P01'
        )
      ).toBeInTheDocument()
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pilih P02' })).toBeEnabled()
    );
    await user.click(await screen.findByRole('button', { name: 'Pilih P02' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('button', { name: 'Isi bib F-002' })).getByText(
          'P02'
        )
      ).toBeInTheDocument()
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pilih P03' })).toBeEnabled()
    );
    await user.click(await screen.findByRole('button', { name: 'Pilih P03' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('button', { name: 'Isi bib F-003' })).getByText(
          'P03'
        )
      ).toBeInTheDocument()
    );
    await user.click(
      await screen.findByRole('button', { name: 'Isi bib F-004' })
    );
    await user.click(screen.getByRole('button', { name: 'Pilih P04' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('button', { name: 'Isi bib F-004' })).getByText(
          'P04'
        )
      ).toBeInTheDocument()
    );
    await user.click(screen.getByRole('button', { name: 'Akhiri pencatatan' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Periksa hasil',
      })
    );
    await user.click(
      await screen.findByRole('button', { name: 'Semua hasil' })
    );
    await user.click(
      screen.getAllByRole('button', { name: 'Koreksi waktu' })[0]
    );
    await user.clear(screen.getByLabelText('Waktu (MM:SS.cc)'));
    await user.type(screen.getByLabelText('Waktu (MM:SS.cc)'), '05:12.34');
    await user.type(
      within(screen.getByRole('dialog')).getByLabelText('Alasan koreksi'),
      'Konfirmasi catatan operator'
    );
    await user.click(screen.getByRole('button', { name: 'Simpan koreksi' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    await user.click(screen.getByRole('button', { name: 'Tandai sisa DNF' }));
    expect(
      within(screen.getByRole('dialog')).getByRole('heading')
    ).toHaveTextContent('8 peserta DNF');
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Konfirmasi',
      })
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    await user.click(
      screen.getByRole('button', { name: 'Simpan dan lanjutkan' })
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Konfirmasi',
      })
    );
    await screen.findByText('Gelombang #1 tersimpan.');
    expect(screen.getByRole('button', { name: 'Unduh backup' })).toBeEnabled();
    const results = await FinishEventRepository.getBatchResults(batch.id);
    expect(
      results.roster.filter((entry) => entry.status === 'DNF')
    ).toHaveLength(8);
    const corrected = results.finishEvents.find(
      (finish) => finish.sequence === 1
    )!;
    expect(corrected.elapsedMs).toBe(312340);
    expect(corrected.correctionHistory).toHaveLength(1);
    expect(await ExportService.buildCsvString()).toContain('05:12.34');
    const backup = await ExportService.buildJsonBackup();
    expect(backup.schemaVersion).toBe(2);
    await ExportService.validateAndPreviewBackupJson(
      JSON.stringify({
        ...backup,
        schemaVersion: 1,
        pendingCaptures: undefined,
      })
    );
    await user.click(screen.getByRole('button', { name: 'Perangkat' }));
    await user.click(
      screen.getByRole('button', { name: /Tampilkan JSON Backup/i })
    );
    expect(
      (
        (await screen.findByLabelText(
          /Isi Backup JSON/i
        )) as HTMLTextAreaElement
      ).value
    ).toContain('Run Timing');
    await user.click(screen.getByRole('button', { name: 'Hasil' }));
    await user.click(
      await screen.findByRole('button', {
        name: 'Siapkan gelombang berikutnya',
      })
    );
    await user.click(await screen.findByRole('button', { name: 'Tambah P01' }));
    await screen.findByRole('button', { name: 'P01 sudah ditambahkan' });
    await screen.findByText('P01 ditambahkan');
    expect(
      (await FinishEventRepository.getBatchResults(batch.id)).finishEvents.find(
        (finish) => finish.sequence === 1
      )?.elapsedMs
    ).toBe(312340);
  });

  it('retains failed finish across navigation and retries the original ID and timestamp once', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startGelombang(user);
    const batch = await currentBatch();
    setSimulatedWriteFailure('Penyimpanan penuh');
    await user.click(screen.getByRole('button', { name: /Catat finish/i }));
    await screen.findByText('1 finish belum tersimpan');
    const pending = { ...getPendingCaptures()[0] };
    expect(sessionStorage.getItem('timex-pending-captures-v2')).toContain(
      pending.id
    );
    await user.click(screen.getByRole('button', { name: 'Kegiatan' }));
    await user.click(
      await screen.findByRole('button', { name: 'Lanjutkan pencatatan' })
    );
    expect(screen.getByText('1 finish belum tersimpan')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Akhiri pencatatan' })
    ).toBeDisabled();
    setSimulatedWriteFailure(null);
    await user.click(screen.getByRole('button', { name: 'Simpan ulang' }));
    await screen.findByRole('button', { name: 'Isi bib F-001' });
    const finishes = await FinishEventRepository.listFinishEventsByBatch(
      batch.id
    );
    expect(finishes).toHaveLength(1);
    expect(finishes[0]).toMatchObject({
      id: pending.id,
      elapsedMs: pending.elapsedMs,
      recordedAtWallClock: pending.recordedAtWallClock,
    });
    await act(async () => {
      restorePendingCaptures([pending]);
      await retryCaptures();
    });
    expect(screen.getAllByRole('button', { name: 'Isi bib F-001' })).toHaveLength(
      1
    );
    expect(
      await FinishEventRepository.listFinishEventsByBatch(batch.id)
    ).toHaveLength(1);
  });

  it('recovers through review and reports the wall clock fallback honestly', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await startGelombang(user);
    first.unmount();
    clearActiveSessionBatchesForTests();
    render(<App />);
    await user.click(
      await screen.findByRole('button', { name: 'Pulihkan sesi' })
    );
    await user.click(
      await screen.findByRole('button', {
        name: 'Tutup pencatatan dan periksa hasil',
      })
    );
    await user.click(
      await screen.findByRole('button', { name: 'Kembali ke stopwatch' })
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Buka stopwatch',
      })
    );
    await user.click(
      await screen.findByRole('button', {
        name: 'Lanjutkan dengan jam perangkat',
      })
    );
    expect(
      await screen.findByText('Pemulihan · jam perangkat')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Catat finish/i }));
    await screen.findByRole('button', { name: 'Isi bib F-001' });
    const batch = await currentBatch();
    expect(
      (await FinishEventRepository.listFinishEventsByBatch(batch.id))[0]
        .timingSource
    ).toBe('WALL_CLOCK_FALLBACK');
  });

  it('explicitly defers unresolved records and permits the next gelombang', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startGelombang(user, 2);
    const batch = await currentBatch();
    await user.click(screen.getByRole('button', { name: /Catat finish/i }));
    await screen.findByRole('button', { name: 'Isi bib F-001' });
    await user.click(screen.getByRole('button', { name: 'Akhiri pencatatan' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Periksa hasil',
      })
    );
    await user.click(
      await screen.findByRole('button', { name: 'Simpan untuk diperiksa' })
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Konfirmasi',
      })
    );
    await screen.findByText('Gelombang #1 tersimpan.');
    const result = await FinishEventRepository.getBatchResults(batch.id);
    expect(screen.getByRole('button', { name: 'Unduh backup' })).toBeEnabled();
    expect(result.batch.status).toBe('NEEDS_REVIEW');
    expect(
      result.roster.every((entry) => entry.status === 'NEEDS_REVIEW')
    ).toBe(true);
    expect(result.finishEvents[0].status).toBe('NEEDS_REVIEW');
    await user.click(
      screen.getByRole('button', { name: 'Siapkan gelombang berikutnya' })
    );
    expect(
      await screen.findByRole('heading', { name: 'Gelombang #2' })
    ).toBeInTheDocument();
  });

  it('keeps legacy direct cards stable, prevents duplicate taps and manages dialog keyboard focus', async () => {
    const event = await EventRepository.ensureDefaultEvent();
    const batch = await BatchRepository.createBatch(event.id, 'DIRECT_CARD');
    await BatchRepository.addBibToBatch({
      batchId: batch.id,
      bibColor: 'BLUE',
      bibNumber: 12,
    });
    await BatchRepository.addBibToBatch({
      batchId: batch.id,
      bibColor: 'WHITE',
      bibNumber: 1,
    });
    await BatchRepository.startBatch({
      batchId: batch.id,
      startedAtWallClock: new Date().toISOString(),
      startedAtMonotonicMs: performance.now(),
    });
    registerSessionStartedBatch(batch.id);
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole('button', { name: 'Lanjutkan pencatatan' })
    );
    await user.click(screen.getByRole('button', { name: 'Peserta' }));
    const before = screen
      .getAllByRole('button', { name: /belum finish/ })
      .map((button) => button.getAttribute('aria-label')?.split(' ')[0]);
    await user.click(screen.getByRole('button', { name: 'B12 belum finish' }));
    await user.click(
      await screen.findByRole('button', { name: 'B12 sudah finish' })
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Batal' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(
      within(dialog).getByRole('button', { name: 'Batalkan finish' })
    ).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'B12 sudah finish' })
    ).toHaveFocus();
    const after = screen
      .getAllByRole('button', { name: /(?:belum|sudah) finish/ })
      .map((button) => button.getAttribute('aria-label')?.split(' ')[0]);
    expect(after).toEqual(before);
    expect(
      await FinishEventRepository.listFinishEventsByBatch(batch.id)
    ).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'B12 sudah finish' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Batalkan finish',
      })
    );
    await screen.findByRole('button', { name: 'B12 belum finish' });
    await user.click(screen.getByRole('button', { name: 'Antrean finish' }));
    expect(screen.getByText('Dibatalkan')).toBeInTheDocument();
  });
});
