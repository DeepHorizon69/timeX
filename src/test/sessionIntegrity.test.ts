import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllStores,
  getDb,
  setSimulatedWriteFailure,
  setWriteLease,
} from '../db/indexedDb';
import {
  AuditRepository,
  BatchRepository,
  EventRepository,
  FinishEventRepository,
} from '../db/repositories';
import { ExportService } from '../services/exportService';
import {
  captureFinishTimingNow,
  clearActiveSessionBatchesForTests,
  registerSessionStartedBatch,
} from '../services/timekeeper';
import { PendingCapture } from '../domain/types';

async function setupBatch() {
  const event = await EventRepository.ensureDefaultEvent();
  const batch = await BatchRepository.createBatch(event.id);
  const entry = await BatchRepository.addBibToBatch({
    batchId: batch.id,
    bibColor: 'BLUE',
    bibNumber: 12,
  });
  const running = await BatchRepository.startBatch({
    batchId: batch.id,
    startedAtWallClock: new Date().toISOString(),
    startedAtMonotonicMs: performance.now(),
  });
  registerSessionStartedBatch(batch.id);
  return { event, batch: running, entry };
}

describe('Session persistence and compatibility', () => {
  beforeEach(async () => {
    setWriteLease(Infinity);
    setSimulatedWriteFailure(null);
    clearActiveSessionBatchesForTests();
    await clearAllStores();
  });

  it('restores the emergency journal in a fresh module and retries without duplicating a committed capture', async () => {
    const { batch } = await setupBatch();
    const item: PendingCapture = {
      id: 'restored-finish',
      batchId: batch.id,
      ...captureFinishTimingNow(batch),
    };
    await FinishEventRepository.recordTimestampFirstFinish(item);
    sessionStorage.setItem('timex-pending-captures-v2', JSON.stringify([item]));
    vi.resetModules();
    const session = await import('../services/captureSession');
    session.restoreCaptureJournal();
    expect(session.getPendingCaptures()).toHaveLength(1);
    await session.retryCaptures();
    expect(session.getPendingCaptures()).toHaveLength(0);
    expect(
      await FinishEventRepository.listFinishEventsByBatch(batch.id)
    ).toHaveLength(1);
  });

  it('keeps an emergency capture available when browser storage also refuses the journal', async () => {
    const { batch } = await setupBatch();
    const session = await import('../services/captureSession');
    const item: PendingCapture = {
      id: 'quota-finish',
      batchId: batch.id,
      ...captureFinishTimingNow(batch),
    };
    const storageSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('Quota exceeded');
      });
    const freshDb = await import('../db/indexedDb');
    freshDb.setSimulatedWriteFailure('Disk full');
    session.enqueueCapture(item);
    await session.retryCaptures();
    expect(session.getPendingCaptures()[0]).toMatchObject({
      id: item.id,
      elapsedMs: item.elapsedMs,
    });
    storageSpy.mockRestore();
    freshDb.setSimulatedWriteFailure(null);
    await session.retryCaptures();
    expect(session.getPendingCaptures()).toHaveLength(0);
  });

  it('rejects changed bulk selections atomically and records each deferred decision', async () => {
    const { batch, entry } = await setupBatch();
    const other = await BatchRepository.addBibToBatch({
      batchId: batch.id,
      bibColor: 'WHITE',
      bibNumber: 1,
      allowRunningException: true,
      reason: 'Peserta susulan',
    });
    await FinishEventRepository.markParticipantStatus({
      batchBibEntryId: entry.id,
      status: 'DNS',
    });
    await expect(
      BatchRepository.markWaitingParticipants(
        batch.id,
        [entry.id, other.id],
        'DNF'
      )
    ).rejects.toThrow('Daftar peserta berubah');
    expect(
      (await BatchRepository.listBibEntriesByBatch(batch.id)).find(
        (item) => item.id === other.id
      )?.status
    ).toBe('WAITING');
    await BatchRepository.transitionBatchStatus({
      batchId: batch.id,
      targetStatus: 'REVIEW',
    });
    await BatchRepository.deferReview(batch.id);
    expect(
      (await AuditRepository.listByBatch(batch.id)).some(
        (log) =>
          log.entityId === other.id && log.action === 'DEFER_PARTICIPANT_REVIEW'
      )
    ).toBe(true);
  });

  it('blocks a second running gelombang when reopening history', async () => {
    const { event, batch } = await setupBatch();
    await BatchRepository.transitionBatchStatus({
      batchId: batch.id,
      targetStatus: 'REVIEW',
    });
    const next = await BatchRepository.createBatch(event.id);
    await BatchRepository.addBibToBatch({
      batchId: next.id,
      bibColor: 'BLUE',
      bibNumber: 12,
    });
    await BatchRepository.startBatch({
      batchId: next.id,
      startedAtWallClock: new Date().toISOString(),
      startedAtMonotonicMs: performance.now(),
    });
    await expect(
      BatchRepository.transitionBatchStatus({
        batchId: batch.id,
        targetStatus: 'RUNNING',
      })
    ).rejects.toThrow('Tutup gelombang');
  });

  it('reads v1 backups and rejects cross-gelombang references before changing stored data', async () => {
    const { batch } = await setupBatch();
    await BatchRepository.transitionBatchStatus({
      batchId: batch.id,
      targetStatus: 'REVIEW',
    });
    const backup = await ExportService.buildJsonBackup();
    const old = { ...backup, schemaVersion: 1, pendingCaptures: undefined };
    await ExportService.importValidatedBackup(old);
    expect(await BatchRepository.getBatchById(batch.id)).toBeDefined();
    const invalid = {
      ...backup,
      batchBibEntries: backup.batchBibEntries.map((entry) => ({
        ...entry,
        batchId: 'missing',
      })),
    };
    await expect(ExportService.importValidatedBackup(invalid)).rejects.toThrow(
      'tidak konsisten'
    );
    expect(await BatchRepository.listBibEntriesByBatch(batch.id)).toHaveLength(
      1
    );
  });

  it('validates rescue files against existing data and guards read-only writes', async () => {
    const { batch } = await setupBatch();
    const item: PendingCapture = {
      id: 'rescue-1',
      batchId: batch.id,
      ...captureFinishTimingNow(batch),
    };
    expect(
      await ExportService.validateRescueJson(
        JSON.stringify({ appName: 'TimeX Rescue', pendingCaptures: [item] })
      )
    ).toEqual([item]);
    await expect(
      ExportService.validateRescueJson(
        JSON.stringify({
          appName: 'TimeX Rescue',
          pendingCaptures: [{ ...item, batchId: 'unknown' }],
        })
      )
    ).rejects.toThrow('Pulihkan backup');
    setWriteLease(0);
    await expect(
      FinishEventRepository.recordTimestampFirstFinish(item)
    ).rejects.toThrow('mode baca');
    setWriteLease(Infinity);
    expect(await (await getDb()).count('finishEvents')).toBe(0);
  });
});
