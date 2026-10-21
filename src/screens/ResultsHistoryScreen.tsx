import React, { useMemo, useState } from 'react';
import {
  AuditLogRecord,
  BatchBibEntry,
  BatchRecord,
  EventRecord,
  FinishEventRecord,
} from '../domain/types';
import {
  formatElapsedMs,
  formatSequenceLabel,
  formatWallClockDateTime,
  formatWallClockTime,
  getBatchStatusLabel,
  getParticipantStatusLabel,
  matchesBibQuery,
  parseElapsedString,
} from '../domain/utils';
import { BibBadge } from '../components/BibBadge';

interface ResultsHistoryScreenProps {
  activeEvent: EventRecord;
  batches: BatchRecord[];
  allBibEntries: BatchBibEntry[];
  allFinishEvents: FinishEventRecord[];
  auditLogs: AuditLogRecord[];
  onReopenBatchToReview: (batch: BatchRecord) => Promise<void>;
  onCorrectFinishTime: (
    finishEventId: string,
    newElapsedMs: number,
    reason: string
  ) => Promise<void>;
  onIdentifyFinish: (
    finishEventId: string,
    batchBibEntryId: string,
    reason?: string
  ) => Promise<void>;
  onNavigateExport: () => void;
  onBackHome: () => void;
}

