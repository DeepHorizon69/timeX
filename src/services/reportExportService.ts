import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  BatchBibEntry,
  EventRecord,
  FinishEventRecord,
} from '../domain/types';
import {
  BIB_COLOR_MAP,
  formatElapsedMs,
  formatSequenceLabel,
  formatWallClockDateTime,
  getParticipantStatusLabel,
  isValidBibColor,
  isValidBibNumber,
} from '../domain/utils';
import { getDb } from '../db/indexedDb';
import { sortBibEntriesByBibCode } from '../db/repositories';

export interface ReportFilterOptions {
  eventId?: string;
  batchId?: string;
}

export interface ValidResultRow {
  eventId: string;
  eventName: string;
  eventDate: string;
  batchId: string;
  batchNumber: number;
  finishPosition: number | null; // 1, 2, 3... for finishers; null for DNS/DNF
  bibLabel: string;
  bibColorName: string;
  bibNumber: number;
  participantName: string; // "" if not provided; never invented
  elapsedMs: number | null;
  elapsedFormatted: string;
  statusCode: 'FINISHED' | 'DNS' | 'DNF';
  statusLabel: string;
  finishSequenceLabel: string;
  notes: string;
}

export interface ReviewResultRow {
  eventId: string;
  eventName: string;
  eventDate: string;
  batchId: string;
  batchNumber: number;
  recordType: 'PESERTA' | 'FINISH_EVENT' | 'INKONSISTENSI';
  bibLabel: string;
  bibColorName: string;
  bibNumber: number | null;
  participantName: string;
  elapsedMs: number | null;
  elapsedFormatted: string;
  statusLabel: string;
  finishSequenceLabel: string;
  reviewReason: string;
}

export interface ValidatedReportDataset {
  eventTitle: string;
  eventDate: string;
  batchScopeLabel: string;
  generatedAtIso: string;
  generatedAtFormatted: string;
  summary: {
    totalBatches: number;
    totalRegisteredParticipants: number;
    totalValidResults: number;
    totalValidFinishers: number;
    totalDns: number;
    totalDnf: number;
    totalNeedsReview: number;
    totalCancelledFinishesExcluded: number;
  };
  validRows: ValidResultRow[];
  reviewRows: ReviewResultRow[];
}

export function buildReportFilename(
  eventName: string,
  eventDate: string,
  extension: 'xlsx' | 'pdf'
): string {
  const safeEventName =
    eventName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'acara';
  const safeDate =
    eventDate
      .trim()
      .replace(/[^0-9-]+/g, '')
      .slice(0, 10) || new Date().toISOString().slice(0, 10);
  return `laporan-lari-${safeEventName}-${safeDate}.${extension}`;
}

/**
 * Inspects stored records without modifying them, excludes CANCELLED finish events
 * from valid results, and separates valid results from uncertain/inconsistent records.
 */
