import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { useWriteAccess } from '../services/writeAccess';
import {
  checkWriteAllowed,
  clearAllStores,
  getDb,
  setWriteLease,
} from '../db/indexedDb';
import { EventRepository } from '../db/repositories';

function mockLocks(externalOwner = true) {
  let held = false;
  const request = vi.fn(
    async (
      _name: string,
      _options: { ifAvailable: boolean },
      callback: (lock: Lock | null) => Promise<void>
    ) => {
      if (externalOwner || held) {
        await callback(null);
        return;
      }
      held = true;
      try {
        await callback({ name: 'timex-writer', mode: 'exclusive' } as Lock);
      } finally {
        held = false;
      }
    }
  );
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request },
  });
  return {
    request,
    releaseExternal: () => {
      externalOwner = false;
    },
    isHeld: () => held,
  };
}

describe('Writer access recovery', () => {
  const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  beforeEach(async () => {
    setWriteLease(Infinity);
    await clearAllStores();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
    else Reflect.deleteProperty(navigator, 'locks');
    setWriteLease(Infinity);
  });

  it('automatically acquires a released browser lock and keeps exclusive ownership until unmount', async () => {
    const locks = mockLocks();
    const hook = renderHook(useWriteAccess);
    await act(async () => {});
    expect(hook.result.current.access).toBe('reader');
    expect(() => checkWriteAllowed()).toThrow('mode baca');
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(hook.result.current.access).toBe('reader');
    locks.releaseExternal();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(hook.result.current.access).toBe('writer');
    expect(() => checkWriteAllowed()).not.toThrow();
    const calls = locks.request.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(6000);
      hook.result.current.retryAccess();
    });
    expect(locks.request).toHaveBeenCalledTimes(calls);
    expect(locks.isHeld()).toBe(true);
    await act(async () => {
      hook.unmount();
    });
    expect(locks.isHeld()).toBe(false);
  });

  it('retries on focus and via the manual retry action without reloading', async () => {
    const locks = mockLocks();
    const hook = renderHook(useWriteAccess);
    await act(async () => {});
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(locks.request).toHaveBeenCalledTimes(2);
    expect(hook.result.current.access).toBe('reader');
    locks.releaseExternal();
    await act(async () => {
      hook.result.current.retryAccess();
    });
    expect(hook.result.current.access).toBe('writer');
  });

  it('distinguishes browser failures from another tab owning the lock and can retry after failure', async () => {
    const locks = mockLocks(false);
    locks.request.mockRejectedValueOnce(new Error('Lock API unavailable'));
    const hook = renderHook(useWriteAccess);
    await act(async () => {});
    expect(hook.result.current.access).toBe('reader');
    expect(hook.result.current.error).toBe('Lock API unavailable');
    await act(async () => {
      hook.result.current.retryAccess();
    });
    expect(hook.result.current.access).toBe('writer');
    expect(hook.result.current.error).toBeNull();
  });

  it('recovers from an expired fallback lease while preserving the other owner until expiration', async () => {
    vi.useRealTimers();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    });
    const db = await getDb();
    await db.put('settings', {
      key: '_timex_writer',
      value: JSON.stringify({
        owner: 'other-tab',
        expires: Date.now() + 60000,
      }),
      updatedAt: new Date().toISOString(),
    });
    const hook = renderHook(useWriteAccess);
    await waitFor(() => expect(hook.result.current.access).toBe('reader'));
    await db.put('settings', {
      key: '_timex_writer',
      value: JSON.stringify({ owner: 'other-tab', expires: Date.now() - 1000 }),
      updatedAt: new Date().toISOString(),
    });
    act(() => {
      hook.result.current.retryAccess();
    });
    await waitFor(() => expect(hook.result.current.access).toBe('writer'));
  });

  it('unlocks the primary action in the existing page after retrying access', async () => {
    await EventRepository.ensureDefaultEvent();
    const locks = mockLocks();
    const user = userEvent.setup();
    render(<App />);
    expect(
      await screen.findByRole('button', { name: 'Siapkan gelombang' })
    ).toBeDisabled();
    locks.releaseExternal();
    await user.click(
      screen.getByRole('button', { name: 'Coba akses pencatatan' })
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Siapkan gelombang' })
      ).toBeEnabled()
    );
    expect(
      screen.queryByRole('button', { name: 'Coba akses pencatatan' })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Siapkan gelombang' }));
    expect(
      await screen.findByRole('heading', { name: 'Gelombang #1', level: 1 })
    ).toBeInTheDocument();
  });
});
