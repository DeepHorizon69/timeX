import { useEffect, useRef, useState } from 'react';

export function useOfflineSupport(active: boolean) {
  const [ready, setReady] = useState(false);
  const busy = useRef(active);
  busy.current = active;
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    let registration: ServiceWorkerRegistration | undefined;
    const hadController = Boolean(navigator.serviceWorker.controller);
    const onControllerChange = () => {
      if (hadController && !busy.current) location.reload();
    };
    const checkUpdate = () => {
      if (!busy.current) registration?.waiting?.postMessage('ACTIVATE_UPDATE');
    };
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      onControllerChange
    );
    void navigator.serviceWorker
      .register('/sw.js')
      .then(async (result) => {
        registration = result;
        await navigator.serviceWorker.ready;
        if (!cancelled) setReady(true);
        checkUpdate();
      })
      .catch(() => {
        if (!cancelled) setReady(false);
      });
    const interval = setInterval(checkUpdate, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        onControllerChange
      );
    };
  }, []);
  return ready;
}
