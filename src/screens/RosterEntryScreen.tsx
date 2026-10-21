import React, { useRef, useState } from 'react';
import {
  BatchBibEntry,
  BatchRecord,
  BibColor,
  RecordingMode,
} from '../domain/types';
import {
  BIB_COLOR_MAP,
  BIB_COLORS,
  formatBibLabel,
  getRecordingModeLabel,
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
  onRemoveBib: (entryId: string) => Promise<void>;
  onChangeMode: (mode: RecordingMode) => Promise<void>;
  onStartBatch: () => Promise<void>;
  onBackHome: () => void;
}

export const RosterEntryScreen: React.FC<RosterEntryScreenProps> = ({
  batch,
  roster,
  onAddBib,
  onUpdateBib,
  onRemoveBib,
  onChangeMode,
  onStartBatch,
  onBackHome,
}) => {
  const [selectedColor, setSelectedColor] = useState<BibColor>('WHITE');
  const [numberInput, setNumberInput] = useState<string>('');
  const [participantNameInput, setParticipantNameInput] = useState<string>('');
  const [showOptionalName, setShowOptionalName] = useState<boolean>(false);
  const [inputModeTab, setInputModeTab] = useState<'KEYPAD' | 'GRID'>('KEYPAD');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastAddedLabel, setLastAddedLabel] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [inFlightKeys, setInFlightKeys] = useState<Set<string>>(() => new Set());

  // Edit existing entry state
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editColor, setEditColor] = useState<BibColor>('WHITE');
  const [editNumber, setEditNumber] = useState<string>('');
  const [editName, setEditName] = useState<string>('');

  // Confirm start dialog
  const [confirmStartOpen, setConfirmStartOpen] = useState<boolean>(false);

  const numberFieldRef = useRef<HTMLInputElement | null>(null);

  const existingNumbersForSelectedColor = new Set(
    roster.filter((r) => r.bibColor === selectedColor).map((r) => r.bibNumber)
  );

  const handleAddNumber = async (rawNumberStr: string) => {
    setErrorMessage(null);
    const trimmed = rawNumberStr.trim();
    if (!trimmed) {
      setErrorMessage('Masukkan nomor bib terlebih dahulu (1 sampai 50).');
      return;
    }
    if (!/^\d+$/.test(trimmed)) {
      setErrorMessage('Nomor bib harus berupa angka bulat (1 sampai 50).');
      return;
    }
    const parsed = parseInt(trimmed, 10);
    if (parsed < 1 || parsed > 50) {
      setErrorMessage(`Nomor ${parsed} tidak valid. Masukkan angka antara 1 sampai 50.`);
      return;
    }

    const key = `${selectedColor}_${parsed}`;
    if (inFlightKeys.has(key)) return;
    setInFlightKeys((prev) => new Set(prev).add(key));

    try {
      const added = await onAddBib({
        bibColor: selectedColor,
        bibNumber: parsed,
        participantName: participantNameInput.trim() || undefined,
      });
      setNumberInput('');
      setParticipantNameInput('');
      setLastAddedLabel(`${added.bibLabel} (${BIB_COLOR_MAP[added.bibColor].nameId} ${added.bibNumber})`);
      numberFieldRef.current?.focus();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal menambahkan nomor bib.');
    } finally {
      setInFlightKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void handleAddNumber(numberInput);
  };

  const handleKeypadDigit = (digit: string) => {
    setErrorMessage(null);
    setNumberInput((prev) => {
      const next = `${prev}${digit}`.replace(/^0+/, '');
      if (next.length > 2) return prev;
      return next;
    });
  };

  const handleKeypadBackspace = () => {
    setErrorMessage(null);
    setNumberInput((prev) => prev.slice(0, -1));
  };

  const startEditingEntry = (entry: BatchBibEntry) => {
    setErrorMessage(null);
    setEditingEntryId(entry.id);
    setEditColor(entry.bibColor);
    setEditNumber(String(entry.bibNumber));
    setEditName(entry.participantName ?? '');
  };

  const handleSaveEditEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntryId) return;
    setErrorMessage(null);
    const parsed = parseInt(editNumber.trim(), 10);
    if (!/^\d+$/.test(editNumber.trim()) || parsed < 1 || parsed > 50) {
      setErrorMessage('Nomor bib pengganti harus berupa angka 1–50.');
      return;
    }
    setIsBusy(true);
    try {
      await onUpdateBib({
        entryId: editingEntryId,
        bibColor: editColor,
        bibNumber: parsed,
        participantName: editName.trim() || undefined,
      });
      setEditingEntryId(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal mengubah nomor bib.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleAttemptStartBatch = () => {
    setErrorMessage(null);
    if (roster.length === 0) {
      setErrorMessage('Daftar peserta masih kosong! Tambahkan minimal 1 nomor bib sebelum memulai batch.');
      return;
    }
    setConfirmStartOpen(true);
  };

  const handleConfirmStartBatch = async () => {
    setConfirmStartOpen(false);
    setErrorMessage(null);
    setIsBusy(true);
    try {
      await onStartBatch();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal memulai batch.');
    } finally {
      setIsBusy(false);
    }
  };

  // Count by color for summary
  const countByColor = BIB_COLORS.map((color) => ({
    color,
    meta: BIB_COLOR_MAP[color],
    count: roster.filter((r) => r.bibColor === color).length,
  })).filter((c) => c.count > 0);

  // Recent 5 added entries (newest first)
  const recentEntries = [...roster].reverse().slice(0, 5);

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
            <span className="sticky-top-bar__title">Batch #{batch.batchNumber} • Persiapan</span>
            <span className="sticky-top-bar__sub">
              Total Peserta: <strong>{roster.length}</strong>
            </span>
          </div>
        </div>
        <span className="save-indicator">Tersimpan Lokal</span>
      </header>

      {/* Mode Selection Bar */}
      <section className="card compact-card" aria-label="Mode Pencatatan Saat Lari">
        <div className="mode-bar">
          <div>
            <span className="eyebrow-label">MODE PENCATATAN FINISH</span>
            <div className="mode-bar__current">
              {getRecordingModeLabel(batch.recordingMode)}
            </div>
          </div>
          <div className="mode-bar__buttons">
            <button
              type="button"
              className={`btn btn--small ${
                batch.recordingMode === 'TIMESTAMP_FIRST'
                  ? 'btn--primary'
                  : 'btn--secondary'
              }`}
              onClick={() => void onChangeMode('TIMESTAMP_FIRST')}
            >
              Catat Waktu Dulu
            </button>
            <button
              type="button"
              className={`btn btn--small ${
                batch.recordingMode === 'DIRECT_CARD'
                  ? 'btn--primary'
                  : 'btn--secondary'
              }`}
              onClick={() => void onChangeMode('DIRECT_CARD')}
            >
              Ketuk Kartu
            </button>
          </div>
        </div>
      </section>

      {/* Step 1: Select Bib Color */}
      <section className="card" aria-label="Input Nomor Bib">
        <div className="section-header-row">
          <h2 className="section-title">1. Pilih Warna Bib</h2>
          <span className="helper-badge">
            Aktif: {BIB_COLOR_MAP[selectedColor].nameId} ({BIB_COLOR_MAP[selectedColor].prefix})
          </span>
        </div>

        <div className="color-selector-grid" role="radiogroup" aria-label="Warna Bib">
          {BIB_COLORS.map((color) => {
            const meta = BIB_COLOR_MAP[color];
            const isSelected = selectedColor === color;
            const colorCount = roster.filter((r) => r.bibColor === color).length;
            return (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={isSelected}
                className={`color-choice-btn ${
                  isSelected ? 'color-choice-btn--selected' : ''
                }`}
                style={{
                  backgroundColor: meta.bgHex,
                  color: meta.textHex,
                  borderColor: isSelected ? '#0f172a' : meta.borderHex,
                }}
                onClick={() => {
                  setSelectedColor(color);
                  setErrorMessage(null);
                }}
              >
                <span className="color-choice-btn__prefix">{meta.prefix}</span>
                <span className="color-choice-btn__name">{meta.nameId}</span>
                {colorCount > 0 && (
                  <span className="color-choice-btn__count">{colorCount}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Step 2: Enter Number */}
        <div className="section-header-row" style={{ marginTop: '1rem' }}>
          <h2 className="section-title">2. Masukkan Nomor (1–50)</h2>
          <div className="segmented-toggle" role="tablist" aria-label="Metode Input Nomor">
            <button
              type="button"
              role="tab"
              aria-selected={inputModeTab === 'KEYPAD'}
              className={`segmented-toggle__btn ${
                inputModeTab === 'KEYPAD' ? 'segmented-toggle__btn--active' : ''
              }`}
              onClick={() => setInputModeTab('KEYPAD')}
            >
              Keypad / Ketik
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inputModeTab === 'GRID'}
              className={`segmented-toggle__btn ${
                inputModeTab === 'GRID' ? 'segmented-toggle__btn--active' : ''
              }`}
              onClick={() => setInputModeTab('GRID')}
            >
              Grid Cepat 1–50
            </button>
          </div>
        </div>

        {errorMessage && (
          <div className="inline-alert inline-alert--error" role="alert">
            {errorMessage}
          </div>
        )}

        {lastAddedLabel && !errorMessage && (
          <div className="inline-alert inline-alert--success" role="status">
            Ditambahkan: <strong>{lastAddedLabel}</strong> • Total: {roster.length} peserta
          </div>
        )}

        {inputModeTab === 'KEYPAD' ? (
          <form onSubmit={handleFormSubmit} className="bib-input-form">
            <div className="bib-preview-input-row">
              <div
                className="bib-live-preview"
                style={{
                  backgroundColor: BIB_COLOR_MAP[selectedColor].bgHex,
                  color: BIB_COLOR_MAP[selectedColor].textHex,
                  borderColor: BIB_COLOR_MAP[selectedColor].borderHex,
                }}
              >
                <span className="bib-live-preview__code">
                  {numberInput
                    ? formatBibLabel(selectedColor, parseInt(numberInput, 10) || 0)
                    : `${BIB_COLOR_MAP[selectedColor].prefix}--`}
                </span>
                <span className="bib-live-preview__label">
                  {BIB_COLOR_MAP[selectedColor].nameId}
                </span>
              </div>

              <div className="bib-number-input-wrapper">
                <label htmlFor="bib-number-input" className="sr-only">
                  Nomor Bib (1 sampai 50)
                </label>
                <input
                  ref={numberFieldRef}
                  id="bib-number-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={2}
                  className="bib-number-input"
                  placeholder="No. 1-50"
                  value={numberInput}
                  onChange={(e) => {
                    setErrorMessage(null);
                    setNumberInput(e.target.value.replace(/[^0-9]/g, ''));
                  }}
                />
              </div>

              <button
                type="submit"
                className="btn btn--primary btn--add-bib"
                disabled={isBusy}
              >
                Tambah Nomor
              </button>
            </div>

            {/* Optional participant name toggle */}
            <div className="optional-name-row">
              {!showOptionalName ? (
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setShowOptionalName(true)}
                >
                  + Catatan / Nama Peserta (Opsional)
                </button>
              ) : (
                <div className="optional-name-field">
                  <label htmlFor="participant-name-input" className="field-label">
                    Nama / Catatan Peserta (Opsional):
                  </label>
                  <input
                    id="participant-name-input"
                    type="text"
                    className="text-input"
                    placeholder="Misal: Budi (opsional)"
                    value={participantNameInput}
                    onChange={(e) => setParticipantNameInput(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Built-in Large Touch Keypad */}
            <div className="touch-keypad" aria-label="Keypad Angka Cepat">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  className="touch-keypad__btn"
                  onClick={() => handleKeypadDigit(digit)}
                >
                  {digit}
                </button>
              ))}
              <button
                type="button"
                className="touch-keypad__btn touch-keypad__btn--secondary"
                onClick={handleKeypadBackspace}
                aria-label="Hapus Digit"
              >
                ⌫ Hapus
              </button>
              <button
                type="button"
                className="touch-keypad__btn"
                onClick={() => handleKeypadDigit('0')}
              >
                0
              </button>
              <button
                type="button"
                className="touch-keypad__btn touch-keypad__btn--submit"
                onClick={() => void handleAddNumber(numberInput)}
                disabled={isBusy}
              >
                + Tambah
              </button>
            </div>
          </form>
        ) : (
          <div className="quick-number-grid-container">
            <p className="helper-text">
              Ketuk angka untuk langsung menambahkan bib warna{' '}
              <strong>{BIB_COLOR_MAP[selectedColor].nameId}</strong>:
            </p>
            <div className="quick-number-grid">
              {Array.from({ length: 50 }, (_, idx) => idx + 1).map((num) => {
                const alreadyAdded = existingNumbersForSelectedColor.has(num);
                const inFlight = inFlightKeys.has(`${selectedColor}_${num}`);
                const label = formatBibLabel(selectedColor, num);
                return (
                  <button
                    key={num}
                    type="button"
                    disabled={alreadyAdded || inFlight}
                    className={`quick-grid-btn ${
                      alreadyAdded ? 'quick-grid-btn--added' : ''
                    }`}
                    onClick={() => void handleAddNumber(String(num))}
                    aria-label={
                      alreadyAdded
                        ? `${label} sudah ditambahkan`
                        : `Tambah ${label}`
                    }
                  >
                    <span>{num}</span>
                    {alreadyAdded && <span className="quick-grid-btn__check">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Recently added chips for immediate visual verification */}
        {recentEntries.length > 0 && (
          <div className="recent-added-strip">
            <span className="recent-added-strip__label">Baru ditambahkan:</span>
            <div className="recent-added-strip__list">
              {recentEntries.map((entry) => (
                <BibBadge
                  key={entry.id}
                  color={entry.bibColor}
                  number={entry.bibNumber}
                  size="sm"
                  showColorName={false}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Roster Review List */}
      <section className="card" aria-label="Daftar Peserta Batch">
        <div className="section-header-row">
          <h2 className="section-title">
            Daftar Peserta Batch #{batch.batchNumber} ({roster.length})
          </h2>
          {countByColor.length > 0 && (
            <div className="color-summary-pills">
              {countByColor.map((c) => (
                <span key={c.color} className="color-summary-pill">
                  {c.meta.nameId}: <strong>{c.count}</strong>
                </span>
              ))}
            </div>
          )}
        </div>

        {roster.length === 0 ? (
          <div className="empty-state">
            Belum ada nomor bib ditambahkan. Pilih warna dan masukkan nomor 1–50 di atas.
          </div>
        ) : (
          <ul className="roster-list">
            {roster.map((entry, idx) => (
              <li key={entry.id} className="roster-item">
                {editingEntryId === entry.id ? (
                  <form onSubmit={handleSaveEditEntry} className="roster-edit-form">
                    <div className="roster-edit-row">
                      <select
                        aria-label="Ubah Warna Bib"
                        className="select-input"
                        value={editColor}
                        onChange={(e) => setEditColor(e.target.value as BibColor)}
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
                        aria-label="Ubah Nomor Bib"
                        className="text-input"
                        value={editNumber}
                        onChange={(e) => setEditNumber(e.target.value)}
                      />
                      <input
                        type="text"
                        aria-label="Ubah Nama Peserta"
                        className="text-input"
                        placeholder="Nama (opsional)"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    </div>
                    <div className="roster-edit-actions">
                      <button
                        type="button"
                        className="btn btn--small btn--secondary"
                        onClick={() => setEditingEntryId(null)}
                      >
                        Batal
                      </button>
                      <button type="submit" className="btn btn--small btn--primary">
                        Simpan Perubahan
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="roster-item__content">
                    <div className="roster-item__left">
                      <span className="roster-item__index">#{idx + 1}</span>
                      <BibBadge
                        color={entry.bibColor}
                        number={entry.bibNumber}
                        size="md"
                      />
                      {entry.participantName && (
                        <span className="roster-item__name">{entry.participantName}</span>
                      )}
                    </div>
                    <div className="roster-item__actions">
                      <button
                        type="button"
                        className="btn btn--small btn--ghost"
                        onClick={() => startEditingEntry(entry)}
                      >
                        Ubah
                      </button>
                      <button
                        type="button"
                        className="btn btn--small btn--danger-outline"
                        onClick={() => void onRemoveBib(entry.id)}
                        aria-label={`Hapus ${entry.bibLabel}`}
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Bottom Sticky Action Area */}
      <div className="sticky-bottom-bar">
        <div className="sticky-bottom-bar__summary">
          <span>
            Siap Start: <strong>{roster.length} peserta</strong>
          </span>
          <span className="sticky-bottom-bar__mode">
            Mode: {batch.recordingMode === 'TIMESTAMP_FIRST' ? 'Catat Waktu Dulu' : 'Ketuk Kartu'}
          </span>
        </div>
        <button
          type="button"
          className="btn btn--start-batch btn--large btn--block"
          onClick={handleAttemptStartBatch}
          disabled={isBusy}
        >
          MULAI BATCH #{batch.batchNumber} ({roster.length} Peserta)
        </button>
      </div>

      {/* Start Batch Confirmation Dialog */}
      <ConfirmDialog
        open={confirmStartOpen}
        title={`Mulai Batch #${batch.batchNumber} Sekarang?`}
        description={
          <div>
            <p>
              Stopwatch akan langsung berjalan begitu Anda menekan{' '}
              <strong>Mulai Batch</strong>.
            </p>
            <ul className="dialog-summary-list">
              <li>
                Total Peserta: <strong>{roster.length} nomor bib</strong>
              </li>
              <li>
                Rincian Warna:{' '}
                {countByColor.map((c) => `${c.meta.nameId} (${c.count})`).join(', ')}
              </li>
              <li>
                Mode Finish: <strong>{getRecordingModeLabel(batch.recordingMode)}</strong>
              </li>
            </ul>
            <p className="helper-text">
              Daftar peserta akan dikunci setelah batch dimulai untuk menjaga integritas data.
            </p>
          </div>
        }
        confirmLabel="Mulai Batch Sekarang"
        cancelLabel="Periksa Lagi"
        variant="primary"
        onConfirm={() => void handleConfirmStartBatch()}
        onCancel={() => setConfirmStartOpen(false)}
      />
    </div>
  );
};
