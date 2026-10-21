import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAllStores,
  resetDbConnectionForTests,
  setSimulatedWriteFailure,
  StoragePersistenceError,
} from '../db/indexedDb';
import {
  AuditRepository,
  BatchRepository,
  EventRepository,
  FinishEventRepository,
} from '../db/repositories';
import { ExportService } from '../services/exportService';
import { formatElapsedMs, parseElapsedString } from '../domain/utils';

describe('Run Timing Repositories, Timekeeping, Recovery & Export', () => {
  beforeEach(async () => {
    setSimulatedWriteFailure(null);
    await resetDbConnectionForTests();
    await clearAllStores();
  });

  it('creates an event and two batches, blocks duplicate bibs in same batch, allows same bib in another batch', async () => {
    const event = await EventRepository.createEvent('Tes Lari Pagi', '2026-10-22');
    expect(event.name).toBe('Tes Lari Pagi');

    const batch1 = await BatchRepository.createBatch(event.id, 'TIMESTAMP_FIRST');
    expect(batch1.batchNumber).toBe(1);

    const b12 = await BatchRepository.addBibToBatch({
      batchId: batch1.id,
      bibColor: 'BLUE',
      bibNumber: 12,
      participantName: 'Andi, "Schnell"',
    });
    expect(b12.bibLabel).toBe('B12');

    const m07 = await BatchRepository.addBibToBatch({
      batchId: batch1.id,
      bibColor: 'RED',
      bibNumber: 7,
    });
    expect(m07.bibLabel).toBe('M07');

    // Reject duplicate in same batch
    await expect(
      BatchRepository.addBibToBatch({
        batchId: batch1.id,
        bibColor: 'BLUE',
        bibNumber: 12,
      })
    ).rejects.toThrow(/sudah terdaftar/);

    // Reject invalid bib numbers
    await expect(
      BatchRepository.addBibToBatch({
        batchId: batch1.id,
        bibColor: 'WHITE',
        bibNumber: 0,
      })
    ).rejects.toThrow(/antara 1 sampai 50/);

    await expect(
      BatchRepository.addBibToBatch({
        batchId: batch1.id,
        bibColor: 'YELLOW',
        bibNumber: 51,
      })
    ).rejects.toThrow(/antara 1 sampai 50/);

    // Start Batch 1
    const startedBatch1 = await BatchRepository.startBatch({
      batchId: batch1.id,
      startedAtWallClock: '2026-10-22T06:00:00.000Z',
      startedAtMonotonicMs: 1000,
    });
    expect(startedBatch1.status).toBe('RUNNING');

    // Cannot create Batch 2 while Batch 1 is RUNNING
    await expect(BatchRepository.createBatch(event.id)).rejects.toThrow(/masih berjalan/);

    // Cannot add bib after start without explicit exception
    await expect(
      BatchRepository.addBibToBatch({
        batchId: batch1.id,
        bibColor: 'GREEN',
        bibNumber: 5,
      })
    ).rejects.toThrow(/dikunci setelah batch dimulai/);

    // Record finishes in Batch 1
    const fin1 = await FinishEventRepository.recordTimestampFirstFinish({
      batchId: batch1.id,
      recordedAtWallClock: '2026-10-22T06:05:12.340Z',
      recordedAtMonotonicMs: 313340,
      elapsedMs: 312340,
      timingSource: 'MONOTONIC',
    });
    expect(fin1.sequence).toBe(1);
    expect(fin1.status).toBe('UNIDENTIFIED');

    // Identify F-001 as B12
    const identified = await FinishEventRepository.identifyFinishEvent({
      finishEventId: fin1.id,
      batchBibEntryId: b12.id,
    });
    expect(identified.finishEvent.status).toBe('IDENTIFIED');
    expect(identified.bibEntry.status).toBe('FINISHED');

    // Mark M07 as DNF
    await FinishEventRepository.markParticipantStatus({
      batchBibEntryId: m07.id,
      status: 'DNF',
      reason: 'Cedera ringan',
    });

    // Complete Batch 1
    const completedBatch1 = await BatchRepository.completeBatch(batch1.id);
    expect(completedBatch1.status).toBe('COMPLETED');

    // Create Batch 2 and reuse B12
    const batch2 = await BatchRepository.createBatch(event.id, 'DIRECT_CARD');
    expect(batch2.batchNumber).toBe(2);

    const b12Batch2 = await BatchRepository.addBibToBatch({
      batchId: batch2.id,
      bibColor: 'BLUE',
      bibNumber: 12,
    });
    expect(b12Batch2.bibLabel).toBe('B12');
    expect(b12Batch2.id).not.toBe(b12.id);

    // Start Batch 2 and record finish for B12 in Batch 2
    await BatchRepository.startBatch({
      batchId: batch2.id,
      startedAtWallClock: '2026-10-22T06:30:00.000Z',
      startedAtMonotonicMs: 5000,
    });
    await FinishEventRepository.recordDirectCardFinish({
      batchId: batch2.id,
      batchBibEntryId: b12Batch2.id,
      recordedAtWallClock: '2026-10-22T06:34:00.000Z',
      recordedAtMonotonicMs: 245000,
      elapsedMs: 240000,
      timingSource: 'MONOTONIC',
    });

    // Verify Batch 1 results are completely untouched
    const batch1Results = await FinishEventRepository.getBatchResults(batch1.id);
    const b12Result1 = batch1Results.results.find((r) => r.entry.bibLabel === 'B12');
    expect(b12Result1?.finishEvent?.elapsedMs).toBe(312340);

    const batch2Results = await FinishEventRepository.getBatchResults(batch2.id);
    const b12Result2 = batch2Results.results.find((r) => r.entry.bibLabel === 'B12');
    expect(b12Result2?.finishEvent?.elapsedMs).toBe(240000);
  });

  it('prevents assigning two finish events to the same bib, supports correction and audit logs', async () => {
    const event = await EventRepository.createEvent('Event Koreksi');
    const batch = await BatchRepository.createBatch(event.id, 'TIMESTAMP_FIRST');
    const p1 = await BatchRepository.addBibToBatch({
      batchId: batch.id,
      bibColor: 'WHITE',
      bibNumber: 1,
    });
    const p2 = await BatchRepository.addBibToBatch({
      batchId: batch.id,
      bibColor: 'YELLOW',
      bibNumber: 2,
    });

    await BatchRepository.startBatch({
      batchId: batch.id,
      startedAtWallClock: '2026-10-22T07:00:00.000Z',
      startedAtMonotonicMs: 100,
    });

    const f1 = await FinishEventRepository.recordTimestampFirstFinish({
      batchId: batch.id,
      recordedAtWallClock: '2026-10-22T07:02:00.000Z',
      recordedAtMonotonicMs: 120100,
      elapsedMs: 120000,
      timingSource: 'MONOTONIC',
    });
    const f2 = await FinishEventRepository.recordTimestampFirstFinish({
      batchId: batch.id,
      recordedAtWallClock: '2026-10-22T07:02:05.000Z',
      recordedAtMonotonicMs: 125100,
      elapsedMs: 125000,
      timingSource: 'MONOTONIC',
    });

    await FinishEventRepository.identifyFinishEvent({
      finishEventId: f1.id,
      batchBibEntryId: p1.id,
    });

    // Attempting to assign f2 to p1 (already finished) should fail
    await expect(
      FinishEventRepository.identifyFinishEvent({
        finishEventId: f2.id,
        batchBibEntryId: p1.id,
      })
    ).rejects.toThrow(/sudah terhubung/);

    // Reassign f1 from p1 (P01) to p2 (K02) with reason
    const corrected = await FinishEventRepository.identifyFinishEvent({
      finishEventId: f1.id,
      batchBibEntryId: p2.id,
      reason: 'Salah lihat warna kaos',
    });
    expect(corrected.finishEvent.correctionHistory).toHaveLength(1);
    expect(corrected.finishEvent.correctionHistory[0].oldValue).toBe('P01');
    expect(corrected.finishEvent.correctionHistory[0].newValue).toBe('K02');

    // Now p1 is WAITING again and can be assigned to f2
    const entries = await BatchRepository.listBibEntriesByBatch(batch.id);
    const updatedP1 = entries.find((e) => e.id === p1.id);
    expect(updatedP1?.status).toBe('WAITING');

    // Correct elapsed time with audit
    const timeCorrected = await FinishEventRepository.correctFinishElapsedTime({
      finishEventId: f1.id,
      newElapsedMs: 119500,
      reason: 'Penyesuaian manual catatan juri',
    });
    expect(timeCorrected.elapsedMs).toBe(119500);
    expect(timeCorrected.correctionHistory).toHaveLength(2);

    const logs = await AuditRepository.listByBatch(batch.id);
    expect(logs.some((l) => l.action === 'REASSIGN_FINISH_BIB')).toBe(true);
    expect(logs.some((l) => l.action === 'CORRECT_FINISH_TIME')).toBe(true);
  });

  it('flags running batches for recovery on reload and supports backup/restore & CSV export', async () => {
    const event = await EventRepository.createEvent('Event Pemulihan, "Spesial"');
    const batch = await BatchRepository.createBatch(event.id, 'TIMESTAMP_FIRST');
    const entry = await BatchRepository.addBibToBatch({
      batchId: batch.id,
      bibColor: 'GREEN',
      bibNumber: 15,
      participantName: 'Budi, Jr.\nTim A',
    });

    await BatchRepository.startBatch({
      batchId: batch.id,
      startedAtWallClock: '2026-10-22T08:00:00.000Z',
      startedAtMonotonicMs: 500,
    });

    const fin = await FinishEventRepository.recordTimestampFirstFinish({
      batchId: batch.id,
      recordedAtWallClock: '2026-10-22T08:03:20.000Z',
      recordedAtMonotonicMs: 200500,
      elapsedMs: 200000,
      timingSource: 'MONOTONIC',
    });
    await FinishEventRepository.identifyFinishEvent({
      finishEventId: fin.id,
      batchBibEntryId: entry.id,
    });

    // Simulate reload: no active in-memory batch IDs
    const flagged = await BatchRepository.flagRunningBatchesForRecovery(new Set());
    expect(flagged).toHaveLength(1);
    expect(flagged[0].recoveryRequired).toBe(true);
    expect(flagged[0].startedAtMonotonicMs).toBeUndefined();

    // Resume with wall-clock fallback
    const resumed = await BatchRepository.resumeBatchWithWallClockFallback(batch.id);
    expect(resumed.recoveryRequired).toBe(false);
    expect(resumed.timingSource).toBe('WALL_CLOCK_FALLBACK');

    // Export CSV and verify proper escaping of quotes, commas, and newlines
    const csv = await ExportService.buildCsvString({ eventId: event.id });
    expect(csv).toContain('event_id,event_name,event_date');
    expect(csv).toContain('"Event Pemulihan, ""Spesial"""');
    expect(csv).toContain('"Budi, Jr.\nTim A"');
    expect(csv).toContain('H15');
    expect(csv).toContain('03:20.00');

    // Export JSON Backup, clear DB, and restore
    const jsonString = await ExportService.buildJsonBackupString();
    await clearAllStores();
    expect(await EventRepository.listEvents()).toHaveLength(0);

    const preview = await ExportService.validateAndPreviewBackupJson(jsonString);
    expect(preview.eventCount).toBe(1);
    expect(preview.batchCount).toBe(1);
    expect(preview.finishEventCount).toBe(1);

    await ExportService.importValidatedBackup(preview.payload);
    const restoredEvents = await EventRepository.listEvents();
    expect(restoredEvents).toHaveLength(1);
    expect(restoredEvents[0].name).toBe('Event Pemulihan, "Spesial"');
  });

  it('surfaces StoragePersistenceError when IndexedDB write fails', async () => {
    const event = await EventRepository.createEvent('Event Normal');
    const batch = await BatchRepository.createBatch(event.id);
    await BatchRepository.addBibToBatch({
      batchId: batch.id,
      bibColor: 'RED',
      bibNumber: 1,
    });
    await BatchRepository.startBatch({
      batchId: batch.id,
      startedAtWallClock: new Date().toISOString(),
      startedAtMonotonicMs: 100,
    });

    setSimulatedWriteFailure('Kuota penyimpanan penuh (Simulasi)');
    await expect(
      FinishEventRepository.recordTimestampFirstFinish({
        batchId: batch.id,
        recordedAtWallClock: new Date().toISOString(),
        recordedAtMonotonicMs: 2000,
        elapsedMs: 1900,
        timingSource: 'MONOTONIC',
      })
    ).rejects.toThrow(StoragePersistenceError);
  });

  it('formats and parses elapsed time accurately without floating-point drift', () => {
    expect(formatElapsedMs(0)).toBe('00:00.00');
    expect(formatElapsedMs(65432)).toBe('01:05.43');
    expect(formatElapsedMs(3661990)).toBe('01:01:01.99');
    expect(parseElapsedString('01:05.43')).toBe(65430);
    expect(parseElapsedString('01:01:01.99')).toBe(3661990);
  });
});
