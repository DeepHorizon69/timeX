import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BatchBibEntry,
  BatchRecord,
  BibColor,
  FinishEventRecord,
} from '../domain/types';
import {
  BIB_COLORS,
  BIB_COLOR_MAP,
  formatElapsedMs,
  formatSequenceLabel,
  formatWallClockTime,
  generateId,
  getBatchName,
  matchesBibQuery,
} from '../domain/utils';
import {
  captureFinishTimingNow,
  useScreenWakeLock,
} from '../services/timekeeper';
import {
  downloadRescueFile,
  enqueueCapture,
  retryCaptures,
  useCaptureSession,
} from '../services/captureSession';
import { BibBadge } from '../components/BibBadge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LiveTimer } from '../components/LiveTimer';

interface RunningBatchScreenProps {
  batch: BatchRecord;
  roster: BatchBibEntry[];
  finishEvents: FinishEventRecord[];
  onIdentifyFinish: (
    finishId: string,
    entryId: string,
    reason?: string
  ) => Promise<void>;
  onMarkFinishNeedsReview: (id: string, notes?: string) => Promise<void>;
  onCancelFinishEvent: (id: string, reason?: string) => Promise<void>;
  onResumeRecoveryFallback: () => Promise<void>;
  onMarkRecoveryNeedsReview: () => Promise<void>;
  onMoveToReview: () => Promise<void>;
  onAddEmergencyBib: (
    color: BibColor,
    number: number,
    reason: string
  ) => Promise<void>;
  onNavigateExport: () => void;
  onBackHome: () => void;
}