export const ResultsHistoryScreen: React.FC<ResultsHistoryScreenProps> = ({
  activeEvent,
  batches,
  allBibEntries,
  allFinishEvents,
  auditLogs,
  onReopenBatchToReview,
  onCorrectFinishTime,
  onIdentifyFinish,
  onNavigateExport,
  onBackHome,
}) => {
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(
    batches[0]?.id ?? null
  );
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showAuditLogs, setShowAuditLogs] = useState<boolean>(false);

  // Deliberate correction state inside Results screen
  const [correctingEntryId, setCorrectingEntryId] = useState<string | null>(null);
  const [editElapsedInput, setEditElapsedInput] = useState<string>('');
  const [editReasonInput, setEditReasonInput] = useState<string>('');
  const [swapFinishIdInput, setSwapFinishIdInput] = useState<string>('');
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [correctionSuccess, setCorrectionSuccess] = useState<string | null>(null);

  const finishMap = useMemo(
    () => new Map<string, FinishEventRecord>(allFinishEvents.map((f) => [f.id, f])),
    [allFinishEvents]
  );

  // Reverse chronological batches
  const orderedBatches = useMemo(
    () => [...batches].sort((a, b) => b.batchNumber - a.batchNumber),
    [batches]
  );

  const selectedBatch = useMemo(
    () => orderedBatches.find((b) => b.id === selectedBatchId) ?? orderedBatches[0] ?? null,
    [orderedBatches, selectedBatchId]
  );

  // Global search across all batches when searchQuery is typed
  const crossBatchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const batchMap = new Map<string, BatchRecord>(batches.map((b) => [b.id, b]));
    return allBibEntries
      .filter((entry) => matchesBibQuery(entry, searchQuery))
      .map((entry) => ({
        entry,
        batch: batchMap.get(entry.batchId),
        finish: entry.finishEventId ? finishMap.get(entry.finishEventId) : undefined,
      }))
      .sort((a, b) => (b.batch?.batchNumber ?? 0) - (a.batch?.batchNumber ?? 0));
  }, [allBibEntries, batches, finishMap, searchQuery]);

  const selectedBatchEntries = useMemo(() => {
    if (!selectedBatch) return [];
    const raw = allBibEntries.filter((e) => e.batchId === selectedBatch.id);
    // Sort finished participants by elapsed time ascending, then DNS/DNF/Waiting
    return [...raw].sort((a, b) => {
      const finA = a.finishEventId ? finishMap.get(a.finishEventId) : undefined;
      const finB = b.finishEventId ? finishMap.get(b.finishEventId) : undefined;
      if (finA && finB) return finA.elapsedMs - finB.elapsedMs;
      if (finA) return -1;
      if (finB) return 1;
      return a.bibLabel.localeCompare(b.bibLabel);
    });
  }, [allBibEntries, selectedBatch, finishMap]);

  const selectedBatchFinishes = useMemo(() => {
    if (!selectedBatch) return [];
    return allFinishEvents
      .filter((f) => f.batchId === selectedBatch.id && f.status !== 'CANCELLED')
      .sort((a, b) => a.sequence - b.sequence);
  }, [allFinishEvents, selectedBatch]);

  const selectedBatchAuditLogs = useMemo(() => {
    if (!selectedBatch) return auditLogs.slice(0, 30);
    return auditLogs.filter((l) => !l.batchId || l.batchId === selectedBatch.id);
  }, [auditLogs, selectedBatch]);

  const handleOpenCorrection = (entry: BatchBibEntry) => {
    setCorrectionError(null);
    setCorrectionSuccess(null);
    const fin = entry.finishEventId ? finishMap.get(entry.finishEventId) : undefined;
    setCorrectingEntryId(entry.id);
    setEditElapsedInput(fin ? formatElapsedMs(fin.elapsedMs) : '');
    setSwapFinishIdInput(fin?.id ?? '');
    setEditReasonInput('');
  };

  const handleSaveResultCorrection = async (
    e: React.FormEvent,
    entry: BatchBibEntry
  ) => {
    e.preventDefault();
    setCorrectionError(null);
    setCorrectionSuccess(null);

    if (!editReasonInput.trim()) {
      setCorrectionError('Alasan koreksi wajib diisi untuk catatan audit.');
      return;
    }

    try {
      const currentFin = entry.finishEventId
        ? finishMap.get(entry.finishEventId)
        : undefined;

      // If assigning to a different finish event in the batch
      if (swapFinishIdInput && swapFinishIdInput !== currentFin?.id) {
        await onIdentifyFinish(
          swapFinishIdInput,
          entry.id,
          editReasonInput.trim()
        );
      }

      // If editing elapsed time on the linked finish event
      const targetFinId = swapFinishIdInput || currentFin?.id;
      if (targetFinId && editElapsedInput.trim()) {
        const targetFin = finishMap.get(targetFinId);
        const parsedMs = parseElapsedString(editElapsedInput);
        if (parsedMs === null) {
          setCorrectionError('Format waktu tidak valid. Gunakan MM:SS.cc');
          return;
        }
        if (!targetFin || targetFin.elapsedMs !== parsedMs) {
          await onCorrectFinishTime(
            targetFinId,
            parsedMs,
            editReasonInput.trim()
          );
        }
      }

      setCorrectingEntryId(null);
      setCorrectionSuccess(
        `Koreksi hasil nomor ${entry.bibLabel} berhasil disimpan dan dicatat ke log audit.`
      );
    } catch (err) {
      setCorrectionError(
        err instanceof Error ? err.message : 'Gagal menyimpan koreksi hasil.'
      );
    }
  };

  return (
    <div className="screen-container">
      {/* Header */}
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
            <span className="sticky-top-bar__title">Hasil & Riwayat Batch</span>
            <span className="sticky-top-bar__sub">{activeEvent.name}</span>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--small btn--primary"
          onClick={onNavigateExport}
        >
          Ekspor CSV / JSON
        </button>
      </header>

      {/* Search by Bib Label across all batches */}
      <section className="card compact-card" aria-label="Pencarian Nomor Bib">
        <label htmlFor="results-bib-search" className="field-label">
          Cari Nomor Bib (Contoh: B12, M07, Biru, 12):
        </label>
        <div className="search-input-row">
          <input
            id="results-bib-search"
            type="text"
            className="text-input"
            placeholder="Ketik kode nomor bib..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="btn btn--small btn--secondary"
              onClick={() => setSearchQuery('')}
            >
              Reset
            </button>
          )}
        </div>

        {searchQuery.trim() !== '' && (
          <div className="search-results-box">
            <h3 className="subsection-title">
              Hasil Pencarian &ldquo;{searchQuery}&rdquo; ({crossBatchMatches.length}{' '}
              catatan di semua batch):
            </h3>
            {crossBatchMatches.length === 0 ? (
              <p className="helper-text">Tidak ditemukan nomor bib yang cocok.</p>
            ) : (
              <ul className="roster-list">
                {crossBatchMatches.map(({ entry, batch, finish }) => (
                  <li key={entry.id} className="roster-item">
                    <div className="roster-item__content">
                      <div className="roster-item__left">
                        <span className="batch-pill">
                          Batch #{batch?.batchNumber ?? '?'}
                        </span>
                        <BibBadge
                          color={entry.bibColor}
                          number={entry.bibNumber}
                          size="sm"
                        />
                        <span>
                          {finish
                            ? `${formatSequenceLabel(finish.sequence)} • ${formatElapsedMs(
                                finish.elapsedMs
                              )}`
                            : getParticipantStatusLabel(entry.status)}
                        </span>
                      </div>
                      {batch && (
                        <button
                          type="button"
                          className="btn btn--small btn--secondary"
                          onClick={() => {
                            setSelectedBatchId(batch.id);
                            setSearchQuery('');
                          }}
                        >
                          Lihat Batch #{batch.batchNumber}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {orderedBatches.length === 0 ? (
        <section className="card">
          <div className="empty-state">
            Belum ada batch pada kegiatan ini. Buat batch baru dari Beranda.
          </div>
        </section>
      ) : (
        <>
          {/* Batch Selector List (Reverse Chronological) */}
          <section className="card" aria-label="Pilih Batch">
            <h2 className="section-title">
              Daftar Batch (Terbaru ke Terlama)
            </h2>
            <div className="batch-selector-cards">
              {orderedBatches.map((b) => {
                const bEntries = allBibEntries.filter((e) => e.batchId === b.id);
                const bFinishes = allFinishEvents.filter(
                  (f) => f.batchId === b.id && f.status !== 'CANCELLED'
                );
                const isSelected = selectedBatch?.id === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    className={`batch-selector-card ${
                      isSelected ? 'batch-selector-card--selected' : ''
                    }`}
                    onClick={() => setSelectedBatchId(b.id)}
                  >
                    <div className="batch-selector-card__top">
                      <strong>Batch #{b.batchNumber}</strong>
                      <span
                        className={`status-badge status-badge--${b.status.toLowerCase()}`}
                      >
                        {getBatchStatusLabel(b.status, b.recoveryRequired)}
                      </span>
                    </div>
                    <div className="batch-selector-card__meta">
                      {bEntries.length} peserta • {bFinishes.length} finish
                    </div>
                    {b.startedAtWallClock && (
                      <div className="batch-selector-card__time">
                        Mulai: {formatWallClockTime(b.startedAtWallClock)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Selected Batch Detailed Results */}
          {selectedBatch && (
            <section className="card" aria-label={`Detail Hasil Batch #${selectedBatch.batchNumber}`}>
              <div className="section-header-row">
                <div>
                  <h2 className="section-title">
                    Rincian Hasil Batch #{selectedBatch.batchNumber}
                  </h2>
                  <p className="helper-text">
                    Status: <strong>{getBatchStatusLabel(selectedBatch.status, selectedBatch.recoveryRequired)}</strong>
                    {selectedBatch.startedAtWallClock &&
                      ` • Mulai: ${formatWallClockDateTime(selectedBatch.startedAtWallClock)}`}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn--small btn--secondary"
                  onClick={() => void onReopenBatchToReview(selectedBatch)}
                >
                  Buka di Layar Tinjau
                </button>
              </div>

              {correctionError && (
                <div className="inline-alert inline-alert--error" role="alert">
                  {correctionError}
                </div>
              )}

              {correctionSuccess && (
                <div className="inline-alert inline-alert--success" role="status">
                  {correctionSuccess}
                </div>
              )}

              {selectedBatchEntries.length === 0 ? (
                <div className="empty-state">Tidak ada peserta pada batch ini.</div>
              ) : (
                <ul className="roster-list">
                  {selectedBatchEntries.map((entry, idx) => {
                    const fin = entry.finishEventId
                      ? finishMap.get(entry.finishEventId)
                      : undefined;
                    const isCorrecting = correctingEntryId === entry.id;

                    return (
                      <li key={entry.id} className="roster-item">
                        <div className="roster-item__content">
                          <div className="roster-item__left">
                            <span className="roster-item__index">
                              {fin ? `#${idx + 1}` : '-'}
                            </span>
                            <BibBadge
                              color={entry.bibColor}
                              number={entry.bibNumber}
                              size="md"
                            />
                            <div>
                              {fin ? (
                                <div className="result-time-row">
                                  <strong className="result-elapsed">
                                    {formatElapsedMs(fin.elapsedMs)}
                                  </strong>
                                  <span className="finish-seq-badge">
                                    {formatSequenceLabel(fin.sequence)}
                                  </span>
                                  {fin.correctionHistory.length > 0 && (
                                    <span className="audit-tag">
                                      Dikoreksi ({fin.correctionHistory.length}x)
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span
                                  className={`status-badge status-badge--${entry.status.toLowerCase()}`}
                                >
                                  {getParticipantStatusLabel(entry.status)}
                                </span>
                              )}
                              {entry.participantName && (
                                <div className="roster-item__name">
                                  {entry.participantName}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="roster-item__actions">
                            <button
                              type="button"
                              className="btn btn--small btn--ghost"
                              onClick={() =>
                                isCorrecting
                                  ? setCorrectingEntryId(null)
                                  : handleOpenCorrection(entry)
                              }
                            >
                              {isCorrecting ? 'Tutup' : 'Koreksi'}
                            </button>
                          </div>
                        </div>

                        {isCorrecting && (
                          <form
                            onSubmit={(e) => void handleSaveResultCorrection(e, entry)}
                            className="inline-identify-drawer"
                          >
                            <h4>
                              Koreksi Tertera Audit untuk Nomor {entry.bibLabel} (Batch #{selectedBatch.batchNumber})
                            </h4>
                            <div className="roster-edit-row">
                              <div>
                                <label className="field-label">
                                  Urutan Finish di Batch #{selectedBatch.batchNumber}:
                                </label>
                                <select
                                  className="select-input"
                                  value={swapFinishIdInput}
                                  onChange={(e) => {
                                    const newFinId = e.target.value;
                                    setSwapFinishIdInput(newFinId);
                                    const picked = finishMap.get(newFinId);
                                    if (picked) {
                                      setEditElapsedInput(
                                        formatElapsedMs(picked.elapsedMs)
                                      );
                                    }
                                  }}
                                >
                                  <option value="">-- Pilih Catatan Finish --</option>
                                  {selectedBatchFinishes.map((f) => (
                                    <option key={f.id} value={f.id}>
                                      {formatSequenceLabel(f.sequence)} —{' '}
                                      {formatElapsedMs(f.elapsedMs)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="field-label">
                                  Waktu Tempuh (MM:SS.cc):
                                </label>
                                <input
                                  type="text"
                                  className="text-input"
                                  value={editElapsedInput}
                                  onChange={(e) => setEditElapsedInput(e.target.value)}
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
                                  value={editReasonInput}
                                  onChange={(e) => setEditReasonInput(e.target.value)}
                                  placeholder="Misal: Konfirmasi ulang catatan finish"
                                  required
                                />
                              </div>
                            </div>
                            <div className="roster-edit-actions">
                              <button
                                type="button"
                                className="btn btn--small btn--secondary"
                                onClick={() => setCorrectingEntryId(null)}
                              >
                                Batal
                              </button>
                              <button
                                type="submit"
                                className="btn btn--small btn--primary"
                              >
                                Simpan Koreksi & Audit
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
          )}

          {/* Audit Log History Section */}
          <section className="card" aria-label="Riwayat Audit Lokal">
            <div className="section-header-row">
              <h2 className="section-title">
                Riwayat Audit & Koreksi ({selectedBatchAuditLogs.length})
              </h2>
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={() => setShowAuditLogs((prev) => !prev)}
              >
                {showAuditLogs ? 'Sembunyikan' : 'Tampilkan Log Audit'}
              </button>
            </div>
            {showAuditLogs && (
              <ul className="audit-log-list">
                {selectedBatchAuditLogs.map((log) => (
                  <li key={log.id} className="audit-log-item">
                    <div className="audit-log-item__top">
                      <strong>{log.action}</strong>
                      <span>{formatWallClockDateTime(log.changedAt)}</span>
                    </div>
                    {(log.oldValue !== undefined || log.newValue !== undefined) && (
                      <div className="audit-log-item__diff">
                        {log.oldValue !== undefined && log.oldValue !== null
                          ? `${String(log.oldValue)} → `
                          : ''}
                        <strong>{String(log.newValue ?? '')}</strong>
                      </div>
                    )}
                    {log.reason && (
                      <div className="audit-log-item__reason">
                        Alasan: {log.reason}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};
