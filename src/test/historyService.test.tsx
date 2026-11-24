import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import {
  clearAllStores,
  getDb,
  setSimulatedWriteFailure,
  setWriteLease,
} from '../db/indexedDb';
import {
  BatchRepository,
  EventRepository,
  FinishEventRepository,
} from '../db/repositories';
import { HistoryService } from '../services/historyService';
import {
  clearCaptureJournal,
  enqueueCapture,
  getPendingCaptures,
  retryCaptures,
} from '../services/captureSession';
import { clearActiveSessionBatchesForTests } from '../services/timekeeper';

async function createHistory(name: string) {
  const event = await EventRepository.createEvent(name);
  const batch = await BatchRepository.createBatch(event.id);
  const bib = await BatchRepository.addBibToBatch({
    batchId: batch.id,
    bibColor: 'WHITE',
    bibNumber: 1,
  });
  await BatchRepository.startBatch({
    batchId: batch.id,
    startedAtWallClock: new Date().toISOString(),
    startedAtMonotonicMs: performance.now(),
  });
  await FinishEventRepository.recordDirectCardFinish({
    batchId: batch.id,
    batchBibEntryId: bib.id,
    recordedAtWallClock: new Date().toISOString(),
    elapsedMs: 1000,
    timingSource: 'MONOTONIC',
  });
  await BatchRepository.transitionBatchStatus({
    batchId: batch.id,
    targetStatus: 'REVIEW',
  });
  await BatchRepository.completeBatch(batch.id);
  return { event, batch };
}

describe('Clear all history', () => {
  beforeEach(async () => {
    setWriteLease(Infinity);
    setSimulatedWriteFailure(null);
    clearActiveSessionBatchesForTests();
    await retryCaptures();
    clearCaptureJournal();
    await clearAllStores();
  });

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    setSimulatedWriteFailure(null);
    await retryCaptures();
  });

  it('shows all activities in confirmation, supports cancel, clears previews, and returns to a fresh activity', async () => {
    await createHistory('Lomba pagi');
    await createHistory('Lomba sore');
    const summary = await HistoryService.getSummary();
    expect(summary).toMatchObject({
      events: 2,
      batches: 2,
      participants: 2,
      finishes: 2,
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Perangkat' }));
    await user.click(
      screen.getByRole('button', { name: /Tampilkan JSON Backup/i })
    );
    await screen.findByLabelText(/Isi Backup JSON/i);
    await user.click(
      screen.getByRole('button', { name: 'Hapus seluruh riwayat' })
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('2 kegiatan')).toBeInTheDocument();
    expect(within(dialog).getByText('2 catatan finish')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Batal' }));
    expect(await HistoryService.getSummary()).toEqual(summary);
    await user.click(
      screen.getByRole('button', { name: 'Hapus seluruh riwayat' })
    );
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Hapus permanen',
      })
    );
    await screen.findByText(
      'Seluruh riwayat dihapus. Kegiatan kosong baru siap digunakan.'
    );
    expect(screen.queryByLabelText(/Isi Backup JSON/i)).not.toBeInTheDocument();
    expect(await HistoryService.getSummary()).toEqual({
      events: 1,
      batches: 0,
      participants: 0,
      finishes: 0,
      auditLogs: 0,
    });
    await user.click(screen.getByRole('button', { name: 'Kegiatan' }));
    expect(
      await screen.findByRole('heading', { name: 'Kegiatan baru' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Siapkan gelombang' }));
    expect(
      await screen.findByRole('heading', { name: 'Gelombang #1', level: 1 })
    ).toBeInTheDocument();
  });

  it('preserves device settings and writer access while clearing session history', async () => {
    await createHistory('Acara lama');
    const db = await getDb();
    const settings = [
      {
        key: '_timex_writer',
        value: '{"owner":"active-tab","expires":9999999999999}',
        updatedAt: new Date().toISOString(),
      },
      {
        key: 'preference',
        value: 'saved',
        updatedAt: new Date().toISOString(),
      },
    ];
    for (const setting of settings) await db.put('settings', setting);
    const result = await HistoryService.clearAllHistory();
    expect(result.journalCleared).toBe(true);
    expect(await db.getAll('settings')).toEqual(settings);
    expect(sessionStorage.getItem('timex-pending-captures-v2')).toBeNull();
  });

  it('keeps stored history intact if an operation fails after clearing has started', async () => {
    await createHistory('Lomba');
    const before = await HistoryService.getSummary();
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (this.name === 'events')
        throw new DOMException('Simulated failure', 'QuotaExceededError');
      return originalPut.apply(this, args);
    });
    await expect(HistoryService.clearAllHistory()).rejects.toThrow(
      'Simulated failure'
    );
    expect(await HistoryService.getSummary()).toEqual(before);
  });

  it('refuses deletion for running sessions, pending captures and read-only tabs', async () => {
    const { event } = await createHistory('Lomba');
    const batch = await BatchRepository.createBatch(event.id);
    await BatchRepository.addBibToBatch({
      batchId: batch.id,
      bibColor: 'WHITE',
      bibNumber: 2,
    });
    await BatchRepository.startBatch({
      batchId: batch.id,
      startedAtWallClock: new Date().toISOString(),
      startedAtMonotonicMs: performance.now(),
    });
    const before = await HistoryService.getSummary();
    await expect(HistoryService.clearAllHistory()).rejects.toThrow(
      'Akhiri pencatatan'
    );
    expect(await HistoryService.getSummary()).toEqual(before);
    await BatchRepository.transitionBatchStatus({
      batchId: batch.id,
      targetStatus: 'REVIEW',
    });
    setSimulatedWriteFailure('Penuh');
    enqueueCapture({
      id: 'pending-clear-test',
      batchId: batch.id,
      elapsedMs: 500,
      recordedAtWallClock: new Date().toISOString(),
      timingSource: 'MONOTONIC',
    });
    await retryCaptures();
    setSimulatedWriteFailure(null);
    expect(getPendingCaptures()).toHaveLength(1);
    await expect(HistoryService.clearAllHistory()).rejects.toThrow('tertunda');
    await retryCaptures();
    setWriteLease(0);
    await expect(HistoryService.clearAllHistory()).rejects.toThrow('mode baca');
    setWriteLease(Infinity);
    await waitFor(async () =>
      expect((await HistoryService.getSummary()).events).toBe(1)
    );
  });
});
