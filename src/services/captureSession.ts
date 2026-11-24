import { useSyncExternalStore } from 'react';
import { PendingCapture, SavedCapture } from '../domain/types';
import { FinishEventRepository } from '../db/repositories';

const journalKey = 'timex-pending-captures-v2';
const captureSavedEvent = 'timex-capture-saved';
const listeners = new Set<() => void>();
let snapshot: {
  pending: PendingCapture[];
  journalError: boolean;
  saving: boolean;
} = {
  pending: [],
  journalError: false,
  saving: false,
};
let initialized = false;
let unreadableJournal = false;
let draining: Promise<void> | null = null;

export function isPendingCapture(value: unknown): value is PendingCapture {
  if (!value || typeof value !== 'object') return false;
  const item = value as PendingCapture;
  return (
    typeof item.id === 'string' &&
    typeof item.batchId === 'string' &&
    typeof item.recordedAtWallClock === 'string' &&
    Number.isFinite(Date.parse(item.recordedAtWallClock)) &&
    Number.isFinite(item.elapsedMs) &&
    item.elapsedMs >= 0 &&
    (item.timingSource === 'MONOTONIC' ||
      item.timingSource === 'WALL_CLOCK_FALLBACK') &&
    (item.batchBibEntryId === undefined ||
      typeof item.batchBibEntryId === 'string')
  );
}

function publish(pending: PendingCapture[], saving = snapshot.saving) {
  let journalError = false;
  try {
    if (unreadableJournal) throw new Error('Journal requires recovery');
    sessionStorage.setItem(journalKey, JSON.stringify(pending));
  } catch {
    journalError = true;
  }
  snapshot = { pending, saving, journalError };
  listeners.forEach((listener) => listener());
}

export function restoreCaptureJournal() {
  if (initialized) return;
  initialized = true;
  try {
    const journal: unknown = JSON.parse(
      sessionStorage.getItem(journalKey) ?? '[]'
    );
    if (!Array.isArray(journal) || !journal.every(isPendingCapture))
      throw new Error('Invalid capture journal');
    publish(journal);
  } catch {
    unreadableJournal = true;
    snapshot = { ...snapshot, journalError: true };
  }
}

export function getPendingCaptures() {
  return snapshot.pending;
}

export function restorePendingCaptures(items: PendingCapture[]) {
  const merged = new Map(snapshot.pending.map((item) => [item.id, item]));
  items.forEach((item) => {
    if (!merged.has(item.id)) merged.set(item.id, item);
  });
  publish([...merged.values()]);
}

export function useCaptureSession() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot
  );
}

export function subscribeToSavedCaptures(
  listener: (capture: SavedCapture) => void
) {
  const handleSaved = (event: Event) =>
    listener((event as CustomEvent<SavedCapture>).detail);
  window.addEventListener(captureSavedEvent, handleSaved);
  return () => window.removeEventListener(captureSavedEvent, handleSaved);
}

export function enqueueCapture(item: PendingCapture) {
  restoreCaptureJournal();
  if (
    item.batchBibEntryId &&
    snapshot.pending.some(
      (pending) =>
        pending.batchId === item.batchId &&
        pending.batchBibEntryId === item.batchBibEntryId
    )
  )
    return;
  publish([...snapshot.pending, item]);
  void retryCaptures();
}

export function retryCaptures(): Promise<void> {
  if (draining) return draining;
  if (snapshot.pending.length === 0) return Promise.resolve();
  draining = (async () => {
    publish(snapshot.pending, true);
    while (snapshot.pending.length > 0) {
      const item = snapshot.pending[0];
      try {
        const saved = item.batchBibEntryId
          ? await FinishEventRepository.recordDirectCardFinish({
              ...item,
              batchBibEntryId: item.batchBibEntryId,
            })
          : await FinishEventRepository.saveTimestampFirstCapture(item);
        window.dispatchEvent(
          new CustomEvent<SavedCapture>(captureSavedEvent, { detail: saved })
        );
        publish(
          snapshot.pending.filter((pending) => pending.id !== item.id),
          true
        );
      } catch (error) {
        publish(
          snapshot.pending.map((pending) =>
            pending.id === item.id
              ? {
                  ...pending,
                  error:
                    error instanceof Error
                      ? error.message
                      : 'Gagal menyimpan finish.',
                }
              : pending
          ),
          false
        );
        return;
      }
    }
  })().finally(() => {
    draining = null;
    publish(snapshot.pending, false);
  });
  return draining;
}

export function downloadRescueFile() {
  let rawJournal: string | null = null;
  if (unreadableJournal) {
    try {
      rawJournal = sessionStorage.getItem(journalKey);
    } catch {
      /* Storage access is unavailable. */
    }
  }
  const blob = new Blob(
    [
      JSON.stringify(
        {
          appName: 'TimeX Rescue',
          pendingCaptures: snapshot.pending,
          rawJournal,
        },
        null,
        2
      ),
    ],
    { type: 'application/json' }
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `timex-penyelamatan-${Date.now()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function assertCapturesSaved() {
  if (snapshot.pending.length > 0)
    throw new Error(
      'Simpan ulang catatan finish yang tertunda sebelum melanjutkan.'
    );
}

export function clearCaptureJournal(): boolean {
  assertCapturesSaved();
  let cleared = true;
  try {
    sessionStorage.removeItem(journalKey);
  } catch {
    cleared = false;
  }
  initialized = true;
  unreadableJournal = !cleared;
  snapshot = { pending: [], saving: false, journalError: !cleared };
  listeners.forEach((listener) => listener());
  return cleared;
}