export async function buildValidatedReportDataset(
  options?: ReportFilterOptions
): Promise<ValidatedReportDataset> {
  const db = await getDb();
  const [allEvents, allBatches, allEntries, allFinishes] = await Promise.all([
    db.getAll('events'),
    db.getAll('batches'),
    db.getAll('batchBibEntries'),
    db.getAll('finishEvents'),
  ]);

  const eventMap = new Map<string, EventRecord>(allEvents.map((e) => [e.id, e]));

  const filteredBatches = [...allBatches]
    .filter((b) => {
      if (options?.batchId) return b.id === options.batchId;
      if (options?.eventId) return b.eventId === options.eventId;
      return true;
    })
    .sort((a, b) => {
      if (a.eventId !== b.eventId) return a.eventId.localeCompare(b.eventId);
      return a.batchNumber - b.batchNumber;
    });

  // Determine report header metadata
  let primaryEvent: EventRecord | undefined;
  if (options?.eventId) {
    primaryEvent = eventMap.get(options.eventId);
  } else if (options?.batchId && filteredBatches[0]) {
    primaryEvent = eventMap.get(filteredBatches[0].eventId);
  } else {
    primaryEvent =
      allEvents.find((e) => e.status === 'ACTIVE') ?? allEvents[0];
  }

  const eventTitle =
    options && !options.eventId && !options.batchId && allEvents.length > 1
      ? `Semua Acara (${allEvents.length} Kegiatan)`
      : primaryEvent?.name ?? 'Laporan Lari';
  const eventDate =
    primaryEvent?.eventDate ?? new Date().toISOString().slice(0, 10);

  let batchScopeLabel = 'Semua Batch';
  if (options?.batchId && filteredBatches[0]) {
    batchScopeLabel = `Batch #${filteredBatches[0].batchNumber}`;
  } else if (filteredBatches.length > 0) {
    batchScopeLabel = `Batch ${filteredBatches
      .map((b) => `#${b.batchNumber}`)
      .join(', ')}`;
  } else {
    batchScopeLabel = 'Belum Ada Batch';
  }

  const validRows: ValidResultRow[] = [];
  const reviewRows: ReviewResultRow[] = [];

  let totalRegisteredParticipants = 0;
  let totalValidFinishers = 0;
  let totalDns = 0;
  let totalDnf = 0;
  let totalCancelledFinishesExcluded = 0;

  for (const batch of filteredBatches) {
    const ev = eventMap.get(batch.eventId);
    const evName = ev?.name ?? 'Kegiatan Tidak Diketahui';
    const evDate = ev?.eventDate ?? '-';

    const batchEntries = sortBibEntriesByBibCode(
      allEntries.filter((e) => e.batchId === batch.id)
    );
    const batchFinishes = [...allFinishes]
      .filter((f) => f.batchId === batch.id)
      .sort((a, b) => a.sequence - b.sequence);

    totalRegisteredParticipants += batchEntries.length;

    const entryMap = new Map<string, BatchBibEntry>(
      batchEntries.map((e) => [e.id, e])
    );
    const finishMap = new Map<string, FinishEventRecord>(
      batchFinishes.map((f) => [f.id, f])
    );

    // Count how many bib entries reference each finishEventId to detect duplicate links
    const finishRefCount = new Map<string, number>();
    for (const entry of batchEntries) {
      if (entry.finishEventId) {
        finishRefCount.set(
          entry.finishEventId,
          (finishRefCount.get(entry.finishEventId) ?? 0) + 1
        );
      }
    }

    // Count how many non-cancelled finish events reference each batchBibEntryId
    const entryRefByActiveFinishCount = new Map<string, FinishEventRecord[]>();
    for (const fin of batchFinishes) {
      if (fin.status === 'CANCELLED') {
        totalCancelledFinishesExcluded += 1;
        continue;
      }
      if (fin.batchBibEntryId) {
        const list = entryRefByActiveFinishCount.get(fin.batchBibEntryId) ?? [];
        list.push(fin);
        entryRefByActiveFinishCount.set(fin.batchBibEntryId, list);
      }
    }

    const handledFinishIds = new Set<string>();
    const batchValidFinisherCandidates: Array<{
      entry: BatchBibEntry;
      finish: FinishEventRecord;
      notes: string;
    }> = [];
    const batchValidNonFinishers: Array<{
      entry: BatchBibEntry;
      statusCode: 'DNS' | 'DNF';
      notes: string;
    }> = [];

    for (const entry of batchEntries) {
      const colorValid = isValidBibColor(entry.bibColor);
      const numberValid = isValidBibNumber(entry.bibNumber);
      const colorName = colorValid
        ? BIB_COLOR_MAP[entry.bibColor].nameId
        : String(entry.bibColor);
      const safeName = entry.participantName?.trim() ?? '';

      const linkedFinish = entry.finishEventId
        ? finishMap.get(entry.finishEventId)
        : undefined;
      const referencingFinishes =
        entryRefByActiveFinishCount.get(entry.id) ?? [];

      const inconsistencyReasons: string[] = [];

      if (!colorValid || !numberValid) {
        inconsistencyReasons.push(
          `Data nomor/warna bib tidak standar (${String(entry.bibColor)} ${String(
            entry.bibNumber
          )})`
        );
      }

      if (batch.recoveryRequired) {
        inconsistencyReasons.push(
          'Batch memerlukan pemulihan setelah muat ulang halaman (Recovery Required)'
        );
      }

      if (entry.status === 'NEEDS_REVIEW') {
        inconsistencyReasons.push('Peserta ditandai Perlu Diperiksa');
      } else if (entry.status === 'WAITING') {
        inconsistencyReasons.push(
          'Peserta masih berstatus Belum Finish (belum ditentukan Finish/DNS/DNF)'
        );
      }

      // Check finish reference consistency
      if (entry.finishEventId && !linkedFinish) {
        inconsistencyReasons.push(
          `Referensi waktu finish (${entry.finishEventId}) tidak ditemukan di database`
        );
      }

      if (linkedFinish) {
        if (linkedFinish.status === 'CANCELLED') {
          inconsistencyReasons.push(
            `Peserta masih terhubung ke catatan finish ${formatSequenceLabel(
              linkedFinish.sequence
            )} yang berstatus DIBATALKAN`
          );
        } else {
          if (linkedFinish.status === 'NEEDS_REVIEW') {
            inconsistencyReasons.push(
              `Catatan finish ${formatSequenceLabel(
                linkedFinish.sequence
              )} ditandai Perlu Diperiksa`
            );
          }
          if (linkedFinish.status === 'UNIDENTIFIED') {
            inconsistencyReasons.push(
              `Status catatan finish ${formatSequenceLabel(
                linkedFinish.sequence
              )} masih Belum Diidentifikasi`
            );
          }
          if (linkedFinish.batchBibEntryId !== entry.id) {
            inconsistencyReasons.push(
              `Referensi silang tidak cocok antara peserta ${entry.bibLabel} dan ${formatSequenceLabel(
                linkedFinish.sequence
              )}`
            );
          }
          if ((finishRefCount.get(linkedFinish.id) ?? 0) > 1) {
            inconsistencyReasons.push(
              `Catatan finish ${formatSequenceLabel(
                linkedFinish.sequence
              )} dirujuk oleh lebih dari satu peserta`
            );
          }
          if (
            typeof linkedFinish.elapsedMs !== 'number' ||
            !Number.isFinite(linkedFinish.elapsedMs) ||
            linkedFinish.elapsedMs < 0
          ) {
            inconsistencyReasons.push(
              `Waktu tempuh pada ${formatSequenceLabel(
                linkedFinish.sequence
              )} tidak valid`
            );
          }
        }
      }

      if (referencingFinishes.length > 1) {
        inconsistencyReasons.push(
          `Peserta dirujuk oleh ${
            referencingFinishes.length
          } catatan finish aktif sekaligus (${referencingFinishes
            .map((f) => formatSequenceLabel(f.sequence))
            .join(', ')})`
        );
      } else if (
        referencingFinishes.length === 1 &&
        entry.finishEventId !== referencingFinishes[0].id
      ) {
        inconsistencyReasons.push(
          `Catatan finish ${formatSequenceLabel(
            referencingFinishes[0].sequence
          )} menunjuk ke peserta ${
            entry.bibLabel
          }, tetapi data peserta tidak menunjuk balik`
        );
      }

      if (entry.status === 'FINISHED' && !linkedFinish) {
        inconsistencyReasons.push(
          'Peserta berstatus FINISHED tetapi tidak memiliki catatan waktu finish'
        );
      }

      if (
        (entry.status === 'DNS' || entry.status === 'DNF') &&
        (linkedFinish || referencingFinishes.length > 0)
      ) {
        inconsistencyReasons.push(
          `Peserta berstatus ${entry.status} tetapi masih memiliki tautan ke catatan waktu finish`
        );
      }

      // Build notes from correction history or batch notes if relevant
      const noteParts: string[] = [];
      if (linkedFinish?.notes) noteParts.push(linkedFinish.notes);
      if (linkedFinish && linkedFinish.correctionHistory.length > 0) {
        noteParts.push(
          `Dikoreksi ${linkedFinish.correctionHistory.length}x`
        );
      }
      if (
        (linkedFinish?.timingSource ?? batch.timingSource) ===
        'WALL_CLOCK_FALLBACK'
      ) {
        noteParts.push('Waktu fallback jam perangkat');
      }

      if (inconsistencyReasons.length > 0) {
        if (linkedFinish && linkedFinish.status !== 'CANCELLED') {
          handledFinishIds.add(linkedFinish.id);
        }
        for (const rf of referencingFinishes) {
          handledFinishIds.add(rf.id);
        }

        const primaryFinish =
          linkedFinish && linkedFinish.status !== 'CANCELLED'
            ? linkedFinish
            : referencingFinishes[0];

        reviewRows.push({
          eventId: batch.eventId,
          eventName: evName,
          eventDate: evDate,
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          recordType:
            entry.status === 'NEEDS_REVIEW' || entry.status === 'WAITING'
              ? 'PESERTA'
              : 'INKONSISTENSI',
          bibLabel: entry.bibLabel,
          bibColorName: colorName,
          bibNumber: numberValid ? entry.bibNumber : null,
          participantName: safeName,
          elapsedMs:
            primaryFinish && Number.isFinite(primaryFinish.elapsedMs)
              ? primaryFinish.elapsedMs
              : null,
          elapsedFormatted:
            primaryFinish && Number.isFinite(primaryFinish.elapsedMs)
              ? formatElapsedMs(primaryFinish.elapsedMs)
              : '-',
          statusLabel: getParticipantStatusLabel(entry.status),
          finishSequenceLabel: primaryFinish
            ? formatSequenceLabel(primaryFinish.sequence)
            : '-',
          reviewReason: [...inconsistencyReasons, ...noteParts].join('; '),
        });
      } else if (entry.status === 'FINISHED' && linkedFinish) {
        handledFinishIds.add(linkedFinish.id);
        batchValidFinisherCandidates.push({
          entry,
          finish: linkedFinish,
          notes: noteParts.join('; '),
        });
      } else if (entry.status === 'DNS' || entry.status === 'DNF') {
        batchValidNonFinishers.push({
          entry,
          statusCode: entry.status,
          notes: noteParts.join('; '),
        });
      }
    }

    // Now inspect any remaining non-cancelled finish events in this batch that were not handled
    for (const fin of batchFinishes) {
      if (fin.status === 'CANCELLED' || handledFinishIds.has(fin.id)) {
        continue;
      }

      const targetEntry = fin.batchBibEntryId
        ? entryMap.get(fin.batchBibEntryId)
        : undefined;
      const reasons: string[] = [];

      if (fin.status === 'UNIDENTIFIED') {
        reasons.push('Catatan waktu finish belum diidentifikasi ke nomor bib');
      } else if (fin.status === 'NEEDS_REVIEW') {
        reasons.push('Catatan waktu finish ditandai Perlu Diperiksa');
      }
      if (fin.batchBibEntryId && !targetEntry) {
        reasons.push(
          `Catatan finish menunjuk ke ID peserta (${fin.batchBibEntryId}) yang tidak ditemukan di batch ini`
        );
      }
      if (reasons.length === 0) {
        reasons.push(
          'Catatan finish tidak terhubung secara valid ke peserta aktif'
        );
      }
      if (fin.notes) {
        reasons.push(fin.notes);
      }

      reviewRows.push({
        eventId: batch.eventId,
        eventName: evName,
        eventDate: evDate,
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        recordType: 'FINISH_EVENT',
        bibLabel: targetEntry?.bibLabel ?? 'BELUM_DIIDENTIFIKASI',
        bibColorName: targetEntry
          ? BIB_COLOR_MAP[targetEntry.bibColor]?.nameId ?? ''
          : '-',
        bibNumber: targetEntry?.bibNumber ?? null,
        participantName: targetEntry?.participantName?.trim() ?? '',
        elapsedMs: Number.isFinite(fin.elapsedMs) ? fin.elapsedMs : null,
        elapsedFormatted: Number.isFinite(fin.elapsedMs)
          ? formatElapsedMs(fin.elapsedMs)
          : '-',
        statusLabel:
          fin.status === 'UNIDENTIFIED'
            ? 'Belum Diidentifikasi'
            : 'Perlu Diperiksa',
        finishSequenceLabel: formatSequenceLabel(fin.sequence),
        reviewReason: reasons.join('; '),
      });
    }

    // Sort valid finishers in this batch by elapsedMs ascending (tie-break by sequence) and assign Finish Position
    batchValidFinisherCandidates.sort((a, b) => {
      if (a.finish.elapsedMs !== b.finish.elapsedMs) {
        return a.finish.elapsedMs - b.finish.elapsedMs;
      }
      return a.finish.sequence - b.finish.sequence;
    });

    batchValidFinisherCandidates.forEach(({ entry, finish, notes }, index) => {
      totalValidFinishers += 1;
      validRows.push({
        eventId: batch.eventId,
        eventName: evName,
        eventDate: evDate,
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        finishPosition: index + 1,
        bibLabel: entry.bibLabel,
        bibColorName: BIB_COLOR_MAP[entry.bibColor].nameId,
        bibNumber: entry.bibNumber,
        participantName: entry.participantName?.trim() ?? '',
        elapsedMs: finish.elapsedMs,
        elapsedFormatted: formatElapsedMs(finish.elapsedMs),
        statusCode: 'FINISHED',
        statusLabel: 'Finish',
        finishSequenceLabel: formatSequenceLabel(finish.sequence),
        notes,
      });
    });

    // Append valid DNS / DNF participants for this batch
    for (const { entry, statusCode, notes } of batchValidNonFinishers) {
      if (statusCode === 'DNS') totalDns += 1;
      if (statusCode === 'DNF') totalDnf += 1;

      validRows.push({
        eventId: batch.eventId,
        eventName: evName,
        eventDate: evDate,
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        finishPosition: null,
        bibLabel: entry.bibLabel,
        bibColorName: BIB_COLOR_MAP[entry.bibColor].nameId,
        bibNumber: entry.bibNumber,
        participantName: entry.participantName?.trim() ?? '',
        elapsedMs: null,
        elapsedFormatted: '-',
        statusCode,
        statusLabel: getParticipantStatusLabel(statusCode),
        finishSequenceLabel: '-',
        notes,
      });
    }
  }

  const generatedAtIso = new Date().toISOString();

  return {
    eventTitle,
    eventDate,
    batchScopeLabel,
    generatedAtIso,
    generatedAtFormatted: formatWallClockDateTime(generatedAtIso),
    summary: {
      totalBatches: filteredBatches.length,
      totalRegisteredParticipants,
      totalValidResults: validRows.length,
      totalValidFinishers,
      totalDns,
      totalDnf,
      totalNeedsReview: reviewRows.length,
      totalCancelledFinishesExcluded,
    },
    validRows,
    reviewRows,
  };
}

/**
 * Generates an Excel (.xlsx) report buffer with Indonesian column headers,
 * styled title & header rows, frozen table headers, auto-filters, borders,
 * alternating row shading, and separate worksheets for Valid Results and Records Requiring Review.
 */
export async function generateExcelReportBuffer(
  options?: ReportFilterOptions
): Promise<{ buffer: ArrayBuffer; dataset: ValidatedReportDataset; filename: string }> {
  const dataset = await buildValidatedReportDataset(options);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Run Timing Web App';
  workbook.created = new Date(dataset.generatedAtIso);

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  };

  // ==========================================================================
  // WORKSHEET 1: Hasil Lari Valid
  // ==========================================================================
  const wsValid = workbook.addWorksheet('Hasil Lari Valid', {
    views: [{ state: 'frozen', ySplit: 6 }],
  });

  // Title Row (Row 1)
  wsValid.mergeCells('A1:K1');
  const titleCell = wsValid.getCell('A1');
  titleCell.value = `LAPORAN HASIL LARI — ${dataset.eventTitle.toUpperCase()}`;
  titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F172A' },
  };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  wsValid.getRow(1).height = 28;

  // Metadata Rows (Rows 2-4)
  wsValid.mergeCells('A2:K2');
  wsValid.getCell('A2').value = `Tanggal Acara: ${dataset.eventDate}   |   Cakupan Batch: ${dataset.batchScopeLabel}   |   Tanggal Cetak Laporan: ${dataset.generatedAtFormatted}`;
  wsValid.getCell('A2').font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1E293B' } };

  wsValid.mergeCells('A3:K3');
  wsValid.getCell('A3').value = `Ringkasan Tervalidasi: Total Peserta Terdaftar: ${dataset.summary.totalRegisteredParticipants}  •  Finish Valid: ${dataset.summary.totalValidFinishers}  •  DNS: ${dataset.summary.totalDns}  •  DNF: ${dataset.summary.totalDnf}  •  Perlu Diperiksa: ${dataset.summary.totalNeedsReview}`;
  wsValid.getCell('A3').font = { name: 'Calibri', size: 10, color: { argb: 'FF334155' } };

  wsValid.mergeCells('A4:K4');
  wsValid.getCell('A4').value =
    dataset.summary.totalNeedsReview > 0
      ? `Perhatian: Terdapat ${dataset.summary.totalNeedsReview} data yang memerlukan pemeriksaan pada lembar kerja "Perlu Diperiksa".`
      : 'Semua data pada cakupan laporan ini telah tervalidasi tanpa catatan yang perlu diperiksa.';
  wsValid.getCell('A4').font = {
    name: 'Calibri',
    size: 10,
    italic: true,
    color: {
      argb: dataset.summary.totalNeedsReview > 0 ? 'FFB45309' : 'FF15803D',
    },
  };

  // Blank spacer row 5
  wsValid.getRow(5).height = 8;

  // Header Row (Row 6)
  const validHeaders = [
    'Nama Acara',
    'Tanggal Acara',
    'No. Batch',
    'Posisi Finish',
    'Warna Bib',
    'Nomor Bib',
    'Kode Bib',
    'Nama Peserta',
    'Waktu Tempuh',
    'Waktu Tempuh (ms)',
    'Status Peserta',
    'Catatan',
  ];

  // Adjust merge cells to L for 12 columns
  wsValid.unMergeCells('A1:K1');
  wsValid.mergeCells('A1:L1');
  wsValid.unMergeCells('A2:K2');
  wsValid.mergeCells('A2:L2');
  wsValid.unMergeCells('A3:K3');
  wsValid.mergeCells('A3:L3');
  wsValid.unMergeCells('A4:K4');
  wsValid.mergeCells('A4:L4');

  const headerRow = wsValid.getRow(6);
  headerRow.values = validHeaders;
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1D4ED8' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBorder;
  });

  // Populate Valid Rows starting at Row 7
  dataset.validRows.forEach((row, idx) => {
    const excelRow = wsValid.getRow(7 + idx);
    excelRow.values = [
      row.eventName,
      row.eventDate,
      row.batchNumber,
      row.finishPosition !== null ? row.finishPosition : '-',
      row.bibColorName,
      row.bibNumber,
      row.bibLabel,
      row.participantName, // Empty string "" if missing; never invented
      row.elapsedFormatted,
      row.elapsedMs !== null ? row.elapsedMs : '',
      row.statusLabel,
      row.notes,
    ];
    excelRow.height = 20;

    const isEven = idx % 2 === 1;
    const rowBg = isEven ? 'FFF8FAFC' : 'FFFFFFFF';

    excelRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: rowBg },
      };
      cell.border = thinBorder;
      cell.alignment = {
        vertical: 'middle',
        horizontal:
          colNumber === 3 ||
          colNumber === 4 ||
          colNumber === 6 ||
          colNumber === 7 ||
          colNumber === 9
            ? 'center'
            : colNumber === 10
            ? 'right'
            : 'left',
      };
    });
  });

  const lastValidRowIdx = Math.max(6, 6 + dataset.validRows.length);
  wsValid.autoFilter = {
    from: { row: 6, column: 1 },
    to: { row: lastValidRowIdx, column: validHeaders.length },
  };

  wsValid.columns = [
    { key: 'eventName', width: 24 },
    { key: 'eventDate', width: 14 },
    { key: 'batchNumber', width: 12 },
    { key: 'finishPosition', width: 14 },
    { key: 'bibColorName', width: 14 },
    { key: 'bibNumber', width: 12 },
    { key: 'bibLabel', width: 12 },
    { key: 'participantName', width: 26 },
    { key: 'elapsedFormatted', width: 16 },
    { key: 'elapsedMs', width: 18 },
    { key: 'statusLabel', width: 20 },
    { key: 'notes', width: 32 },
  ];

  // ==========================================================================
  // WORKSHEET 2: Perlu Diperiksa (Records Requiring Review)
  // ==========================================================================
  const wsReview = workbook.addWorksheet('Perlu Diperiksa', {
    views: [{ state: 'frozen', ySplit: 5 }],
  });

  wsReview.mergeCells('A1:K1');
  const revTitle = wsReview.getCell('A1');
  revTitle.value = `DAFTAR DATA PERLU DIPERIKSA / BELUM DISELESAIKAN — ${dataset.eventTitle.toUpperCase()}`;
  revTitle.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  revTitle.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFB45309' },
  };
  revTitle.alignment = { vertical: 'middle', horizontal: 'left' };
  wsReview.getRow(1).height = 26;

  wsReview.mergeCells('A2:K2');
  wsReview.getCell('A2').value = `Tanggal Acara: ${dataset.eventDate}   |   Cakupan Batch: ${dataset.batchScopeLabel}   |   Tanggal Cetak Laporan: ${dataset.generatedAtFormatted}`;
  wsReview.getCell('A2').font = { name: 'Calibri', size: 10, bold: true };

  wsReview.mergeCells('A3:K3');
  wsReview.getCell('A3').value =
    'Catatan di bawah ini tidak dimasukkan ke Hasil Lari Valid karena belum diidentifikasi, belum berstatus akhir, atau memiliki ketidaksesuaian referensi.';
  wsReview.getCell('A3').font = { name: 'Calibri', size: 10, italic: true };

  wsReview.getRow(4).height = 8;

  const reviewHeaders = [
    'Nama Acara',
    'Tanggal Acara',
    'No. Batch',
    'Jenis Catatan',
    'Urutan Finish',
    'Warna Bib',
    'Nomor Bib',
    'Kode Bib',
    'Nama Peserta',
    'Waktu Tempuh',
    'Status Saat Ini',
    'Catatan / Alasan Perlu Diperiksa',
  ];

  wsReview.unMergeCells('A1:K1');
  wsReview.mergeCells('A1:L1');
  wsReview.unMergeCells('A2:K2');
  wsReview.mergeCells('A2:L2');
  wsReview.unMergeCells('A3:K3');
  wsReview.mergeCells('A3:L3');

  const revHeaderRow = wsReview.getRow(5);
  revHeaderRow.values = reviewHeaders;
  revHeaderRow.height = 24;
  revHeaderRow.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD97706' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBorder;
  });

  dataset.reviewRows.forEach((row, idx) => {
    const excelRow = wsReview.getRow(6 + idx);
    excelRow.values = [
      row.eventName,
      row.eventDate,
      row.batchNumber,
      row.recordType,
      row.finishSequenceLabel,
      row.bibColorName,
      row.bibNumber !== null ? row.bibNumber : '-',
      row.bibLabel,
      row.participantName,
      row.elapsedFormatted,
      row.statusLabel,
      row.reviewReason,
    ];
    excelRow.height = 20;

    const isEven = idx % 2 === 1;
    const rowBg = isEven ? 'FFFFFBEB' : 'FFFFFFFF';

    excelRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: rowBg },
      };
      cell.border = thinBorder;
      cell.alignment = {
        vertical: 'middle',
        horizontal:
          colNumber >= 3 && colNumber <= 8 || colNumber === 10
            ? 'center'
            : 'left',
      };
    });
  });

  const lastRevRowIdx = Math.max(5, 5 + dataset.reviewRows.length);
  wsReview.autoFilter = {
    from: { row: 5, column: 1 },
    to: { row: lastRevRowIdx, column: reviewHeaders.length },
  };

  wsReview.columns = [
    { key: 'eventName', width: 22 },
    { key: 'eventDate', width: 14 },
    { key: 'batchNumber', width: 12 },
    { key: 'recordType', width: 16 },
    { key: 'finishSequenceLabel', width: 14 },
    { key: 'bibColorName', width: 14 },
    { key: 'bibNumber', width: 12 },
    { key: 'bibLabel', width: 14 },
    { key: 'participantName', width: 24 },
    { key: 'elapsedFormatted', width: 16 },
    { key: 'statusLabel', width: 20 },
    { key: 'reviewReason', width: 42 },
  ];

  const rawBuffer = await workbook.xlsx.writeBuffer();
  const uint8 = new Uint8Array(rawBuffer as ArrayBuffer);
  const arrayBuffer = uint8.buffer.slice(
    uint8.byteOffset,
    uint8.byteOffset + uint8.byteLength
  ) as ArrayBuffer;

  const filename = buildReportFilename(
    dataset.eventTitle,
    dataset.eventDate,
    'xlsx'
  );

  return { buffer: arrayBuffer, dataset, filename };
}

/**
 * Generates a print-friendly, mobile-readable PDF (.pdf) report with repeated table headers
 * across pages, summary counts, valid results table, separate section for records requiring review,
 * and a status legend explaining DNS, DNF, and Perlu Diperiksa.
 */
export async function generatePdfReportBytes(
  options?: ReportFilterOptions
): Promise<{ bytes: Uint8Array; dataset: ValidatedReportDataset; filename: string }> {
  const dataset = await buildValidatedReportDataset(options);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Header Block
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text('LAPORAN HASIL PENCATATAN WAKTU LARI', 14, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(51, 65, 85);
  doc.text(`Nama Acara: ${dataset.eventTitle}`, 14, 23);
  doc.text(
    `Tanggal Acara: ${dataset.eventDate}   |   Cakupan: ${dataset.batchScopeLabel}`,
    14,
    28
  );
  doc.text(`Dicetak pada: ${dataset.generatedAtFormatted}`, 14, 33);

  // Summary Box
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, 37, 182, 18, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Ringkasan Hasil Tervalidasi:', 18, 43);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `Total Peserta Terdaftar: ${dataset.summary.totalRegisteredParticipants}   |   Finish Valid: ${dataset.summary.totalValidFinishers}   |   DNS: ${dataset.summary.totalDns}   |   DNF: ${dataset.summary.totalDnf}   |   Perlu Diperiksa: ${dataset.summary.totalNeedsReview}`,
    18,
    50
  );

  // Section 1: Valid Results Table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(
    `1. Daftar Hasil Lari (${dataset.validRows.length} Peserta)`,
    14,
    63
  );

  const validBody =
    dataset.validRows.length > 0
      ? dataset.validRows.map((r) => [
          `#${r.batchNumber}`,
          r.finishPosition !== null ? String(r.finishPosition) : '-',
          r.bibColorName,
          String(r.bibNumber),
          r.participantName, // blank if missing
          r.elapsedFormatted,
          r.statusLabel,
          r.notes || '-',
        ])
      : [['-', '-', '-', '-', 'Belum ada hasil lari valid', '-', '-', '-']];

  autoTable(doc, {
    startY: 66,
    head: [
      [
        'Batch',
        'Posisi',
        'Warna Bib',
        'No. Bib',
        'Nama Peserta',
        'Waktu Tempuh',
        'Status',
        'Catatan',
      ],
    ],
    body: validBody,
    showHead: 'everyPage',
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 2.2,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [29, 78, 216],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 15 },
      1: { halign: 'center', cellWidth: 14 },
      2: { halign: 'center', cellWidth: 20 },
      3: { halign: 'center', cellWidth: 16 },
      4: { halign: 'left', cellWidth: 38 },
      5: { halign: 'center', cellWidth: 24, fontStyle: 'bold' },
      6: { halign: 'center', cellWidth: 26 },
      7: { halign: 'left', cellWidth: 29 },
    },
    margin: { left: 14, right: 14 },
  });

  const docWithAutoTable = doc as jsPDF & {
    lastAutoTable?: { finalY: number };
  };
  let currentY = (docWithAutoTable.lastAutoTable?.finalY ?? 85) + 9;

  // Section 2: Records Requiring Review (never silently omitted!)
  if (currentY > 250) {
    doc.addPage();
    currentY = 18;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(180, 83, 9);
  doc.text(
    `2. Catatan Perlu Diperiksa / Belum Terselesaikan (${dataset.reviewRows.length} Catatan)`,
    14,
    currentY
  );

  const reviewBody =
    dataset.reviewRows.length > 0
      ? dataset.reviewRows.map((r) => [
          `#${r.batchNumber}`,
          r.bibColorName,
          r.bibNumber !== null ? String(r.bibNumber) : r.bibLabel,
          r.participantName,
          r.elapsedFormatted,
          r.statusLabel,
          r.reviewReason,
        ])
      : [
          [
            '-',
            '-',
            '-',
            '-',
            '-',
            'Lengkap',
            'Tidak ada catatan yang perlu diperiksa.',
          ],
        ];

  autoTable(doc, {
    startY: currentY + 3,
    head: [
      [
        'Batch',
        'Warna Bib',
        'No. Bib / Kode',
        'Nama Peserta',
        'Waktu Tempuh',
        'Status',
        'Alasan Perlu Diperiksa',
      ],
    ],
    body: reviewBody,
    showHead: 'everyPage',
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.2,
      cellPadding: 2,
      textColor: [15, 23, 42],
      lineColor: [217, 119, 6],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [217, 119, 6],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
    },
    alternateRowStyles: {
      fillColor: [255, 251, 235],
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 15 },
      1: { halign: 'center', cellWidth: 20 },
      2: { halign: 'center', cellWidth: 24 },
      3: { halign: 'left', cellWidth: 30 },
      4: { halign: 'center', cellWidth: 22 },
      5: { halign: 'center', cellWidth: 25 },
      6: { halign: 'left', cellWidth: 46 },
    },
    margin: { left: 14, right: 14 },
  });

  currentY = (docWithAutoTable.lastAutoTable?.finalY ?? currentY + 25) + 8;

  // Section 3: Status Legend (DNS, DNF, Perlu Diperiksa)
  if (currentY > 258) {
    doc.addPage();
    currentY = 18;
  }

  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, currentY, 182, 24, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('Keterangan Status (Legenda):', 18, currentY + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(51, 65, 85);
  doc.text(
    '• DNS (Did Not Start / Tidak Start): Peserta terdaftar di batch tetapi tidak memulai lari.',
    18,
    currentY + 11.5
  );
  doc.text(
    '• DNF (Did Not Finish / Tidak Selesai): Peserta memulai lari tetapi tidak menyelesaikan lintasan hingga garis finish.',
    18,
    currentY + 16.5
  );
  doc.text(
    '• Perlu Diperiksa: Catatan waktu atau peserta yang belum diidentifikasi, belum berstatus akhir, atau memerlukan verifikasi juri.',
    18,
    currentY + 21.5
  );

  // Add page numbers across all pages
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Run Timing — ${dataset.eventTitle} (${dataset.eventDate})   |   Halaman ${p} dari ${totalPages}`,
      14,
      290
    );
  }

  const arrayBuf = doc.output('arraybuffer');
  const bytes = new Uint8Array(arrayBuf);
  const filename = buildReportFilename(
    dataset.eventTitle,
    dataset.eventDate,
    'pdf'
  );

  return { bytes, dataset, filename };
}
