export function triggerBlobDownload(filename: string, blob: Blob): void {
  if (typeof URL.createObjectURL !== 'function') {
    throw new Error(
      'Browser ini belum mendukung unduhan file. Coba gunakan browser lain.'
    );
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => {
      if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
    }, 5000);
  }
}

export function triggerFileDownload(
  filename: string,
  content: string,
  mimeType: string
): void {
  triggerBlobDownload(filename, new Blob([content], { type: mimeType }));
}

export function downloadBackupJson(content: string): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `run-timing-backup-${timestamp}.json`;
  triggerFileDownload(filename, content, 'application/json;charset=utf-8');
  return filename;
}
