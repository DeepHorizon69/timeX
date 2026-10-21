import React, { useMemo, useState } from 'react';
import {
  BatchBibEntry,
  BatchRecord,
  FinishEventRecord,
  ParticipantStatus,
} from '../domain/types';
import {
  formatElapsedMs,
  formatSequenceLabel,
  formatWallClockTime,
  getBatchStatusLabel,
  getFinishEventStatusLabel,
  getParticipantStatusLabel,
  parseElapsedString,
} from '../domain/utils';
import { BibBadge } from '../components/BibBadge';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface ReviewBatchScreenProps {
  batch: BatchRecord;
  roster: BatchBibEntry[];
  finishEvents: FinishEventRecord[];
  onIdentifyFinish: (
    finishEventId: string,
    batchBibEntryId: string,
    reason?: string
  ) => Promise<void>;
  onUnassignOrMarkFinish: (
    finishEventId: string,
    targetStatus: 'UNIDENTIFIED' | 'NEEDS_REVIEW',
    reason?: string
  ) => Promise<void>;
  onCancelFinish: (finishEventId: string, reason?: string) => Promise<void>;
  onCorrectFinishTime: (
    finishEventId: string,
    newElapsedMs: number,
    reason: string
  ) => Promise<void>;
  onMarkParticipantStatus: (
    batchBibEntryId: string,
    status: Exclude<ParticipantStatus, 'FINISHED'>,
    reason?: string
  ) => Promise<void>;
  onReturnToRunning: () => Promise<void>;
  onCompleteBatch: (notes?: string) => Promise<void>;
  onBackHome: () => void;
}

