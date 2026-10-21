import {
  AuditLogRecord,
  BatchBibEntry,
  BatchRecord,
  BatchStatus,
  BibColor,
  DerivedParticipantResult,
  EventRecord,
  FinishEventRecord,
  ParticipantStatus,
  RecordingMode,
  TimingSource,
} from '../domain/types';
import {
  BIB_COLOR_MAP,
  formatBibLabel,
  generateId,
  isValidBibColor,
  isValidBibNumber,
} from '../domain/utils';
import { checkWriteAllowed, getDb, StoragePersistenceError } from './indexedDb';

function wrapWriteError(err: unknown, fallbackMessage: string): never {
  if (err instanceof StoragePersistenceError) {
    throw err;
  }
  if (err instanceof Error) {
    throw new StoragePersistenceError(`${fallbackMessage}: ${err.message}`, err);
  }
  throw new StoragePersistenceError(fallbackMessage, err);
}

export function sortBibEntriesStable(entries: BatchBibEntry[]): BatchBibEntry[] {
  return [...entries].sort((a, b) => {
    const timeDiff = a.createdAt.localeCompare(b.createdAt);
    if (timeDiff !== 0) return timeDiff;
    const colorDiff = BIB_COLOR_MAP[a.bibColor].sortOrder - BIB_COLOR_MAP[b.bibColor].sortOrder;
    if (colorDiff !== 0) return colorDiff;
    return a.bibNumber - b.bibNumber;
  });
}

export function sortBibEntriesByBibCode(entries: BatchBibEntry[]): BatchBibEntry[] {
  return [...entries].sort((a, b) => {
    const colorDiff = BIB_COLOR_MAP[a.bibColor].sortOrder - BIB_COLOR_MAP[b.bibColor].sortOrder;
    if (colorDiff !== 0) return colorDiff;
    return a.bibNumber - b.bibNumber;
  });
}

export const EventRepository = {
  async listEvents(): Promise<EventRecord[]> {
    const db = await getDb();
    const events = await db.getAll('events');
    return events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async getEventById(id: string): Promise<EventRecord | undefined> {
    const db = await getDb();
    return db.get('events', id);
  },

  async getActiveEvent(): Promise<EventRecord | undefined> {
    const events = await this.listEvents();
    const active = events.find((e) => e.status === 'ACTIVE');
    return active ?? events[0];
  },

  async ensureDefaultEvent(): Promise<EventRecord> {
    const existing = await this.getActiveEvent();
    if (existing) return existing;
    const today = new Date().toISOString().slice(0, 10);
    return this.createEvent(`Simulasi Lari ${today}`, today);
  },

  async createEvent(name: string, eventDate?: string): Promise<EventRecord> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('Nama kegiatan tidak boleh kosong.');
    }
    try {
      checkWriteAllowed();
      const db = await getDb();
      const now = new Date().toISOString();
      const dateStr = eventDate?.trim() || now.slice(0, 10);

      const tx = db.transaction(['events', 'auditLogs'], 'readwrite');
      const allEvents = await tx.objectStore('events').getAll();

      // Mark previous ACTIVE events as COMPLETED or keep them preserved;
      // Only one event is ACTIVE at a time so operator context is clear.
      for (const prev of allEvents) {
        if (prev.status === 'ACTIVE') {
          await tx.objectStore('events').put({
            ...prev,
            status: 'COMPLETED',
            updatedAt: now,
          });
        }
      }

      const newEvent: EventRecord = {
        id: generateId('evt'),
        name: trimmed,
        eventDate: dateStr,
        createdAt: now,
        updatedAt: now,
        status: 'ACTIVE',
      };

      await tx.objectStore('events').put(newEvent);
      const audit: AuditLogRecord = {
        id: generateId('aud'),
        eventId: newEvent.id,
        entityType: 'EVENT',
        entityId: newEvent.id,
        action: 'CREATE_EVENT',
        changedAt: now,
        newValue: `${newEvent.name} (${newEvent.eventDate})`,
      };
      await tx.objectStore('auditLogs').put(audit);
      await tx.done;
      return newEvent;
    } catch (err) {
      wrapWriteError(err, 'Gagal menyimpan kegiatan ke penyimpanan lokal');
    }
  },

  async updateEvent(
    eventId: string,
    updates: { name: string; eventDate?: string }
  ): Promise<EventRecord> {
    const trimmed = updates.name.trim();
    if (!trimmed) {
      throw new Error('Nama kegiatan tidak boleh kosong.');
    }
    try {
      checkWriteAllowed();
      const db = await getDb();
      const tx = db.transaction(['events', 'auditLogs'], 'readwrite');
      const existing = await tx.objectStore('events').get(eventId);
      if (!existing) {
        throw new Error('Kegiatan tidak ditemukan.');
      }
      const now = new Date().toISOString();
      const updated: EventRecord = {
        ...existing,
        name: trimmed,
        eventDate: updates.eventDate?.trim() || existing.eventDate,
        updatedAt: now,
      };
      await tx.objectStore('events').put(updated);
      await tx.objectStore('auditLogs').put({
        id: generateId('aud'),
        eventId: existing.id,
        entityType: 'EVENT',
        entityId: existing.id,
        action: 'UPDATE_EVENT',
        changedAt: now,
        oldValue: `${existing.name} (${existing.eventDate})`,
        newValue: `${updated.name} (${updated.eventDate})`,
      });
      await tx.done;
      return updated;
    } catch (err) {
      wrapWriteError(err, 'Gagal memperbarui nama kegiatan');
    }
  },

  async switchActiveEvent(eventId: string): Promise<EventRecord> {
    try {
      checkWriteAllowed();
      const db = await getDb();
      const tx = db.transaction(['events'], 'readwrite');
      const all = await tx.objectStore('events').getAll();
      const target = all.find((e) => e.id === eventId);
      if (!target) {
        throw new Error('Kegiatan tidak ditemukan.');
      }
      const now = new Date().toISOString();
      for (const ev of all) {
        const desiredStatus = ev.id === eventId ? 'ACTIVE' : 'COMPLETED';
        if (ev.status !== desiredStatus) {
          await tx.objectStore('events').put({
            ...ev,
            status: desiredStatus,
            updatedAt: now,
          });
        }
      }
      await tx.done;
      return { ...target, status: 'ACTIVE', updatedAt: now };
    } catch (err) {
      wrapWriteError(err, 'Gagal mengganti kegiatan aktif');
    }
  },
};

