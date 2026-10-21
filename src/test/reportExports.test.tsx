import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExcelJS from 'exceljs';
import {
  clearAllStores,
  getDb,
  resetDbConnectionForTests,
  setSimulatedWriteFailure,
} from '../db/indexedDb';
import {
  BatchRepository,
  EventRepository,
  FinishEventRepository,
} from '../db/repositories';
import { CSV_HEADERS, ExportService } from '../services/exportService';
import { App } from '../App';
import { clearActiveSessionBatchesForTests } from '../services/timekeeper';

describe('Additional Export Methods: Excel (.xlsx), PDF (.pdf), Data Integrity & UI', () => {
  beforeEach(async () => {
    setSimulatedWriteFailure(null);
    clearActiveSessionBatchesForTests();
    await resetDbConnectionForTests();
    await clearAllStores();
  });

  it('preserves existing CSV schema & JSON backup/restore while generating valid Excel (.xlsx) and PDF (.pdf) reports across multiple batches and reused bibs', async () => {
    const event = await EventRepository.createEvent(
      'Lomba Lari Kemerdekaan',
      '2026-08-17'
    );

    // Batch 1: 3 participants (B12 with name, M07 without name, P01 DNS), 1 cancelled finish, 1 unidentified finish
    const batch1 = await BatchRepository.createBatch(
      event.id,
      'TIMESTAMP_FIRST'
    );
    const b12Batch1 = await BatchRepository.addBibToBatch({
      batchId: batch1.id,
      bibColor: 'BLUE',
      bibNumber: 12,
      participantName: 'Siti Aminah',
    });
    const m07Batch1 = await BatchRepository.addBibToBatch({
      batchId: batch1.id,
      bibColor: 'RED',
      bibNumber: 7,
      // No participantName provided -> must remain blank, never invented
    });
    const p01Batch1 = await BatchRepository.addBibToBatch({
      batchId: batch1.id,
      bibColor: 'WHITE',
      bibNumber: 1,
    });

    await BatchRepository.startBatch({
      batchId: batch1.id,
      startedAtWallClock: '2026-08-17T06:00:00.000Z',
      startedAtMonotonicMs: 1000,
    });

    // F-001: M07 finishes first (faster time: 02:05.40 = 125400 ms)
    const f1 = await FinishEventRepository.recordTimestampFirstFinish({
      batchId: batch1.id,
      recordedAtWallClock: '2026-08-17T06:02:05.400Z',
      recordedAtMonotonicMs: 126400,
      elapsedMs: 125400,
      timingSource: 'MONOTONIC',
    });
    await FinishEventRepository.identifyFinishEvent({
      finishEventId: f1.id,
      batchBibEntryId: m07Batch1.id,
    });

    // F-002: Accidental tap -> CANCELLED (must be excluded from valid results!)
    const f2Cancelled = await FinishEventRepository.recordTimestampFirstFinish({
      batchId: batch1.id,
      recordedAtWallClock: '2026-08-17T06:02:10.000Z',
      recordedAtMonotonicMs: 131000,
      elapsedMs: 130000,
      timingSource: 'MONOTONIC',
    });
    await FinishEventRepository.cancelFinishEvent({
      finishEventId: f2Cancelled.id,
      reason: 'Salah tekan tombol',
    });

    // F-003: B12 finishes second (02:30.15 = 150150 ms)
    const f3 = await FinishEventRepository.recordTimestampFirstFinish({
      batchId: batch1.id,
      recordedAtWallClock: '2026-08-17T06:02:30.150Z',
      recordedAtMonotonicMs: 151150,
      elapsedMs: 150150,
      timingSource: 'MONOTONIC',
    });
    await FinishEventRepository.identifyFinishEvent({
      finishEventId: f3.id,
      batchBibEntryId: b12Batch1.id,
    });

    // F-004: Unidentified finish marked NEEDS_REVIEW
    const f4Review = await FinishEventRepository.recordTimestampFirstFinish({
      batchId: batch1.id,
      recordedAtWallClock: '2026-08-17T06:02:45.000Z',
      recordedAtMonotonicMs: 166000,
      elapsedMs: 165000,
      timingSource: 'MONOTONIC',
    });
    await FinishEventRepository.unassignOrMarkNeedsReview({
      finishEventId: f4Review.id,
      targetStatus: 'NEEDS_REVIEW',
      notes: 'Peserta tanpa bib terlihat',
    });

    // Mark P01 as DNS
    await FinishEventRepository.markParticipantStatus({
      batchBibEntryId: p01Batch1.id,
      status: 'DNS',
    });

    await BatchRepository.completeBatch(batch1.id);

    // Batch 2: Reuses B12 for a different participant (with no name) and H10 as DNF
    const batch2 = await BatchRepository.createBatch(event.id, 'DIRECT_CARD');
    const b12Batch2 = await BatchRepository.addBibToBatch({
      batchId: batch2.id,
      bibColor: 'BLUE',
      bibNumber: 12,
    });
    const h10Batch2 = await BatchRepository.addBibToBatch({
      batchId: batch2.id,
      bibColor: 'GREEN',
      bibNumber: 10,
      participantName: 'Budi Santoso',
    });

    await BatchRepository.startBatch({
      batchId: batch2.id,
      startedAtWallClock: '2026-08-17T06:30:00.000Z',
      startedAtMonotonicMs: 2000,
    });

    await FinishEventRepository.recordDirectCardFinish({
      batchId: batch2.id,
      batchBibEntryId: b12Batch2.id,
      recordedAtWallClock: '2026-08-17T06:33:00.000Z',
      recordedAtMonotonicMs: 182000,
      elapsedMs: 180000,
      timingSource: 'MONOTONIC',
    });

    await FinishEventRepository.markParticipantStatus({
      batchBibEntryId: h10Batch2.id,
      status: 'DNF',
    });

    await BatchRepository.completeBatch(batch2.id);

    // 1. Verify existing CSV export still works and retains exact schema
    const csv = await ExportService.buildCsvString({ eventId: event.id });
    const csvLines = csv.split('\r\n');
    expect(csvLines[0]).toBe(CSV_HEADERS.join(','));
    expect(csv).toContain('Siti Aminah');
    expect(csv).toContain('02:05.40');
    expect(csv).toContain('02:30.15');
    expect(csv).toContain('03:00.00');

    // 2. Verify existing JSON backup still works
    const backup = await ExportService.buildJsonBackup();
    expect(backup.appName).toBe('Run Timing');
    expect(backup.batches).toHaveLength(2);
    expect(backup.finishEvents).toHaveLength(5); // includes cancelled F-002 in raw backup

    // 3. Verify Excel (.xlsx) report generation and inspect parsed workbook
    const excelResult = await ExportService.buildExcelReport({
      eventId: event.id,
    });
    expect(excelResult.filename).toBe(
      'laporan-lari-lomba-lari-kemerdekaan-2026-08-17.xlsx'
    );
    expect(excelResult.dataset.summary.totalRegisteredParticipants).toBe(5);
    expect(excelResult.dataset.summary.totalValidFinishers).toBe(3);
    expect(excelResult.dataset.summary.totalDns).toBe(1);
    expect(excelResult.dataset.summary.totalDnf).toBe(1);
    expect(excelResult.dataset.summary.totalValidResults).toBe(5);
    expect(excelResult.dataset.summary.totalNeedsReview).toBe(1); // F-004 NEEDS_REVIEW
    expect(excelResult.dataset.summary.totalCancelledFinishesExcluded).toBe(1); // F-002 CANCELLED

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(excelResult.buffer);

    const wsValid = wb.getWorksheet('Hasil Lari Valid');
    const wsReview = wb.getWorksheet('Perlu Diperiksa');
    expect(wsValid).toBeDefined();
    expect(wsReview).toBeDefined();

    // Verify frozen header row & autoFilter on Hasil Lari Valid
    expect(wsValid!.views[0]?.state).toBe('frozen');
    expect((wsValid!.views[0] as { ySplit?: number })?.ySplit).toBe(6);
    expect(wsValid!.autoFilter).toBeDefined();

    // Verify Indonesian column headers on Row 6
    const headerValues = wsValid!.getRow(6).values as string[];
    expect(headerValues).toContain('Nama Acara');
    expect(headerValues).toContain('No. Batch');
    expect(headerValues).toContain('Posisi Finish');
    expect(headerValues).toContain('Warna Bib');
    expect(headerValues).toContain('Nomor Bib');
    expect(headerValues).toContain('Nama Peserta');
    expect(headerValues).toContain('Waktu Tempuh');
    expect(headerValues).toContain('Status Peserta');

    // Row 7 should be Batch 1 Position 1: M07 (Merah 7), missing name is empty string "", time 02:05.40 (125400 ms)
    const row7 = wsValid!.getRow(7);
    expect(row7.getCell(3).value).toBe(1); // Batch 1
    expect(row7.getCell(4).value).toBe(1); // Posisi 1
    expect(row7.getCell(5).value).toBe('Merah');
    expect(row7.getCell(6).value).toBe(7);
    expect(row7.getCell(7).value).toBe('M07');
    expect(row7.getCell(8).value ?? '').toBe(''); // Missing participantName is never invented
    expect(row7.getCell(9).value).toBe('02:05.40');
    expect(row7.getCell(10).value).toBe(125400);

    // Row 8 should be Batch 1 Position 2: B12 (Biru 12, Siti Aminah, 02:30.15)
    const row8 = wsValid!.getRow(8);
    expect(row8.getCell(3).value).toBe(1);
    expect(row8.getCell(4).value).toBe(2);
    expect(row8.getCell(7).value).toBe('B12');
    expect(row8.getCell(8).value).toBe('Siti Aminah');
    expect(row8.getCell(9).value).toBe('02:30.15');

    // Row 10 should be Batch 2 Position 1: reused B12 (Biru 12, blank name, 03:00.00)
    const row10 = wsValid!.getRow(10);
    expect(row10.getCell(3).value).toBe(2); // Batch 2
    expect(row10.getCell(4).value).toBe(1); // Posisi 1 in Batch 2
    expect(row10.getCell(7).value).toBe('B12');
    expect(row10.getCell(8).value ?? '').toBe('');
    expect(row10.getCell(9).value).toBe('03:00.00');

    // Verify Worksheet 2 ("Perlu Diperiksa") contains F-004 and does NOT contain cancelled F-002
    const reviewRow6 = wsReview!.getRow(6);
    expect(reviewRow6.getCell(5).value).toBe('F-004');
    expect(reviewRow6.getCell(10).value).toBe('02:45.00');
    expect(String(reviewRow6.getCell(12).value)).toContain('Perlu Diperiksa');

    // 4. Verify PDF (.pdf) report generation
    const pdfResult = await ExportService.buildPdfReport({
      eventId: event.id,
    });
    expect(pdfResult.filename).toBe(
      'laporan-lari-lomba-lari-kemerdekaan-2026-08-17.pdf'
    );
    expect(pdfResult.bytes.byteLength).toBeGreaterThan(1000);
    const pdfHeader = new TextDecoder().decode(pdfResult.bytes.slice(0, 8));
    expect(pdfHeader).toContain('%PDF-1.');
  });

  it('detects inconsistent participant/finish references and flags them for review without modifying stored IndexedDB records', async () => {
    const event = await EventRepository.createEvent('Uji Integritas Data', '2026-10-22');
    const batch = await BatchRepository.createBatch(event.id, 'TIMESTAMP_FIRST');
    const entryBrokenRef = await BatchRepository.addBibToBatch({
      batchId: batch.id,
      bibColor: 'YELLOW',
      bibNumber: 5,
    });
    const entryDnsWithFinish = await BatchRepository.addBibToBatch({
      batchId: batch.id,
      bibColor: 'GREEN',
      bibNumber: 8,
    });

    // Manually inject inconsistent states into IndexedDB to test defensive validation
    const db = await getDb();
    await db.put('batchBibEntries', {
      ...entryBrokenRef,
      status: 'FINISHED',
      finishEventId: 'fin_non_existent_999',
    });

    const strayFinishId = 'fin_stray_1';
    await db.put('finishEvents', {
      id: strayFinishId,
      eventId: event.id,
      batchId: batch.id,
      sequence: 1,
      recordedAtWallClock: '2026-10-22T07:05:00.000Z',
      elapsedMs: 95000,
      timingSource: 'MONOTONIC',
      batchBibEntryId: entryDnsWithFinish.id,
      status: 'IDENTIFIED',
      correctionHistory: [],
    });
    await db.put('batchBibEntries', {
      ...entryDnsWithFinish,
      status: 'DNS',
      finishEventId: strayFinishId,
    });

    const dataset = await ExportService.buildValidatedReportDataset({
      eventId: event.id,
    });

    // Neither inconsistent record should be treated as a valid result!
    expect(dataset.validRows).toHaveLength(0);
    expect(dataset.reviewRows).toHaveLength(2);
    const k05Review = dataset.reviewRows.find((r) => r.bibLabel === 'K05');
    const h08Review = dataset.reviewRows.find((r) => r.bibLabel === 'H08');
    expect(k05Review?.reviewReason).toMatch(/tidak ditemukan/i);
    expect(h08Review?.reviewReason).toMatch(/DNS.*catatan waktu finish/i);

    // Verify stored records in IndexedDB were NOT modified during export
    const storedAfter1 = await db.get('batchBibEntries', entryBrokenRef.id);
    expect(storedAfter1?.finishEventId).toBe('fin_non_existent_999');
    const storedAfter2 = await db.get('batchBibEntries', entryDnsWithFinish.id);
    expect(storedAfter2?.status).toBe('DNS');
  });

  it('handles large result sets (60 participants) across multiple PDF pages and renders all 4 export options in the UI', async () => {
    const event = await EventRepository.createEvent('Maraton Besar', '2026-11-01');
    const batch1 = await BatchRepository.createBatch(event.id, 'DIRECT_CARD');

    // Add 35 bibs in Batch 1
    for (let i = 1; i <= 35; i++) {
      await BatchRepository.addBibToBatch({
        batchId: batch1.id,
        bibColor: 'WHITE',
        bibNumber: i,
        participantName: i % 2 === 0 ? `Peserta ${i}` : undefined,
      });
    }
    await BatchRepository.startBatch({
      batchId: batch1.id,
      startedAtWallClock: '2026-11-01T05:00:00.000Z',
      startedAtMonotonicMs: 100,
    });
    const entries1 = await BatchRepository.listBibEntriesByBatch(batch1.id);
    for (let i = 0; i < entries1.length; i++) {
      await FinishEventRepository.recordDirectCardFinish({
        batchId: batch1.id,
        batchBibEntryId: entries1[i].id,
        recordedAtWallClock: '2026-11-01T05:10:00.000Z',
        recordedAtMonotonicMs: 600100 + i * 1000,
        elapsedMs: 600000 + i * 1000,
        timingSource: 'MONOTONIC',
      });
    }
    await BatchRepository.completeBatch(batch1.id);

    // Add 25 bibs in Batch 2
    const batch2 = await BatchRepository.createBatch(event.id, 'DIRECT_CARD');
    for (let i = 1; i <= 25; i++) {
      await BatchRepository.addBibToBatch({
        batchId: batch2.id,
        bibColor: 'BLUE',
        bibNumber: i,
      });
    }
    await BatchRepository.startBatch({
      batchId: batch2.id,
      startedAtWallClock: '2026-11-01T06:00:00.000Z',
      startedAtMonotonicMs: 200,
    });
    const entries2 = await BatchRepository.listBibEntriesByBatch(batch2.id);
    for (let i = 0; i < entries2.length; i++) {
      await FinishEventRepository.recordDirectCardFinish({
        batchId: batch2.id,
        batchBibEntryId: entries2[i].id,
        recordedAtWallClock: '2026-11-01T06:12:00.000Z',
        recordedAtMonotonicMs: 720200 + i * 1000,
        elapsedMs: 720000 + i * 1000,
        timingSource: 'MONOTONIC',
      });
    }
    await BatchRepository.completeBatch(batch2.id);

    const { bytes, dataset } = await ExportService.buildPdfReport({
      eventId: event.id,
    });
    expect(dataset.validRows).toHaveLength(60);
    const pdfText = new TextDecoder('latin1').decode(bytes);
    expect(pdfText).toContain('Halaman 2 dari');

    // Render UI and test all 4 export options
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Ekspor\/Backup/i }));

    // Verify all 4 options and their descriptions are visible
    expect(
      screen.getByText(/data tabel untuk spreadsheet atau pemrosesan lanjutan/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/backup lengkap untuk memulihkan data aplikasi/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/laporan hasil yang mudah dibaca dan dianalisis/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/laporan siap dibagikan atau dicetak/i)
    ).toBeInTheDocument();

    const excelBtn = screen.getByRole('button', {
      name: /Unduh Laporan Excel \(\.xlsx\)/i,
    });
    const pdfBtn = screen.getByRole('button', {
      name: /Unduh Laporan PDF \(\.pdf\)/i,
    });
    const csvBtn = screen.getByRole('button', { name: /^Ekspor CSV$/i });
    const jsonBtn = screen.getByRole('button', {
      name: /Backup Lengkap \(JSON\)/i,
    });

    await user.click(excelBtn);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        /Laporan Excel .*\.xlsx.* berhasil diunduh/i
      );
    });

    await user.click(pdfBtn);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        /Laporan PDF .*\.pdf.* berhasil diunduh/i
      );
    });

    await user.click(csvBtn);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        /File CSV .*\.csv.* berhasil diunduh/i
      );
    });

    await user.click(jsonBtn);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        /File Backup JSON .*\.json.* berhasil diunduh/i
      );
    });
  });
});
