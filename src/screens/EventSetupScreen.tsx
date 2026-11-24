import { useState } from 'react';
import { CopyrightFooter } from '../components/CopyrightFooter';

interface EventSetupScreenProps {
  writable: boolean;
  checkingAccess: boolean;
  onRetryAccess: () => void;
  onCreate: (name: string, date: string) => Promise<void>;
}

export function EventSetupScreen({
  writable,
  checkingAccess,
  onRetryAccess,
  onCreate,
}: EventSetupScreenProps) {
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => {
    const today = new Date();
    return [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-');
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="screen-container dashboard">
      <header className="page-heading">
        <div>
          <h1>Buat kegiatan</h1>
          <p>
            Masukkan nama dan tanggal kegiatan untuk mulai menyiapkan gelombang.
          </p>
        </div>
      </header>
      {!writable && (
        <div className="inline-alert" role="status">
          <p>Gunakan tab pencatatan untuk membuat kegiatan.</p>
          <button
            className="btn btn--secondary"
            disabled={checkingAccess}
            onClick={onRetryAccess}
          >
            {checkingAccess ? 'Memeriksa akses…' : 'Coba akses pencatatan'}
          </button>
        </div>
      )}
      <form
        className="card event-setup"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !writable || !name.trim()) return;
          setBusy(true);
          setError(null);
          try {
            await onCreate(name.trim(), date);
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : 'Kegiatan gagal disimpan.'
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="write-surface" disabled={!writable || busy}>
          <label className="field-label" htmlFor="setup-event-name">
            Nama kegiatan
          </label>
          <input
            className="text-input"
            id="setup-event-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <label className="field-label" htmlFor="setup-event-date">
            Tanggal
          </label>
          <input
            className="text-input"
            id="setup-event-date"
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          {error && (
            <p className="inline-alert inline-alert--error" role="alert">
              {error}
            </p>
          )}
          <div className="button-row">
            <button className="btn btn--primary" disabled={!name.trim()}>
              {busy ? 'Menyimpan…' : 'Simpan kegiatan'}
            </button>
          </div>
        </fieldset>
      </form>
      <CopyrightFooter />
    </main>
  );
}
