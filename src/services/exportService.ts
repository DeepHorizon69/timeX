import {
  AuditLogRecord,
  BackupPayload,
  BatchBibEntry,
  BatchRecord,
  EventRecord,
  FinishEventRecord,
} from '../domain/types';
import {
  BIB_COLOR_MAP,
  formatElapsedMs,
  formatSequenceLabel,
  generateId,
  isValidBibColor,
  isValidBibNumber,
} from '../domain/utils';
import {
  BACKUP_SCHEMA_VERSION,
  checkWriteAllowed,
  getDb,
  StoragePersistenceError,
} from '../db/indexedDb';
import { sortBibEntriesByBibCode } from '../db/repositories';
import {
  buildReportFilename,
  buildValidatedReportDataset,
  generateExcelReportBuffer,
  generatePdfReportBytes,
  ReportFilterOptions,
  ValidatedReportDataset,
} from './reportExportService';

export {
  buildReportFilename,
  buildValidatedReportDataset,
  generateExcelReportBuffer,
  generatePdfReportBytes,
};
export type { ReportFilterOptions, ValidatedReportDataset };

export function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export const CSV_HEADERS = [
  'event_id',
  'event_name',
  'event_date',
  'batch_id',
  'batch_number',
  'batch_status',
  'recording_mode',
  'timing_source',
  'bib_entry_id',
  'bib_label',
  'bib_color',
  'bib_color_id',
  'bib_number',
  'participant_name',
  'participant_status',
  'finish_event_id',
  'finish_sequence',
  'finish_status',
  'elapsed_ms',
  'elapsed_formatted',
  'batch_started_at',
  'finish_recorded_at',
  'correction_count',
] as const;

export interface BackupPreviewSummary {
  schemaVersion: number;
  exportedAt: string;
  eventCount: number;
  batchCount: number;
  bibEntryCount: number;
  finishEventCount: number;
  auditLogCount: number;
  existingEventCount: number;
  existingBatchCount: number;
  existingFinishCount: number;
  payload: BackupPayload;
}

