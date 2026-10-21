import { useEffect, useState } from 'react';
import { BatchRecord, TimingSource } from '../domain/types';

/**
 * Tracks batches started during the current browser page session.
 * A browser reload clears this Set, allowing startup logic to detect
 * any RUNNING batch in IndexedDB whose monotonic origin is no longer valid.
 */
const activeSessionBatchIds = new Set<string>();

export function registerSessionStartedBatch(batchId: string): void {
  activeSessionBatchIds.add(batchId);
}

export function getActiveSessionBatchIds(): Set<string> {
  return new Set(activeSessionBatchIds);
}

export function clearActiveSessionBatchesForTests(): void {
  activeSessionBatchIds.clear();
}

export interface CapturedFinishTiming {
  recordedAtMonotonicMs?: number;
  recordedAtWallClock: string;
  elapsedMs: number;
  timingSource: TimingSource;
}

/**
 * Captures finish timing immediately on operator tap before any async work.
 */
export function captureFinishTimingNow(batch: BatchRecord): CapturedFinishTiming {
  const monoNow = performance.now();
  const wallNow = new Date().toISOString();

  if (
    batch.timingSource !== 'WALL_CLOCK_FALLBACK' &&
    typeof batch.startedAtMonotonicMs === 'number' &&
    !batch.recoveryRequired
  ) {
    const elapsedMs = Math.max(0, Math.round(monoNow - batch.startedAtMonotonicMs));
    return {
      recordedAtMonotonicMs: monoNow,
      recordedAtWallClock: wallNow,
      elapsedMs,
      timingSource: 'MONOTONIC',
    };
  }

  if (batch.startedAtWallClock) {
    const startWallMs = Date.parse(batch.startedAtWallClock);
    const currentWallMs = Date.parse(wallNow);
    const elapsedMs = Number.isFinite(startWallMs)
      ? Math.max(0, Math.round(currentWallMs - startWallMs))
      : 0;
    return {
      recordedAtMonotonicMs: undefined,
      recordedAtWallClock: wallNow,
      elapsedMs,
      timingSource: 'WALL_CLOCK_FALLBACK',
    };
  }

  return {
    recordedAtMonotonicMs: monoNow,
    recordedAtWallClock: wallNow,
    elapsedMs: 0,
    timingSource: 'MONOTONIC',
  };
}

export function computeCurrentBatchElapsedMs(batch: BatchRecord | null | undefined): number {
  if (!batch || batch.status !== 'RUNNING' || batch.recoveryRequired) {
    return 0;
  }
  if (
    batch.timingSource !== 'WALL_CLOCK_FALLBACK' &&
    typeof batch.startedAtMonotonicMs === 'number'
  ) {
    return Math.max(0, Math.round(performance.now() - batch.startedAtMonotonicMs));
  }
  if (batch.startedAtWallClock) {
    const startMs = Date.parse(batch.startedAtWallClock);
    if (Number.isFinite(startMs)) {
      return Math.max(0, Date.now() - startMs);
    }
  }
  return 0;
}

export function useBatchLiveTimer(batch: BatchRecord | null | undefined): number {
  const [elapsedMs, setElapsedMs] = useState<number>(() =>
    computeCurrentBatchElapsedMs(batch)
  );

  useEffect(() => {
    if (!batch || batch.status !== 'RUNNING' || batch.recoveryRequired) {
      setElapsedMs(0);
      return;
    }

    setElapsedMs(computeCurrentBatchElapsedMs(batch));
    const intervalId = window.setInterval(() => {
      setElapsedMs(computeCurrentBatchElapsedMs(batch));
    }, 45);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    batch?.id,
    batch?.status,
    batch?.recoveryRequired,
    batch?.startedAtMonotonicMs,
    batch?.startedAtWallClock,
    batch?.timingSource,
  ]);

  return elapsedMs;
}

export function useScreenWakeLock(active: boolean): {
  supported: boolean;
  isLocked: boolean;
} {
  const supported =
    typeof navigator !== 'undefined' &&
    'wakeLock' in navigator &&
    Boolean((navigator as Navigator & { wakeLock?: unknown }).wakeLock);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    if (!active || !supported) {
      setIsLocked(false);
      return;
    }

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function requestLock() {
      try {
        if ('wakeLock' in navigator && navigator.wakeLock) {
          sentinel = await navigator.wakeLock.request('screen');
          if (!cancelled) {
            setIsLocked(true);
          }
          sentinel.addEventListener('release', () => {
            if (!cancelled) setIsLocked(false);
          });
        }
      } catch {
        if (!cancelled) setIsLocked(false);
      }
    }

    void requestLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && active) {
        void requestLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (sentinel) {
        void sentinel.release().catch(() => undefined);
      }
    };
  }, [active, supported]);

  return { supported, isLocked };
}
