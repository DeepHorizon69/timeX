import { getDb } from '../db/indexedDb';
import { sortBibEntriesStable } from '../db/repositories';
import {
  AuditLogRecord,
  BatchBibEntry,
  BatchRecord,
  EventRecord,
  FinishEventRecord,
  SavedCapture,
} from '../domain/types';

interface BatchRows {
  roster: BatchBibEntry[];
  finishes: FinishEventRecord[];
}

export const emptyBatchRows: BatchRows = { roster: [], finishes: [] };

export interface EventData {
  event: EventRecord;
  batches: BatchRecord[];
  rowsByBatch: Map<string, BatchRows>;
  auditLogs: AuditLogRecord[];
}

const eventStores = [
  'batches',
  'batchBibEntries',
  'finishEvents',
  'auditLogs',
] as const;
const newestFinishFirst = (a: FinishEventRecord, b: FinishEventRecord) =>
  b.sequence - a.sequence;
const newestLogFirst = (a: AuditLogRecord, b: AuditLogRecord) =>
  b.changedAt.localeCompare(a.changedAt);

export async function readEventData(event: EventRecord): Promise<EventData> {
  const db = await getDb();
  const tx = db.transaction(eventStores);
  // A single snapshot cannot mix roster or finishes from different saves.
  const [batches, roster, finishes, auditLogs] = await Promise.all([
    tx.objectStore('batches').index('by-eventId').getAll(event.id),
    tx.objectStore('batchBibEntries').index('by-eventId').getAll(event.id),
    tx.objectStore('finishEvents').index('by-eventId').getAll(event.id),
    tx.objectStore('auditLogs').index('by-eventId').getAll(event.id),
    tx.done,
  ]);
  batches.sort((a, b) => b.batchNumber - a.batchNumber);
  const rowsByBatch = new Map<string, BatchRows>();
  for (const batch of batches) {
    rowsByBatch.set(batch.id, { roster: [], finishes: [] });
  }
  for (const entry of roster) {
    rowsByBatch.get(entry.batchId)?.roster.push(entry);
  }
  for (const finish of finishes) {
    rowsByBatch.get(finish.batchId)?.finishes.push(finish);
  }
  for (const rows of rowsByBatch.values()) {
    rows.roster = sortBibEntriesStable(rows.roster);
    rows.finishes.sort(newestFinishFirst);
  }
  return {
    event,
    batches,
    rowsByBatch,
    auditLogs: auditLogs.sort(newestLogFirst),
  };
}

export async function readBatchData(batchId: string) {
  const db = await getDb();
  const tx = db.transaction(eventStores);
  const [batch, roster, finishes, auditLogs] = await Promise.all([
    tx.objectStore('batches').get(batchId),
    tx.objectStore('batchBibEntries').index('by-batchId').getAll(batchId),
    tx.objectStore('finishEvents').index('by-batchId').getAll(batchId),
    tx.objectStore('auditLogs').index('by-batchId').getAll(batchId),
    tx.done,
  ]);
  return {
    batch,
    rows: {
      roster: sortBibEntriesStable(roster),
      finishes: finishes.sort(newestFinishFirst),
    },
    auditLogs,
  };
}

export function applySavedCapture(
  data: EventData | null,
  { finishEvent, bibEntry, batch }: SavedCapture
): EventData | null {
  const rows = data?.rowsByBatch.get(finishEvent.batchId);
  if (!data || !rows || data.event.id !== finishEvent.eventId) return data;

  // A retried capture may already be in the snapshot. Keep just one row and
  // preserve order for both newly saved and replayed captures.
  const finishes = [...rows.finishes];
  const position = finishes.findIndex(
    (item) => item.id === finishEvent.id || item.sequence < finishEvent.sequence
  );
  const replace = finishes[position]?.id === finishEvent.id;
  finishes.splice(
    position < 0 ? finishes.length : position,
    replace ? 1 : 0,
    finishEvent
  );

  const rowsByBatch = new Map(data.rowsByBatch);
  rowsByBatch.set(finishEvent.batchId, {
    finishes,
    roster: bibEntry
      ? rows.roster.map((item) => (item.id === bibEntry.id ? bibEntry : item))
      : rows.roster,
  });
  return {
    ...data,
    batches: batch
      ? data.batches.map((item) => (item.id === batch.id ? batch : item))
      : data.batches,
    rowsByBatch,
  };
}

export function applyBatchData(
  data: EventData | null,
  { batch, rows, auditLogs }: Awaited<ReturnType<typeof readBatchData>>
): EventData | null {
  if (
    !data ||
    !batch ||
    !data.rowsByBatch.has(batch.id) ||
    data.event.id !== batch.eventId
  ) {
    return data;
  }
  const rowsByBatch = new Map(data.rowsByBatch);
  rowsByBatch.set(batch.id, rows);
  return {
    ...data,
    batches: data.batches.map((item) => (item.id === batch.id ? batch : item)),
    rowsByBatch,
    auditLogs: [
      ...data.auditLogs.filter((log) => log.batchId !== batch.id),
      ...auditLogs,
    ].sort(newestLogFirst),
  };
}
