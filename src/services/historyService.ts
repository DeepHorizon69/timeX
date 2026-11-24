import { checkWriteAllowed, getDb } from '../db/indexedDb';
import { EventRecord } from '../domain/types';
import { generateId } from '../domain/utils';
import { assertCapturesSaved, clearCaptureJournal } from './captureSession';
import { clearActiveSessionBatches } from './timekeeper';

export interface HistorySummary {
  events: number;
  batches: number;
  participants: number;
  finishes: number;
  auditLogs: number;
}

const historyStores = [
  'events',
  'batches',
  'batchBibEntries',
  'finishEvents',
  'auditLogs',
] as const;

export const HistoryService = {
  async getSummary(): Promise<HistorySummary> {
    const db = await getDb();
    const tx = db.transaction(historyStores, 'readonly');
    const [events, batches, participants, finishes, auditLogs] =
      await Promise.all(
        historyStores.map((store) => tx.objectStore(store).count())
      );
    await tx.done;
    return { events, batches, participants, finishes, auditLogs };
  },

  async clearAllHistory(): Promise<{ journalCleared: boolean }> {
    checkWriteAllowed();
    assertCapturesSaved();
    const db = await getDb();
    const tx = db.transaction(historyStores, 'readwrite');
    const running = await tx
      .objectStore('batches')
      .index('by-status')
      .count('RUNNING');
    if (running > 0) {
      await tx.done;
      throw new Error(
        'Akhiri pencatatan atau tutup pemulihan gelombang sebelum menghapus riwayat.'
      );
    }
    assertCapturesSaved();
    const now = new Date();
    const localDate = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    const newEvent: EventRecord = {
      id: generateId('evt'),
      name: 'Kegiatan baru',
      eventDate: localDate,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      status: 'ACTIVE',
    };
    try {
      await Promise.all(
        historyStores.map((store) => tx.objectStore(store).clear())
      );
      await tx.objectStore('events').put(newEvent);
      await tx.done;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* The transaction may already have aborted. */
      }
      await tx.done.catch(() => undefined);
      throw error;
    }
    clearActiveSessionBatches();
    return { journalCleared: clearCaptureJournal() };
  },
};
