import { useCallback, useEffect, useRef, useState } from 'react';
import { getDb, setWriteLease } from '../db/indexedDb';
import { generateId } from '../domain/utils';

const leaseKey = '_timex_writer';

export function useWriteAccess() {
  const [access, setAccess] = useState<'loading' | 'writer' | 'reader'>(
    'loading'
  );
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = useRef<() => void>(() => undefined);
  const retryAccess = useCallback(() => retry.current(), []);
  useEffect(() => {
    setWriteLease(0);
    const owner = generateId('writer');
    let cancelled = false;
    let releaseLock: (() => void) | undefined;
    let attempting = false;
    let holdingLock = false;
    const useNativeLocks = Boolean(navigator.locks?.request);

    async function renewLease() {
      const db = await getDb();
      const tx = db.transaction('settings', 'readwrite');
      const existing = await tx.store.get(leaseKey);
      const lease = existing
        ? (JSON.parse(existing.value) as { owner: string; expires: number })
        : null;
      const available =
        !lease || lease.owner === owner || lease.expires < Date.now();
      if (available && !cancelled) {
        await tx.store.put({
          key: leaseKey,
          value: JSON.stringify({ owner, expires: Date.now() + 15000 }),
          updatedAt: new Date().toISOString(),
        });
      }
      await tx.done;
      if (!cancelled) {
        setWriteLease(available ? Date.now() + 12000 : 0);
        setAccess(available ? 'writer' : 'reader');
      }
    }

    async function attemptAccess() {
      if (cancelled || attempting || holdingLock) return;
      attempting = true;
      setChecking(true);
      setError(null);
      try {
        if (useNativeLocks) {
          await navigator.locks.request(
            'timex-writer',
            { ifAvailable: true },
            async (lock) => {
              if (cancelled) return;
              setWriteLease(lock ? Infinity : 0);
              setAccess(lock ? 'writer' : 'reader');
              setChecking(false);
              if (lock) {
                holdingLock = true;
                await new Promise<void>((resolve) => {
                  releaseLock = resolve;
                });
                holdingLock = false;
              }
            }
          );
        } else {
          await renewLease();
        }
      } catch (failure) {
        if (!cancelled) {
          setWriteLease(0);
          setAccess('reader');
          setError(
            failure instanceof Error
              ? failure.message
              : 'Pemeriksaan akses pencatatan gagal.'
          );
        }
      } finally {
        attempting = false;
        if (!cancelled) setChecking(false);
      }
    }

    retry.current = () => {
      void attemptAccess();
    };
    void attemptAccess();
    const timer = setInterval(() => {
      void attemptAccess();
    }, 2000);
    const onFocus = () => {
      void attemptAccess();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void attemptAccess();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      retry.current = () => undefined;
      setWriteLease(Infinity);
      clearInterval(timer);
      releaseLock?.();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      if (!useNativeLocks)
        void getDb()
          .then(async (db) => {
            const tx = db.transaction('settings', 'readwrite');
            const existing = await tx.store.get(leaseKey);
            if (
              existing &&
              (JSON.parse(existing.value) as { owner: string }).owner === owner
            )
              await tx.store.delete(leaseKey);
            await tx.done;
          })
          .catch(() => undefined);
    };
  }, []);
  return { access, checking, retryAccess, error };
}