export const BatchRepository = {
  async listBatchesByEvent(eventId: string): Promise<BatchRecord[]> {
    const db = await getDb();
    const batches = await db.getAllFromIndex('batches', 'by-eventId', eventId);
    return batches.sort((a, b) => b.batchNumber - a.batchNumber);
  },

  async getBatchById(batchId: string): Promise<BatchRecord | undefined> {
    const db = await getDb();
    return db.get('batches', batchId);
  },

  async listBibEntriesByBatch(batchId: string): Promise<BatchBibEntry[]> {
    const db = await getDb();
    const entries = await db.getAllFromIndex('batchBibEntries', 'by-batchId', batchId);
    return sortBibEntriesStable(entries);
  },

  async createBatch(
    eventId: string,
    recordingMode: RecordingMode = 'TIMESTAMP_FIRST'
  ): Promise<BatchRecord> {
    try {
      checkWriteAllowed();
      const db = await getDb();
      const tx = db.transaction(['batches', 'auditLogs'], 'readwrite');
      const existingBatches = await tx
        .objectStore('batches')
        .index('by-eventId')
        .getAll(eventId);

      const runningBatch = existingBatches.find((b) => b.status === 'RUNNING');
      if (runningBatch) {
        throw new Error(
          `Batch #${runningBatch.batchNumber} masih berjalan. Selesaikan atau tinjau Batch #${runningBatch.batchNumber} terlebih dahulu.`
        );
      }

      const maxNum = existingBatches.reduce(
        (max, b) => (b.batchNumber > max ? b.batchNumber : max),
        0
      );
      const now = new Date().toISOString();
      const batch: BatchRecord = {
        id: generateId('bat'),
        eventId,
        batchNumber: maxNum + 1,
        status: 'DRAFT',
        recordingMode,
        createdAt: now,
        updatedAt: now,
      };

      await tx.objectStore('batches').put(batch);
      await tx.objectStore('auditLogs').put({
        id: generateId('aud'),
        eventId,
        batchId: batch.id,
        entityType: 'BATCH',
        entityId: batch.id,
        action: 'CREATE_BATCH',
        changedAt: now,
        newValue: `Batch #${batch.batchNumber} (${recordingMode})`,
      });
      await tx.done;
      return batch;
    } catch (err) {
      if (err instanceof Error && !(err instanceof StoragePersistenceError)) {
        if (err.message.includes('masih berjalan')) throw err;
      }
      wrapWriteError(err, 'Gagal membuat batch baru');
    }
  },

  async updateRecordingMode(
    batchId: string,
    newMode: RecordingMode,
    reason?: string
  ): Promise<BatchRecord> {
    try {
      checkWriteAllowed();
      const db = await getDb();
      const tx = db.transaction(['batches', 'auditLogs'], 'readwrite');
      const batch = await tx.objectStore('batches').get(batchId);
      if (!batch) {
        throw new Error('Batch tidak ditemukan.');
      }
      if (batch.recordingMode === newMode) {
        await tx.done;
        return batch;
      }
      const now = new Date().toISOString();
      const updated: BatchRecord = {
        ...batch,
        recordingMode: newMode,
        updatedAt: now,
      };
      await tx.objectStore('batches').put(updated);
      await tx.objectStore('auditLogs').put({
        id: generateId('aud'),
        eventId: batch.eventId,
        batchId: batch.id,
        entityType: 'BATCH',
        entityId: batch.id,
        action: 'CHANGE_RECORDING_MODE',
        changedAt: now,
        field: 'recordingMode',
        oldValue: batch.recordingMode,
        newValue: newMode,
        reason,
      });
      await tx.done;
      return updated;
    } catch (err) {
      wrapWriteError(err, 'Gagal mengubah mode pencatatan batch');
    }
  },

  async addBibToBatch(params: {
    batchId: string;
    bibColor: BibColor;
    bibNumber: number;
    participantName?: string;
    allowRunningException?: boolean;
    reason?: string;
  }): Promise<BatchBibEntry> {
    const { batchId, bibColor, bibNumber, participantName, allowRunningException, reason } =
      params;

    if (!isValidBibColor(bibColor)) {
      throw new Error('Warna bib tidak valid. Pilih Putih, Hijau, Merah, Biru, atau Kuning.');
    }
    if (!isValidBibNumber(bibNumber)) {
      throw new Error('Nomor bib harus berupa angka bulat antara 1 sampai 50.');
    }

    try {
      checkWriteAllowed();
      const db = await getDb();
      const tx = db.transaction(['batches', 'batchBibEntries', 'auditLogs'], 'readwrite');
      const batch = await tx.objectStore('batches').get(batchId);
      if (!batch) {
        throw new Error('Batch tidak ditemukan.');
      }

      const isPreStart = batch.status === 'DRAFT' || batch.status === 'READY';
      if (!isPreStart && !allowRunningException) {
        throw new Error(
          'Daftar peserta dikunci setelah batch dimulai. Gunakan aksi tambah darurat jika benar-benar diperlukan.'
        );
      }

      const existingEntries = await tx
        .objectStore('batchBibEntries')
        .index('by-batchId')
        .getAll(batchId);

      const label = formatBibLabel(bibColor, bibNumber);
      const duplicate = existingEntries.find(
        (e) => e.bibColor === bibColor && e.bibNumber === bibNumber
      );
      if (duplicate) {
        throw new Error(
          `Nomor bib ${label} (${BIB_COLOR_MAP[bibColor].nameId} ${bibNumber}) sudah terdaftar di Batch #${batch.batchNumber}.`
        );
      }

      const now = new Date().toISOString();
      const entry: BatchBibEntry = {
        id: generateId('bib'),
        eventId: batch.eventId,
        batchId: batch.id,
        bibColor,
        bibNumber,
        bibLabel: label,
        participantName: participantName?.trim() || undefined,
        status: 'WAITING',
        createdAt: now,
        updatedAt: now,
      };

      await tx.objectStore('batchBibEntries').put(entry);

      if (batch.status === 'DRAFT') {
        await tx.objectStore('batches').put({
          ...batch,
          status: 'READY',
          updatedAt: now,
        });
      }

      if (!isPreStart && allowRunningException) {
        await tx.objectStore('auditLogs').put({
          id: generateId('aud'),
          eventId: batch.eventId,
          batchId: batch.id,
          entityType: 'BIB_ENTRY',
          entityId: entry.id,
          action: 'ADD_BIB_AFTER_START',
          changedAt: now,
          newValue: entry.bibLabel,
          reason: reason || 'Penambahan peserta susulan saat batch berjalan',
        });
      }

      await tx.done;
      return entry;
    } catch (err) {
      if (
        err instanceof Error &&
        !(err instanceof StoragePersistenceError) &&
        (err.message.includes('sudah terdaftar') ||
          err.message.includes('dikunci') ||
          err.message.includes('tidak valid') ||
          err.message.includes('antara 1 sampai 50'))
      ) {
        throw err;
      }
      wrapWriteError(err, 'Gagal menambahkan nomor bib ke batch');
    }
  },

  async updateBibInDraftBatch(params: {
    entryId: string;
    bibColor: BibColor;
    bibNumber: number;
    participantName?: string;
  }): Promise<BatchBibEntry> {
    const { entryId, bibColor, bibNumber, participantName } = params;
    if (!isValidBibColor(bibColor)) {
      throw new Error('Warna bib tidak valid.');
    }
    if (!isValidBibNumber(bibNumber)) {
      throw new Error('Nomor bib harus antara 1 sampai 50.');
    }

    try {
      checkWriteAllowed();
      const db = await getDb();
      const tx = db.transaction(['batches', 'batchBibEntries', 'auditLogs'], 'readwrite');
      const entry = await tx.objectStore('batchBibEntries').get(entryId);
      if (!entry) {
        throw new Error('Peserta tidak ditemukan.');
      }
      const batch = await tx.objectStore('batches').get(entry.batchId);
      if (!batch || (batch.status !== 'DRAFT' && batch.status !== 'READY')) {
        throw new Error('Nomor bib hanya dapat diubah langsung sebelum batch dimulai.');
      }

      const siblings = await tx
        .objectStore('batchBibEntries')
        .index('by-batchId')
        .getAll(entry.batchId);

      const duplicate = siblings.find(
        (e) => e.id !== entryId && e.bibColor === bibColor && e.bibNumber === bibNumber
      );
      const newLabel = formatBibLabel(bibColor, bibNumber);
      if (duplicate) {
        throw new Error(`Nomor bib ${newLabel} sudah ada di Batch #${batch.batchNumber}.`);
      }

      const now = new Date().toISOString();
      const updated: BatchBibEntry = {
        ...entry,
        bibColor,
        bibNumber,
        bibLabel: newLabel,
        participantName: participantName?.trim() || undefined,
        updatedAt: now,
      };
      await tx.objectStore('batchBibEntries').put(updated);
      await tx.done;
      return updated;
    } catch (err) {
      if (
        err instanceof Error &&
        !(err instanceof StoragePersistenceError) &&
        (err.message.includes('sudah ada') ||
          err.message.includes('sebelum batch dimulai') ||
          err.message.includes('antara 1 sampai 50'))
      ) {
        throw err;
      }
      wrapWriteError(err, 'Gagal memperbarui nomor bib');
    }
  },

  async removeBibFromDraftBatch(entryId: string): Promise<void> {
    try {
      checkWriteAllowed();
      const db = await getDb();
      const tx = db.transaction(['batches', 'batchBibEntries'], 'readwrite');
      const entry = await tx.objectStore('batchBibEntries').get(entryId);
      if (!entry) return;

      const batch = await tx.objectStore('batches').get(entry.batchId);
      if (!batch || (batch.status !== 'DRAFT' && batch.status !== 'READY')) {
        throw new Error('Peserta tidak dapat dihapus setelah batch dimulai.');
      }

      await tx.objectStore('batchBibEntries').delete(entryId);
      const remaining = await tx
        .objectStore('batchBibEntries')
        .index('by-batchId')
        .getAll(entry.batchId);

      if (remaining.length === 0 && batch.status === 'READY') {
        await tx.objectStore('batches').put({
          ...batch,
          status: 'DRAFT',
          updatedAt: new Date().toISOString(),
        });
      }
      await tx.done;
    } catch (err) {
      if (
        err instanceof Error &&
        !(err instanceof StoragePersistenceError) &&
        err.message.includes('setelah batch dimulai')
      ) {
        throw err;
      }
      wrapWriteError(err, 'Gagal menghapus nomor bib dari daftar');
    }
  },

  async startBatch(params: {
    batchId: string;
    startedAtWallClock: string;
    startedAtMonotonicMs: number;
  }): Promise<BatchRecord> {
    const { batchId, startedAtWallClock, startedAtMonotonicMs } = params;
    try {
      checkWriteAllowed();
      const db = await getDb();
      const tx = db.transaction(['batches', 'batchBibEntries', 'auditLogs'], 'readwrite');
      const batch = await tx.objectStore('batches').get(batchId);
      if (!batch) {
        throw new Error('Batch tidak ditemukan.');
      }
      if (batch.status !== 'DRAFT' && batch.status !== 'READY') {
        throw new Error(`Batch #${batch.batchNumber} sudah dimulai atau selesai.`);
      }

      const eventBatches = await tx
        .objectStore('batches')
        .index('by-eventId')
        .getAll(batch.eventId);
      const otherRunning = eventBatches.find(
        (b) => b.id !== batchId && b.status === 'RUNNING'
      );
      if (otherRunning) {
        throw new Error(
          `Batch #${otherRunning.batchNumber} masih berstatus sedang berjalan. Selesaikan atau tinjau terlebih dahulu.`
        );
      }

      const roster = await tx
        .objectStore('batchBibEntries')
        .index('by-batchId')
        .getAll(batchId);
      if (roster.length === 0) {
        throw new Error('Tidak dapat memulai batch kosong. Tambahkan minimal 1 nomor bib.');
      }

      const updated: BatchRecord = {
        ...batch,
        status: 'RUNNING',
        startedAtWallClock,
        startedAtMonotonicMs,
        timingSource: 'MONOTONIC',
        recoveryRequired: false,
        updatedAt: startedAtWallClock,
      };

      await tx.objectStore('batches').put(updated);
      await tx.objectStore('auditLogs').put({
        id: generateId('aud'),
        eventId: batch.eventId,
        batchId: batch.id,
        entityType: 'BATCH',
        entityId: batch.id,
        action: 'START_BATCH',
        changedAt: startedAtWallClock,
        newValue: `Mulai pada ${startedAtWallClock} (${roster.length} peserta)`,
      });
      await tx.done;
      return updated;
    } catch (err) {
      if (
        err instanceof Error &&
        !(err instanceof StoragePersistenceError) &&
        (err.message.includes('batch kosong') ||
          err.message.includes('masih berstatus') ||
          err.message.includes('sudah dimulai'))
      ) {
        throw err;
      }
      wrapWriteError(err, 'Gagal memulai batch. Pastikan penyimpanan perangkat tersedia');
    }
  },

  /**
   * Called on page load to detect any RUNNING batches whose monotonic timer origin
   * was lost due to browser reload/reopen.
   */
  async flagRunningBatchesForRecovery(activeInMemoryBatchIds: Set<string>): Promise<BatchRecord[]> {
    const db = await getDb();
    const runningBatches = await db.getAllFromIndex('batches', 'by-status', 'RUNNING');
    const flagged: BatchRecord[] = [];

    for (const b of runningBatches) {
      if (!activeInMemoryBatchIds.has(b.id)) {
        if (!b.recoveryRequired) {
          checkWriteAllowed();
          const now = new Date().toISOString();
          const updated: BatchRecord = {
            ...b,
            recoveryRequired: true,
            startedAtMonotonicMs: undefined,
            updatedAt: now,
          };
          const tx = db.transaction(['batches', 'auditLogs'], 'readwrite');
          await tx.objectStore('batches').put(updated);
          await tx.objectStore('auditLogs').put({
            id: generateId('aud'),
            eventId: b.eventId,
            batchId: b.id,
            entityType: 'BATCH',
            entityId: b.id,
            action: 'RELOAD_RECOVERY_TRIGGERED',
            changedAt: now,
            reason: 'Halaman dimuat ulang saat batch masih RUNNING; origin waktu monotonik terputus.',
          });
          await tx.done;
          flagged.push(updated);
        } else {
          flagged.push(b);
        }
      }
    }
    return flagged;
  },

  async resumeBatchWithWallClockFallback(
    batchId: string,
    reason?: string
  ): Promise<BatchRecord> {
    try {
      checkWriteAllowed();
      const db = await getDb();
      const tx = db.transaction(['batches', 'auditLogs'], 'readwrite');
      const batch = await tx.objectStore('batches').get(batchId);
      if (!batch) {
        throw new Error('Batch tidak ditemukan.');
      }
      if (!batch.startedAtWallClock) {
        throw new Error('Waktu mulai batch tidak ditemukan untuk pemulihan.');
      }
      const now = new Date().toISOString();
      const updated: BatchRecord = {
        ...batch,
        status: 'RUNNING',
        recoveryRequired: false,
        timingSource: 'WALL_CLOCK_FALLBACK',
        startedAtMonotonicMs: undefined,
        updatedAt: now,
      };
      await tx.objectStore('batches').put(updated);
      await tx.objectStore('auditLogs').put({
        id: generateId('aud'),
        eventId: batch.eventId,
        batchId: batch.id,
        entityType: 'BATCH',
        entityId: batch.id,
        action: 'RESUME_WALL_CLOCK_FALLBACK',
        changedAt: now,
        oldValue: batch.timingSource ?? 'MONOTONIC',
        newValue: 'WALL_CLOCK_FALLBACK',
        reason:
          reason ||
          'Operator melanjutkan batch setelah muat ulang menggunakan waktu jam perangkat (wall-clock fallback).',
      });
      await tx.done;
      return updated;
    } catch (err) {
      wrapWriteError(err, 'Gagal memulihkan batch');
    }
  },

  async transitionBatchStatus(params: {
    batchId: string;
    targetStatus: BatchStatus;
    reason?: string;
  }): Promise<BatchRecord> {
    const { batchId, targetStatus, reason } = params;
    try {
      checkWriteAllowed();
      const db = await getDb();
      const tx = db.transaction(['batches', 'auditLogs'], 'readwrite');
      const batch = await tx.objectStore('batches').get(batchId);
      if (!batch) {
        throw new Error('Batch tidak ditemukan.');
      }
      const now = new Date().toISOString();
      const updated: BatchRecord = {
        ...batch,
        status: targetStatus,
        recoveryRequired: false,
        completedAt:
          targetStatus === 'COMPLETED' || targetStatus === 'NEEDS_REVIEW'
            ? now
            : batch.completedAt,
        updatedAt: now,
      };
      await tx.objectStore('batches').put(updated);
      await tx.objectStore('auditLogs').put({
        id: generateId('aud'),
        eventId: batch.eventId,
        batchId: batch.id,
        entityType: 'BATCH',
        entityId: batch.id,
        action: `STATUS_${targetStatus}`,
        changedAt: now,
        field: 'status',
        oldValue: batch.status,
        newValue: targetStatus,
        reason,
      });
      await tx.done;
      return updated;
    } catch (err) {
      wrapWriteError(err, 'Gagal memperbarui status batch');
    }
  },

  async completeBatch(batchId: string, notes?: string): Promise<BatchRecord> {
    try {
      checkWriteAllowed();
      const db = await getDb();
      const tx = db.transaction(
        ['batches', 'batchBibEntries', 'finishEvents', 'auditLogs'],
        'readwrite'
      );
      const batch = await tx.objectStore('batches').get(batchId);
      if (!batch) {
        throw new Error('Batch tidak ditemukan.');
      }

      const finishEvents = await tx
        .objectStore('finishEvents')
        .index('by-batchId')
        .getAll(batchId);
      const unidentified = finishEvents.filter((f) => f.status === 'UNIDENTIFIED');
      if (unidentified.length > 0) {
        throw new Error(
          `Masih ada ${unidentified.length} catatan waktu finish yang belum diidentifikasi. Identifikasi, tandai Perlu Diperiksa, atau batalkan terlebih dahulu.`
        );
      }

      const roster = await tx
        .objectStore('batchBibEntries')
        .index('by-batchId')
        .getAll(batchId);
      const waiting = roster.filter((r) => r.status === 'WAITING');
      if (waiting.length > 0) {
        throw new Error(
          `Masih ada ${waiting.length} peserta berstatus Belum Finish (${waiting
            .slice(0, 4)
            .map((w) => w.bibLabel)
            .join(', ')}${waiting.length > 4 ? '...' : ''}). Hubungkan ke waktu finish atau tandai DNS / DNF / Perlu Diperiksa.`
        );
      }

      const hasNeedsReview =
        finishEvents.some((f) => f.status === 'NEEDS_REVIEW') ||
        roster.some((r) => r.status === 'NEEDS_REVIEW');

      const finalStatus: BatchStatus = hasNeedsReview ? 'NEEDS_REVIEW' : 'COMPLETED';
      const now = new Date().toISOString();
      const updated: BatchRecord = {
        ...batch,
        status: finalStatus,
        recoveryRequired: false,
        completedAt: now,
        updatedAt: now,
        notes: notes?.trim() || batch.notes,
      };

      await tx.objectStore('batches').put(updated);
      await tx.objectStore('auditLogs').put({
        id: generateId('aud'),
        eventId: batch.eventId,
        batchId: batch.id,
        entityType: 'BATCH',
        entityId: batch.id,
        action: 'COMPLETE_BATCH',
        changedAt: now,
        oldValue: batch.status,
        newValue: finalStatus,
        reason: notes?.trim() || 'Batch diselesaikan setelah tinjauan operator',
      });
      await tx.done;
      return updated;
    } catch (err) {
      if (
        err instanceof Error &&
        !(err instanceof StoragePersistenceError) &&
        (err.message.includes('Masih ada') || err.message.includes('tidak ditemukan'))
      ) {
        throw err;
      }
      wrapWriteError(err, 'Gagal menyelesaikan batch');
    }
  },
};

