import { BatchRecord } from '../domain/types';
import { formatElapsedMs } from '../domain/utils';
import { useBatchLiveTimer } from '../services/timekeeper';

export function LiveTimer({
  batch,
  compact = false,
}: {
  batch: BatchRecord;
  compact?: boolean;
}) {
  const elapsed = useBatchLiveTimer(batch);
  return (
    <span
      className={compact ? 'timer-compact' : 'timer-value'}
      role="timer"
      aria-live="off"
    >
      {batch.recoveryRequired ? 'Pulihkan sesi' : formatElapsedMs(elapsed)}
    </span>
  );
}
