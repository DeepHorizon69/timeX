import React, { useEffect, useState } from 'react';
import { BatchRecord, EventRecord, PendingCapture } from '../domain/types';
import { formatWallClockDateTime, getBatchName } from '../domain/utils';
import { BackupPreviewSummary, ExportService } from '../services/exportService';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ThemePicker } from '../components/ThemePicker';
import {
  downloadBackupJson,
  triggerBlobDownload,
  triggerFileDownload,
} from '../services/fileDownload';
import { HistoryService, HistorySummary } from '../services/historyService';
import {
  restorePendingCaptures,
  retryCaptures,
} from '../services/captureSession';

interface ExportBackupScreenProps {
  offlineReady?: boolean;
  activeEvent: EventRecord;
  batches: BatchRecord[];
  onDataImported: () => Promise<void>;
  onHistoryCleared: () => Promise<void>;
  onBackHome: () => void;
}

export const ExportBackupScreen: React.FC<ExportBackupScreenProps> = ({
  offlineReady = false,
  activeEvent,
  batches,
  onDataImported,
  onHistoryCleared,
  onBackHome,
}) => {
  const [selectedBatchFilter, setSelectedBatchFilter] =
    useState<string>('ALL_EVENT');
  const [csvPreviewText, setCsvPreviewText] = useState<string | null>(null);
  const [jsonBackupText, setJsonBackupText] = useState<string | null>(null);
  const [rawImportJson, setRawImportJson] = useState<string>('');
  const [importPreview, setImportPreview] =
    useState<BackupPreviewSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [storageStatus, setStorageStatus] = useState('Penyimpanan lokal aktif');
  const [rescuePreview, setRescuePreview] = useState<PendingCapture[] | null>(
    null
  );
  const [clearPreview, setClearPreview] = useState<HistorySummary | null>(null);
  useEffect(() => {
    void navigator.storage
      ?.persisted?.()
      .then((persisted) => {
        setStorageStatus(
          persisted
            ? 'Penyimpanan persisten diizinkan browser'
            : 'Penyimpanan standar browser'
        );
      })
      .catch(() => setStorageStatus('Penyimpanan lokal aktif'));
  }, []);

  const getFilterOptions = () =>
    selectedBatchFilter === 'ALL_EVENTS'
      ? undefined
      : selectedBatchFilter === 'ALL_EVENT'
        ? { eventId: activeEvent.id }
        : { batchId: selectedBatchFilter };

  const handleExportCsv = async (download: boolean) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsBusy(true);
    try {
      const options = getFilterOptions();
      const csv = await ExportService.buildCsvString(options);
      setCsvPreviewText(csv);

      if (download) {
        const safeName = activeEvent.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        const timestamp = new Date()
          .toISOString()
          .slice(0, 19)
          .replace(/[:T]/g, '-');
        const filename = `hasil-lari-${safeName || 'event'}-${timestamp}.csv`;
        triggerFileDownload(filename, '\uFEFF' + csv, 'text/csv;charset=utf-8');
        setSuccessMessage(`File CSV "${filename}" berhasil diunduh.`);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Gagal membuat file CSV.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleExportExcel = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsBusy(true);
    try {
      const options = getFilterOptions();
      const { buffer, filename, dataset } =
        await ExportService.buildExcelReport(options);
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      triggerBlobDownload(filename, blob);
      setSuccessMessage(
        `Laporan Excel "${filename}" berhasil diunduh (${dataset.summary.totalValidResults} hasil valid, ${dataset.summary.totalNeedsReview} perlu diperiksa).`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Gagal membuat laporan Excel (.xlsx).'
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleExportPdf = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsBusy(true);
    try {
      const options = getFilterOptions();
      const { bytes, filename, dataset } =
        await ExportService.buildPdfReport(options);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      triggerBlobDownload(filename, blob);
      setSuccessMessage(
        `Laporan PDF "${filename}" berhasil diunduh (${dataset.summary.totalValidResults} hasil valid, ${dataset.summary.totalNeedsReview} perlu diperiksa).`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Gagal membuat laporan PDF (.pdf).'
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleExportJsonBackup = async (download: boolean) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsBusy(true);
    try {
      const jsonStr = await ExportService.buildJsonBackupString();
      setJsonBackupText(jsonStr);

      if (download) {
        const filename = downloadBackupJson(jsonStr);
        setSuccessMessage(`File Backup JSON "${filename}" berhasil diunduh.`);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Gagal membuat backup JSON.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleFileUploadChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setRawImportJson(text);
      setImportPreview(null);
      setRescuePreview(null);
      const rescue = await ExportService.validateRescueJson(text);
      if (rescue) {
        setRescuePreview(rescue);
        return;
      }
      const preview = await ExportService.validateAndPreviewBackupJson(text);
      setImportPreview(preview);
    } catch (err) {
      setImportPreview(null);
      setErrorMessage(
        err instanceof Error ? err.message : 'File backup JSON tidak valid.'
      );
    }
  };

  const handleValidateManualJson = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!rawImportJson.trim()) {
      setErrorMessage('Pilih file JSON atau tempel isi JSON terlebih dahulu.');
      return;
    }
    try {
      setImportPreview(null);
      setRescuePreview(null);
      const rescue = await ExportService.validateRescueJson(rawImportJson);
      if (rescue) {
        setRescuePreview(rescue);
        return;
      }
      const preview =
        await ExportService.validateAndPreviewBackupJson(rawImportJson);
      setImportPreview(preview);
    } catch (err) {
      setImportPreview(null);
      setErrorMessage(
        err instanceof Error ? err.message : 'Isi JSON backup tidak valid.'
      );
    }
  };

  const handleConfirmRestoreBackup = async () => {
    if (!importPreview) return;
    setIsBusy(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await ExportService.importValidatedBackup(importPreview.payload);
      setImportPreview(null);
      setRawImportJson('');
      await onDataImported();
      setSuccessMessage(
        'Backup JSON berhasil dipulihkan ke penyimpanan lokal perangkat ini.'
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Gagal memulihkan data dari backup.'
      );
      throw err;
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="screen-container">
      {/* Top Bar */}
      <header className="page-heading">
        <div className="sticky-top-bar__left">
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={onBackHome}
          >
            Kembali
          </button>
          <div>
            <h1>Perangkat</h1>
            <span className="sticky-top-bar__sub">{activeEvent.name}</span>
          </div>
        </div>
      </header>

      {/* Local Data Warning */}
      <section className="card device-overview">
        <h2>Data di HP ini</h2>
        <p>{storageStatus}</p>
        <p className="helper-text">
          {offlineReady
            ? 'Aplikasi siap dibuka kembali tanpa internet.'
            : 'Akses offline tersedia setelah aset versi produksi selesai disimpan.'}
        </p>
        <p className="helper-text">
          Unduh backup JSON dan simpan salinannya di luar perangkat untuk
          pemulihan data.
        </p>
        {navigator.storage?.persist && (
          <button
            className="btn btn--secondary"
            onClick={() => {
              void navigator.storage
                .persist()
                .then((allowed) =>
                  setStorageStatus(
                    allowed
                      ? 'Penyimpanan persisten diizinkan browser'
                      : 'Browser tetap memakai penyimpanan standar'
                  )
                )
                .catch(() =>
                  setStorageStatus(
                    'Permintaan penyimpanan persisten gagal. Coba lagi.'
                  )
                );
            }}
          >
            Minta penyimpanan persisten
          </button>
        )}
      </section>

      <ThemePicker />

      {errorMessage && (
        <div className="inline-alert inline-alert--error" role="alert">
          {errorMessage}
        </div>
      )}

      {successMessage && (
        <div className="inline-alert inline-alert--success" role="status">
          {successMessage}
        </div>
      )}

      {/* Section 1: Export CSV & Reports (CSV, Excel, PDF) */}
      <section className="card" aria-label="Ekspor CSV Hasil">
        <h2 className="section-title">Ekspor hasil lomba</h2>

        <div className="form-group">
          <label htmlFor="csv-scope-select" className="field-label">
            Cakupan Data Laporan / CSV:
          </label>
          <select
            id="csv-scope-select"
            className="select-input"
            value={selectedBatchFilter}
            onChange={(e) => setSelectedBatchFilter(e.target.value)}
          >
            <option value="ALL_EVENT">
              Semua gelombang ({activeEvent.name})
            </option>
            <option value="ALL_EVENTS">Semua Kegiatan Tersimpan</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {getBatchName(b)}
              </option>
            ))}
          </select>
        </div>

        {/* Option 1: CSV */}
        <div className="export-method-block">
          <p className="helper-text">
            <strong>CSV:</strong> data tabel untuk spreadsheet atau pemrosesan
            lanjutan.
          </p>
          <div className="export-btn-row">
            <button
              type="button"
              className="btn btn--primary btn--large"
              disabled={isBusy}
              onClick={() => void handleExportCsv(true)}
            >
              Ekspor CSV
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={isBusy}
              onClick={() => void handleExportCsv(false)}
            >
              Tampilkan Pratinjau CSV
            </button>
          </div>
        </div>

        {csvPreviewText && (
          <div className="preview-textarea-box">
            <label htmlFor="csv-preview-textarea" className="field-label">
              Isi CSV (UTF-8):
            </label>
            <textarea
              id="csv-preview-textarea"
              readOnly
              rows={7}
              className="code-textarea"
              value={csvPreviewText}
            />
          </div>
        )}

        {/* Option 3: Excel (.xlsx) */}
        <div className="export-method-block" style={{ marginTop: '0.85rem' }}>
          <p className="helper-text">
            <strong>Excel:</strong> laporan hasil yang mudah dibaca dan
            dianalisis.
          </p>
          <div className="export-btn-row">
            <button
              type="button"
              className="btn btn--primary btn--large"
              disabled={isBusy}
              onClick={() => void handleExportExcel()}
            >
              Unduh Laporan Excel (.xlsx)
            </button>
          </div>
        </div>

        {/* Option 4: PDF (.pdf) */}
        <div className="export-method-block" style={{ marginTop: '0.85rem' }}>
          <p className="helper-text">
            <strong>PDF:</strong> laporan siap dibagikan atau dicetak.
          </p>
          <div className="export-btn-row">
            <button
              type="button"
              className="btn btn--primary btn--large"
              disabled={isBusy}
              onClick={() => void handleExportPdf()}
            >
              Unduh Laporan PDF (.pdf)
            </button>
          </div>
        </div>
      </section>

      {/* Section 2: Export JSON Backup */}
      <section className="card" aria-label="Backup JSON Lengkap">
        <h2 className="section-title">Backup lengkap</h2>
        <p className="helper-text">
          <strong>JSON:</strong> backup lengkap untuk memulihkan data aplikasi.
        </p>

        <div className="export-btn-row">
          <button
            type="button"
            className="btn btn--primary btn--large"
            disabled={isBusy}
            onClick={() => void handleExportJsonBackup(true)}
          >
            Backup Lengkap (JSON)
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={isBusy}
            onClick={() => void handleExportJsonBackup(false)}
          >
            Tampilkan JSON Backup
          </button>
        </div>

        {jsonBackupText && (
          <div className="preview-textarea-box">
            <label htmlFor="json-preview-textarea" className="field-label">
              Isi Backup JSON:
            </label>
            <textarea
              id="json-preview-textarea"
              readOnly
              rows={7}
              className="code-textarea"
              value={jsonBackupText}
            />
          </div>
        )}
      </section>

      {/* Section 3: Import / Restore JSON Backup */}
      <section className="card" aria-label="Impor dan Pulihkan Backup JSON">
        <h2 className="section-title">Pulihkan backup</h2>
        <p className="helper-text">
          Pilih backup JSON atau file penyelamatan TimeX. Periksa isinya sebelum
          mengonfirmasi pemulihan.
        </p>

        <div className="form-group">
          <label htmlFor="backup-file-input" className="field-label">
            Pilih File Backup (.json):
          </label>
          <input
            id="backup-file-input"
            type="file"
            accept=".json,application/json"
            className="file-input"
            onChange={(e) => void handleFileUploadChange(e)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="manual-json-input" className="field-label">
            Atau Tempel Isi JSON Backup:
          </label>
          <textarea
            id="manual-json-input"
            rows={5}
            className="code-textarea"
            placeholder='{"schemaVersion": 1, "appName": "Run Timing", ...}'
            value={rawImportJson}
            onChange={(e) => setRawImportJson(e.target.value)}
          />
        </div>

        <button
          type="button"
          className="btn btn--secondary"
          disabled={isBusy}
          onClick={() => void handleValidateManualJson()}
        >
          Periksa backup
        </button>
      </section>

      <section className="card" aria-label="Hapus seluruh riwayat">
        <h2>Hapus seluruh riwayat</h2>
        <p className="helper-text">
          Hapus semua kegiatan, gelombang, peserta, hasil finish, dan audit di
          perangkat ini. Setelah dihapus, TimeX membuka satu kegiatan kosong
          baru. Unduh backup terlebih dahulu jika ingin menyimpan salinannya.
        </p>
        <button
          type="button"
          className="btn btn--danger-outline"
          disabled={isBusy}
          onClick={async () => {
            setIsBusy(true);
            setErrorMessage(null);
            try {
              setClearPreview(await HistoryService.getSummary());
            } catch (error) {
              setErrorMessage(
                error instanceof Error
                  ? error.message
                  : 'Gagal membaca ringkasan riwayat.'
              );
            } finally {
              setIsBusy(false);
            }
          }}
        >
          Hapus seluruh riwayat
        </button>
      </section>

      <ConfirmDialog
        open={clearPreview !== null}
        title="Hapus seluruh riwayat di perangkat ini?"
        description={
          clearPreview && (
            <>
              <p>Penghapusan mencakup seluruh kegiatan di browser ini.</p>
              <ul className="dialog-summary-list">
                <li>{clearPreview.events} kegiatan</li>
                <li>{clearPreview.batches} gelombang</li>
                <li>{clearPreview.participants} peserta</li>
                <li>{clearPreview.finishes} catatan finish</li>
                <li>{clearPreview.auditLogs} catatan audit</li>
              </ul>
              <p>
                Penghapusan permanen. Pemulihan membutuhkan file backup yang
                sudah diunduh.
              </p>
            </>
          )
        }
        variant="danger"
        confirmLabel="Hapus permanen"
        onCancel={() => setClearPreview(null)}
        onConfirm={async () => {
          setIsBusy(true);
          try {
            const result = await HistoryService.clearAllHistory();
            setClearPreview(null);
            setCsvPreviewText(null);
            setJsonBackupText(null);
            setRawImportJson('');
            setImportPreview(null);
            setRescuePreview(null);
            setSelectedBatchFilter('ALL_EVENT');
            setErrorMessage(null);
            setSuccessMessage(
              result.journalCleared
                ? 'Seluruh riwayat dihapus. Kegiatan kosong baru siap digunakan.'
                : 'Riwayat dihapus. Browser gagal membersihkan salinan darurat sesi.'
            );
            await onHistoryCleared();
          } finally {
            setIsBusy(false);
          }
        }}
      />

      {/* Confirmation Dialog for JSON Backup Import */}
      <ConfirmDialog
        open={Boolean(importPreview)}
        title="Konfirmasi Pemulihan Data Backup JSON"
        description={
          importPreview && (
            <div>
              <p>
                File backup valid (Skema v{importPreview.schemaVersion},
                diekspor pada{' '}
                <strong>
                  {formatWallClockDateTime(importPreview.exportedAt)}
                </strong>
                ).
              </p>
              <div className="import-comparison-box">
                <div>
                  <strong>Data di File Backup:</strong>
                  <ul className="dialog-summary-list">
                    <li>{importPreview.eventCount} Kegiatan</li>
                    <li>{importPreview.batchCount} gelombang</li>
                    <li>{importPreview.bibEntryCount} Peserta (Bib)</li>
                    <li>{importPreview.finishEventCount} Catatan Finish</li>
                    <li>{importPreview.auditLogCount} Log Audit</li>
                    <li>
                      {importPreview.payload.pendingCaptures?.length ?? 0}{' '}
                      finish tertunda
                    </li>
                  </ul>
                </div>
                <div>
                  <strong>Data Saat Ini di Perangkat:</strong>
                  <ul className="dialog-summary-list">
                    <li>{importPreview.existingEventCount} Kegiatan</li>
                    <li>{importPreview.existingBatchCount} Batch</li>
                    <li>{importPreview.existingFinishCount} Catatan Finish</li>
                  </ul>
                </div>
              </div>
              <p className="inline-note inline-note--warning">
                Perhatian: Memulihkan backup ini akan menggantikan data lokal
                yang saat ini ada di browser dengan data dari file backup.
              </p>
            </div>
          )
        }
        confirmLabel="Ya, Pulihkan Data Backup Ini"
        cancelLabel="Batal"
        variant="warning"
        onConfirm={handleConfirmRestoreBackup}
        onCancel={() => setImportPreview(null)}
      />
      <ConfirmDialog
        open={rescuePreview !== null}
        title="Pulihkan catatan darurat?"
        description={
          <p>
            {rescuePreview?.length ?? 0} catatan akan ditambahkan ke antrean
            penyimpanan. Catatan yang sudah tersimpan akan dikenali melalui ID
            yang sama.
          </p>
        }
        confirmLabel="Pulihkan catatan"
        onCancel={() => setRescuePreview(null)}
        onConfirm={async () => {
          restorePendingCaptures(rescuePreview ?? []);
          setRescuePreview(null);
          await retryCaptures();
          await onDataImported();
        }}
      />
    </div>
  );
};
