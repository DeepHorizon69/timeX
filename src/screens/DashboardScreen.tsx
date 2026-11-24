import { useEffect, useRef, useState } from 'react';
import {
  BatchRecord,
  EventRecord,
  FinishEventRecord,
  RecordingMode,
} from '../domain/types';
import { getBatchName, getBatchStatusLabel } from '../domain/utils';
import { LiveTimer } from '../components/LiveTimer';

interface DashboardScreenProps {
  activeEvent: EventRecord;
  allEvents: EventRecord[];
  batches: BatchRecord[];
  allFinishEvents: FinishEventRecord[];
  nextBatchBibCount: number;
  onCreateBatch: (mode: RecordingMode) => Promise<void>;
  onOpenBatch: (batch: BatchRecord) => void;
  onRenameBatch: (batchId: string, name: string) => Promise<void>;
  onNavigateResults: () => void;
  onNavigateExport: () => void;
  onUpdateEvent: (name: string, date: string) => Promise<void>;
  onCreateNewEvent: (name: string, date: string) => Promise<void>;
  onSwitchEvent: (id: string) => Promise<void>;
}

export function DashboardScreen({
  activeEvent,
  allEvents,
  batches,
  allFinishEvents,
  nextBatchBibCount,
  onCreateBatch,
  onOpenBatch,
  onRenameBatch,
  onNavigateResults,
  onNavigateExport,
  onUpdateEvent,
  onCreateNewEvent,
  onSwitchEvent,
}: DashboardScreenProps) {
  const [editing, setEditing] = useState<'edit' | 'new' | null>(null);
  const [name, setName] = useState(activeEvent.name);
  const [date, setDate] = useState(activeEvent.eventDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchEdit, setBatchEdit] = useState<{ id: string; name: string } | null>(
    null
  );
  const [batchNameError, setBatchNameError] = useState<string | null>(null);
  const editBatchButton = useRef<HTMLButtonElement>(null);
  const returnToEditButton = useRef(false);
  const running = batches.find((batch) => batch.status === 'RUNNING');
  const draft = batches.find(
    (batch) => batch.status === 'DRAFT' || batch.status === 'READY'
  );
  const next = running ?? draft;
  const batchNameEdit =
    !running && batchEdit?.id === draft?.id ? batchEdit : null;
  const isEditingBatchName = batchNameEdit !== null;
  const completed = batches.filter(
    (batch) => batch.status === 'COMPLETED' || batch.status === 'NEEDS_REVIEW'
  );
  const unresolved = allFinishEvents.filter(
    (finish) =>
      finish.status === 'UNIDENTIFIED' || finish.status === 'NEEDS_REVIEW'
  ).length;
  const nextNumber =
    Math.max(0, ...batches.map((batch) => batch.batchNumber)) + 1;

  useEffect(() => {
    if (busy || isEditingBatchName || !returnToEditButton.current) return;
    returnToEditButton.current = false;
    editBatchButton.current?.focus();
  }, [busy, isEditingBatchName]);

  function closeBatchNameEditor() {
    returnToEditButton.current = true;
    setBatchEdit(null);
  }

  async function perform(
    action: () => Promise<unknown>,
    reportError = setError
  ) {
    setBusy(true);
    reportError(null);
    try {
      await action();
    } catch (failure) {
      reportError(
        failure instanceof Error
          ? failure.message
          : 'Tindakan gagal. Coba lagi.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen-container dashboard">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Kegiatan</p>
          <h1>{activeEvent.name}</h1>
          <p>
            {new Date(`${activeEvent.eventDate}T12:00:00`).toLocaleDateString(
              'id-ID',
              { day: 'numeric', month: 'long', year: 'numeric' }
            )}
          </p>
        </div>
        <button
          className="btn btn--secondary"
          aria-expanded={editing !== null}
          disabled={busy}
          onClick={() => {
            setName(activeEvent.name);
            setDate(activeEvent.eventDate);
            setEditing(editing ? null : 'edit');
          }}
        >
          Kelola kegiatan
        </button>
      </header>
      {error && (
        <p role="alert" className="inline-alert inline-alert--error">
          {error}
        </p>
      )}
      {editing && (
        <section className="card event-editor">
          <div className="button-row">
            <button
              className={`btn ${editing === 'edit' ? 'btn--primary' : 'btn--secondary'}`}
              onClick={() => {
                setEditing('edit');
                setName(activeEvent.name);
              }}
            >
              Ubah kegiatan
            </button>
            <button
              className={`btn ${editing === 'new' ? 'btn--primary' : 'btn--secondary'}`}
              onClick={() => {
                setEditing('new');
                setName('');
              }}
            >
              Kegiatan baru
            </button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                if (editing === 'new')
                  await onCreateNewEvent(name.trim(), date);
                else await onUpdateEvent(name.trim(), date);
                setEditing(null);
              });
            }}
          >
            <label className="field-label" htmlFor="event-name">
              Nama kegiatan
            </label>
            <input
              className="text-input"
              id="event-name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <label className="field-label" htmlFor="event-date">
              Tanggal
            </label>
            <input
              className="text-input"
              id="event-date"
              type="date"
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <button
              className="btn btn--primary"
              disabled={busy || !name.trim()}
            >
              Simpan kegiatan
            </button>
          </form>
          {allEvents.length > 1 && (
            <>
              <label className="field-label" htmlFor="event-switch">
                Buka kegiatan tersimpan
              </label>
              <select
                id="event-switch"
                className="select-input"
                value={activeEvent.id}
                disabled={busy || Boolean(running)}
                onChange={(event) =>
                  void perform(() => onSwitchEvent(event.target.value))
                }
              >
                {allEvents.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.eventDate}
                  </option>
                ))}
              </select>
            </>
          )}
        </section>
      )}

      <section className="next-action" aria-label="Langkah berikutnya">
        <p className="eyebrow">
          {running
            ? 'Sedang berlangsung'
            : draft
              ? 'Persiapan tersimpan'
              : 'Siap untuk start berikutnya'}
        </p>
        <div className="next-action__title">
          <h2 className="batch-name">
            {getBatchName(next ?? { batchNumber: nextNumber })}
          </h2>
          {!running && draft && !batchNameEdit && (
            <button
              ref={editBatchButton}
              type="button"
              className="btn btn--small btn--secondary"
              disabled={busy}
              onClick={() => {
                setBatchNameError(null);
                setBatchEdit({ id: draft.id, name: getBatchName(draft) });
              }}
            >
              Edit nama
            </button>
          )}
        </div>
        {next && (
          <p className="next-action__participants">
            {nextBatchBibCount > 0
              ? `${nextBatchBibCount} bib dipilih`
              : 'Belum ada bib dipilih'}
          </p>
        )}
        {batchNameEdit && (
          <form
            className="batch-name-editor"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || !batchNameEdit.name.trim()) return;
              void perform(async () => {
                await onRenameBatch(batchNameEdit.id, batchNameEdit.name);
                closeBatchNameEditor();
              }, setBatchNameError);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !busy) closeBatchNameEditor();
            }}
          >
            <label className="field-label" htmlFor="batch-name">
              Nama gelombang
            </label>
            <input
              autoFocus
              className="text-input"
              id="batch-name"
              required
              readOnly={busy}
              value={batchNameEdit.name}
              onChange={(event) => {
                setBatchEdit({ ...batchNameEdit, name: event.target.value });
              }}
            />
            {batchNameError && (
              <div role="alert" className="inline-alert inline-alert--error">
                {batchNameError}
              </div>
            )}
            <div className="button-row">
              <button
                type="button"
                className="btn btn--secondary"
                disabled={busy}
                onClick={closeBatchNameEditor}
              >
                Batal
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={busy || !batchNameEdit.name.trim()}
              >
                {busy ? 'Menyimpan…' : 'Simpan nama'}
              </button>
            </div>
          </form>
        )}
        {running ? (
          <LiveTimer batch={running} />
        ) : (
          <p>
            {draft
              ? 'Lanjutkan memilih bib peserta sebelum start.'
              : 'Pilih bib peserta yang sudah berkumpul di garis start.'}
          </p>
        )}
        <button
          className="btn btn--primary btn--large btn--block"
          disabled={busy || isEditingBatchName}
          onClick={() =>
            next
              ? onOpenBatch(next)
              : void perform(() => onCreateBatch('TIMESTAMP_FIRST'))
          }
        >
          {running
            ? running.recoveryRequired
              ? 'Pulihkan sesi'
              : 'Lanjutkan pencatatan'
            : draft
              ? 'Lanjutkan persiapan'
              : 'Siapkan gelombang'}
        </button>
        <span className="next-action__note">
          {running
            ? 'Satu ketukan untuk setiap peserta finish.'
            : 'Catat waktu dahulu, isi bib saat ada jeda.'}
        </span>
      </section>

      <section className="event-summary" aria-label="Ringkasan kegiatan">
        <div>
          <strong>{completed.length}</strong>
          <span>Gelombang selesai</span>
        </div>
        <div>
          <strong>
            {
              allFinishEvents.filter((finish) => finish.status !== 'CANCELLED')
                .length
            }
          </strong>
          <span>Finish tercatat</span>
        </div>
        <div>
          <strong>{unresolved}</strong>
          <span>Perlu diperiksa</span>
        </div>
      </section>
      <section className="batch-history">
        <div className="section-header-row">
          <h2>Gelombang kegiatan</h2>
          <button className="btn btn--ghost" onClick={onNavigateResults}>
            Lihat hasil
          </button>
        </div>
        {batches.length === 0 ? (
          <div className="empty-state">
            Gelombang pertama akan muncul di sini setelah disiapkan.
          </div>
        ) : (
          <ul className="session-list">
            {[...batches]
              .sort((a, b) => b.batchNumber - a.batchNumber)
              .map((batch) => (
                <li key={batch.id}>
                  <button
                    className="session-row"
                    onClick={() => onOpenBatch(batch)}
                  >
                    <span>
                      <strong className="batch-name">
                        {getBatchName(batch)}
                      </strong>
                      <small>
                        {getBatchStatusLabel(
                          batch.status,
                          batch.recoveryRequired
                        )}
                      </small>
                    </span>
                    <span className="session-row__action">
                      {batch.status === 'REVIEW' ? 'Periksa' : 'Buka'}{' '}
                      <span aria-hidden="true">↗</span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>
      <div className="backup-reminder">
        <p>
          Data tersimpan di browser HP ini. Unduh backup untuk menyimpan salinan
          di luar perangkat.
        </p>
        <button className="btn btn--secondary" onClick={onNavigateExport}>
          Backup dan ekspor
        </button>
      </div>
    </div>
  );
}