const FinishQueueRow = memo(function FinishQueueRow({
  finish,
  bib,
  selected,
  onSelect,
}: {
  finish: FinishEventRecord;
  bib?: BatchBibEntry;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const sequence = formatSequenceLabel(finish.sequence);
  const cancelled = finish.status === 'CANCELLED';
  return (
    <li
      className={`capture-row ${selected ? 'capture-row--selected' : ''} ${cancelled ? 'capture-row--cancelled' : ''}`}
    >
      <div className="capture-row__time">
        <span>{sequence}</span>
        <strong>{formatElapsedMs(finish.elapsedMs)}</strong>
        <small>
          {cancelled
            ? 'Dibatalkan'
            : finish.status === 'NEEDS_REVIEW'
              ? 'Perlu diperiksa'
              : 'Tersimpan'}
        </small>
      </div>
      {!cancelled && (
        <button
          className="capture-bib-button"
          aria-label={`Isi bib ${sequence}`}
          onClick={() => onSelect(finish.id)}
        >
          {bib ? (
            <BibBadge color={bib.bibColor} number={bib.bibNumber} size="sm" />
          ) : (
            <span>
              Isi bib <span aria-hidden="true">+</span>
            </span>
          )}
        </button>
      )}
    </li>
  );
});

export function RunningBatchScreen({
  batch,
  roster,
  finishEvents,
  onIdentifyFinish,
  onMarkFinishNeedsReview,
  onCancelFinishEvent,
  onResumeRecoveryFallback,
  onMarkRecoveryNeedsReview,
  onMoveToReview,
  onAddEmergencyBib,
  onNavigateExport,
  onBackHome,
}: RunningBatchScreenProps) {
  const session = useCaptureSession();
  const screen = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = dock.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const updateHeight = () => {
      screen.current?.style.setProperty(
        '--capture-dock-height',
        `${element.getBoundingClientRect().height}px`
      );
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [batch.recoveryRequired]);
  const rosterById = useMemo(
    () => new Map(roster.map((entry) => [entry.id, entry])),
    [roster]
  );
  const finishesById = useMemo(
    () => new Map(finishEvents.map((finish) => [finish.id, finish])),
    [finishEvents]
  );
  const pending = useMemo(
    () =>
      session.pending.filter(
        (item) => item.batchId === batch.id && !finishesById.has(item.id)
      ),
    [batch.id, finishesById, session.pending]
  );
  const pendingBibIds = useMemo(
    () => new Set(pending.map((item) => item.batchBibEntryId)),
    [pending]
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const identificationPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selectedId)
      identificationPanel.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<BibColor | 'ALL'>('ALL');
  const [view, setView] = useState<'QUEUE' | 'ROSTER'>('QUEUE');
  const [undo, setUndo] = useState<FinishEventRecord | null>(null);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [emergencyColor, setEmergencyColor] = useState<BibColor>('WHITE');
  const [emergencyNumber, setEmergencyNumber] = useState('');
  const [emergencyReason, setEmergencyReason] = useState('');
  const wakeLock = useScreenWakeLock(
    !batch.recoveryRequired && batch.status === 'RUNNING'
  );
  const active = useMemo(
    () => finishEvents.filter((finish) => finish.status !== 'CANCELLED'),
    [finishEvents]
  );
  const unassigned = useMemo(
    () => active.filter((finish) => finish.status === 'UNIDENTIFIED'),
    [active]
  );
  const selected = selectedId ? finishesById.get(selectedId) : undefined;
  const latest = active[0];
  const failedCapture = pending.find((item) => item.error);
  const hasUnsaved = pending.length > 0 && !session.saving;
  const pendingDisplay = failedCapture ?? pending[pending.length - 1];
  const saveState = pending.length
    ? hasUnsaved
      ? 'error'
      : 'saving'
    : latest
      ? 'saved'
      : 'ready';
  const available = useMemo(
    () => {
      if (!selectedId) return [];
      return roster.filter(
        (entry) =>
          (!entry.finishEventId || entry.finishEventId === selectedId) &&
          (filter === 'ALL' || filter === entry.bibColor) &&
          matchesBibQuery(entry, search)
      );
    },
    [roster, selectedId, filter, search]
  );
  const selectFinish = useCallback((id: string) => {
    setSelectedId(id);
    setSearch('');
    setFilter('ALL');
  }, []);

  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Tindakan gagal. Coba lagi.'
      );
    } finally {
      setBusy(false);
    }
  }

  function capture(entry?: BatchBibEntry) {
    try {
      const timing = captureFinishTimingNow(batch);
      enqueueCapture({
        ...timing,
        id: generateId('fin'),
        batchId: batch.id,
        batchBibEntryId: entry?.id,
      });
      setFeedback(
        `${entry?.bibLabel ?? 'Finish'} ditangkap pada ${formatElapsedMs(timing.elapsedMs)}`
      );
      setError(null);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  if (batch.recoveryRequired)
    return (
      <div className="screen-container recovery-screen">
        <button className="btn btn--ghost" onClick={onBackHome}>
          Kembali ke kegiatan
        </button>
        <p className="eyebrow">Sesi terputus</p>
        <h1 className="batch-name">Pulihkan {getBatchName(batch)}</h1>
        <p>
          Halaman dibuka ulang saat pencatatan berjalan. Pilih cara melanjutkan
          waktu.
        </p>
        <section className="card">
          <dl className="recovery-facts">
            <div>
              <dt>Waktu start</dt>
              <dd>{formatWallClockTime(batch.startedAtWallClock)}</dd>
            </div>
            <div>
              <dt>Finish tersimpan</dt>
              <dd>{active.length}</dd>
            </div>
            <div>
              <dt>Finish terakhir</dt>
              <dd>
                {latest ? formatElapsedMs(latest.elapsedMs) : 'Belum ada'}
              </dd>
            </div>
          </dl>
        </section>
        {error && (
          <p role="alert" className="inline-alert inline-alert--error">
            {error}
          </p>
        )}
        <div className="recovery-options">
          <button
            className="btn btn--primary btn--large"
            disabled={busy}
            onClick={() => void perform(onResumeRecoveryFallback)}
          >
            Lanjutkan dengan jam perangkat
          </button>
          <p className="helper-text">
            Selisih waktu dihitung dari jam HP. Perubahan pengaturan jam dapat
            memengaruhi hasil dan akan ditandai di laporan.
          </p>
          <button
            className="btn btn--secondary"
            disabled={busy}
            onClick={() => void perform(onMarkRecoveryNeedsReview)}
          >
            Tutup pencatatan dan periksa hasil
          </button>
          <button className="btn btn--ghost" onClick={onNavigateExport}>
            Unduh backup dahulu
          </button>
        </div>
      </div>
    );

  return (
    <div
      ref={screen}
      className="screen-container screen-container--with-finish-dock capture-screen"
    >
      <header className="capture-header">
        <div className="capture-header__top">
          <button className="btn btn--ghost" onClick={onBackHome}>
            Kegiatan
          </button>
          <span className="batch-name">{getBatchName(batch)}</span>
          <span className="live-indicator">Berjalan</span>
        </div>
        <h1 className="sr-only">Catat finish {getBatchName(batch)}</h1>
        <div className="capture-timer">
          <LiveTimer batch={batch} />
        </div>
        <div className="capture-source">
          {batch.timingSource === 'WALL_CLOCK_FALLBACK'
            ? 'Pemulihan · jam perangkat'
            : 'Waktu presisi · sesi aktif'}
        </div>
        <div className="capture-counters">
          <div>
            <strong>{roster.length}</strong>
            <span>Peserta</span>
          </div>
          <div>
            <strong>{active.length + pending.length}</strong>
            <span>Finish</span>
          </div>
          <button
            type="button"
            className="capture-counter-action"
            disabled={unassigned.length === 0}
            aria-label={`${unassigned.length} belum isi bib`}
            onClick={() => {
              const oldest = unassigned[unassigned.length - 1];
              if (oldest) {
                setView('QUEUE');
                selectFinish(oldest.id);
              }
            }}
          >
            <strong>{unassigned.length}</strong>
            <span>Belum isi bib</span>
          </button>
        </div>
      </header>
      {error && (
        <p className="inline-alert inline-alert--error" role="alert">
          {error}
        </p>
      )}
      <div className="capture-feedback" role="status">
        <span>{feedback || 'Siap mencatat peserta finish.'}</span>
        {latest && (
          <button
            className="btn btn--small btn--secondary"
            onClick={() => setUndo(latest)}
          >
            Urungkan terakhir
          </button>
        )}
      </div>
      {pending.length > 0 && (hasUnsaved || session.journalError) && (
        <section
          className="capture-save-error inline-alert inline-alert--error"
          role="alert"
          aria-label="Masalah penyimpanan"
        >
          <p>
            {failedCapture?.error ??
              (session.saving
                ? 'Catatan finish sedang disimpan ke perangkat.'
                : 'Catatan finish menunggu disimpan. Pilih Simpan ulang.')}
          </p>
          {session.journalError && (
            <p>
              Salinan darurat gagal disimpan. Unduh penyelamatan sebelum
              menutup halaman.
            </p>
          )}
          <button className="btn btn--secondary" onClick={downloadRescueFile}>
            Unduh penyelamatan
          </button>
        </section>
      )}

      <div className="segmented-toggle" aria-label="Tampilan pencatatan">
        <button
          className={`segmented-btn ${view === 'QUEUE' ? 'segmented-btn--active' : ''}`}
          aria-pressed={view === 'QUEUE'}
          onClick={() => setView('QUEUE')}
        >
          Antrean finish
        </button>
        <button
          className={`segmented-btn ${view === 'ROSTER' ? 'segmented-btn--active' : ''}`}
          aria-pressed={view === 'ROSTER'}
          onClick={() => setView('ROSTER')}
        >
          Peserta
        </button>
      </div>
      <div className="capture-workspace">
        <section className="capture-log" aria-label="Catatan finish">
          {view === 'QUEUE' ? (
            <>
              {pending.length > 0 && (
                <ul className="pending-list">
                  {pending.map((item) => (
                    <li key={item.id}>
                      <strong>{formatElapsedMs(item.elapsedMs)}</strong>
                      <span>
                        {item.error ? 'Belum tersimpan' : 'Menyimpan…'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {finishEvents.length === 0 && pending.length === 0 && (
                <div className="capture-empty">
                  <strong>Tunggu di garis finish.</strong>
                  <p>
                    Ketuk Catat finish satu kali untuk setiap peserta yang
                    melintas.
                  </p>
                </div>
              )}
              <ul className="capture-list">
                {finishEvents.map((finish) => {
                  const bib = finish.batchBibEntryId
                    ? rosterById.get(finish.batchBibEntryId)
                    : undefined;
                  return (
                    <FinishQueueRow
                      key={finish.id}
                      finish={finish}
                      bib={bib}
                      selected={selectedId === finish.id}
                      onSelect={selectFinish}
                    />
                  );
                })}
              </ul>
            </>
          ) : (
            <div className="direct-card-grid">
              {roster.map((entry) => {
                const linked = entry.finishEventId
                  ? finishesById.get(entry.finishEventId)
                  : undefined;
                const finish =
                  linked?.status !== 'CANCELLED' ? linked : undefined;
                const waiting = pendingBibIds.has(entry.id);
                return (
                  <button
                    key={entry.id}
                    className={`participant-card ${finish ? 'participant-card--finished' : ''}`}
                    disabled={waiting || batch.recordingMode !== 'DIRECT_CARD'}
                    aria-label={`${entry.bibLabel}${finish ? ' sudah finish' : ' belum finish'}`}
                    onClick={() => (finish ? setUndo(finish) : capture(entry))}
                  >
                    <BibBadge color={entry.bibColor} number={entry.bibNumber} />
                    <span>
                      {finish
                        ? formatElapsedMs(finish.elapsedMs)
                        : waiting
                          ? 'Menyimpan…'
                          : 'Belum finish'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {selected && (
          <section
            ref={identificationPanel}
            className="identification-panel"
            aria-label={`Identifikasi ${formatSequenceLabel(selected.sequence)}`}
          >
            <div className="section-header-row">
              <div>
                <p className="eyebrow">Isi bib</p>
                <h2>
                  {formatSequenceLabel(selected.sequence)} ·{' '}
                  {formatElapsedMs(selected.elapsedMs)}
                </h2>
              </div>
              <button
                className="btn btn--ghost"
                onClick={() => setSelectedId(null)}
              >
                Tutup
              </button>
            </div>
            <label className="field-label" htmlFor="identify-search">
              Cari nomor bib
            </label>
            <input
              id="identify-search"
              className="text-input"
              value={search}
              placeholder="Contoh B12 atau 12"
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="color-filter-chips">
              <button
                className="filter-chip"
                aria-pressed={filter === 'ALL'}
                onClick={() => setFilter('ALL')}
              >
                Semua
              </button>
              {BIB_COLORS.filter((color) =>
                roster.some((entry) => entry.bibColor === color)
              ).map((color) => (
                <button
                  key={color}
                  className="filter-chip"
                  aria-pressed={filter === color}
                  onClick={() => setFilter(color)}
                >
                  {BIB_COLOR_MAP[color].nameId}
                </button>
              ))}
            </div>
            <div className="identify-grid">
              {available.map((entry) => (
                <button
                  className="bib-select-btn"
                  key={entry.id}
                  disabled={busy}
                  aria-label={`Pilih ${entry.bibLabel}`}
                  onClick={() =>
                    void perform(async () => {
                      await onIdentifyFinish(
                        selected.id,
                        entry.id,
                        selected.batchBibEntryId
                          ? 'Koreksi bib saat pencatatan'
                          : undefined
                      );
                      setFeedback(
                        `${formatSequenceLabel(selected.sequence)} terhubung ke ${entry.bibLabel}`
                      );
                      const next = [...unassigned]
                        .reverse()
                        .find((finish) => finish.id !== selected.id);
                      setSelectedId(next?.id ?? null);
                      setSearch('');
                      setFilter('ALL');
                    })
                  }
                >
                  <BibBadge
                    color={entry.bibColor}
                    number={entry.bibNumber}
                    size="sm"
                  />
                </button>
              ))}
            </div>
            {!available.length && (
              <p className="helper-text">
                Tidak ada bib yang tersedia untuk pencarian ini.
              </p>
            )}
            <button
              className="btn btn--ghost"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await onMarkFinishNeedsReview(
                    selected.id,
                    'Identitas perlu dikonfirmasi operator'
                  );
                  setSelectedId(null);
                })
              }
            >
              Tandai perlu diperiksa
            </button>
          </section>
        )}
      </div>
      <details className="capture-tools">
        <summary>Tindakan lainnya</summary>
        <p className="helper-text">
          {wakeLock.isLocked
            ? 'Layar dijaga tetap menyala.'
            : 'Pastikan layar HP tetap menyala selama pencatatan.'}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              await onAddEmergencyBib(
                emergencyColor,
                Number(emergencyNumber),
                emergencyReason
              );
              setEmergencyNumber('');
              setEmergencyReason('');
              setFeedback('Bib darurat ditambahkan.');
            });
          }}
        >
          <h2>Tambah bib darurat</h2>
          <label className="field-label" htmlFor="emergency-color">
            Warna bib
          </label>
          <select
            id="emergency-color"
            className="select-input"
            value={emergencyColor}
            onChange={(event) =>
              setEmergencyColor(event.target.value as BibColor)
            }
          >
            {BIB_COLORS.map((color) => (
              <option key={color} value={color}>
                {BIB_COLOR_MAP[color].nameId}
              </option>
            ))}
          </select>
          <label className="field-label" htmlFor="emergency-number">
            Nomor bib
          </label>
          <input
            id="emergency-number"
            className="text-input"
            type="number"
            inputMode="numeric"
            min="1"
            max="50"
            required
            value={emergencyNumber}
            onChange={(event) => setEmergencyNumber(event.target.value)}
          />
          <label className="field-label" htmlFor="emergency-reason">
            Alasan penambahan
          </label>
          <input
            id="emergency-reason"
            className="text-input"
            required
            value={emergencyReason}
            onChange={(event) => setEmergencyReason(event.target.value)}
          />
          <button className="btn btn--secondary" disabled={busy}>
            Tambahkan bib
          </button>
        </form>
      </details>
      <button
        className="btn btn--secondary"
        disabled={pending.length > 0}
        onClick={() => setEnding(true)}
      >
        Akhiri pencatatan
      </button>
      <div
        ref={dock}
        className="finish-capture-dock"
        role="region"
        aria-label="Pencatatan finish"
      >
        <div className={`capture-save-summary capture-save-summary--${saveState}`}>
          <div role="status" aria-atomic="true">
            <strong>
              {pendingDisplay
                ? formatElapsedMs(pendingDisplay.elapsedMs)
                : latest
                  ? `${formatSequenceLabel(latest.sequence)} · ${formatElapsedMs(latest.elapsedMs)}`
                  : 'Siap mencatat finish'}
            </strong>
            <span>
              {pending.length
                ? `${pending.length} finish ${hasUnsaved ? 'belum tersimpan' : 'sedang disimpan'}`
                : latest ? 'Tersimpan' : 'Ketuk saat peserta melintas'}
            </span>
          </div>
          {hasUnsaved && (
            <button
              type="button"
              className="btn btn--small btn--warning"
              onClick={() => void retryCaptures()}
            >
              Simpan ulang
            </button>
          )}
        </div>
        <button className="btn-giant-finish" onClick={() => capture()}>
          <span className="btn-giant-finish__main">Catat finish</span>
          <span className="btn-giant-finish__sub">
            Satu ketukan untuk satu peserta
          </span>
        </button>
      </div>
      <ConfirmDialog
        open={ending}
        title="Akhiri pencatatan gelombang?"
        description={
          <p>
            {active.length} finish tercatat. Selanjutnya periksa bib dan status
            peserta. Kamu dapat membuka kembali pencatatan jika diperlukan.
          </p>
        }
        confirmLabel="Periksa hasil"
        cancelLabel="Tetap mencatat"
        onConfirm={onMoveToReview}
        onCancel={() => setEnding(false)}
      />
      <ConfirmDialog
        open={Boolean(undo)}
        title="Batalkan finish terakhir?"
        variant="danger"
        description={
          <p>
            {undo &&
              `${formatSequenceLabel(undo.sequence)} · ${formatElapsedMs(undo.elapsedMs)}`}{' '}
            akan ditandai dibatalkan dan tetap ada dalam audit.
          </p>
        }
        confirmLabel="Batalkan finish"
        onCancel={() => setUndo(null)}
        onConfirm={async () => {
          if (undo)
            await onCancelFinishEvent(
              undo.id,
              'Operator membatalkan ketukan finish'
            );
          setUndo(null);
        }}
      />
    </div>
  );
}
