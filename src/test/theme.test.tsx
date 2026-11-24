import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { ThemePicker } from '../components/ThemePicker';
import { initializeTheme, setTheme } from '../services/theme';
import { clearAllStores, setWriteLease } from '../db/indexedDb';
import { EventRepository } from '../db/repositories';
import { BIB_COLOR_MAP } from '../domain/utils';
import html from '../../index.html?raw';
import stylesheet from '../styles.css?raw';

function luminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((channel) => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('Light and dark themes', () => {
  beforeEach(async () => {
    const environment = globalThis as unknown as {
      jsdom: { window: { localStorage: Storage } };
    };
    vi.stubGlobal('localStorage', environment.jsdom.window.localStorage);
    setWriteLease(Infinity);
    await clearAllStores();
    await EventRepository.createEvent('Lomba pagi');
    window.localStorage.clear();
    document.head.innerHTML = '<meta name="theme-color" content="#f8fafc">';
    initializeTheme();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
    initializeTheme();
    vi.unstubAllGlobals();
  });

  it('switches from device settings, retains the theme across navigation and includes dialogs', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Perangkat' }));
    expect(screen.getByRole('radio', { name: 'Terang' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Gelap' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(window.localStorage.getItem('timex-theme')).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute(
      'content',
      '#0b1220'
    );
    await user.click(
      screen.getByRole('button', { name: 'Hapus seluruh riwayat' })
    );
    expect(
      within(await screen.findByRole('dialog')).getByRole('heading')
    ).toHaveTextContent('Hapus seluruh riwayat');
    expect(screen.getByRole('dialog').closest('html')).toHaveAttribute(
      'data-theme',
      'dark'
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Batal' })
    );
    await user.click(screen.getByRole('button', { name: 'Kegiatan' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await user.click(screen.getByRole('button', { name: 'Siapkan gelombang' }));
    await screen.findByRole('heading', { name: 'Gelombang #1', level: 1 });
    expect(
      screen.getByRole('radio', { name: /Putih/ }).closest('label')
    ).toHaveStyle({ background: '#ffffff', color: '#0f172a' });
    await user.click(screen.getByRole('button', { name: 'Kembali' }));
    await user.click(screen.getByRole('button', { name: 'Perangkat' }));
    await user.click(screen.getByRole('radio', { name: 'Terang' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('timex-theme')).toBe('light');
  });

  it('applies the saved preference in the head bootstrap before rendering the app', () => {
    window.localStorage.setItem('timex-theme', 'dark');
    const page = new DOMParser().parseFromString(html, 'text/html');
    const script = page.querySelector('script:not([src])')!.textContent!;
    new Function(script)();
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    initializeTheme();
    render(<ThemePicker />);
    expect(screen.getByRole('radio', { name: 'Gelap' })).toBeChecked();
    window.localStorage.setItem('timex-theme', 'unsupported');
    new Function(script)();
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });

  it('still applies the theme if preference storage is blocked and explains persistence failure', async () => {
    const user = userEvent.setup();
    render(<ThemePicker />);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    await user.click(screen.getByRole('radio', { name: 'Gelap' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Browser gagal menyimpan pilihan tema'
    );
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    act(() => {
      expect(() => setTheme('light')).not.toThrow();
    });
  });

  it('keeps text contrast at AA in both themes, including warnings, selected controls and physical bib colors', () => {
    const parseTokens = (content: string) =>
      Object.fromEntries(
        [...content.matchAll(/(--[\w-]+):\s*(#[\da-f]{6});/gi)].map((match) => [
          match[1],
          match[2],
        ])
      );
    const light = parseTokens(stylesheet.match(/:root \{([\s\S]*?)\n\}/)![1]);
    const dark = {
      ...light,
      ...parseTokens(
        stylesheet.match(/:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/)![1]
      ),
    };
    expect(light['--bg-panel']).toBe(light['--bg-card']);
    expect(dark['--bg-panel']).toBe(dark['--bg-card']);
    expect(light['--bg-panel']).not.toBe(dark['--bg-panel']);
    for (const theme of [light, dark]) {
      for (const background of [
        '--bg-page',
        '--bg-card',
        '--bg-subtle',
        '--bg-selected',
      ]) {
        for (const foreground of [
          '--text-main',
          '--text-muted',
          '--text-secondary',
        ]) {
          expect(
            contrast(theme[foreground], theme[background]),
            `${foreground} / ${background}`
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const [foreground, background] of [
        ['--text-success', '--bg-success'],
        ['--text-success', '--bg-success-subtle'],
        ['--text-warning', '--bg-warning'],
        ['--text-danger', '--bg-danger'],
        ['--text-link', '--bg-card'],
        ['--text-panel-muted', '--bg-panel'],
        ['--text-panel', '--bg-panel'],
        ['--text-panel-accent', '--bg-panel'],
      ]) {
        expect(
          contrast(theme[foreground], theme[background]),
          `${foreground} / ${background}`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast('#ffffff', light['--primary'])).toBeGreaterThanOrEqual(4.5);
    for (const bib of Object.values(BIB_COLOR_MAP)) {
      expect(contrast(bib.textHex, bib.bgHex)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