export const FinishEventRepository = {
  async listFinishEventsByBatch(batchId: string): Promise<FinishEventRecord[]> {
    const db = await getDb();
    const events = await db.getAllFromIndex('finishEvents', 'by-batchId', batchId);
    return events.sort((a, b) => b.sequence - a.sequence);
  },

  async recordTimestampFirstFinish(params: {
    batchId: string;
    recordedAtWallClock: string;
    recordedAtMonotonicMs?: number;
    elapsedMs: number;
    timingSource: TimingSource;
  }): Promise<FinishEventRecord> {
    const {
      batchId,
      recordedAtWallClock,
      recordedAtMonotonicMs,
      elapsedMs,
      timingSource,
    } = params;

    try {
      checkWriteAllowed();
      const db = await getDb();
      const tx = db.transaction(['batches', 'finishEvents'], 'readwrite');
      const batch = await tx.objectStore('batches').get(batchId);
      if (!batch) {
        throw new Error('Batch tidak ditemukan.');
      }

      const existing = await tx
        .objectStore('finishEvents')
        .index('by-batchId')
        .getAll(batchId);
      const maxSeq = existing.reduce((m, f) => (f.sequence > m ? f.sequence : m), 0);

      const safeElapsedMs = Math.max(0, Math.round(elapsedMs));
      const record: FinishEventRecord = {
        id: generateId('fin'),
        eventId: batch.eventId,
        batchId: batch.id,
        sequence: maxSeq + 1,
        recordedAtWallClock,
        recordedAtMonotonicMs,
        elapsedMs: safeElapsedMs,
        timingSource,
        status: 'UNIDENTIFIED',
        correctionHistory: [],
      };

      await tx.objectStore('finishEvents').put(record);
      await tx.done;
      return record;
    } catch (err) {
      wrapWriteError(
        err,
        'GAGAL MENYIMPAN FINISH KE PERANGKAT! Jangan tutup halaman dan coba lagi'
      );
    }
  },

  async recordDirectCardFinish(params: {
    batchId: string;
    batchBibEntryId: string;
    recordedAtWallClock: string;
    recordedAtMonotonicMs?: number;
    elapsedMs: number;
    timingSource: TimingSource;
  }): Promise<{ finishEvent: FinishEventRecord; bibEntry: BatchBibEntry }> {
    const {
      batchId,
      batchBibEntryId,
      recordedAtWallClock,
      recordedAtMonotonicMs,
      elapsedMs,
      timingSource,
    } = params;

    try {
      checkWriteAllowed();
      const db = await getDb();
      const tx = db.transaction(
        ['batches', 'batchBibEntries', 'finishEvents'],
        'readwrite'
      );
      const batch = await tx.objectStore('batches').get(batchId);
      if (!batch) {
        throw new Error('Batch tidak ditemukan.');
      }
      const entry = await tx.objectStore('batchBibEntries').get(batchBibEntryId);
      if (!entry || entry.batchId !== batchId) {
        throw new Error('Peserta tidak ditemukan dalam batch ini.');
      }
      if (entry.status === 'FINISHED' && entry.finishEventId) {
        throw new Error(
          `Nomor ${entry.bibLabel} sudah tercatat finish. Gunakan fitur Koreksi jika ingin mengubah.`
        );
      }

      const existing = await tx
        .objectStore('finishEvents')
        .index('by-batchId')
        .getAll(batchId);
      const maxSeq = existing.reduce((m, f) => (f.sequence > m ? f.sequence : m), 0);

      const safeElapsedMs = Math.max(0, Math.round(elapsedMs));
      const finishEvent: FinishEventRecord = {
        id: generateId('fin'),
        eventId: batch.eventId,
        batchId: batch.id,
        sequence: maxSeq + 1,
        recordedAtWallClock,
        recordedAtMonotonicMs,
        elapsedMs: safeElapsedMs,
        timingSource,
        batchBibEntryId: entry.id,
        status: 'IDENTIFIED',
        correctionHistory: [],
      };

      const updatedEntry: BatchBibEntry = {
        ...entry,
        status: 'FINISHED',
        finishEventId: finishEvent.id,
        updatedAt: recordedAtWallClock,
      };

      await tx.objectStore('finishEvents').put(finishEvent);
      await tx.objectStore('batchBibEntries').put(updatedEntry);
      await tx.done;
      return { finishEvent, bibEntry: updatedEntry };
    } catch (err) {
      if (
        err instanceof Error &&
        !(err instanceof StoragePersistenceError) &&
        err.message.includes('sudah tercatat finish')
      ) {
        throw err;
      }
      wrapWriteError(
        err,
        'GAGAL MENYIMPAN FINISH KE PERANGKAT! Jangan tutup halaman dan coba lagi'
      );
    }
  },

  async identifyFinishEvent(params: {
    finishEventId: string;
    batchBibEntryId: string;
    reason?: string;
  }): Promise<{ finishEvent: FinishEventRecord; bibEntry: BatchBibEntry }> {
    const { finishEventId, batchBibEntryId, reason } = params;
    try {
      checkWriteAllowed();
      const db = await getDb();
      const tx = db.transaction(
        ['finishEvents', 'batchBibEntries', 'auditLogs'],
        'readwrite'
      );
      const finishEvent = await tx.objectStore('finishEvents').get(finishEventId);
      if (!finishEvent) {
        throw new Error('Catatan finish tidak ditemukan.');
      }
      if (finishEvent.status === 'CANCELLED') {
        throw new Error('Catatan finish yang sudah dibatalkan tidak dapat diidentifikasi.');
      }

      const targetBib = await tx.objectStore('batchBibEntries').get(batchBibEntryId);
      if (!targetBib || targetBib.batchId !== finishEvent.batchId) {
        throw new Error('Nomor bib tidak ditemukan pada batch yang sama.');
      }

      if (
        targetBib.finishEventId &&
        targetBib.finishEventId !== finishEventId &&
        targetBib.status === 'FINISHED'
      ) {
        throw new Error(
          `Nomor bib ${targetBib.bibLabel} sudah terhubung ke finish lain. Lepaskan atau koreksi terlebih dahulu.`
        );
      }

      const now = new Date().toISOString();
      const previousBibEntryId = finishEvent.batchBibEntryId;
      let previousBibLabel: string | null = null;

      // If this finish event was previously linked to another bib entry, release the old bib entry
      if (previousBibEntryId && previousBibEntryId !== batchBibEntryId) {
        const oldBib = await tx.objectStore('batchBibEntries').get(previousBibEntryId);
        if (oldBib) {
          previousBibLabel = oldBib.bibLabel;
          await tx.objectStore('batchBibEntries').put({
            ...oldBib,
            status: 'WAITING',
            finishEventId: undefined,
            updatedAt: now,
          });
        }
      }

      const isCorrection = Boolean(previousBibEntryId && previousBibEntryId !== batchBibEntryId);
      const updatedHistory = [...finishEvent.correctionHistory];
      if (isCorrection || reason) {
        updatedHistory.push({
          id: generateId('cor'),
          changedAt: now,
          field: 'batchBibEntryId',
          oldValue: previousBibLabel ?? previousBibEntryId ?? null,
          newValue: targetBib.bibLabel,
          reason: reason || (isCorrection ? 'Koreksi identifikasi nomor bib' : 'Identifikasi nomor bib'),
        });
      }

      const updatedFinish: FinishEventRecord = {
        ...finishEvent,
        batchBibEntryId: targetBib.id,
        status: 'IDENTIFIED',
        correctionHistory: updatedHistory,
      };

      const updatedBib: BatchBibEntry = {
        ...targetBib,
        status: 'FINISHED',
        finishEventId: finishEvent.id,
        updatedAt: now,
      };

      await tx.objectStore('finishEvents').put(updatedFinish);
      await tx.objectStore('batchBibEntries').put(updatedBib);

      if (isCorrection || reason) {
        await tx.objectStore('auditLogs').put({
          id: generateId('aud'),
          eventId: finishEvent.eventId,
          batchId: finishEvent.batchId,
          entityType: 'FINISH_EVENT',
          entityId: finishEvent.id,
          action: isCorrection ? 'REASSIGN_FINISH_BIB' : 'IDENTIFY_FINISH_BIB',
          changedAt: now,
          field: 'bibLabel',
          oldValue: previousBibLabel,
          newValue: targetBib.bibLabel,
          reason,
        });
      }

      await tx.done;
      return { finishEvent: updatedFinish, bibEntry: updatedBib };
    } catch (err) {
      if (
        err instanceof Error &&
        !(err instanceof StoragePersistenceError) &&
        (err.message.includes('sudah terhubung') ||
          err.message.includes('tidak ditemukan') ||
          err.message.includes('dibatalkan'))
      ) {
        throw err;
      }
      wrapWriteError(err, 'Gagal menyimpan identifikasi nomor bib');
    }
  },

  async unassignOrMarkNeedsReview(params: {
    finishEventId: string;
    targetStatus: 'UNIDENTIFIED' | 'NEEDS_REVIEW';
    reason?: string;
    notes?: string;
  }): Promise<FinishEventRecord> {
    const { finishEventId, targetStatus, reason, notes } = params;
    try {
      checkWriteAllowed();
      const db = await getDb();
      const tx = db.transaction(
        ['finishEvents', 'batchBibEntries', 'auditLogs'],
        'readwrite'
      );
      const finishEvent = await tx.objectStore('finishEvents').get(finishEventId);
      if (!finishEvent) {
        throw new Error('Catatan finish tidak ditemukan.');
      }

      const now = new Date().toISOString();
      let oldBibLabel: string | null = null;
      if (finishEvent.batchBibEntryId) {
        const oldBib = await tx
          .objectStore('batchBibEntries')
          .get(finishEvent.batchBibEntryId);
        if (oldBib) {
          oldBibLabel = oldBib.bibLabel;
          await tx.objectStore('batchBibEntries').put({
            ...oldBib,
            status: 'WAITING',
            finishEventId: undefined,
            updatedAt: now,
          });
        }
      }

      const updatedHistory = [
        ...finishEvent.correctionHistory,
        {
          id: generateId('cor'),
          changedAt: now,
          field: 'status',
          oldValue: oldBibLabel ? `${finishEvent.status} (${oldBibLabel})` : finishEvent.status,
          newValue: targetStatus,
          reason: reason || notes || `Ubah status ke ${targetStatus}`,
        },
      ];

      const updatedFinish: FinishEventRecord = {
        ...finishEvent,
        batchBibEntryId: undefined,
        status: targetStatus,
        notes: notes?.trim() || finishEvent.notes,
        correctionHistory: updatedHistory,
      };

      await tx.objectStore('finishEvents').put(updatedFinish);
      await tx.objectStore('auditLogs').put({
        id: generateId('aud'),
        eventId: finishEvent.eventId,
        batchId: finishEvent.batchId,
        entityType: 'FINISH_EVENT',
        entityId: finishEvent.id,
        action: targetStatus === 'NEEDS_REVIEW' ? 'MARK_FINISH_NEEDS_REVIEW' : 'UNASSIGN_FINISH',
        changedAt: now,
        oldValue: oldBibLabel ?? finishEvent.status,
        newValue: targetStatus,
        reason: reason || notes,
      });

      await tx.done;
      return updatedFinish;
    } catch (err) {
      wrapWriteError(err, 'Gagal memperbarui status catatan finish');
    }
  },

  async cancelFinishEvent(params: {
    finishEventId: string;
    reason?: string;
  }): Promise<FinishEventRecord> {
    const { finishEventId, reason } = params;
    try {
      checkWriteAllowed();
      const db = await getDb();
      const tx = db.transaction(
        ['finishEvents', 'batchBibEntries', 'auditLogs'],
        'readwrite'
      );
      const finishEvent = await tx.objectStore('finishEvents').get(finishEventId);
      if (!finishEvent) {
        throw new Error('Catatan finish tidak ditemukan.');
      }

      const now = new Date().toISOString();
      let oldBibLabel: string | null = null;
      if (finishEvent.batchBibEntryId) {
        const linkedBib = await tx
          .objectStore('batchBibEntries')
          .get(finishEvent.batchBibEntryId);
        if (linkedBib) {
          oldBibLabel = linkedBib.bibLabel;
          await tx.objectStore('batchBibEntries').put({
            ...linkedBib,
            status: 'WAITING',
            finishEventId: undefined,
            updatedAt: now,
          });
        }
      }

      const updatedFinish: FinishEventRecord = {
        ...finishEvent,
        batchBibEntryId: undefined,
        status: 'CANCELLED',
        correctionHistory: [
          ...finishEvent.correctionHistory,
          {
            id: generateId('cor'),
            changedAt: now,
            field: 'status',
            oldValue: oldBibLabel
              ? `${finishEvent.status} (${oldBibLabel})`
              : finishEvent.status,
            newValue: 'CANCELLED',
            reason: reason || 'Urungkan / batalkan ketukan finish',
          },
        ],
      };

      await tx.objectStore('finishEvents').put(updatedFinish);
      await tx.objectStore('auditLogs').put({
        id: generateId('aud'),
        eventId: finishEvent.eventId,
        batchId: finishEvent.batchId,
        entityType: 'FINISH_EVENT',
        entityId: finishEvent.id,
        action: 'CANCEL_FINISH_EVENT',
        changedAt: now,
        field: 'status',
        oldValue: finishEvent.status,
        newValue: 'CANCELLED',
        reason: reason || 'Urungkan ketukan finish',
      });
      await tx.done;
      return updatedFinish;
    } catch (err) {
      wrapWriteError(err, 'Gagal membatalkan catatan finish');
    }
  },

  async correctFinishElapsedTime(params: {
    finishEventId: string;
    newElapsedMs: number;
    reason: string;
  }): Promise<FinishEventRecord> {
    const { finishEventId, newElapsedMs, reason } = params;
    if (!reason.trim()) {
      throw new Error('Alasan koreksi waktu wajib diisi untuk jejak audit.');
    }
    if (!Number.isFinite(newElapsedMs) || newElapsedMs < 0) {
      throw new Error('Waktu tempuh pengganti tidak valid.');
    }

    try {
      checkWriteAllowed();
      const db = await getDb();
      const tx = db.transaction(['finishEvents', 'auditLogs'], 'readwrite');
      const finishEvent = await tx.objectStore('finishEvents').get(finishEventId);
      if (!finishEvent) {
        throw new Error('Catatan finish tidak ditemukan.');
      }

      const now = new Date().toISOString();
      const roundedNew = Math.round(newElapsedMs);
      const updatedFinish: FinishEventRecord = {
        ...finishEvent,
        elapsedMs: roundedNew,
        correctionHistory: [
          ...finishEvent.correctionHistory,
          {
            id: generateId('cor'),
            changedAt: now,
            field: 'elapsedMs',
            oldValue: finishEvent.elapsedMs,
            newValue: roundedNew,
            reason: reason.trim(),
          },
        ],
      };

      await tx.objectStore('finishEvents').put(updatedFinish);
      await tx.objectStore('auditLogs').put({
        id: generateId('aud'),
        eventId: finishEvent.eventId,
        batchId: finishEvent.batchId,
        entityType: 'FINISH_EVENT',
        entityId: finishEvent.id,
        action: 'CORRECT_FINISH_TIME',
        changedAt: now,
        field: 'elapsedMs',
        oldValue: finishEvent.elapsedMs,
        newValue: roundedNew,
        reason: reason.trim(),
      });
      await tx.done;
      return updatedFinish;
    } catch (err) {
      wrapWriteError(err, 'Gagal menyimpan koreksi waktu finish');
    }
  },

  async markParticipantStatus(params: {
    batchBibEntryId: string;
    status: Exclude<ParticipantStatus, 'FINISHED'>;
    reason?: string;
  }): Promise<BatchBibEntry> {
    const { batchBibEntryId, status, reason } = params;
    try {
      checkWriteAllowed();
      const db = await getDb();
      const tx = db.transaction(
        ['batchBibEntries', 'finishEvents', 'auditLogs'],
        'readwrite'
      );
      const entry = await tx.objectStore('batchBibEntries').get(batchBibEntryId);
      if (!entry) {
        throw new Error('Peserta tidak ditemukan.');
      }

      const now = new Date().toISOString();
      if (entry.finishEventId) {
        const linkedFinish = await tx
          .objectStore('finishEvents')
          .get(entry.finishEventId);
        if (linkedFinish) {
          await tx.objectStore('finishEvents').put({
            ...linkedFinish,
            batchBibEntryId: undefined,
            status: 'UNIDENTIFIED',
            correctionHistory: [
              ...linkedFinish.correctionHistory,
              {
                id: generateId('cor'),
                changedAt: now,
                field: 'batchBibEntryId',
                oldValue: entry.bibLabel,
                newValue: null,
                reason:
                  reason ||
                  `Peserta ${entry.bibLabel} diubah statusnya menjadi ${status}`,
              },
            ],
          });
        }
      }

      const updatedEntry: BatchBibEntry = {
        ...entry,
        status,
        finishEventId: undefined,
        updatedAt: now,
      };

      await tx.objectStore('batchBibEntries').put(updatedEntry);
      await tx.objectStore('auditLogs').put({
        id: generateId('aud'),
        eventId: entry.eventId,
        batchId: entry.batchId,
        entityType: 'BIB_ENTRY',
        entityId: entry.id,
        action: `MARK_PARTICIPANT_${status}`,
        changedAt: now,
        field: 'status',
        oldValue: entry.status,
        newValue: status,
        reason,
      });
      await tx.done;
      return updatedEntry;
    } catch (err) {
      wrapWriteError(err, 'Gagal mengubah status peserta');
    }
  },

  async getBatchResults(batchId: string): Promise<{
    batch: BatchRecord;
    event: EventRecord;
    roster: BatchBibEntry[];
    finishEvents: FinishEventRecord[];
    results: DerivedParticipantResult[];
  }> {
    const db = await getDb();
    const batch = await db.get('batches', batchId);
    if (!batch) {
      throw new Error('Batch tidak ditemukan.');
    }
    const event = await db.get('events', batch.eventId);
    if (!event) {
      throw new Error('Kegiatan tidak ditemukan.');
    }
    const roster = sortBibEntriesStable(
      await db.getAllFromIndex('batchBibEntries', 'by-batchId', batchId)
    );
    const finishEvents = (
      await db.getAllFromIndex('finishEvents', 'by-batchId', batchId)
    ).sort((a, b) => a.sequence - b.sequence);

    const finishMap = new Map<string, FinishEventRecord>();
    for (const f of finishEvents) {
      finishMap.set(f.id, f);
    }

    const results: DerivedParticipantResult[] = roster.map((entry) => ({
      entry,
      batch,
      event,
      finishEvent: entry.finishEventId ? finishMap.get(entry.finishEventId) : undefined,
    }));

    return {
      batch,
      event,
      roster,
      finishEvents,
      results,
    };
  },
};

export const AuditRepository = {
  async listByEvent(eventId: string): Promise<AuditLogRecord[]> {
    const db = await getDb();
    const logs = await db.getAllFromIndex('auditLogs', 'by-eventId', eventId);
    return logs.sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  },

  async listByBatch(batchId: string): Promise<AuditLogRecord[]> {
    const db = await getDb();
    const logs = await db.getAllFromIndex('auditLogs', 'by-batchId', batchId);
    return logs.sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  },
};
