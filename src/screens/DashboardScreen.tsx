import React, { useState } from 'react';
import {
  BatchBibEntry,
  BatchRecord,
  EventRecord,
  FinishEventRecord,
  RecordingMode,
} from '../domain/types';
import {
  formatWallClockTime,
  getBatchStatusLabel,
  getRecordingModeLabel,
} from '../domain/utils';

interface DashboardScreenProps {
  activeEvent: EventRecord;
  allEvents: EventRecord[];
  batches: BatchRecord[];
  allFinishEvents: FinishEventRecord[];
  allBibEntries: BatchBibEntry[];
  onCreateBatch: (mode: RecordingMode) => Promise<void>;
  onOpenBatch: (batch: BatchRecord) => void;
  onNavigateResults: () => void;
  onNavigateExport: () => void;
  onUpdateEvent: (name: string, eventDate: string) => Promise<void>;
  onCreateNewEvent: (name: string, eventDate: string) => Promise<void>;
  onSwitchEvent: (eventId: string) => Promise<void>;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  activeEvent,
  allEvents,
  batches,
  allFinishEvents,
  allBibEntries,
  onCreateBatch,
  onOpenBatch,
  onNavigateResults,
  onNavigateExport,
  onUpdateEvent,
  onCreateNewEvent,
  onSwitchEvent,
}) => {
  const [editingEvent, setEditingEvent] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [eventNameInput, setEventNameInput] = useState(activeEvent.name);
  const [eventDateInput, setEventDateInput] = useState(activeEvent.eventDate);
  const [newBatchMode, setNewBatchMode] = useState<RecordingMode>('TIMESTAMP_FIRST');
  const [formError, setFormError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // Find active / recoverable / in-progress batch
  const activeOrRecoverableBatch = batches.find(
    (b) =>
      b.status === 'RUNNING' ||
      b.status === 'REVIEW' ||
      b.status === 'DRAFT' ||
      b.status === 'READY'
  );

  const runningBatch = batches.find((b) => b.status === 'RUNNING');
  const completedBatchesCount = batches.filter(
    (b) => b.status === 'COMPLETED' || b.status === 'NEEDS_REVIEW'
  ).length;

  const validFinishes = allFinishEvents.filter((f) => f.status !== 'CANCELLED');
  const unidentifiedFinishesCount = allFinishEvents.filter(
    (f) => f.status === 'UNIDENTIFIED' || f.status === 'NEEDS_REVIEW'
  ).length;

  const handleSaveEventEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!eventNameInput.trim()) {
      setFormError('Nama kegiatan wajib diisi.');
      return;
    }
    setIsBusy(true);
    try {
      await onUpdateEvent(eventNameInput.trim(), eventDateInput);
      setEditingEvent(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menyimpan kegiatan.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateEventSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!eventNameInput.trim()) {
      setFormError('Nama kegiatan baru wajib diisi.');
      return;
    }
    setIsBusy(true);
    try {
      await onCreateNewEvent(eventNameInput.trim(), eventDateInput);
      setCreatingEvent(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal membuat kegiatan baru.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateBatchClick = async () => {
    setFormError(null);
    setIsBusy(true);
    try {
      await onCreateBatch(newBatchMode);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal membuat batch.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="screen-container">
      {/* Local storage status banner */}
      <div className="local-status-banner" role="status">
        <div className="local-status-banner__dot" aria-hidden="true" />
        <div>
          <strong>Data tersimpan di perangkat ini</strong>
          <span className="local-status-banner__sub">
            Belum disinkronkan ke server • Ekspor CSV/JSON secara berkala untuk cadangan di luar HP
          </span>
        </div>
      </div>

      {/* Active Event Card */}
      <section className="card event-header-card" aria-label="Informasi Kegiatan">
        {!editingEvent && !creatingEvent ? (
          <div>
            <div className="event-header-top">
              <div>
                <span className="eyebrow-label">KEGIATAN AKTIF</span>
                <h1 className="event-title">{activeEvent.name}</h1>
                <p className="event-meta">Tanggal: {activeEvent.eventDate}</p>
              </div>
              <div className="event-header-actions">
                <button
                  type="button"
                  className="btn btn--small btn--secondary"
                  onClick={() => {
                    setEventNameInput(activeEvent.name);
                    setEventDateInput(activeEvent.eventDate);
                    setFormError(null);
                    setEditingEvent(true);
                  }}
                >
                  Ubah Nama
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  onClick={() => {
                    const today = new Date().toISOString().slice(0, 10);
                    setEventNameInput('');
                    setEventDateInput(today);
                    setFormError(null);
                    setCreatingEvent(true);
                  }}
                >
                  + Kegiatan Baru
                </button>
              </div>
            </div>

            {allEvents.length > 1 && (
              <div className="event-switcher">
                <label htmlFor="event-select" className="field-label">
                  Pilih Kegiatan Tersimpan ({allEvents.length}):
                </label>
                <select
                  id="event-select"
                  className="select-input"
                  value={activeEvent.id}
                  onChange={(e) => void onSwitchEvent(e.target.value)}
                >
                  {allEvents.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name} ({ev.eventDate}){ev.id === activeEvent.id ? ' — Aktif' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ) : (
          <form
            onSubmit={editingEvent ? handleSaveEventEdit : handleCreateEventSubmit}
            className="event-form"
          >
            <h2 className="section-title">
              {editingEvent ? 'Ubah Nama & Tanggal Kegiatan' : 'Buat Kegiatan Baru'}
            </h2>
            {creatingEvent && (
              <p className="helper-text">
                Kegiatan sebelumnya tetap tersimpan dan tidak akan terhapus.
              </p>
            )}
            <div className="form-group">
              <label htmlFor="event-name-input" className="field-label">
                Nama Kegiatan
              </label>
              <input
                id="event-name-input"
                type="text"
                className="text-input"
                value={eventNameInput}
                onChange={(e) => setEventNameInput(e.target.value)}
                placeholder="Contoh: Lari Pagi Minggu"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label htmlFor="event-date-input" className="field-label">
                Tanggal Kegiatan
              </label>
              <input
                id="event-date-input"
                type="date"
                className="text-input"
                value={eventDateInput}
                onChange={(e) => setEventDateInput(e.target.value)}
              />
            </div>
            {formError && (
              <div className="inline-alert inline-alert--error" role="alert">
                {formError}
              </div>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  setEditingEvent(false);
                  setCreatingEvent(false);
                  setFormError(null);
                }}
              >
                Batal
              </button>
              <button type="submit" className="btn btn--primary" disabled={isBusy}>
                Simpan Kegiatan
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Active or Recovery-Required Batch Alert Card */}
      {activeOrRecoverableBatch && (
        <section
          className={`card active-batch-banner ${
            activeOrRecoverableBatch.recoveryRequired
              ? 'active-batch-banner--recovery'
              : activeOrRecoverableBatch.status === 'RUNNING'
              ? 'active-batch-banner--running'
              : 'active-batch-banner--draft'
          }`}
          aria-label="Status Batch Aktif"
        >
          <div className="active-batch-banner__header">
            <span className="status-pill status-pill--urgent">
              {getBatchStatusLabel(
                activeOrRecoverableBatch.status,
                activeOrRecoverableBatch.recoveryRequired
              )}
            </span>
            <span className="batch-mode-tag">
              {getRecordingModeLabel(activeOrRecoverableBatch.recordingMode)}
            </span>
          </div>
          <h2 className="active-batch-banner__title">
            Batch #{activeOrRecoverableBatch.batchNumber}
          </h2>
          <p className="active-batch-banner__meta">
            {activeOrRecoverableBatch.recoveryRequired
              ? 'Halaman dimuat ulang saat batch sedang berjalan. Ketuk tombol di bawah untuk memulihkan atau meninjau data.'
              : activeOrRecoverableBatch.status === 'RUNNING'
              ? `Mulai pukul ${formatWallClockTime(activeOrRecoverableBatch.startedAtWallClock)}`
              : activeOrRecoverableBatch.status === 'REVIEW'
              ? 'Batch menunggu penyelesaian tinjauan hasil.'
              : 'Sedang menyusun daftar nomor bib peserta di garis start.'}
          </p>
          <button
            type="button"
            className={`btn btn--large btn--block ${
              activeOrRecoverableBatch.recoveryRequired ? 'btn--warning' : 'btn--primary'
            }`}
            onClick={() => onOpenBatch(activeOrRecoverableBatch)}
          >
            {activeOrRecoverableBatch.recoveryRequired
              ? `Pulihkan Batch #${activeOrRecoverableBatch.batchNumber}`
              : `Lanjutkan Batch #${activeOrRecoverableBatch.batchNumber}`}
          </button>
        </section>
      )}

      {/* Summary Metrics Grid */}
      <section className="stats-grid" aria-label="Ringkasan Data Kegiatan">
        <div className="stat-card">
          <span className="stat-card__value">{completedBatchesCount}</span>
          <span className="stat-card__label">Batch Selesai</span>
          <span className="stat-card__sub">Total {batches.length} batch dibuat</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__value">{validFinishes.length}</span>
          <span className="stat-card__label">Catatan Finish</span>
          <span className="stat-card__sub">Total peserta: {allBibEntries.length}</span>
        </div>
        <div
          className={`stat-card ${
            unidentifiedFinishesCount > 0 ? 'stat-card--alert' : ''
          }`}
        >
          <span className="stat-card__value">{unidentifiedFinishesCount}</span>
          <span className="stat-card__label">Perlu Identifikasi / Cek</span>
          <span className="stat-card__sub">
            {unidentifiedFinishesCount > 0
              ? 'Perlu ditinjau operator'
              : 'Semua finish teridentifikasi'}
          </span>
        </div>
      </section>

      {/* Primary Action: Buat Batch Baru */}
      <section className="card create-batch-card" aria-label="Buat Batch Baru">
        <h2 className="section-title">Mulai Batch Baru</h2>
        <p className="helper-text">
          Pilih metode pencatatan finish untuk batch berikutnya:
        </p>

        <div className="mode-selector" role="radiogroup" aria-label="Mode Pencatatan Finish">
          <button
            type="button"
            role="radio"
            aria-checked={newBatchMode === 'TIMESTAMP_FIRST'}
            className={`mode-option ${
              newBatchMode === 'TIMESTAMP_FIRST' ? 'mode-option--selected' : ''
            }`}
            onClick={() => setNewBatchMode('TIMESTAMP_FIRST')}
          >
            <div className="mode-option__title">
              Catat Waktu Dulu (Disarankan)
            </div>
            <div className="mode-option__desc">
              Ketuk <strong>CATAT FINISH</strong> saat peserta lewat garis, lalu pilih nomor bib setelahnya. Aman untuk peserta ramai/berdekatan.
            </div>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={newBatchMode === 'DIRECT_CARD'}
            className={`mode-option ${
              newBatchMode === 'DIRECT_CARD' ? 'mode-option--selected' : ''
            }`}
            onClick={() => setNewBatchMode('DIRECT_CARD')}
          >
            <div className="mode-option__title">Ketuk Kartu Nomor Langsung</div>
            <div className="mode-option__desc">
              Ketuk kartu nomor bib peserta langsung saat finish. Cocok bila peserta sedikit dan nomor terlihat jelas dari jauh.
            </div>
          </button>
        </div>

        {formError && !editingEvent && !creatingEvent && (
          <div className="inline-alert inline-alert--error" role="alert">
            {formError}
          </div>
        )}

        <button
          type="button"
          className="btn btn--primary btn--large btn--block"
          disabled={Boolean(runningBatch) || isBusy}
          onClick={handleCreateBatchClick}
        >
          Buat Batch Baru (Batch #{batches.length + 1})
        </button>
        {runningBatch && (
          <p className="inline-note inline-note--warning">
            Batch #{runningBatch.batchNumber} masih sedang berjalan. Selesaikan atau tinjau Batch #{runningBatch.batchNumber} sebelum membuat batch baru.
          </p>
        )}
      </section>

      {/* Secondary Navigation Cards */}
      <section className="dashboard-secondary-actions" aria-label="Menu Hasil dan Backup">
        <button
          type="button"
          className="btn btn--secondary btn--large"
          onClick={onNavigateResults}
        >
          Lihat Hasil ({batches.length} Batch)
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--large"
          onClick={onNavigateExport}
        >
          Ekspor CSV / Backup JSON
        </button>
      </section>

      {/* Recent Batches Quick List */}
      {batches.length > 0 && (
        <section className="card" aria-label="Daftar Batch Terakhir">
          <h2 className="section-title">Daftar Batch Kegiatan Ini</h2>
          <div className="batch-quick-list">
            {batches.map((b) => {
              const bEntries = allBibEntries.filter((e) => e.batchId === b.id);
              const bFinishes = allFinishEvents.filter(
                (f) => f.batchId === b.id && f.status !== 'CANCELLED'
              );
              return (
                <div key={b.id} className="batch-quick-item">
                  <div>
                    <div className="batch-quick-item__title">
                      <strong>Batch #{b.batchNumber}</strong>{' '}
                      <span className={`status-badge status-badge--${b.status.toLowerCase()}`}>
                        {getBatchStatusLabel(b.status, b.recoveryRequired)}
                      </span>
                    </div>
                    <div className="batch-quick-item__meta">
                      {bEntries.length} peserta • {bFinishes.length} finish tercatat
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn--small btn--secondary"
                    onClick={() => onOpenBatch(b)}
                  >
                    Buka
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Measurement limitation note */}
      <footer className="limitation-footer">
        <strong>Catatan Operasional:</strong> Aplikasi ini mencatat waktu saat operator menekan tombol di layar HP, bukan sensor foto-finish otomatis. Data disimpan secara lokal di browser perangkat ini.
      </footer>
    </div>
  );
};
