import { useRef, useState } from 'react';
import {
  BatchBibEntry,
  BatchRecord,
  BibColor,
  RecordingMode,
} from '../domain/types';
import {
  BIB_COLORS,
  BIB_COLOR_MAP,
  formatBibLabel,
  getBatchName,
} from '../domain/utils';
import { BibBadge } from '../components/BibBadge';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface RosterEntryScreenProps {
  batch: BatchRecord;
  roster: BatchBibEntry[];
  onAddBib: (params: {
    bibColor: BibColor;
    bibNumber: number;
    participantName?: string;
  }) => Promise<BatchBibEntry>;
  onUpdateBib: (params: {
    entryId: string;
    bibColor: BibColor;
    bibNumber: number;
    participantName?: string;
  }) => Promise<BatchBibEntry>;
  onRemoveBib: (id: string) => Promise<void>;
  onChangeMode: (mode: RecordingMode) => Promise<void>;
  onStartBatch: () => Promise<void>;
  onBackHome: () => void;
}

export function RosterEntryScreen({
  batch,
  roster,
  onAddBib,
  onUpdateBib,
  onRemoveBib,
  onStartBatch,
  onBackHome,
}: RosterEntryScreenProps) {
  const [color, setColor] = useState<BibColor>('WHITE');
  const [method, setMethod] = useState<'GRID' | 'TYPE'>('GRID');
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState<BatchBibEntry | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(new Set<string>());
  const [adding, setAdding] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  async function add(value: number) {
    const key = `${color}-${value}`;
    if (inFlight.current.has(key)) return;
    if (!Number.isInteger(value) || value < 1 || value > 50) {
      setError('Masukkan nomor bib 1 sampai 50.');
      return;
    }
    if (
      roster.some((item) => item.bibColor === color && item.bibNumber === value)
    ) {
      setError(`${formatBibLabel(color, value)} sudah ada di gelombang ini.`);
      return;
    }
    inFlight.current.add(key);
    setAdding([...inFlight.current]);
    setError(null);
    try {
      const entry = await onAddBib({
        bibColor: color,
        bibNumber: value,
        participantName:
          method === 'TYPE' ? name.trim() || undefined : undefined,
      });
      setFeedback(`${entry.bibLabel} ditambahkan`);
      setNumber('');
      setName('');
      if (method === 'TYPE') input.current?.focus();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Bib gagal ditambahkan.'
      );
    } finally {
      inFlight.current.delete(key);
      setAdding([...inFlight.current]);
    }
  }

  return (
    <div className="screen-container screen-container--with-sticky-footer roster-screen">
      <header className="page-heading">
        <button className="btn btn--ghost" onClick={onBackHome}>
          Kembali
        </button>
        <div>
          <p className="eyebrow">Siapkan</p>
          <h1 className="batch-name">{getBatchName(batch)}</h1>
        </div>
      </header>
      <p className="lead-copy">
        Pilih warna, lalu ketuk nomor peserta di garis start.
      </p>
      {error && (
        <p className="inline-alert inline-alert--error" role="alert">
          {error}
        </p>
      )}
      <section className="bib-entry" aria-label="Pilih bib peserta">
        <fieldset className="color-picker">
          <legend>Warna bib</legend>
          <div className="color-selector-grid">
            {BIB_COLORS.map((item) => (
              <label
                key={item}
                className={`color-choice-btn ${color === item ? 'color-choice-btn--selected' : ''}`}
                style={{
                  background: BIB_COLOR_MAP[item].bgHex,
                  color: BIB_COLOR_MAP[item].textHex,
                  borderColor: BIB_COLOR_MAP[item].borderHex,
                }}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name="bib-color"
                  value={item}
                  checked={color === item}
                  onChange={() => setColor(item)}
                />
                <strong>{BIB_COLOR_MAP[item].prefix}</strong>
                <span>{BIB_COLOR_MAP[item].nameId}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="segmented-toggle" aria-label="Metode input">
          <button
            className={
              method === 'GRID'
                ? 'segmented-btn segmented-btn--active'
                : 'segmented-btn'
            }
            aria-pressed={method === 'GRID'}
            onClick={() => setMethod('GRID')}
          >
            Grid 1–50
          </button>
          <button
            className={
              method === 'TYPE'
                ? 'segmented-btn segmented-btn--active'
                : 'segmented-btn'
            }
            aria-pressed={method === 'TYPE'}
            onClick={() => setMethod('TYPE')}
          >
            Ketik nomor
          </button>
        </div>
        {method === 'GRID' ? (
          <div className="quick-number-grid">
            {Array.from({ length: 50 }, (_, index) => index + 1).map(
              (value) => {
                const selected = roster.some(
                  (item) => item.bibColor === color && item.bibNumber === value
                );
                const waiting = adding.includes(`${color}-${value}`);
                return (
                  <button
                    key={value}
                    className={`quick-grid-btn ${selected ? 'quick-grid-btn--added' : ''}`}
                    disabled={selected || waiting}
                    aria-label={
                      selected
                        ? `${formatBibLabel(color, value)} sudah ditambahkan`
                        : `Tambah ${formatBibLabel(color, value)}`
                    }
                    onClick={() => void add(value)}
                  >
                    <span>{value}</span>
                    {selected && <small aria-hidden="true">✓</small>}
                  </button>
                );
              }
            )}
          </div>
        ) : (
          <form
            className="bib-type-form"
            onSubmit={(event) => {
              event.preventDefault();
              void add(Number(number));
            }}
          >
            <label className="field-label" htmlFor="bib-number">
              Nomor bib
            </label>
            <input
              ref={input}
              id="bib-number"
              className="text-input"
              type="number"
              inputMode="numeric"
              min="1"
              max="50"
              required
              value={number}
              onChange={(event) => setNumber(event.target.value)}
            />
            <label className="field-label" htmlFor="participant-name">
              Nama peserta (opsional)
            </label>
            <input
              id="participant-name"
              className="text-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button className="btn btn--primary" disabled={adding.length > 0}>
              Tambah bib
            </button>
          </form>
        )}
        <p className="entry-feedback" role="status">
          {feedback || 'Warna tetap terpilih untuk penambahan berikutnya.'}
        </p>
      </section>
      <section className="roster-selection">
        <div className="section-header-row">
          <h2>{roster.length} peserta terpilih</h2>
          <button
            className="btn btn--ghost"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Ringkas' : 'Ubah daftar'}
          </button>
        </div>
        {roster.length === 0 ? (
          <p className="helper-text">
            Tambahkan setidaknya satu peserta sebelum start.
          </p>
        ) : expanded ? (
          <ul className="roster-list">
            {roster.map((entry) => (
              <li key={entry.id} className="roster-item">
                <div className="roster-item__content">
                  <BibBadge color={entry.bibColor} number={entry.bibNumber} />
                  <span>{entry.participantName}</span>
                  <div className="button-row">
                    <button
                      className="btn btn--small btn--secondary"
                      onClick={() => {
                        setEditing(entry);
                        setName(entry.participantName ?? '');
                      }}
                    >
                      Ubah
                    </button>
                    <button
                      className="btn btn--small btn--danger-outline"
                      disabled={busy}
                      aria-label={`Hapus ${entry.bibLabel}`}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await onRemoveBib(entry.id);
                        } catch (failure) {
                          setError((failure as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="selected-bib-strip">
            {roster.map((entry) => (
              <BibBadge
                key={entry.id}
                color={entry.bibColor}
                number={entry.bibNumber}
                size="sm"
              />
            ))}
          </div>
        )}
      </section>
      <div className="sticky-bottom-bar">
        <div className="sticky-bottom-bar__summary">
          <span>{roster.length} peserta</span>
          <span>Waktu dulu, bib menyusul</span>
        </div>
        <button
          className="btn btn--primary btn--large btn--block"
          disabled={!roster.length || busy || adding.length > 0}
          onClick={() => setConfirm(true)}
        >
          Siap start
        </button>
      </div>
      <ConfirmDialog
        open={confirm}
        title={`Mulai ${getBatchName(batch)}?`}
        description={
          <>
            <p>
              {roster.length} peserta siap. Stopwatch dimulai saat kamu menekan
              Mulai sekarang.
            </p>
            <div className="selected-bib-strip">
              {roster.map((entry) => (
                <BibBadge
                  key={entry.id}
                  color={entry.bibColor}
                  number={entry.bibNumber}
                  size="sm"
                />
              ))}
            </div>
          </>
        }
        confirmLabel="Mulai sekarang"
        cancelLabel="Periksa lagi"
        onConfirm={onStartBatch}
        onCancel={() => setConfirm(false)}
      />
      <ConfirmDialog
        open={Boolean(editing)}
        title={`Ubah ${editing?.bibLabel ?? 'peserta'}`}
        description={
          <>
            <label className="field-label" htmlFor="edit-participant-name">
              Nama peserta (opsional)
            </label>
            <input
              id="edit-participant-name"
              className="text-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="helper-text">
              Untuk mengganti bib, hapus bib lama lalu pilih nomor yang benar.
            </p>
          </>
        }
        confirmLabel="Simpan perubahan"
        onCancel={() => {
          setEditing(null);
          setName('');
        }}
        onConfirm={async () => {
          if (!editing) return;
          await onUpdateBib({
            entryId: editing.id,
            bibColor: editing.bibColor,
            bibNumber: editing.bibNumber,
            participantName: name.trim() || undefined,
          });
          setEditing(null);
          setName('');
        }}
      />
    </div>
  );
}