export const ExportService = {
  async buildCsvString(options?: { eventId?: string; batchId?: string }): Promise<string> {
    const db = await getDb();
    const allEvents = await db.getAll('events');
    const allBatches = await db.getAll('batches');
    const allEntries = await db.getAll('batchBibEntries');
    const allFinishes = await db.getAll('finishEvents');

    const eventMap = new Map<string, EventRecord>(allEvents.map((e) => [e.id, e]));
    const filteredBatches = allBatches
      .filter((b) => {
        if (options?.batchId) return b.id === options.batchId;
        if (options?.eventId) return b.eventId === options.eventId;
        return true;
      })
      .sort((a, b) => a.batchNumber - b.batchNumber);

    const rows: string[] = [CSV_HEADERS.join(',')];

    for (const batch of filteredBatches) {
      const event = eventMap.get(batch.eventId);
      const batchEntries = sortBibEntriesByBibCode(
        allEntries.filter((e) => e.batchId === batch.id)
      );
      const batchFinishes = allFinishes
        .filter((f) => f.batchId === batch.id)
        .sort((a, b) => a.sequence - b.sequence);
      const finishMap = new Map<string, FinishEventRecord>(
        batchFinishes.map((f) => [f.id, f])
      );
      const linkedFinishIds = new Set<string>();

      for (const entry of batchEntries) {
        const fin = entry.finishEventId ? finishMap.get(entry.finishEventId) : undefined;
        if (fin) {
          linkedFinishIds.add(fin.id);
        }
        const colorMeta = BIB_COLOR_MAP[entry.bibColor];
        const fields = [
          event?.id ?? batch.eventId,
          event?.name ?? '',
          event?.eventDate ?? '',
          batch.id,
          batch.batchNumber,
          batch.status,
          batch.recordingMode,
          fin?.timingSource ?? batch.timingSource ?? '',
          entry.id,
          entry.bibLabel,
          colorMeta.nameId,
          entry.bibColor,
          entry.bibNumber,
          entry.participantName ?? '',
          entry.status,
          fin?.id ?? '',
          fin ? formatSequenceLabel(fin.sequence) : '',
          fin?.status ?? '',
          fin !== undefined ? fin.elapsedMs : '',
          fin !== undefined ? formatElapsedMs(fin.elapsedMs) : '',
          batch.startedAtWallClock ?? '',
          fin?.recordedAtWallClock ?? '',
          fin ? fin.correctionHistory.length : 0,
        ];
        rows.push(fields.map(escapeCsvField).join(','));
      }

      // Include any unlinked non-cancelled finish events so no recorded finish is ever lost in CSV
      for (const fin of batchFinishes) {
        if (!linkedFinishIds.has(fin.id) && fin.status !== 'CANCELLED') {
          const fields = [
            event?.id ?? batch.eventId,
            event?.name ?? '',
            event?.eventDate ?? '',
            batch.id,
            batch.batchNumber,
            batch.status,
            batch.recordingMode,
            fin.timingSource,
            '',
            'BELUM_DIIDENTIFIKASI',
            '',
            '',
            '',
            '',
            fin.status,
            fin.id,
            formatSequenceLabel(fin.sequence),
            fin.status,
            fin.elapsedMs,
            formatElapsedMs(fin.elapsedMs),
            batch.startedAtWallClock ?? '',
            fin.recordedAtWallClock,
            fin.correctionHistory.length,
          ];
          rows.push(fields.map(escapeCsvField).join(','));
        }
      }
    }

    return rows.join('\r\n');
  },

  async buildValidatedReportDataset(
    options?: ReportFilterOptions
  ): Promise<ValidatedReportDataset> {
    return buildValidatedReportDataset(options);
  },

  async buildExcelReport(options?: ReportFilterOptions): Promise<{
    buffer: ArrayBuffer;
    dataset: ValidatedReportDataset;
    filename: string;
  }> {
    return generateExcelReportBuffer(options);
  },

  async buildPdfReport(options?: ReportFilterOptions): Promise<{
    bytes: Uint8Array;
    dataset: ValidatedReportDataset;
    filename: string;
  }> {
    return generatePdfReportBytes(options);
  },

  async buildJsonBackup(): Promise<BackupPayload> {
    const db = await getDb();
    const [events, batches, batchBibEntries, finishEvents, auditLogs, settings] =
      await Promise.all([
        db.getAll('events'),
        db.getAll('batches'),
        db.getAll('batchBibEntries'),
        db.getAll('finishEvents'),
        db.getAll('auditLogs'),
        db.getAll('settings'),
      ]);

    return {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appName: 'Run Timing',
      exportedAt: new Date().toISOString(),
      events,
      batches,
      batchBibEntries,
      finishEvents,
      auditLogs,
      settings,
    };
  },

  async buildJsonBackupString(): Promise<string> {
    const payload = await this.buildJsonBackup();
    return JSON.stringify(payload, null, 2);
  },

  async validateAndPreviewBackupJson(rawJson: string): Promise<BackupPreviewSummary> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new Error('File JSON rusak atau bukan format JSON yang valid.');
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Struktur file backup tidak valid.');
    }

    const obj = parsed as Record<string, unknown>;
    if (obj.appName !== 'Run Timing') {
      throw new Error('File ini bukan file backup aplikasi Run Timing.');
    }
    if (
      typeof obj.schemaVersion !== 'number' ||
      obj.schemaVersion < 1 ||
      obj.schemaVersion > BACKUP_SCHEMA_VERSION
    ) {
      throw new Error(
        `Versi skema backup (${String(obj.schemaVersion)}) tidak didukung oleh aplikasi ini.`
      );
    }

    if (
      !Array.isArray(obj.events) ||
      !Array.isArray(obj.batches) ||
      !Array.isArray(obj.batchBibEntries) ||
      !Array.isArray(obj.finishEvents) ||
      !Array.isArray(obj.auditLogs)
    ) {
      throw new Error('Data di dalam file backup tidak lengkap (tabel utama hilang).');
    }

    // Validate each record has essential fields
    for (const ev of obj.events as EventRecord[]) {
      if (!ev || typeof ev.id !== 'string' || typeof ev.name !== 'string') {
        throw new Error('Data kegiatan (events) di dalam backup tidak valid.');
      }
    }
    for (const b of obj.batches as BatchRecord[]) {
      if (
        !b ||
        typeof b.id !== 'string' ||
        typeof b.eventId !== 'string' ||
        typeof b.batchNumber !== 'number'
      ) {
        throw new Error('Data batch di dalam backup tidak valid.');
      }
    }
    for (const entry of obj.batchBibEntries as BatchBibEntry[]) {
      if (
        !entry ||
        typeof entry.id !== 'string' ||
        typeof entry.batchId !== 'string' ||
        !isValidBibColor(entry.bibColor) ||
        !isValidBibNumber(entry.bibNumber)
      ) {
        throw new Error('Data nomor bib peserta di dalam backup tidak valid.');
      }
    }
    for (const fin of obj.finishEvents as FinishEventRecord[]) {
      if (
        !fin ||
        typeof fin.id !== 'string' ||
        typeof fin.batchId !== 'string' ||
        typeof fin.sequence !== 'number' ||
        typeof fin.elapsedMs !== 'number'
      ) {
        throw new Error('Data catatan finish di dalam backup tidak valid.');
      }
    }

    const db = await getDb();
    const [existingEvents, existingBatches, existingFinishes] = await Promise.all([
      db.count('events'),
      db.count('batches'),
      db.count('finishEvents'),
    ]);

    const payload: BackupPayload = {
      schemaVersion: obj.schemaVersion,
      appName: 'Run Timing',
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
      events: obj.events as EventRecord[],
      batches: obj.batches as BatchRecord[],
      batchBibEntries: obj.batchBibEntries as BatchBibEntry[],
      finishEvents: obj.finishEvents as FinishEventRecord[],
      auditLogs: obj.auditLogs as AuditLogRecord[],
      settings: Array.isArray(obj.settings) ? (obj.settings as BackupPayload['settings']) : [],
    };

    return {
      schemaVersion: payload.schemaVersion,
      exportedAt: payload.exportedAt,
      eventCount: payload.events.length,
      batchCount: payload.batches.length,
      bibEntryCount: payload.batchBibEntries.length,
      finishEventCount: payload.finishEvents.length,
      auditLogCount: payload.auditLogs.length,
      existingEventCount: existingEvents,
      existingBatchCount: existingBatches,
      existingFinishCount: existingFinishes,
      payload,
    };
  },

  async importValidatedBackup(payload: BackupPayload): Promise<void> {
    try {
      checkWriteAllowed();
      const db = await getDb();
      const tx = db.transaction(
        ['events', 'batches', 'batchBibEntries', 'finishEvents', 'auditLogs', 'settings'],
        'readwrite'
      );

      await Promise.all([
        tx.objectStore('events').clear(),
        tx.objectStore('batches').clear(),
        tx.objectStore('batchBibEntries').clear(),
        tx.objectStore('finishEvents').clear(),
        tx.objectStore('auditLogs').clear(),
        tx.objectStore('settings').clear(),
      ]);

      const now = new Date().toISOString();

      for (const ev of payload.events) {
        await tx.objectStore('events').put(ev);
      }
      for (const b of payload.batches) {
        // Any RUNNING batch imported from JSON backup has no valid monotonic origin in this page
        const normalizedBatch: BatchRecord =
          b.status === 'RUNNING'
            ? {
                ...b,
                recoveryRequired: true,
                startedAtMonotonicMs: undefined,
              }
            : b;
        await tx.objectStore('batches').put(normalizedBatch);
      }
      for (const entry of payload.batchBibEntries) {
        await tx.objectStore('batchBibEntries').put(entry);
      }
      for (const fin of payload.finishEvents) {
        await tx.objectStore('finishEvents').put({
          ...fin,
          recordedAtMonotonicMs: undefined,
        });
      }
      for (const log of payload.auditLogs) {
        await tx.objectStore('auditLogs').put(log);
      }
      for (const setting of payload.settings) {
        await tx.objectStore('settings').put(setting);
      }

      const activeEventId = payload.events[0]?.id ?? 'system';
      await tx.objectStore('auditLogs').put({
        id: generateId('aud'),
        eventId: activeEventId,
        entityType: 'BACKUP',
        entityId: 'json_import',
        action: 'IMPORT_JSON_BACKUP',
        changedAt: now,
        newValue: `${payload.events.length} kegiatan, ${payload.batches.length} batch, ${payload.finishEvents.length} finish`,
      });

      await tx.done;
    } catch (err) {
      if (err instanceof StoragePersistenceError) throw err;
      throw new StoragePersistenceError(
        `Gagal memulihkan data dari backup: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }
  },
};
