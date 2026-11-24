import { useState } from 'react';
import { ExportService } from '../services/exportService';
import { downloadBackupJson } from '../services/fileDownload';

export function QuickBackupButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const content = await ExportService.buildJsonBackupString();
      downloadBackupJson(content);
      setMessage('Unduhan backup dimulai.');
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Backup gagal dibuat. Coba lagi.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="quick-backup">
      <button
        type="button"
        className="btn btn--secondary"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void download()}
      >
        {busy ? 'Menyiapkan backup…' : 'Unduh backup'}
      </button>
      <p className="helper-text">
        Backup JSON mencakup semua kegiatan di perangkat ini.
      </p>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="inline-alert inline-alert--error">
          {error}
        </p>
      )}
    </div>
  );
}
