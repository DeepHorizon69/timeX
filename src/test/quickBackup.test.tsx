import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickBackupButton } from '../components/QuickBackupButton';
import { clearAllStores, setWriteLease } from '../db/indexedDb';
import {
  BatchRepository,
  EventRepository,
  FinishEventRepository,
} from '../db/repositories';
import { ExportService } from '../services/exportService';

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('Quick backup from completion', () => {
  const originalCreate = Object.getOwnPropertyDescriptor(
    URL,
    'createObjectURL'
  );
  const originalRevoke = Object.getOwnPropertyDescriptor(
    URL,
    'revokeObjectURL'
  );
  const createUrl = vi.fn<(blob: Blob) => string>();
  let downloads: { filename: string; href: string }[];

  beforeEach(async () => {
    setWriteLease(Infinity);
    await clearAllStores();
    downloads = [];
    createUrl.mockReset().mockReturnValue('blob:timex-backup');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createUrl,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      downloads.push({ filename: this.download, href: this.href });
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalCreate)
      Object.defineProperty(URL, 'createObjectURL', originalCreate);
    else Reflect.deleteProperty(URL, 'createObjectURL');
    if (originalRevoke)
      Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
    else Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  it('downloads a restorable full JSON backup with the completed gelombang and all activities', async () => {
    const event = await EventRepository.createEvent('Lomba pagi');
    const batch = await BatchRepository.createBatch(event.id);
    const bib = await BatchRepository.addBibToBatch({
      batchId: batch.id,
      bibColor: 'BLUE',
      bibNumber: 12,
    });
    await BatchRepository.startBatch({
      batchId: batch.id,
      startedAtWallClock: new Date().toISOString(),
      startedAtMonotonicMs: performance.now(),
    });
    await FinishEventRepository.recordDirectCardFinish({
      batchId: batch.id,
      batchBibEntryId: bib.id,
      elapsedMs: 12345,
      timingSource: 'MONOTONIC',
      recordedAtWallClock: new Date().toISOString(),
    });
    await BatchRepository.transitionBatchStatus({
      batchId: batch.id,
      targetStatus: 'REVIEW',
    });
    await BatchRepository.completeBatch(batch.id);
    const second = await EventRepository.createEvent('Lomba sore');
    const user = userEvent.setup();
    render(<QuickBackupButton />);
    await user.click(screen.getByRole('button', { name: 'Unduh backup' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Unduhan backup dimulai.'
    );
    expect(downloads).toHaveLength(1);
    expect(downloads[0].filename).toMatch(/^run-timing-backup-.*\.json$/);
    const blob = createUrl.mock.calls[0][0];
    expect(blob.type).toBe('application/json;charset=utf-8');
    const preview = await ExportService.validateAndPreviewBackupJson(
      await readBlob(blob)
    );
    expect(preview.payload.events.map((item) => item.id)).toEqual(
      expect.arrayContaining([event.id, second.id])
    );
    expect(preview.payload.batches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: batch.id, status: 'COMPLETED' }),
      ])
    );
    expect(preview.payload.finishEvents[0]).toMatchObject({
      elapsedMs: 12345,
      batchBibEntryId: bib.id,
    });
    expect(preview.payload.auditLogs.length).toBeGreaterThan(0);
  });

  it('shows progress and prevents duplicate download requests while generating a backup', async () => {
    const content = await ExportService.buildJsonBackupString();
    let complete!: (value: string) => void;
    const build = vi
      .spyOn(ExportService, 'buildJsonBackupString')
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          })
      );
    const user = userEvent.setup();
    render(<QuickBackupButton />);
    await user.click(screen.getByRole('button', { name: 'Unduh backup' }));
    expect(
      screen.getByRole('button', { name: 'Menyiapkan backup…' })
    ).toBeDisabled();
    await user.click(
      screen.getByRole('button', { name: 'Menyiapkan backup…' })
    );
    expect(build).toHaveBeenCalledTimes(1);
    await act(async () => {
      complete(content);
    });
    expect(downloads).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Unduh backup' })).toBeEnabled();
  });

  it.each(['build', 'download'])(
    'shows %s failures and allows retry without navigating away',
    async (failure) => {
      if (failure === 'build')
        vi.spyOn(ExportService, 'buildJsonBackupString').mockRejectedValueOnce(
          new Error('Pembuatan backup gagal')
        );
      else
        createUrl.mockImplementationOnce(() => {
          throw new Error('Unduhan diblokir');
        });
      const user = userEvent.setup();
      render(<QuickBackupButton />);
      await user.click(screen.getByRole('button', { name: 'Unduh backup' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        failure === 'build' ? 'Pembuatan backup gagal' : 'Unduhan diblokir'
      );
      expect(downloads).toHaveLength(0);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Unduh backup' }));
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Unduhan backup dimulai.'
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(downloads).toHaveLength(1);
    }
  );
});
