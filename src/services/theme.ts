import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
const storageKey = 'timex-theme';
const listeners = new Set<() => void>();
let theme: Theme = 'light';

function applyTheme() {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#0b1220' : '#f8fafc');
}

export function initializeTheme() {
  try {
    theme =
      window.localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light';
  } catch {
    theme = 'light';
  }
  applyTheme();
  listeners.forEach((listener) => listener());
}

export function setTheme(next: Theme): boolean {
  theme = next;
  applyTheme();
  let saved = true;
  try {
    window.localStorage.setItem(storageKey, theme);
  } catch {
    saved = false;
  }
  listeners.forEach((listener) => listener());
  return saved;
}

export function useTheme() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => theme
  );
}
