import { BibColor, BatchStatus, FinishEventStatus, ParticipantStatus, RecordingMode } from './types';

export interface BibColorMeta {
  color: BibColor;
  nameId: string; // Indonesian name
  prefix: string; // P, H, M, B, K
  bgHex: string;
  textHex: string;
  borderHex: string;
  sortOrder: number;
}

export const BIB_COLOR_MAP: Record<BibColor, BibColorMeta> = {
  WHITE: {
    color: 'WHITE',
    nameId: 'Putih',
    prefix: 'P',
    bgHex: '#ffffff',
    textHex: '#0f172a',
    borderHex: '#64748b',
    sortOrder: 1,
  },
  GREEN: {
    color: 'GREEN',
    nameId: 'Hijau',
    prefix: 'H',
    bgHex: '#15803d',
    textHex: '#ffffff',
    borderHex: '#14532d',
    sortOrder: 2,
  },
  RED: {
    color: 'RED',
    nameId: 'Merah',
    prefix: 'M',
    bgHex: '#b91c1c',
    textHex: '#ffffff',
    borderHex: '#7f1d1d',
    sortOrder: 3,
  },
  BLUE: {
    color: 'BLUE',
    nameId: 'Biru',
    prefix: 'B',
    bgHex: '#1d4ed8',
    textHex: '#ffffff',
    borderHex: '#1e3a8a',
    sortOrder: 4,
  },
  YELLOW: {
    color: 'YELLOW',
    nameId: 'Kuning',
    prefix: 'K',
    bgHex: '#facc15',
    textHex: '#0f172a',
    borderHex: '#a16207',
    sortOrder: 5,
  },
};

export const BIB_COLORS: BibColor[] = ['WHITE', 'GREEN', 'RED', 'BLUE', 'YELLOW'];

export function isValidBibColor(color: unknown): color is BibColor {
  return typeof color === 'string' && color in BIB_COLOR_MAP;
}

export function isValidBibNumber(num: unknown): num is number {
  return typeof num === 'number' && Number.isInteger(num) && num >= 1 && num <= 50;
}

export function formatBibLabel(color: BibColor, num: number): string {
  const meta = BIB_COLOR_MAP[color];
  const padded = String(num).padStart(2, '0');
  return `${meta.prefix}${padded}`;
}

export function formatBibFullLabel(color: BibColor, num: number): string {
  const meta = BIB_COLOR_MAP[color];
  return `${formatBibLabel(color, num)} (${meta.nameId} ${num})`;
}

export function formatSequenceLabel(sequence: number): string {
  return `F-${String(sequence).padStart(3, '0')}`;
}

/**
 * Formats integer milliseconds into MM:SS.cc (under 1 hour) or HH:MM:SS.cc (1 hour or longer).
 * Uses integer arithmetic to avoid floating-point drift.
 */
export function formatElapsedMs(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms)) {
    return '--:--.--';
  }
  const safeMs = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hundredths = Math.floor((safeMs % 1000) / 10);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const cc = String(hundredths).padStart(2, '0');

  if (hours > 0) {
    const hh = String(hours).padStart(2, '0');
    return `${hh}:${mm}:${ss}.${cc}`;
  }
  return `${mm}:${ss}.${cc}`;
}

/**
 * Parses a time string (MM:SS.cc or HH:MM:SS.cc) into integer milliseconds.
 * Returns null if invalid.
 */
export function parseElapsedString(input: string): number | null {
  const trimmed = input.trim();
  const match = /^(\d{1,2}:)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(trimmed);
  if (!match) return null;

  const hoursPart = match[1] ? parseInt(match[1].replace(':', ''), 10) : 0;
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const fractionStr = match[4] ?? '0';

  if (minutes >= 60 || seconds >= 60) return null;

  let msFraction = 0;
  if (fractionStr.length === 1) {
    msFraction = parseInt(fractionStr, 10) * 100;
  } else if (fractionStr.length === 2) {
    msFraction = parseInt(fractionStr, 10) * 10;
  } else {
    msFraction = parseInt(fractionStr, 10);
  }

  return ((hoursPart * 3600 + minutes * 60 + seconds) * 1000) + msFraction;
}

export function formatWallClockTime(isoString?: string): string {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return d.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export function formatWallClockDateTime(isoString?: string): string {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return d.toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export function getBatchStatusLabel(status: BatchStatus, recoveryRequired?: boolean): string {
  if (recoveryRequired && status === 'RUNNING') {
    return 'Perlu Pemulihan';
  }
  switch (status) {
    case 'DRAFT':
      return 'Persiapan (Draft)';
    case 'READY':
      return 'Siap Mulai';
    case 'RUNNING':
      return 'Sedang Berjalan';
    case 'REVIEW':
      return 'Tinjau Hasil';
    case 'COMPLETED':
      return 'Selesai';
    case 'NEEDS_REVIEW':
      return 'Perlu Diperiksa';
  }
}

export function getParticipantStatusLabel(status: ParticipantStatus): string {
  switch (status) {
    case 'WAITING':
      return 'Belum Finish';
    case 'FINISHED':
      return 'Finish';
    case 'DNS':
      return 'DNS (Tidak Start)';
    case 'DNF':
      return 'DNF (Tidak Selesai)';
    case 'NEEDS_REVIEW':
      return 'Perlu Diperiksa';
  }
}

export function getFinishEventStatusLabel(status: FinishEventStatus): string {
  switch (status) {
    case 'UNIDENTIFIED':
      return 'Belum Diidentifikasi';
    case 'IDENTIFIED':
      return 'Teridentifikasi';
    case 'CANCELLED':
      return 'Dibatalkan';
    case 'NEEDS_REVIEW':
      return 'Perlu Diperiksa';
  }
}

export function getRecordingModeLabel(mode: RecordingMode): string {
  switch (mode) {
    case 'TIMESTAMP_FIRST':
      return 'Catat Waktu Dulu (Disarankan)';
    case 'DIRECT_CARD':
      return 'Ketuk Kartu Nomor Langsung';
  }
}

export function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

export function matchesBibQuery(
  entry: { bibColor: BibColor; bibNumber: number; bibLabel: string; participantName?: string },
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const meta = BIB_COLOR_MAP[entry.bibColor];
  const shortCompact = `${meta.prefix.toLowerCase()}${entry.bibNumber}`;
  const colorNameNum = `${meta.nameId.toLowerCase()} ${entry.bibNumber}`;
  const colorNamePadded = `${meta.nameId.toLowerCase()} ${String(entry.bibNumber).padStart(2, '0')}`;

  return (
    entry.bibLabel.toLowerCase().includes(q) ||
    shortCompact.includes(q) ||
    String(entry.bibNumber) === q ||
    meta.nameId.toLowerCase().includes(q) ||
    colorNameNum.includes(q) ||
    colorNamePadded.includes(q) ||
    (entry.participantName ? entry.participantName.toLowerCase().includes(q) : false)
  );
}
