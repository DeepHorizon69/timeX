import { useState } from 'react';
import {
  BatchBibEntry,
  BatchRecord,
  FinishEventRecord,
  ParticipantStatus,
} from '../domain/types';
import {
  formatElapsedMs,
  formatSequenceLabel,
  getBatchName,
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
    finishId: string,
    entryId: string,
    reason?: string
  ) => Promise<void>;
  onUnassignOrMarkFinish: (
    id: string,
    status: 'UNIDENTIFIED' | 'NEEDS_REVIEW',
    reason?: string
  ) => Promise<void>;
  onCancelFinish: (id: string, reason?: string) => Promise<void>;
  onCorrectFinishTime: (
    id: string,
    ms: number,
    reason: string
  ) => Promise<void>;
  onMarkParticipantStatus: (
    id: string,
    status: Exclude<ParticipantStatus, 'FINISHED'>,
    reason?: string
  ) => Promise<void>;
  onBulkMarkWaiting: (ids: string[], status: 'DNS' | 'DNF') => Promise<void>;
  onDeferReview: (notes?: string) => Promise<void>;
  onReturnToRunning: () => Promise<void>;
  onCompleteBatch: (notes?: string) => Promise<void>;
  onBackHome: () => void;
}

export function ReviewBatchScreen({
  batch,
  roster,
  finishEvents,
  onIdentifyFinish,
  onUnassignOrMarkFinish,
  onCancelFinish,
  onCorrectFinishTime,
  onMarkParticipantStatus,
  onBulkMarkWaiting,
  onDeferReview,
  onReturnToRunning,
  onCompleteBatch,
  onBackHome,
}: ReviewBatchScreenProps) {
  const [filter, setFilter] = useState<'ISSUES' | 'ALL'>('ISSUES');
  const [editing, setEditing] = useState<FinishEventRecord | null>(null);
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState(batch.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<
    'complete' | 'defer' | 'reopen' | 'DNS' | 'DNF' | null
  >(null);
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const active = [...finishEvents]
    .filter((finish) => finish.status !== 'CANCELLED')
    .sort((a, b) => a.sequence - b.sequence);
  const waiting = roster.filter((entry) => entry.status === 'WAITING');
  const unidentified = active.filter(
    (finish) => finish.status === 'UNIDENTIFIED'
  );
  const unresolved = unidentified.length + waiting.length;
  const closeIds = new Set<string>();
  for (let index = 1; index < active.length; index++) {
    if (
      Math.abs(active[index].elapsedMs - active[index - 1].elapsedMs) <= 800
    ) {
      closeIds.add(active[index].id);
      closeIds.add(active[index - 1].id);
    }
  }
  const visible =
    filter === 'ALL'
      ? [...finishEvents].sort((a, b) => a.sequence - b.sequence)
      : active.filter(
          (finish) => finish.status !== 'IDENTIFIED' || closeIds.has(finish.id)
        );
  const visibleRoster =
    filter === 'ALL'
      ? roster
      : roster.filter(
          (entry) =>
            entry.status === 'WAITING' || entry.status === 'NEEDS_REVIEW'
        );

  async function perform(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Perubahan gagal disimpan.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen-container screen-container--with-sticky-footer review-screen">
      <header className="page-heading">
        <button className="btn btn--ghost" onClick={onBackHome}>
          Kembali
        </button>
        <div>
          <p className="eyebrow">Periksa</p>
          <h1 className="batch-name">{getBatchName(batch)}</h1>
        </div>
      </header>
      <section className="review-overview">
        <strong>
          {unresolved === 0
            ? 'Semua peserta sudah memiliki status.'
            : `${unresolved} catatan perlu keputusanmu.`}
        </strong>
        <p>
          {unidentified.length} finish belum diisi bib · {waiting.length}{' '}
          peserta belum memiliki hasil
        </p>
        {batch.timingSource === 'WALL_CLOCK_FALLBACK' && (
          <p className="inline-alert inline-alert--warning">
            Sesi ini menggunakan pemulihan jam perangkat.
          </p>
        )}
        {closeIds.size > 0 && (
          <p className="helper-text">
            Ada ketukan berjarak 800 ms atau kurang. Periksa urutan jika
            diperlukan.
          </p>
        )}
      </section>
      {error && (
        <p role="alert" className="inline-alert inline-alert--error">
          {error}
        </p>
      )}
      <div className="segmented-toggle">
        <button
          className={`segmented-btn ${filter === 'ISSUES' ? 'segmented-btn--active' : ''}`}
          aria-pressed={filter === 'ISSUES'}
          onClick={() => setFilter('ISSUES')}
        >
          Perlu perhatian
        </button>
        <button
          className={`segmented-btn ${filter === 'ALL' ? 'segmented-btn--active' : ''}`}
          aria-pressed={filter === 'ALL'}
          onClick={() => setFilter('ALL')}
        >
          Semua hasil
        </button>
      </div>
      <section className="review-finishes">
        <h2>Catatan finish</h2>
        {!visible.length && (
          <p className="empty-state">
            {filter === 'ISSUES'
              ? 'Catatan finish sudah diperiksa.'
              : 'Belum ada catatan finish.'}
          </p>
        )}
        <ul className="review-finish-list">
          {visible.map((finish) => {
            const bib = roster.find(
              (entry) => entry.id === finish.batchBibEntryId
            );
            return (
              <li key={finish.id} className="card review-finish">
                <div className="section-header-row">
                  <div>
                    <span className="eyebrow">
                      {formatSequenceLabel(finish.sequence)}
                    </span>
                    <h3>{formatElapsedMs(finish.elapsedMs)}</h3>
                  </div>
                  {bib ? (
                    <BibBadge
                      color={bib.bibColor}
                      number={bib.bibNumber}
                      size="sm"
                    />
                  ) : (
                    <span className="status-badge">
                      {finish.status === 'CANCELLED'
                        ? 'Dibatalkan'
                        : finish.status === 'NEEDS_REVIEW'
                          ? 'Perlu diperiksa'
                          : 'Belum isi bib'}
                    </span>
                  )}
                </div>
                {closeIds.has(finish.id) && (
                  <p className="helper-text">
                    Ketukan berdekatan dengan finish lain.
                  </p>
                )}
                {finish.status !== 'CANCELLED' && (
                  <>
                    <label
                      className="field-label"
                      htmlFor={`assign-${finish.id}`}
                    >
                      Bib peserta
                    </label>
                    <select
                      className="select-input"
                      id={`assign-${finish.id}`}
                      value={finish.batchBibEntryId ?? ''}
                      disabled={busy}
                      onChange={(event) => {
                        if (event.target.value)
                          void perform(() =>
                            onIdentifyFinish(
                              finish.id,
                              event.target.value,
                              bib
                                ? 'Koreksi bib melalui pemeriksaan hasil'
                                : undefined
                            )
                          );
                      }}
                    >
                      <option value="">Pilih bib</option>
                      {roster
                        .filter(
                          (entry) =>
                            !entry.finishEventId ||
                            entry.finishEventId === finish.id
                        )
                        .map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.bibLabel} {entry.participantName}
                          </option>
                        ))}
                    </select>
                    <div className="button-row">
                      <button
                        className="btn btn--small btn--secondary"
                        onClick={() => {
                          setEditing(finish);
                          setTime(formatElapsedMs(finish.elapsedMs));
                          setReason('');
                        }}
                      >
                        Koreksi waktu
                      </button>
                      <button
                        className="btn btn--small btn--ghost"
                        disabled={busy}
                        onClick={() =>
                          void perform(() =>
                            onUnassignOrMarkFinish(
                              finish.id,
                              'NEEDS_REVIEW',
                              'Operator meminta pemeriksaan ulang'
                            )
                          )
                        }
                      >
                        Perlu diperiksa
                      </button>
                    </div>
                    <details>
                      <summary>Koreksi identitas atau batalkan</summary>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          const action = (
                            event.nativeEvent as SubmitEvent
                          ).submitter?.getAttribute('value');
                          void perform(() =>
                            action === 'cancel'
                              ? onCancelFinish(
                                  finish.id,
                                  String(form.get('reason'))
                                )
                              : onUnassignOrMarkFinish(
                                  finish.id,
                                  'UNIDENTIFIED',
                                  String(form.get('reason'))
                                )
                          );
                        }}
                      >
                        <label
                          className="field-label"
                          htmlFor={`reason-${finish.id}`}
                        >
                          Alasan koreksi
                        </label>
                        <input
                          className="text-input"
                          id={`reason-${finish.id}`}
                          name="reason"
                          required
                        />
                        <div className="button-row">
                          <button
                            className="btn btn--secondary"
                            value="unassign"
                            disabled={busy}
                          >
                            Lepas bib
                          </button>
                          <button
                            className="btn btn--danger-outline"
                            value="cancel"
                            disabled={busy}
                          >
                            Batalkan catatan
                          </button>
                        </div>
                      </form>
                    </details>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <div className="section-header-row">
          <h2>Status peserta</h2>
          {waiting.length > 0 && (
            <div className="button-row">
              {(['DNF', 'DNS'] as const).map((status) => (
                <button
                  key={status}
                  className="btn btn--small btn--secondary"
                  disabled={busy}
                  onClick={() => {
                    setBulkIds(waiting.map((entry) => entry.id));
                    setConfirm(status);
                  }}
                >
                  Tandai sisa {status}
                </button>
              ))}
            </div>
          )}
        </div>
        {!visibleRoster.length && (
          <p className="empty-state">Status peserta sudah lengkap.</p>
        )}
        <ul className="roster-list">
          {visibleRoster.map((entry) => (
            <li key={entry.id} className="roster-item">
              <div className="roster-item__content">
                <BibBadge
                  color={entry.bibColor}
                  number={entry.bibNumber}
                  size="sm"
                />
                <label className="status-select">
                  <span>{entry.participantName || 'Status peserta'}</span>
                  <select
                    className="select-input"
                    value={entry.status}
                    disabled={busy || entry.status === 'FINISHED'}
                    onChange={(event) =>
                      void perform(() =>
                        onMarkParticipantStatus(
                          entry.id,
                          event.target.value as Exclude<
                            ParticipantStatus,
                            'FINISHED'
                          >,
                          'Operator memeriksa status peserta'
                        )
                      )
                    }
                  >
                    {(
                      [
                        'WAITING',
                        'FINISHED',
                        'DNS',
                        'DNF',
                        'NEEDS_REVIEW',
                      ] as const
                    ).map((status) => (
                      <option
                        key={status}
                        value={status}
                        disabled={status === 'FINISHED'}
                      >
                        {getParticipantStatusLabel(status)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <label className="field-label" htmlFor="review-notes">
          Catatan gelombang (opsional)
        </label>
        <textarea
          className="text-input"
          id="review-notes"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </section>
      <button className="btn btn--ghost" onClick={() => setConfirm('reopen')}>
        Kembali ke stopwatch
      </button>
      <div className="sticky-bottom-bar">
        <p className="helper-text">
          {unresolved > 0
            ? 'Hasil tertunda akan ditandai untuk diperiksa.'
            : 'Hasil disimpan bersama riwayat koreksinya.'}
        </p>
        <button
          className="btn btn--primary btn--large btn--block"
          disabled={busy}
          onClick={() => setConfirm(unresolved ? 'defer' : 'complete')}
        >
          {unresolved ? 'Simpan untuk diperiksa' : 'Simpan dan lanjutkan'}
        </button>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === 'reopen'
            ? 'Kembali ke pencatatan?'
            : confirm === 'DNS' || confirm === 'DNF'
              ? `Tandai ${bulkIds.length} peserta ${confirm}?`
              : 'Simpan gelombang ini?'
        }
        description={
          confirm === 'DNS' || confirm === 'DNF' ? (
            <>
              <p>Peserta yang akan diubah</p>
              <div className="selected-bib-strip">
                {roster
                  .filter((entry) => bulkIds.includes(entry.id))
                  .map((entry) => (
                    <BibBadge
                      key={entry.id}
                      color={entry.bibColor}
                      number={entry.bibNumber}
                      size="sm"
                    />
                  ))}
              </div>
            </>
          ) : (
            <p>
              {confirm === 'defer'
                ? `${unidentified.length} finish dan ${waiting.length} peserta akan ditandai Perlu diperiksa. Kamu dapat melanjutkan gelombang berikutnya.`
                : confirm === 'reopen'
                  ? 'Sumber waktu akan diperiksa sebelum pencatatan dilanjutkan.'
                  : 'Hasil gelombang akan tersedia di riwayat.'}
            </p>
          )
        }
        confirmLabel={confirm === 'reopen' ? 'Buka stopwatch' : 'Konfirmasi'}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm === 'reopen') await onReturnToRunning();
          else if (confirm === 'DNS' || confirm === 'DNF')
            await onBulkMarkWaiting(bulkIds, confirm);
          else if (confirm === 'defer') await onDeferReview(notes);
          else await onCompleteBatch(notes);
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(editing)}
        title="Koreksi waktu finish"
        description={
          <>
            <label className="field-label" htmlFor="correct-time">
              Waktu (MM:SS.cc)
            </label>
            <input
              id="correct-time"
              className="text-input"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
            <label className="field-label" htmlFor="correct-reason">
              Alasan koreksi
            </label>
            <input
              id="correct-reason"
              className="text-input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </>
        }
        confirmLabel="Simpan koreksi"
        onCancel={() => setEditing(null)}
        onConfirm={async () => {
          const milliseconds = parseElapsedString(time);
          if (milliseconds === null || !reason.trim())
            throw new Error('Isi waktu yang valid dan alasan koreksi.');
          if (editing)
            await onCorrectFinishTime(editing.id, milliseconds, reason.trim());
          setEditing(null);
        }}
      />
    </div>
  );
}
