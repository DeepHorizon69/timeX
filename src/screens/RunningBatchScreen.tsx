import React, { useMemo, useState } from 'react';
import {
  BatchBibEntry,
  BatchRecord,
  BibColor,
  FinishEventRecord,
  RecordingMode,
  TimingSource,
} from '../domain/types';
import {
  BIB_COLOR_MAP,
  BIB_COLORS,
  formatElapsedMs,
  formatSequenceLabel,
  formatWallClockDateTime,
  formatWallClockTime,
  getFinishEventStatusLabel,
  getParticipantStatusLabel,
  matchesBibQuery,
} from '../domain/utils';
import {
  CapturedFinishTiming,
  captureFinishTimingNow,
  useBatchLiveTimer,
  useScreenWakeLock,
} from '../services/timekeeper';
import { BibBadge } from '../components/BibBadge';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface PendingFailedFinish extends CapturedFinishTiming {
  tempId: string;
  targetBibEntryId?: string;
  errorMessage: string;
}

interface RunningBatchScreenProps {
  batch: BatchRecord;
  roster: BatchBibEntry[];
  finishEvents: FinishEventRecord[];
  onRecordTimestampFinish: (timing: CapturedFinishTiming) => Promise<FinishEventRecord>;
  onRecordDirectCardFinish: (
    batchBibEntryId: string,
    timing: CapturedFinishTiming
  ) => Promise<void>;
  onIdentifyFinish: (
    finishEventId: string,
    batchBibEntryId: string,
    reason?: string
  ) => Promise<void>;
  onMarkFinishNeedsReview: (finishEventId: string, notes?: string) => Promise<void>;
  onCancelFinishEvent: (finishEventId: string, reason?: string) => Promise<void>;
  onResumeRecoveryFallback: () => Promise<void>;
  onMarkRecoveryNeedsReview: () => Promise<void>;
  onMoveToReview: () => Promise<void>;
  onChangeModeMidBatch: (newMode: RecordingMode, reason: string) => Promise<void>;
  onAddEmergencyBib: (
    bibColor: BibColor,
    bibNumber: number,
    reason: string
  ) => Promise<void>;
  onNavigateExport: () => void;
  onBackHome: () => void;
}