export const ReviewBatchScreen: React.FC<ReviewBatchScreenProps> = ({
  batch,
  roster,
  finishEvents,
  onIdentifyFinish,
  onUnassignOrMarkFinish,
  onCancelFinish,
  onCorrectFinishTime,
  onMarkParticipantStatus,
  onReturnToRunning,
  onCompleteBatch,
  onBackHome,
}) => {
  const [selectedFinishForBib, setSelectedFinishForBib] = useState<string | null>(
    null
  );
  const [reassignReason, setReassignReason] = useState<string>('');

  // Timestamp correction modal/inline state
  const [correctingTimeFinish, setCorrectingTimeFinish] =
    useState<FinishEventRecord | null>(null);
  const [newTimeInput, setNewTimeInput] = useState<string>('');
  const [timeCorrectionReason, setTimeCorrectionReason] = useState<string>('');

  // Completion & Reopen confirmation
  const [completionNotes, setCompletionNotes] = useState<string>(batch.notes ?? '');
  const [confirmCompleteOpen, setConfirmCompleteOpen] = useState<boolean>(false);
  const [confirmReopenOpen, setConfirmReopenOpen] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);

  const bibMap = useMemo(
    () => new Map<string, BatchBibEntry>(roster.map((r) => [r.id, r])),
    [roster]
  );

  const finishMap = useMemo(
    () => new Map<string, FinishEventRecord>(finishEvents.map((f) => [f.id, f])),
    [finishEvents]
  );

  // Ordered by sequence ascending for review clarity
  const orderedFinishEvents = useMemo(
    () => [...finishEvents].sort((a, b) => a.sequence - b.sequence),
    [finishEvents]
  );

  const activeFinishes = useMemo(
    () => orderedFinishEvents.filter((f) => f.status !== 'CANCELLED'),
    [orderedFinishEvents]
  );

  const identifiedCount = useMemo(
    () => activeFinishes.filter((f) => f.status === 'IDENTIFIED').length,
    [activeFinishes]
  );

  const unidentifiedFinishes = useMemo(
    () => activeFinishes.filter((f) => f.status === 'UNIDENTIFIED'),
    [activeFinishes]
  );

  const needsReviewFinishes = useMemo(
    () => activeFinishes.filter((f) => f.status === 'NEEDS_REVIEW'),
    [activeFinishes]
  );

  const waitingParticipants = useMemo(
    () => roster.filter((r) => r.status === 'WAITING'),
    [roster]
  );

  const specialStatusParticipants = useMemo(
    () =>
      roster.filter(
        (r) =>
          r.status === 'DNS' || r.status === 'DNF' || r.status === 'NEEDS_REVIEW'
      ),
    [roster]
  );

  // Detect closely spaced finish events (< 800ms apart) as a helpful data quality warning
  const closeFinishPairs = useMemo(() => {
    const pairs: string[] = [];
    for (let i = 1; i < activeFinishes.length; i++) {
      const prev = activeFinishes[i - 1];
      const curr = activeFinishes[i];
      const diff = Math.abs(curr.elapsedMs - prev.elapsedMs);
      if (diff <= 800) {
        pairs.push(
          `${formatSequenceLabel(prev.sequence)} & ${formatSequenceLabel(
            curr.sequence
          )} (selisih ${diff} ms)`
        );
      }
    }
    return pairs;
  }, [activeFinishes]);

  const dataQualityWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (unidentifiedFinishes.length > 0) {
      warnings.push(
        `Ada ${unidentifiedFinishes.length} catatan finish yang belum diidentifikasi. Pilih nomor bib, tandai Perlu Diperiksa, atau batalkan.`
      );
    }
    if (waitingParticipants.length > 0) {
      warnings.push(
        `Ada ${waitingParticipants.length} peserta yang masih berstatus Belum Finish (${waitingParticipants
          .map((w) => w.bibLabel)
          .join(', ')}). Hubungkan ke waktu finish atau tandai DNS / DNF / Perlu Diperiksa.`
      );
    }
    if (batch.timingSource === 'WALL_CLOCK_FALLBACK') {
      warnings.push(
        'Batch ini sempat menggunakan mode pemulihan jam perangkat (Wall-Clock Fallback) setelah halaman dimuat ulang.'
      );
    }
    if (closeFinishPairs.length > 0) {
      warnings.push(
        `Terdapat ketukan finish yang sangat berdekatan: ${closeFinishPairs.join(
          '; '
        )}. Pastikan urutan nomor bib sudah sesuai.`
      );
    }
    return warnings;
  }, [
    unidentifiedFinishes.length,
    waitingParticipants,
    batch.timingSource,
    closeFinishPairs,
  ]);

  const canCompleteBatch =
    unidentifiedFinishes.length === 0 && waitingParticipants.length === 0;

  const getAvailableBibsForFinish = (finishEventId: string) => {
    return roster.filter((entry) => {
      if (entry.finishEventId && entry.finishEventId !== finishEventId) {
        const linked = finishMap.get(entry.finishEventId);
        if (linked && linked.status !== 'CANCELLED') {
          return false;
        }
      }
      return true;
    });
  };

  const handleAssignBib = async (finishEventId: string, bibEntryId: string) => {
    setErrorMessage(null);
    setStatusMessage(null);
    setSelectedFinishForBib((prev) => (prev === finishEventId ? null : prev));
    setReassignReason('');
    setIsBusy(true);
    try {
      await onIdentifyFinish(
        finishEventId,
        bibEntryId,
        reassignReason.trim() || undefined
      );
      setStatusMessage('Identifikasi nomor bib berhasil disimpan.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Gagal menghubungkan nomor bib.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveTimeCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctingTimeFinish) return;
    setErrorMessage(null);
    setStatusMessage(null);

    const parsedMs = parseElapsedString(newTimeInput);
    if (parsedMs === null) {
      setErrorMessage(
        'Format waktu tidak valid. Gunakan format MM:SS.cc (contoh: 04:15.20) atau HH:MM:SS.cc.'
      );
      return;
    }
    if (!timeCorrectionReason.trim()) {
      setErrorMessage('Alasan koreksi waktu wajib diisi untuk catatan audit.');
      return;
    }

    setIsBusy(true);
    try {
      await onCorrectFinishTime(
        correctingTimeFinish.id,
        parsedMs,
        timeCorrectionReason.trim()
      );
      setCorrectingTimeFinish(null);
      setNewTimeInput('');
      setTimeCorrectionReason('');
      setStatusMessage('Koreksi waktu finish berhasil disimpan beserta log audit.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Gagal mengoreksi waktu finish.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleBulkMarkWaiting = async (
    targetStatus: 'DNF' | 'DNS' | 'NEEDS_REVIEW'
  ) => {
    setErrorMessage(null);
    setStatusMessage(null);
    setIsBusy(true);
    try {
      for (const p of waitingParticipants) {
        await onMarkParticipantStatus(
          p.id,
          targetStatus,
          `Ditandai ${targetStatus} saat peninjauan akhir batch`
        );
      }
      setStatusMessage(
        `Semua sisa peserta (${waitingParticipants.length}) berhasil ditandai ${targetStatus}.`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Gagal menandai status peserta.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleConfirmCompleteBatch = async () => {
    setConfirmCompleteOpen(false);
    setErrorMessage(null);
    setIsBusy(true);
    try {
      await onCompleteBatch(completionNotes);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Gagal menyelesaikan batch.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="screen-container screen-container--with-sticky-footer">
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
            <span className="sticky-top-bar__title">
              Tinjau Hasil Batch #{batch.batchNumber}
            </span>
            <span className="sticky-top-bar__sub">
              Status: {getBatchStatusLabel(batch.status, batch.recoveryRequired)}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--small btn--secondary"
          onClick={() => setConfirmReopenOpen(true)}
        >
          Kembali ke Stopwatch
        </button>
      </header>

      {/* Summary Counts */}
      <section className="stats-grid stats-grid--5" aria-label="Ringkasan Tinjauan Batch">
        <div className="stat-card">
          <span className="stat-card__value">{roster.length}</span>
          <span className="stat-card__label">Total Peserta</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__value">{identifiedCount}</span>
          <span className="stat-card__label">Teridentifikasi</span>
        </div>
        <div
          className={`stat-card ${
            unidentifiedFinishes.length > 0 ? 'stat-card--alert' : ''
          }`}
        >
          <span className="stat-card__value">{unidentifiedFinishes.length}</span>
          <span className="stat-card__label">Belum Identifikasi</span>
        </div>
        <div
          className={`stat-card ${
            waitingParticipants.length > 0 ? 'stat-card--alert' : ''
          }`}
        >
          <span className="stat-card__value">{waitingParticipants.length}</span>
          <span className="stat-card__label">Belum Finish</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__value">
            {specialStatusParticipants.length + needsReviewFinishes.length}
          </span>
          <span className="stat-card__label">DNS / DNF / Cek</span>
        </div>
      </section>

      {/* Data Quality Warnings */}
      {dataQualityWarnings.length > 0 ? (
        <section className="card warning-card" aria-label="Peringatan Kualitas Data">
          <h2 className="section-title">Perhatian Sebelum Menyelesaikan Batch</h2>
          <ul className="warning-list">
            {dataQualityWarnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="card success-card" role="status">
          <strong>✓ Semua catatan finish dan peserta sudah memiliki status jelas.</strong>{' '}
          Batch #{batch.batchNumber} siap diselesaikan.
        </section>
      )}

      {errorMessage && (
        <div className="inline-alert inline-alert--error" role="alert">
          {errorMessage}
        </div>
      )}

      {statusMessage && (
        <div className="inline-alert inline-alert--success" role="status">
          {statusMessage}
        </div>
      )}

      {/* Section 1: Finish Events Review & Identification */}
      <section className="card" aria-label="Daftar Catatan Waktu Finish">
        <h2 className="section-title">
          1. Catatan Waktu Finish ({orderedFinishEvents.length})
        </h2>
        {orderedFinishEvents.length === 0 ? (
          <div className="empty-state">
            Tidak ada catatan waktu finish pada batch ini.
          </div>
        ) : (
          <ul className="finish-queue-list">
            {orderedFinishEvents.map((fin) => {
              const assignedBib = fin.batchBibEntryId
                ? bibMap.get(fin.batchBibEntryId)
                : undefined;
              const isSelectingBib = selectedFinishForBib === fin.id;
              const isCorrectingTime = correctingTimeFinish?.id === fin.id;
              const availableBibs = isSelectingBib
                ? getAvailableBibsForFinish(fin.id)
                : [];

              return (
                <li
                  key={fin.id}
                  className={`finish-queue-item finish-queue-item--${fin.status.toLowerCase()}`}
                >
                  <div className="finish-queue-item__main">
                    <div className="finish-queue-item__left">
                      <span className="finish-seq-badge">
                        {formatSequenceLabel(fin.sequence)}
                      </span>
                      <div>
                        <div className="finish-elapsed-time">
                          {formatElapsedMs(fin.elapsedMs)}
                        </div>
                        <div className="finish-wall-time">
                          Jam: {formatWallClockTime(fin.recordedAtWallClock)}
                          {fin.correctionHistory.length > 0 && (
                            <span className="audit-tag">
                              • {fin.correctionHistory.length}x dikoreksi
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="finish-queue-item__right">
                      {assignedBib ? (
                        <BibBadge
                          color={assignedBib.bibColor}
                          number={assignedBib.bibNumber}
                          size="md"
                        />
                      ) : (
                        <span
                          className={`status-badge status-badge--${fin.status.toLowerCase()}`}
                        >
                          {getFinishEventStatusLabel(fin.status)}
                        </span>
                      )}

                      {fin.status !== 'CANCELLED' && (
                        <div className="finish-review-btn-group">
                          <button
                            type="button"
                            className="btn btn--small btn--primary"
                            onClick={() => {
                              setSelectedFinishForBib(isSelectingBib ? null : fin.id);
                              setReassignReason('');
                            }}
                          >
                            {assignedBib ? 'Ganti Nomor' : 'Pilih Nomor'}
                          </button>
                          <button
                            type="button"
                            className="btn btn--small btn--secondary"
                            onClick={() => {
                              if (isCorrectingTime) {
                                setCorrectingTimeFinish(null);
                              } else {
                                setCorrectingTimeFinish(fin);
                                setNewTimeInput(formatElapsedMs(fin.elapsedMs));
                                setTimeCorrectionReason('');
                              }
                            }}
                          >
                            Koreksi Waktu
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Inline Bib Selection / Reassignment */}
                  {isSelectingBib && (
                    <div className="inline-identify-drawer">
                      <div className="inline-identify-drawer__header">
                        <strong>
                          Hubungkan {formatSequenceLabel(fin.sequence)} ke Nomor Bib:
                        </strong>
                      </div>
                      {assignedBib && (
                        <div className="form-group">
                          <label className="field-label">
                            Alasan koreksi nomor bib (opsional, dicatat di audit):
                          </label>
                          <input
                            type="text"
                            className="text-input text-input--compact"
                            placeholder="Misal: Tertukar urutan saat finish"
                            value={reassignReason}
                            onChange={(e) => setReassignReason(e.target.value)}
                          />
                        </div>
                      )}
                      {availableBibs.length === 0 ? (
                        <p className="helper-text">
                          Semua peserta sudah terhubung ke waktu finish lain. Lepaskan salah satu peserta terlebih dahulu jika ingin menukar.
                        </p>
                      ) : (
                        <div className="identify-bib-grid">
                          {availableBibs.map((entry) => (
                            <button
                              key={entry.id}
                              type="button"
                              className="identify-bib-choice"
                              disabled={isBusy}
                              onClick={() => void handleAssignBib(fin.id, entry.id)}
                            >
                              <BibBadge
                                color={entry.bibColor}
                                number={entry.bibNumber}
                                size="md"
                              />
                              <span className="identify-bib-choice__status">
                                {getParticipantStatusLabel(entry.status)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="inline-identify-drawer__footer">
                        {assignedBib && (
                          <button
                            type="button"
                            className="btn btn--small btn--secondary"
                            onClick={() => {
                              void onUnassignOrMarkFinish(
                                fin.id,
                                'UNIDENTIFIED',
                                reassignReason || 'Melepaskan nomor bib saat tinjauan'
                              );
                              setSelectedFinishForBib(null);
                            }}
                          >
                            Lepaskan Nomor {assignedBib.bibLabel}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn--small btn--warning"
                          onClick={() => {
                            void onUnassignOrMarkFinish(
                              fin.id,
                              'NEEDS_REVIEW',
                              reassignReason || 'Ditandai Perlu Diperiksa saat tinjauan'
                            );
                            setSelectedFinishForBib(null);
                          }}
                        >
                          Tandai Perlu Diperiksa
                        </button>
                        <button
                          type="button"
                          className="btn btn--small btn--danger-outline"
                          onClick={() => {
                            void onCancelFinish(
                              fin.id,
                              reassignReason || 'Dibatalkan saat tinjauan batch'
                            );
                            setSelectedFinishForBib(null);
                          }}
                        >
                          Batalkan Finish Ini
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Inline Timestamp Correction Form */}
                  {isCorrectingTime && (
                    <form
                      onSubmit={handleSaveTimeCorrection}
                      className="inline-identify-drawer"
                    >
                      <h4>
                        Koreksi Waktu Tempuh {formatSequenceLabel(fin.sequence)} (Tercatat di Audit)
                      </h4>
                      <div className="roster-edit-row">
                        <div>
                          <label className="field-label">
                            Waktu Baru (MM:SS.cc):
                          </label>
                          <input
                            type="text"
                            className="text-input"
                            value={newTimeInput}
                            onChange={(e) => setNewTimeInput(e.target.value)}
                            placeholder="05:12.34"
                          />
                        </div>
                        <div>
                          <label className="field-label">
                            Alasan Koreksi (Wajib):
                          </label>
                          <input
                            type="text"
                            className="text-input"
                            value={timeCorrectionReason}
                            onChange={(e) => setTimeCorrectionReason(e.target.value)}
                            placeholder="Misal: Terlambat menekan tombol"
                            required
                          />
                        </div>
                      </div>
                      <div className="roster-edit-actions">
                        <button
                          type="button"
                          className="btn btn--small btn--secondary"
                          onClick={() => setCorrectingTimeFinish(null)}
                        >
                          Batal
                        </button>
                        <button
                          type="submit"
                          className="btn btn--small btn--primary"
                          disabled={isBusy}
                        >
                          Simpan Koreksi Waktu
                        </button>
                      </div>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Section 2: Roster & Participant Statuses (DNS / DNF / NEEDS_REVIEW) */}
      <section className="card" aria-label="Status Semua Peserta Batch">
        <div className="section-header-row">
          <h2 className="section-title">
            2. Status Peserta ({roster.length} Peserta)
          </h2>
          {waitingParticipants.length > 0 && (
            <div className="bulk-status-actions">
              <button
                type="button"
                className="btn btn--small btn--secondary"
                disabled={isBusy}
                onClick={() => void handleBulkMarkWaiting('DNF')}
              >
                Tandai Semua Sisa ({waitingParticipants.length}) DNF
              </button>
              <button
                type="button"
                className="btn btn--small btn--ghost"
                disabled={isBusy}
                onClick={() => void handleBulkMarkWaiting('DNS')}
              >
                Tandai Sisa DNS
              </button>
            </div>
          )}
        </div>

        <ul className="roster-list">
          {roster.map((entry) => {
            const linkedFinish = entry.finishEventId
              ? finishMap.get(entry.finishEventId)
              : undefined;
            return (
              <li key={entry.id} className="roster-item">
                <div className="roster-item__content">
                  <div className="roster-item__left">
                    <BibBadge
                      color={entry.bibColor}
                      number={entry.bibNumber}
                      size="md"
                    />
                    <div>
                      <div className="roster-item__status-line">
                        <span
                          className={`status-badge status-badge--${entry.status.toLowerCase()}`}
                        >
                          {getParticipantStatusLabel(entry.status)}
                        </span>
                        {linkedFinish && (
                          <span className="roster-item__time-badge">
                            {formatSequenceLabel(linkedFinish.sequence)} •{' '}
                            <strong>{formatElapsedMs(linkedFinish.elapsedMs)}</strong>
                          </span>
                        )}
                      </div>
                      {entry.participantName && (
                        <div className="roster-item__name">
                          {entry.participantName}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="participant-status-controls">
                    <button
                      type="button"
                      className={`btn btn--small ${
                        entry.status === 'DNS' ? 'btn--warning' : 'btn--ghost'
                      }`}
                      onClick={() =>
                        void onMarkParticipantStatus(
                          entry.id,
                          'DNS',
                          'Ditandai DNS oleh operator'
                        )
                      }
                    >
                      DNS
                    </button>
                    <button
                      type="button"
                      className={`btn btn--small ${
                        entry.status === 'DNF' ? 'btn--warning' : 'btn--ghost'
                      }`}
                      onClick={() =>
                        void onMarkParticipantStatus(
                          entry.id,
                          'DNF',
                          'Ditandai DNF oleh operator'
                        )
                      }
                    >
                      DNF
                    </button>
                    <button
                      type="button"
                      className={`btn btn--small ${
                        entry.status === 'NEEDS_REVIEW'
                          ? 'btn--warning'
                          : 'btn--ghost'
                      }`}
                      onClick={() =>
                        void onMarkParticipantStatus(
                          entry.id,
                          'NEEDS_REVIEW',
                          'Ditandai Perlu Diperiksa oleh operator'
                        )
                      }
                    >
                      Perlu Cek
                    </button>
                    {entry.status !== 'WAITING' && entry.status !== 'FINISHED' && (
                      <button
                        type="button"
                        className="btn btn--small btn--secondary"
                        onClick={() =>
                          void onMarkParticipantStatus(
                            entry.id,
                            'WAITING',
                            'Dikembalikan ke status Belum Finish'
                          )
                        }
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Notes before completing */}
      <section className="card" aria-label="Catatan Penutup Batch">
        <label htmlFor="batch-notes-input" className="field-label">
          Catatan Batch #{batch.batchNumber} (Opsional):
        </label>
        <input
          id="batch-notes-input"
          type="text"
          className="text-input"
          placeholder="Contoh: Cuaca cerah, 1 peserta DNF di putaran akhir"
          value={completionNotes}
          onChange={(e) => setCompletionNotes(e.target.value)}
        />
      </section>

      {/* Bottom Sticky Complete Action */}
      <div className="sticky-bottom-bar">
        <div className="sticky-bottom-bar__summary">
          <span>
            {canCompleteBatch
              ? 'Semua data siap diselesaikan'
              : `${unidentifiedFinishes.length} finish belum identifikasi • ${waitingParticipants.length} peserta belum berstatus`}
          </span>
        </div>
        <button
          type="button"
          className="btn btn--primary btn--large btn--block"
          disabled={!canCompleteBatch || isBusy}
          onClick={() => setConfirmCompleteOpen(true)}
        >
          Selesaikan Batch #{batch.batchNumber}
        </button>
      </div>

      {/* Confirm Complete Batch */}
      <ConfirmDialog
        open={confirmCompleteOpen}
        title={`Selesaikan & Kunci Batch #${batch.batchNumber}?`}
        description={
          <div>
            <p>
              Batch #{batch.batchNumber} akan ditandai selesai dan disimpan ke riwayat hasil.
            </p>
            <ul className="dialog-summary-list">
              <li>Finish Teridentifikasi: {identifiedCount} peserta</li>
              <li>DNS / DNF / Perlu Cek: {specialStatusParticipants.length} peserta</li>
            </ul>
            <p className="helper-text">
              Anda tetap dapat mengekspor CSV atau melakukan koreksi teraudit dari menu Lihat Hasil kapan saja.
            </p>
          </div>
        }
        confirmLabel="Ya, Selesaikan Batch"
        cancelLabel="Batal"
        variant="primary"
        onConfirm={() => void handleConfirmCompleteBatch()}
        onCancel={() => setConfirmCompleteOpen(false)}
      />

      {/* Confirm Reopen Batch */}
      <ConfirmDialog
        open={confirmReopenOpen}
        title={`Kembalikan Batch #${batch.batchNumber} ke Layar Stopwatch?`}
        description={
          <p>
            Batch akan kembali ke layar pencatatan finish (RUNNING). Semua waktu finish yang sudah tercatat tetap aman.
          </p>
        }
        confirmLabel="Kembali ke Stopwatch"
        cancelLabel="Batal"
        variant="warning"
        onConfirm={() => {
          setConfirmReopenOpen(false);
          void onReturnToRunning();
        }}
        onCancel={() => setConfirmReopenOpen(false)}
      />
    </div>
  );
};
