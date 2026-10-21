import { openDB, DBSchema, IDBPDatabase } from 'idb';
import {
  EventRecord,
  BatchRecord,
  BatchBibEntry,
  FinishEventRecord,
  AuditLogRecord,
  AppSettingsRecord,
} from '../domain/types';

export const DB_NAME = 'run-timing-db';
export const DB_VERSION = 1;
export const BACKUP_SCHEMA_VERSION = 1;

export interface RunTimingDBSchema extends DBSchema {
  events: {
    key: string;
    value: EventRecord;
    indexes: {
      'by-status': string;
      'by-createdAt': string;
    };
  };
  batches: {
    key: string;
    value: BatchRecord;
    indexes: {
      'by-eventId': string;
      'by-status': string;
    };
  };
  batchBibEntries: {
    key: string;
    value: BatchBibEntry;
    indexes: {
      'by-batchId': string;
      'by-eventId': string;
    };
  };
  finishEvents: {
    key: string;
    value: FinishEventRecord;
    indexes: {
      'by-batchId': string;
      'by-eventId': string;
    };
  };
  auditLogs: {
    key: string;
    value: AuditLogRecord;
    indexes: {
      'by-eventId': string;
      'by-batchId': string;
    };
  };
  settings: {
    key: string;
    value: AppSettingsRecord;
  };
}

let dbPromise: Promise<IDBPDatabase<RunTimingDBSchema>> | null = null;
let simulatedWriteFailure: string | null = null;

export class StoragePersistenceError extends Error {
  constructor(message: string, public readonly causeError?: unknown) {
    super(message);
    this.name = 'StoragePersistenceError';
  }
}

export function setSimulatedWriteFailure(message: string | null): void {
  simulatedWriteFailure = message;
}

export function checkWriteAllowed(): void {
  if (simulatedWriteFailure) {
    throw new StoragePersistenceError(simulatedWriteFailure);
  }
}

export function getDb(): Promise<IDBPDatabase<RunTimingDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<RunTimingDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('events')) {
          const eventStore = db.createObjectStore('events', { keyPath: 'id' });
          eventStore.createIndex('by-status', 'status');
          eventStore.createIndex('by-createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('batches')) {
          const batchStore = db.createObjectStore('batches', { keyPath: 'id' });
          batchStore.createIndex('by-eventId', 'eventId');
          batchStore.createIndex('by-status', 'status');
        }
        if (!db.objectStoreNames.contains('batchBibEntries')) {
          const bibStore = db.createObjectStore('batchBibEntries', { keyPath: 'id' });
          bibStore.createIndex('by-batchId', 'batchId');
          bibStore.createIndex('by-eventId', 'eventId');
        }
        if (!db.objectStoreNames.contains('finishEvents')) {
          const finishStore = db.createObjectStore('finishEvents', { keyPath: 'id' });
          finishStore.createIndex('by-batchId', 'batchId');
          finishStore.createIndex('by-eventId', 'eventId');
        }
        if (!db.objectStoreNames.contains('auditLogs')) {
          const auditStore = db.createObjectStore('auditLogs', { keyPath: 'id' });
          auditStore.createIndex('by-eventId', 'eventId');
          auditStore.createIndex('by-batchId', 'batchId');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

export async function resetDbConnectionForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
}

export async function clearAllStores(): Promise<void> {
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
    tx.done,
  ]);
}