export const RunningBatchScreen: React.FC<RunningBatchScreenProps> = ({
  batch,
  roster,
  finishEvents,
  onRecordTimestampFinish,
  onRecordDirectCardFinish,
  onIdentifyFinish,
  onMarkFinishNeedsReview,
  onCancelFinishEvent,
  onResumeRecoveryFallback,
  onMarkRecoveryNeedsReview,
  onMoveToReview,
  onChangeModeMidBatch,
  onAddEmergencyBib,
  onNavigateExport,
  onBackHome,
}) => {
  const liveElapsedMs = useBatchLiveTimer(batch);
  const wakeLock = useScreenWakeLock(batch.status === 'RUNNING' && !batch.recoveryRequired);

  // Active sub-tab in TIMESTAMP_FIRST mode
  const [activeSubView, setActiveSubView] = useState<'QUEUE' | 'ROSTER'>('QUEUE');

  // Inline identification state for a finish event
  const [identifyingFinishId, setIdentifyingFinishId] = useState<string | null>(null);
  const [identifySearchQuery, setIdentifySearchQuery] = useState<string>('');
  const [identifyColorFilter, setIdentifyColorFilter] = useState<BibColor | 'ALL'>('ALL');

  // Direct card search/filter state
  const [cardSearchQuery, setCardSearchQuery] = useState<string>('');
  const [cardColorFilter, setCardColorFilter] = useState<BibColor | 'ALL'>('ALL');

  // Confirmation dialogs
  const [confirmUndoFinish, setConfirmUndoFinish] = useState<FinishEventRecord | null>(
    null
  );
  const [confirmEndBatchOpen, setConfirmEndBatchOpen] = useState<boolean>(false);
  const [confirmSwitchModeTarget, setConfirmSwitchModeTarget] =
    useState<RecordingMode | null>(null);

  // Emergency add bib panel
  const [showEmergencyPanel, setShowEmergencyPanel] = useState<boolean>(false);
  const [emergColor, setEmergColor] = useState<BibColor>('WHITE');
  const [emergNumber, setEmergNumber] = useState<string>('');
  const [emergReason, setEmergReason] = useState<string>('');

  // Status feedback & storage failure retry queue
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingFailedFinishes, setPendingFailedFinishes] = useState<
    PendingFailedFinish[]
  >([]);
  const [isRetryingSave, setIsRetryingSave] = useState<boolean>(false);

  const bibMap = useMemo(() => {
    const map = new Map<string, BatchBibEntry>();
    for (const r of roster) {
      map.set(r.id, r);
    }
    return map;
  }, [roster]);

  const finishMap = useMemo(() => {
    const map = new Map<string, FinishEventRecord>();
    for (const f of finishEvents) {
      map.set(f.id, f);
    }
    return map;
  }, [finishEvents]);

  const activeFinishes = useMemo(
    () => finishEvents.filter((f) => f.status !== 'CANCELLED'),
    [finishEvents]
  );

  const identifiedFinishesCount = useMemo(
    () => activeFinishes.filter((f) => f.status === 'IDENTIFIED').length,
    [activeFinishes]
  );

  const unidentifiedFinishesCount = useMemo(
    () =>
      activeFinishes.filter(
        (f) => f.status === 'UNIDENTIFIED' || f.status === 'NEEDS_REVIEW'
      ).length,
    [activeFinishes]
  );

  const waitingParticipants = useMemo(
    () => roster.filter((r) => r.status === 'WAITING'),
    [roster]
  );

  // Available bibs for identifying a finish event:
  // Exclude participants already linked to another non-cancelled finish event
  const getAvailableBibsForFinish = (targetFinishEventId: string) => {
    return roster.filter((entry) => {
      if (entry.finishEventId && entry.finishEventId !== targetFinishEventId) {
        const linkedFin = finishMap.get(entry.finishEventId);
        if (linkedFin && linkedFin.status !== 'CANCELLED') {
          return false;
        }
      }
      if (identifyColorFilter !== 'ALL' && entry.bibColor !== identifyColorFilter) {
        return false;
      }
      if (!matchesBibQuery(entry, identifySearchQuery)) {
        return false;
      }
      return true;
    });
  };

  // Last non-cancelled finish event (for "Urungkan Finish Terakhir")
  const latestActiveFinish = activeFinishes[0] ?? null;

  // Immediate timestamp-first tap handler
  const handleTimestampFinishTap = async () => {
    // STEP 1: Capture monotonic & wall-clock timestamps immediately before any async work
    const captured = captureFinishTimingNow(batch);
    setActionError(null);

    try {
      const saved = await onRecordTimestampFinish(captured);
      setFeedbackToast(
        `${formatSequenceLabel(saved.sequence)} tercatat (${formatElapsedMs(
          saved.elapsedMs
        )})`
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Gagal menyimpan catatan finish ke penyimpanan perangkat!';
      setActionError(msg);
      setPendingFailedFinishes((prev) => [
        ...prev,
        {
          ...captured,
          tempId: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          errorMessage: msg,
        },
      ]);
    }
  };

  // Immediate direct-card tap handler
  const handleDirectCardTap = async (entry: BatchBibEntry) => {
    setActionError(null);

    // Prevent duplicate finish taps on an already finished card
    if (entry.status === 'FINISHED' && entry.finishEventId) {
      const linked = finishMap.get(entry.finishEventId);
      if (linked && linked.status !== 'CANCELLED') {
        setConfirmUndoFinish(linked);
        return;
      }
    }

    // STEP 1: Capture monotonic & wall-clock timestamps immediately
    const captured = captureFinishTimingNow(batch);

    try {
      await onRecordDirectCardFinish(entry.id, captured);
      setFeedbackToast(
        `${entry.bibLabel} finish (${formatElapsedMs(captured.elapsedMs)})`
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : `Gagal menyimpan finish untuk ${entry.bibLabel}!`;
      setActionError(msg);
      setPendingFailedFinishes((prev) => [
        ...prev,
        {
          ...captured,
          tempId: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          targetBibEntryId: entry.id,
          errorMessage: msg,
        },
      ]);
    }
  };

  const handleRetryFailedSaves = async () => {
    if (pendingFailedFinishes.length === 0) return;
    setIsRetryingSave(true);
    setActionError(null);

    const remaining: PendingFailedFinish[] = [];
    for (const item of pendingFailedFinishes) {
      try {
        const timing: CapturedFinishTiming = {
          recordedAtMonotonicMs: item.recordedAtMonotonicMs,
          recordedAtWallClock: item.recordedAtWallClock,
          elapsedMs: item.elapsedMs,
          timingSource: item.timingSource as TimingSource,
        };
        if (item.targetBibEntryId) {
          await onRecordDirectCardFinish(item.targetBibEntryId, timing);
        } else {
          await onRecordTimestampFinish(timing);
        }
      } catch (err) {
        remaining.push({
          ...item,
          errorMessage:
            err instanceof Error ? err.message : 'Masih gagal menyimpan ke perangkat',
        });
      }
    }

    setPendingFailedFinishes(remaining);
    setIsRetryingSave(false);
    if (remaining.length === 0) {
      setFeedbackToast('Semua catatan finish yang tertunda berhasil disimpan!');
    } else {
      setActionError(
        `Masih ada ${remaining.length} catatan finish yang gagal disimpan. Periksa ruang penyimpanan browser.`
      );
    }
  };

  const handleAssignBibToFinish = async (finishEventId: string, bibEntryId: string) => {
    setActionError(null);
    setIdentifyingFinishId((prev) => (prev === finishEventId ? null : prev));
    setIdentifySearchQuery('');
    setIdentifyColorFilter('ALL');
    try {
      await onIdentifyFinish(finishEventId, bibEntryId);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Gagal menghubungkan nomor bib.'
      );
    }
  };

  const handleMarkNeedsReviewClick = async (finishEventId: string) => {
    setActionError(null);
    setIdentifyingFinishId((prev) => (prev === finishEventId ? null : prev));
    try {
      await onMarkFinishNeedsReview(
        finishEventId,
        'Urutan atau identitas belum pasti saat melintasi garis finish'
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Gagal menandai Perlu Diperiksa.'
      );
    }
  };

  const handleConfirmCancelFinish = async () => {
    if (!confirmUndoFinish) return;
    setActionError(null);
    try {
      await onCancelFinishEvent(
        confirmUndoFinish.id,
        'Dibatalkan oleh operator (Urungkan finish)'
      );
      setFeedbackToast(
        `${formatSequenceLabel(confirmUndoFinish.sequence)} telah dibatalkan.`
      );
      setConfirmUndoFinish(null);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Gagal membatalkan catatan finish.'
      );
    }
  };

  const handleEmergencyBibSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    const num = parseInt(emergNumber.trim(), 10);
    if (!/^\d+$/.test(emergNumber.trim()) || num < 1 || num > 50) {
      setActionError('Nomor bib susulan harus berupa angka 1–50.');
      return;
    }
    try {
      await onAddEmergencyBib(
        emergColor,
        num,
        emergReason.trim() || 'Penambahan peserta susulan saat batch berjalan'
      );
      setEmergNumber('');
      setEmergReason('');
      setShowEmergencyPanel(false);
      setFeedbackToast('Peserta susulan berhasil ditambahkan dan dicatat di log audit.');
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Gagal menambahkan peserta susulan.'
      );
    }
  };

  // Filtered roster for Direct Card mode
  const filteredDirectCards = useMemo(() => {
    return roster.filter((entry) => {
      if (cardColorFilter !== 'ALL' && entry.bibColor !== cardColorFilter) {
        return false;
      }
      return matchesBibQuery(entry, cardSearchQuery);
    });
  }, [roster, cardColorFilter, cardSearchQuery]);

  // ============================================================================
  // RECOVERY WORKFLOW SCREEN (when page reloads while batch is RUNNING)
  // ============================================================================
  if (batch.recoveryRequired) {
    const lastSavedFinish = activeFinishes[0];
    return (
      <div className="screen-container">
        <header className="sticky-top-bar">
          <button type="button" className="btn btn--small btn--ghost" onClick={onBackHome}>
            ← Beranda
          </button>
          <span className="status-pill status-pill--urgent">Pemulihan Batch</span>
        </header>

        <section className="card recovery-card" role="alert">
          <h1 className="recovery-card__title">
            Pulihkan Batch #{batch.batchNumber}
          </h1>
          <p className="recovery-card__lead">
            Halaman browser dimuat ulang atau dibuka kembali saat{' '}
            <strong>Batch #{batch.batchNumber}</strong> sedang berjalan.
          </p>
          <div className="recovery-warning-box">
            <strong>Mengapa muncul peringatan ini?</strong>
            <p>
              Pengukur waktu presisi (monotonic timer) terputus saat halaman dimuat ulang. Aplikasi tidak melanjutkan timer secara diam-diam agar akurasi waktu tidak diklaim secara keliru.
            </p>
          </div>

          <div className="recovery-facts">
            <div className="recovery-fact-row">
              <span>Waktu Mulai Batch (Jam Perangkat):</span>
              <strong>{formatWallClockDateTime(batch.startedAtWallClock)}</strong>
            </div>
            <div className="recovery-fact-row">
              <span>Jumlah Peserta Terdaftar:</span>
              <strong>{roster.length} peserta</strong>
            </div>
            <div className="recovery-fact-row">
              <span>Catatan Finish Tersimpan:</span>
              <strong>
                {activeFinishes.length} finish ({identifiedFinishesCount} teridentifikasi)
              </strong>
            </div>
            <div className="recovery-fact-row">
              <span>Finish Terakhir Tersimpan:</span>
              <strong>
                {lastSavedFinish
                  ? `${formatSequenceLabel(lastSavedFinish.sequence)} — ${formatElapsedMs(
                      lastSavedFinish.elapsedMs
                    )} (${formatWallClockTime(lastSavedFinish.recordedAtWallClock)})`
                  : 'Belum ada finish tercatat'}
              </strong>
            </div>
          </div>

          {actionError && (
            <div className="inline-alert inline-alert--error" role="alert">
              {actionError}
            </div>
          )}

          <div className="recovery-actions">
            <button
              type="button"
              className="btn btn--warning btn--large btn--block"
              onClick={() => void onResumeRecoveryFallback()}
            >
              Lanjutkan Batch dengan Jam Perangkat (Fallback)
            </button>
            <p className="helper-text">
              * Menggunakan selisih waktu jam perangkat terhadap waktu mulai ({formatWallClockTime(batch.startedAtWallClock)}). Perubahan pengaturan jam HP dapat memengaruhi hasil. Semua finish yang sudah tersimpan sebelumnya tetap utuh.
            </p>

            <button
              type="button"
              className="btn btn--primary btn--large btn--block"
              onClick={() => void onMarkRecoveryNeedsReview()}
            >
              Tandai Perlu Diperiksa & Tinjau Hasil Batch
            </button>

            <button
              type="button"
              className="btn btn--secondary btn--large btn--block"
              onClick={onNavigateExport}
            >
              Ekspor / Backup Data Saat Ini Terlebih Dahulu
            </button>
          </div>
        </section>
      </div>
    );
  }

  // ============================================================================
  // NORMAL RUNNING SCREEN
  // ============================================================================
  return (
    <div
      className={`screen-container ${
        batch.recordingMode === 'TIMESTAMP_FIRST'
          ? 'screen-container--with-finish-dock'
          : ''
      }`}
    >
      {/* Sticky Header with Batch & Live Stopwatch */}
      <header className="running-sticky-header" aria-label="Stopwatch dan Status Batch">
        <div className="running-header-top">
          <div className="running-header-top__left">
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={onBackHome}
            >
              ← Beranda
            </button>
            <span className="running-batch-badge">BATCH #{batch.batchNumber}</span>
            <span className="status-pill status-pill--running">RUNNING</span>
          </div>

          <button
            type="button"
            className="btn btn--small btn--review-Action"
            onClick={() => setConfirmEndBatchOpen(true)}
          >
            Tinjau Hasil →
          </button>
        </div>

        {/* Live Stopwatch Display */}
        <div className="stopwatch-display" role="timer" aria-live="off">
          <div className="stopwatch-display__time">
            {formatElapsedMs(liveElapsedMs)}
          </div>
          <div className="stopwatch-display__meta">
            <span>
              Mulai: {formatWallClockTime(batch.startedAtWallClock)}
            </span>
            <span>•</span>
            <span>
              {batch.timingSource === 'WALL_CLOCK_FALLBACK'
                ? 'Mode Fallback Jam Perangkat'
                : 'Timer Monotonik Aktif'}
            </span>
            <span>•</span>
            <span>
              {pendingFailedFinishes.length === 0
                ? '✓ Tersimpan di perangkat'
                : '⚠ Gagal Simpan!'}
            </span>
          </div>
        </div>

        {/* Compact Live Counters */}
        <div className="running-counters-strip">
          <div className="running-counter">
            <span className="running-counter__val">{roster.length}</span>
            <span className="running-counter__lbl">Peserta</span>
          </div>
          <div className="running-counter">
            <span className="running-counter__val">{activeFinishes.length}</span>
            <span className="running-counter__lbl">Finish</span>
          </div>
          <div className="running-counter">
            <span className="running-counter__val">{identifiedFinishesCount}</span>
            <span className="running-counter__lbl">Teridentifikasi</span>
          </div>
          <div
            className={`running-counter ${
              unidentifiedFinishesCount > 0 ? 'running-counter--highlight' : ''
            }`}
          >
            <span className="running-counter__val">{unidentifiedFinishesCount}</span>
            <span className="running-counter__lbl">Belum Identifikasi</span>
          </div>
          <div className="running-counter">
            <span className="running-counter__val">{waitingParticipants.length}</span>
            <span className="running-counter__lbl">Belum Finish</span>
          </div>
        </div>
      </header>

      {/* Blocking Storage Write Failure Banner (if IndexedDB write ever fails) */}
      {pendingFailedFinishes.length > 0 && (
        <section className="blocking-storage-error" role="alert">
          <h3>
            PERINGATAN KRITIS: {pendingFailedFinishes.length} Catatan Finish Belum Tersimpan ke Penyimpanan!
          </h3>
          <p>
            Waktu ketukan sudah diamankan di memori sementara halaman ini. Jangan muat ulang halaman! Tekan tombol di bawah untuk menyimpan ulang ke perangkat.
          </p>
          <button
            type="button"
            className="btn btn--danger btn--large btn--block"
            disabled={isRetryingSave}
            onClick={() => void handleRetryFailedSaves()}
          >
            {isRetryingSave
              ? 'Menyimpan Ulang...'
              : `Simpan Ulang Sekarang (${pendingFailedFinishes.length} Catatan)`}
          </button>
        </section>
      )}

      {actionError && pendingFailedFinishes.length === 0 && (
        <div className="inline-alert inline-alert--error" role="alert">
          {actionError}
        </div>
      )}

      {feedbackToast && !actionError && (
        <div className="toast-banner" role="status">
          <span>{feedbackToast}</span>
          {latestActiveFinish && batch.recordingMode === 'TIMESTAMP_FIRST' && (
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={() => setConfirmUndoFinish(latestActiveFinish)}
            >
              Urungkan {formatSequenceLabel(latestActiveFinish.sequence)}
            </button>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODE B: TIMESTAMP-FIRST WORKFLOW                                     */}
      {/* ==================================================================== */}
      {batch.recordingMode === 'TIMESTAMP_FIRST' && (
        <>
          {/* Sub-navigation between Finish Queue and Roster */}
          <div className="subview-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeSubView === 'QUEUE'}
              className={`subview-tab ${
                activeSubView === 'QUEUE' ? 'subview-tab--active' : ''
              }`}
              onClick={() => setActiveSubView('QUEUE')}
            >
              Antrean Finish ({activeFinishes.length})
              {unidentifiedFinishesCount > 0 && (
                <span className="tab-badge">{unidentifiedFinishesCount} belum</span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeSubView === 'ROSTER'}
              className={`subview-tab ${
                activeSubView === 'ROSTER' ? 'subview-tab--active' : ''
              }`}
              onClick={() => setActiveSubView('ROSTER')}
            >
              Daftar Peserta ({waitingParticipants.length} sisa)
            </button>
          </div>

          {activeSubView === 'QUEUE' ? (
            <section className="card" aria-label="Antrean Catatan Waktu Finish">
              <div className="section-header-row">
                <h2 className="section-title">
                  Urutan Ketukan Finish (Terbaru di Atas)
                </h2>
                {latestActiveFinish && (
                  <button
                    type="button"
                    className="btn btn--small btn--danger-outline"
                    onClick={() => setConfirmUndoFinish(latestActiveFinish)}
                  >
                    Urungkan Finish Terakhir ({formatSequenceLabel(latestActiveFinish.sequence)})
                  </button>
                )}
              </div>

              {finishEvents.length === 0 ? (
                <div className="empty-state">
                  Belum ada ketukan finish. Tekan tombol besar{' '}
                  <strong>CATAT FINISH</strong> di bagian bawah layar setiap kali peserta melintasi garis finish.
                </div>
              ) : (
                <ul className="finish-queue-list">
                  {finishEvents.map((fin) => {
                    const assignedBib = fin.batchBibEntryId
                      ? bibMap.get(fin.batchBibEntryId)
                      : undefined;
                    const isIdentifyingThis = identifyingFinishId === fin.id;
                    const availableBibs = isIdentifyingThis
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
                              </div>
                            </div>
                          </div>

                          <div className="finish-queue-item__right">
                            {fin.status === 'CANCELLED' ? (
                              <span className="status-badge status-badge--cancelled">
                                Dibatalkan
                              </span>
                            ) : assignedBib ? (
                              <div className="finish-assigned-group">
                                <BibBadge
                                  color={assignedBib.bibColor}
                                  number={assignedBib.bibNumber}
                                  size="md"
                                />
                                <button
                                  type="button"
                                  className="btn btn--small btn--ghost"
                                  onClick={() => {
                                    setIdentifyingFinishId(
                                      isIdentifyingThis ? null : fin.id
                                    );
                                    setIdentifySearchQuery('');
                                    setIdentifyColorFilter('ALL');
                                  }}
                                >
                                  {isIdentifyingThis ? 'Tutup' : 'Ubah'}
                                </button>
                              </div>
                            ) : (
                              <div className="finish-unassigned-group">
                                <span
                                  className={`status-badge status-badge--${fin.status.toLowerCase()}`}
                                >
                                  {getFinishEventStatusLabel(fin.status)}
                                </span>
                                <button
                                  type="button"
                                  className="btn btn--small btn--primary"
                                  onClick={() => {
                                    setIdentifyingFinishId(
                                      isIdentifyingThis ? null : fin.id
                                    );
                                    setIdentifySearchQuery('');
                                    setIdentifyColorFilter('ALL');
                                  }}
                                >
                                  {isIdentifyingThis ? 'Tutup Pilihan' : 'Identifikasi Nomor'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Inline Bib Selector Drawer */}
                        {isIdentifyingThis && fin.status !== 'CANCELLED' && (
                          <div className="inline-identify-drawer">
                            <div className="inline-identify-drawer__header">
                              <strong>
                                Pilih Nomor Bib untuk {formatSequenceLabel(fin.sequence)} ({formatElapsedMs(fin.elapsedMs)}):
                              </strong>
                            </div>

                            {/* Quick Search & Color Filter inside drawer */}
                            <div className="identify-filters">
                              <input
                                type="text"
                                className="text-input text-input--compact"
                                placeholder="Cari nomor bib (mis. B12, 7, Merah)..."
                                value={identifySearchQuery}
                                onChange={(e) => setIdentifySearchQuery(e.target.value)}
                              />
                              <div className="color-filter-chips">
                                <button
                                  type="button"
                                  className={`filter-chip ${
                                    identifyColorFilter === 'ALL'
                                      ? 'filter-chip--active'
                                      : ''
                                  }`}
                                  onClick={() => setIdentifyColorFilter('ALL')}
                                >
                                  Semua
                                </button>
                                {BIB_COLORS.map((c) => (
                                  <button
                                    key={c}
                                    type="button"
                                    className={`filter-chip ${
                                      identifyColorFilter === c
                                        ? 'filter-chip--active'
                                        : ''
                                    }`}
                                    onClick={() => setIdentifyColorFilter(c)}
                                  >
                                    {BIB_COLOR_MAP[c].nameId}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {availableBibs.length === 0 ? (
                              <p className="helper-text">
                                Tidak ada nomor bib yang cocok / belum finish.
                              </p>
                            ) : (
                              <div className="identify-bib-grid">
                                {availableBibs.map((entry) => (
                                  <button
                                    key={entry.id}
                                    type="button"
                                    className="identify-bib-choice"
                                    onClick={() =>
                                      void handleAssignBibToFinish(fin.id, entry.id)
                                    }
                                  >
                                    <BibBadge
                                      color={entry.bibColor}
                                      number={entry.bibNumber}
                                      size="md"
                                    />
                                    {entry.participantName && (
                                      <span className="identify-bib-choice__name">
                                        {entry.participantName}
                                      </span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}

                            <div className="inline-identify-drawer__footer">
                              <button
                                type="button"
                                className="btn btn--small btn--warning"
                                onClick={() => void handleMarkNeedsReviewClick(fin.id)}
                              >
                                Ragu Urutan? Tandai Perlu Diperiksa
                              </button>
                              <button
                                type="button"
                                className="btn btn--small btn--danger-outline"
                                onClick={() => {
                                  setIdentifyingFinishId(null);
                                  setConfirmUndoFinish(fin);
                                }}
                              >
                                Batalkan {formatSequenceLabel(fin.sequence)}
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : (
            <section className="card" aria-label="Status Peserta Batch">
              <h2 className="section-title">
                Daftar Peserta Batch #{batch.batchNumber}
              </h2>
              <p className="helper-text">
                Anda juga dapat mengetuk peserta yang belum finish di bawah ini untuk langsung mencatat waktu finishnya:
              </p>
              <div className="direct-card-grid">
                {roster.map((entry) => {
                  const linkedFin = entry.finishEventId
                    ? finishMap.get(entry.finishEventId)
                    : undefined;
                  const isFinished =
                    entry.status === 'FINISHED' &&
                    linkedFin &&
                    linkedFin.status !== 'CANCELLED';
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={`participant-tap-card ${
                        isFinished ? 'participant-tap-card--finished' : ''
                      }`}
                      onClick={() => void handleDirectCardTap(entry)}
                    >
                      <BibBadge
                        color={entry.bibColor}
                        number={entry.bibNumber}
                        size="md"
                      />
                      <div className="participant-tap-card__info">
                        {isFinished && linkedFin ? (
                          <>
                            <span className="participant-tap-card__time">
                              {formatElapsedMs(linkedFin.elapsedMs)}
                            </span>
                            <span className="participant-tap-card__seq">
                              {formatSequenceLabel(linkedFin.sequence)} • Finish ✓
                            </span>
                          </>
                        ) : (
                          <span className="participant-tap-card__waiting">
                            {getParticipantStatusLabel(entry.status)}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Bottom Anchored Giant CATAT FINISH Button */}
          <div className="finish-capture-dock">
            <button
              type="button"
              className="btn-giant-finish"
              onClick={() => void handleTimestampFinishTap()}
            >
              <span className="btn-giant-finish__main">CATAT FINISH</span>
              <span className="btn-giant-finish__sub">
                Ketuk tepat saat peserta melewati garis • Urutan berikutnya:{' '}
                {formatSequenceLabel(finishEvents.length + 1)}
              </span>
            </button>
          </div>
        </>
      )}

      {/* ==================================================================== */}
      {/* MODE A: DIRECT CARD TAP WORKFLOW                                     */}
      {/* ==================================================================== */}
      {batch.recordingMode === 'DIRECT_CARD' && (
        <section className="card" aria-label="Ketuk Kartu Peserta">
          <div className="section-header-row">
            <h2 className="section-title">
              Ketuk Kartu Nomor Saat Peserta Finish
            </h2>
            <button
              type="button"
              className="btn btn--small btn--secondary"
              onClick={() => void handleTimestampFinishTap()}
            >
              + Finish Tanpa Nomor ({formatSequenceLabel(finishEvents.length + 1)})
            </button>
          </div>

          {/* Search & Color Filter Bar */}
          <div className="identify-filters">
            <input
              type="text"
              className="text-input text-input--compact"
              placeholder="Cari nomor bib (mis. B12, M07, 12)..."
              value={cardSearchQuery}
              onChange={(e) => setCardSearchQuery(e.target.value)}
            />
            <div className="color-filter-chips">
              <button
                type="button"
                className={`filter-chip ${
                  cardColorFilter === 'ALL' ? 'filter-chip--active' : ''
                }`}
                onClick={() => setCardColorFilter('ALL')}
              >
                Semua ({roster.length})
              </button>
              {BIB_COLORS.map((c) => {
                const count = roster.filter((r) => r.bibColor === c).length;
                if (count === 0) return null;
                return (
                  <button
                    key={c}
                    type="button"
                    className={`filter-chip ${
                      cardColorFilter === c ? 'filter-chip--active' : ''
                    }`}
                    onClick={() => setCardColorFilter(c)}
                  >
                    {BIB_COLOR_MAP[c].nameId} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Stable Participant Card Grid (Never reorders after finish!) */}
          <div className="direct-card-grid">
            {filteredDirectCards.map((entry) => {
              const linkedFin = entry.finishEventId
                ? finishMap.get(entry.finishEventId)
                : undefined;
              const isFinished =
                entry.status === 'FINISHED' &&
                linkedFin &&
                linkedFin.status !== 'CANCELLED';

              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`participant-tap-card ${
                    isFinished ? 'participant-tap-card--finished' : ''
                  }`}
                  onClick={() => void handleDirectCardTap(entry)}
                >
                  <BibBadge
                    color={entry.bibColor}
                    number={entry.bibNumber}
                    size="lg"
                  />
                  {entry.participantName && (
                    <div className="participant-tap-card__name">
                      {entry.participantName}
                    </div>
                  )}
                  <div className="participant-tap-card__info">
                    {isFinished && linkedFin ? (
                      <>
                        <span className="participant-tap-card__time">
                          {formatElapsedMs(linkedFin.elapsedMs)}
                        </span>
                        <span className="participant-tap-card__seq">
                          {formatSequenceLabel(linkedFin.sequence)} • Sudah Finish ✓ (Ketuk untuk Urungkan)
                        </span>
                      </>
                    ) : (
                      <span className="participant-tap-card__cta">
                        KETUK SAAT FINISH
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Deliberate Audited Options & Wake Lock Info (Safe distance from finish controls) */}
      <section className="card auxiliary-running-card">
        <div className="wake-lock-status">
          <span>
            {wakeLock.supported
              ? wakeLock.isLocked
                ? '🔆 Layar tetap menyala otomatis selama batch berjalan.'
                : 'ℹ️ Mode layar menyala otomatis siap diaktifkan.'
              : 'ℹ️ Browser ini tidak mendukung pengunci layar otomatis. Atur batas waktu layar HP di Pengaturan OS agar tidak terkunci.'}
          </span>
        </div>

        <div className="auxiliary-actions-row">
          <button
            type="button"
            className="btn btn--small btn--secondary"
            onClick={() =>
              setConfirmSwitchModeTarget(
                batch.recordingMode === 'TIMESTAMP_FIRST'
                  ? 'DIRECT_CARD'
                  : 'TIMESTAMP_FIRST'
              )
            }
          >
            Ganti ke Mode{' '}
            {batch.recordingMode === 'TIMESTAMP_FIRST'
              ? 'Ketuk Kartu'
              : 'Catat Waktu Dulu'}
          </button>

          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={() => setShowEmergencyPanel((prev) => !prev)}
          >
            {showEmergencyPanel ? 'Tutup Form Susulan' : '+ Tambah Peserta Susulan (Audit)'}
          </button>
        </div>

        {showEmergencyPanel && (
          <form onSubmit={handleEmergencyBibSubmit} className="emergency-add-form">
            <h3>Tambah Peserta Susulan (Tercatat di Audit)</h3>
            <p className="helper-text">
              Gunakan hanya jika ada peserta di garis start yang terlewat dicatat sebelum tombol Mulai ditekan.
            </p>
            <div className="roster-edit-row">
              <select
                aria-label="Warna Bib Susulan"
                className="select-input"
                value={emergColor}
                onChange={(e) => setEmergColor(e.target.value as BibColor)}
              >
                {BIB_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {BIB_COLOR_MAP[c].nameId} ({BIB_COLOR_MAP[c].prefix})
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={50}
                placeholder="No. 1-50"
                className="text-input"
                value={emergNumber}
                onChange={(e) => setEmergNumber(e.target.value)}
              />
              <input
                type="text"
                placeholder="Alasan (misal: Terlewat saat start)"
                className="text-input"
                value={emergReason}
                onChange={(e) => setEmergReason(e.target.value)}
              />
            </div>
            <div className="roster-edit-actions">
              <button
                type="button"
                className="btn btn--small btn--secondary"
                onClick={() => setShowEmergencyPanel(false)}
              >
                Batal
              </button>
              <button type="submit" className="btn btn--small btn--warning">
                Tambah & Catat Audit
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Confirm Undo / Cancel Finish Dialog */}
      <ConfirmDialog
        open={Boolean(confirmUndoFinish)}
        title={
          confirmUndoFinish
            ? `Urungkan / Batalkan ${formatSequenceLabel(confirmUndoFinish.sequence)}?`
            : 'Urungkan Finish?'
        }
        description={
          confirmUndoFinish && (
            <div>
              <p>
                Catatan finish{' '}
                <strong>{formatSequenceLabel(confirmUndoFinish.sequence)}</strong> pada waktu{' '}
                <strong>{formatElapsedMs(confirmUndoFinish.elapsedMs)}</strong> akan ditandai sebagai{' '}
                <strong>Dibatalkan</strong>.
              </p>
              {confirmUndoFinish.batchBibEntryId && (
                <p>
                  Peserta{' '}
                  <strong>
                    {bibMap.get(confirmUndoFinish.batchBibEntryId)?.bibLabel}
                  </strong>{' '}
                  akan kembali berstatus Belum Finish.
                </p>
              )}
              <p className="helper-text">
                Riwayat pembatalan tetap tersimpan di catatan audit untuk transparansi.
              </p>
            </div>
          )
        }
        confirmLabel="Ya, Urungkan Finish Ini"
        cancelLabel="Kembali"
        variant="danger"
        onConfirm={() => void handleConfirmCancelFinish()}
        onCancel={() => setConfirmUndoFinish(null)}
      />

      {/* Confirm Switch Mode Mid-Batch Dialog */}
      <ConfirmDialog
        open={Boolean(confirmSwitchModeTarget)}
        title="Ubah Mode Pencatatan di Tengah Batch?"
        description={
          <div>
            <p>
              Anda akan mengubah tampilan pencatatan ke{' '}
              <strong>
                {confirmSwitchModeTarget === 'DIRECT_CARD'
                  ? 'Ketuk Kartu Nomor Langsung'
                  : 'Catat Waktu Dulu'}
              </strong>
              .
            </p>
            <p className="helper-text">
              Semua catatan finish yang sudah terekam ({activeFinishes.length} finish) tetap aman dan tidak berubah.
            </p>
          </div>
        }
        confirmLabel="Ya, Ganti Mode"
        cancelLabel="Batal"
        variant="warning"
        onConfirm={() => {
          if (confirmSwitchModeTarget) {
            void onChangeModeMidBatch(
              confirmSwitchModeTarget,
              'Operator mengganti mode saat batch berjalan'
            );
          }
          setConfirmSwitchModeTarget(null);
        }}
        onCancel={() => setConfirmSwitchModeTarget(null)}
      />

      {/* Confirm End / Move to Review Dialog */}
      <ConfirmDialog
        open={confirmEndBatchOpen}
        title={`Lanjut ke Tinjauan Hasil Batch #${batch.batchNumber}?`}
        description={
          <div>
            <p>
              Anda akan masuk ke layar <strong>Tinjau Hasil Batch #{batch.batchNumber}</strong> untuk mengidentifikasi sisa finish dan menandai peserta yang DNS/DNF.
            </p>
            <ul className="dialog-summary-list">
              <li>Total Peserta: {roster.length}</li>
              <li>Finish Tercatat: {activeFinishes.length}</li>
              <li>Belum Diidentifikasi: {unidentifiedFinishesCount}</li>
              <li>Peserta Belum Finish: {waitingParticipants.length}</li>
            </ul>
          </div>
        }
        confirmLabel="Lanjut ke Tinjau Hasil"
        cancelLabel="Tetap di Layar Finish"
        variant="primary"
        onConfirm={() => {
          setConfirmEndBatchOpen(false);
          void onMoveToReview();
        }}
        onCancel={() => setConfirmEndBatchOpen(false)}
      />
    </div>
  );
};
