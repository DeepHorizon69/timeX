export type EventStatus = 'ACTIVE' | 'COMPLETED';

export interface EventRecord {
  id: string;
  name: string;
  eventDate: string; // YYYY-MM-DD
  createdAt: string; // ISO timestamp
  updatedAt: string;
  status: EventStatus;
}

export type BatchStatus =
  | 'DRAFT'
  | 'READY'
  | 'RUNNING'
  | 'REVIEW'
  | 'COMPLETED'
  | 'NEEDS_REVIEW';

export type RecordingMode = 'DIRECT_CARD' | 'TIMESTAMP_FIRST';

export type TimingSource = 'MONOTONIC' | 'WALL_CLOCK_FALLBACK';

export interface BatchRecord {
  id: string;
  eventId: string;
  batchNumber: number;
  status: BatchStatus;
  recordingMode: RecordingMode;
  createdAt: string;
  updatedAt: string;
  startedAtWallClock?: string;
  startedAtMonotonicMs?: number; // valid only within same page lifetime
  completedAt?: string;
  recoveryRequired?: boolean;
  timingSource?: TimingSource;
  notes?: string;
}

export type BibColor = 'WHITE' | 'GREEN' | 'RED' | 'BLUE' | 'YELLOW';

export type ParticipantStatus =
  | 'WAITING'
  | 'FINISHED'
  | 'DNS'
  | 'DNF'
  | 'NEEDS_REVIEW';

export interface BatchBibEntry {
  id: string;
  eventId: string;
  batchId: string;
  bibColor: BibColor;
  bibNumber: number; // validate range 1..50
  bibLabel: string; // derived for display, e.g. B12, M07
  participantName?: string; // optional
  status: ParticipantStatus;
  finishEventId?: string;
  createdAt: string;
  updatedAt: string;
}

export type FinishEventStatus =
  | 'UNIDENTIFIED'
  | 'IDENTIFIED'
  | 'CANCELLED'
  | 'NEEDS_REVIEW';

export interface CorrectionEntry {
  id: string;
  changedAt: string;
  field: string;
  oldValue: string | number | null;
  newValue: string | number | null;
  reason?: string;
}

export interface FinishEventRecord {
  id: string;
  eventId: string;
  batchId: string;
  sequence: number;
  recordedAtWallClock: string;
  recordedAtMonotonicMs?: number;
  elapsedMs: number; // integer milliseconds
  timingSource: TimingSource;
  batchBibEntryId?: string;
  status: FinishEventStatus;
  notes?: string;
  correctionHistory: CorrectionEntry[];
}

export type AuditEntityType =
  | 'EVENT'
  | 'BATCH'
  | 'BIB_ENTRY'
  | 'FINISH_EVENT'
  | 'BACKUP';

export interface AuditLogRecord {
  id: string;
  eventId: string;
  batchId?: string;
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  changedAt: string;
  field?: string;
  oldValue?: string | number | null;
  newValue?: string | number | null;
  reason?: string;
}

export interface AppSettingsRecord {
  key: string;
  value: string;
  updatedAt: string;
}

export interface BackupPayload {
  schemaVersion: number;
  appName: 'Run Timing';
  exportedAt: string;
  events: EventRecord[];
  batches: BatchRecord[];
  batchBibEntries: BatchBibEntry[];
  finishEvents: FinishEventRecord[];
  auditLogs: AuditLogRecord[];
  settings: AppSettingsRecord[];
}

export interface DerivedParticipantResult {
  entry: BatchBibEntry;
  batch: BatchRecord;
  event: EventRecord;
  finishEvent?: FinishEventRecord;
}
