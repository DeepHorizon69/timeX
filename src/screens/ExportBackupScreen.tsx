import React, { useState } from 'react';
import { BatchRecord, EventRecord } from '../domain/types';
import { formatWallClockDateTime } from '../domain/utils';
import {
  BackupPreviewSummary,
  ExportService,
} from '../services/exportService';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface ExportBackupScreenProps {
  activeEvent: EventRecord;
  batches: BatchRecord[];
  onDataImported: () => Promise<void>;
  onBackHome: () => void;
}

function triggerFileDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const ExportBackupScreen: React.FC<ExportBackupScreenProps> = ({
  activeEvent,
  batches,
  onDataImported,
  onBackHome,
}) => {
  const [selectedBatchFilter, setSelectedBatchFilter] = useState<string>('ALL_EVENT');
  const [csvPreviewText, setCsvPreviewText] = useState<string | null>(null);
  const [jsonBackupText, setJsonBackupText] = useState<string | null>(null);
  const [rawImportJson, setRawImportJson] = useState<string>('');
  const [importPreview, setImportPreview] = useState<BackupPreviewSummary | null>(
    null
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);

  const handleExportCsv = async (download: boolean) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsBusy(true);
    try {
      const options =
        selectedBatchFilter === 'ALL_EVENTS'
          ? undefined
          : selectedBatchFilter === 'ALL_EVENT'
          ? { eventId: activeEvent.id }
          : { batchId: selectedBatchFilter };

      const csv = await ExportService.buildCsvString(options);
      setCsvPreviewText(csv);

      if (download) {
        const safeName = activeEvent.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
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

  const handleExportJsonBackup = async (download: boolean) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsBusy(true);
    try {
      const jsonStr = await ExportService.buildJsonBackupString();
      setJsonBackupText(jsonStr);

      if (download) {
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const filename = `run-timing-backup-${timestamp}.json`;
        triggerFileDownload(
          filename,
          jsonStr,
          'application/json;charset=utf-8'
        );
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
      const preview = await ExportService.validateAndPreviewBackupJson(
        rawImportJson
      );
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
        err instanceof Error ? err.message : 'Gagal memulihkan data dari backup.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="screen-container">
      {/* Top Bar */}
      <header className="sticky-top-bar">
        <div className="sticky-top-bar__left">
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={onBackHome}
          >
            ← Beranda
          </button>
          <div>
            <span className="sticky-top-bar__title">Ekspor CSV & Backup JSON</span>
            <span className="sticky-top-bar__sub">{activeEvent.name}</span>
          </div>
        </div>
      </header>

      {/* Local Data Warning */}
      <section className="card warning-card" role="note">
        <h2 className="section-title">Penting: Data Tersimpan Lokal di HP Ini</h2>
        <p>
          Aplikasi ini <strong>tidak mengirim data ke server atau cloud</strong>. Agar hasil tetap aman apabila HP kehabisan baterai, browser terhapus, atau perangkat rusak, selalu unduh file <strong>Ekspor CSV</strong> dan <strong>Backup JSON</strong> lalu salin/kirim ke luar perangkat ini (mis. ke email, pesan, atau flashdisk).
        </p>
      </section>

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

      {/* Section 1: Export CSV */}
      <section className="card" aria-label="Ekspor CSV Hasil">
        <h2 className="section-title">1. Ekspor CSV Hasil Lari</h2>
        <p className="helper-text">
          Menghasilkan satu baris per peserta/hasil lengkap dengan kegiatan, nomor batch, warna bib, nomor bib, urutan finish, waktu milidetik, waktu terformat (MM:SS.cc), status, dan waktu jam.
        </p>

        <div className="form-group">
          <label htmlFor="csv-scope-select" className="field-label">
            Cakupan Data CSV:
          </label>
          <select
            id="csv-scope-select"
            className="select-input"
            value={selectedBatchFilter}
            onChange={(e) => setSelectedBatchFilter(e.target.value)}
          >
            <option value="ALL_EVENT">
              Semua Batch di Kegiatan Aktif ({activeEvent.name})
            </option>
            <option value="ALL_EVENTS">Semua Kegiatan Tersimpan</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                Hanya Batch #{b.batchNumber} ({b.status})
              </option>
            ))}
          </select>
        </div>

        <div className="export-btn-row">
          <button
            type="button"
            className="btn btn--primary btn--large"
            disabled={isBusy}
            onClick={() => void handleExportCsv(true)}
          >
            Ekspor CSV (Unduh File)
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
      </section>

      {/* Section 2: Export JSON Backup */}
      <section className="card" aria-label="Backup JSON Lengkap">
        <h2 className="section-title">2. Backup JSON Lengkap</h2>
        <p className="helper-text">
          Menyimpan seluruh basis data lokal (semua kegiatan, batch, nomor bib, catatan finish, dan riwayat audit/koreksi) ke satu file JSON berversi skema.
        </p>

        <div className="export-btn-row">
          <button
            type="button"
            className="btn btn--primary btn--large"
            disabled={isBusy}
            onClick={() => void handleExportJsonBackup(true)}
          >
            Backup JSON (Unduh File)
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
        <h2 className="section-title">3. Impor / Pulihkan dari Backup JSON</h2>
        <p className="helper-text">
          Sistem akan memeriksa struktur dan versi skema file terlebih dahulu, lalu menampilkan ringkasan isi sebelum Anda mengonfirmasi pemulihan.
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
          Periksa & Tampilkan Pratinjau Impor
        </button>
      </section>

      {/* Confirmation Dialog for JSON Backup Import */}
      <ConfirmDialog
        open={Boolean(importPreview)}
        title="Konfirmasi Pemulihan Data Backup JSON"
        description={
          importPreview && (
            <div>
              <p>
                File backup valid (Skema v{importPreview.schemaVersion}, diekspor pada{' '}
                <strong>{formatWallClockDateTime(importPreview.exportedAt)}</strong>).
              </p>
              <div className="import-comparison-box">
                <div>
                  <strong>Data di File Backup:</strong>
                  <ul className="dialog-summary-list">
                    <li>{importPreview.eventCount} Kegiatan</li>
                    <li>{importPreview.batchCount} Batch</li>
                    <li>{importPreview.bibEntryCount} Peserta (Bib)</li>
                    <li>{importPreview.finishEventCount} Catatan Finish</li>
                    <li>{importPreview.auditLogCount} Log Audit</li>
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
                Perhatian: Memulihkan backup ini akan menggantikan data lokal yang saat ini ada di browser dengan data dari file backup.
              </p>
            </div>
          )
        }
        confirmLabel="Ya, Pulihkan Data Backup Ini"
        cancelLabel="Batal"
        variant="warning"
        onConfirm={() => void handleConfirmRestoreBackup()}
        onCancel={() => setImportPreview(null)}
      />
    </div>
  );
};
