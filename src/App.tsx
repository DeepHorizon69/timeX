import React, { useCallback, useEffect, useState } from 'react';
import {
  AuditLogRecord,
  BatchBibEntry,
  BatchRecord,
  BibColor,
  EventRecord,
  FinishEventRecord,
  ParticipantStatus,
  RecordingMode,
} from './domain/types';
import {
  AuditRepository,
  BatchRepository,
  EventRepository,
  FinishEventRepository,
} from './db/repositories';
import {
  CapturedFinishTiming,
  getActiveSessionBatchIds,
  registerSessionStartedBatch,
} from './services/timekeeper';
import { DashboardScreen } from './screens/DashboardScreen';
import { RosterEntryScreen } from './screens/RosterEntryScreen';
import { RunningBatchScreen } from './screens/RunningBatchScreen';
import { ReviewBatchScreen } from './screens/ReviewBatchScreen';
import { ResultsHistoryScreen } from './screens/ResultsHistoryScreen';
import { ExportBackupScreen } from './screens/ExportBackupScreen';

export type ScreenName =
  | 'HOME'
  | 'ROSTER_ENTRY'
  | 'RUNNING'
  | 'REVIEW'
  | 'RESULTS'
  | 'EXPORT';

export const App: React.FC = () => {
  const [loading, setLoading] = useState<boolean>(true);
  const [initError, setInitError] = useState<string | null>(null);

  const [activeEvent, setActiveEvent] = useState<EventRecord | null>(null);
  const [allEvents, setAllEvents] = useState<EventRecord[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [allBibEntries, setAllBibEntries] = useState<BatchBibEntry[]>([]);
  const [allFinishEvents, setAllFinishEvents] = useState<FinishEventRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);

  const [currentScreen, setCurrentScreen] = useState<ScreenName>('HOME');
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  const reloadEventData = useCallback(async (targetEventId?: string) => {
    const events = await EventRepository.listEvents();
    setAllEvents(events);

    let event: EventRecord | undefined;
    if (targetEventId) {
      event = events.find((e) => e.id === targetEventId);
    }
    if (!event) {
      event = events.find((e) => e.status === 'ACTIVE') ?? events[0];
    }
    if (!event) {
      event = await EventRepository.ensureDefaultEvent();
      const updatedEvents = await EventRepository.listEvents();
      setAllEvents(updatedEvents);
    }

    setActiveEvent(event);

    const eventBatches = await BatchRepository.listBatchesByEvent(event.id);
    setBatches(eventBatches);

    // Load all bib entries & finish events for batches of this event
    const bibLists = await Promise.all(
      eventBatches.map((b) => BatchRepository.listBibEntriesByBatch(b.id))
    );
    const finishLists = await Promise.all(
      eventBatches.map((b) => FinishEventRepository.listFinishEventsByBatch(b.id))
    );
    const logs = await AuditRepository.listByEvent(event.id);

    setAllBibEntries(bibLists.flat());
    setAllFinishEvents(finishLists.flat());
    setAuditLogs(logs);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        await BatchRepository.flagRunningBatchesForRecovery(
          getActiveSessionBatchIds()
        );
        await reloadEventData();
      } catch (err) {
        if (mounted) {
          setInitError(
            err instanceof Error
              ? err.message
              : 'Gagal membuka penyimpanan lokal IndexedDB.'
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }
    void init();
    return () => {
      mounted = false;
    };
  }, [reloadEventData]);

  const selectedBatch = batches.find((b) => b.id === selectedBatchId) ?? null;
  const selectedBatchRoster = allBibEntries.filter(
    (e) => e.batchId === selectedBatchId
  );
  const selectedBatchFinishes = allFinishEvents.filter(
    (f) => f.batchId === selectedBatchId
  );

  const handleOpenBatch = (batch: BatchRecord) => {
    setSelectedBatchId(batch.id);
    if (batch.status === 'DRAFT' || batch.status === 'READY') {
      setCurrentScreen('ROSTER_ENTRY');
    } else if (batch.status === 'RUNNING') {
      setCurrentScreen('RUNNING');
    } else if (batch.status === 'REVIEW') {
      setCurrentScreen('REVIEW');
    } else {
      setCurrentScreen('RESULTS');
    }
  };

  const handleCreateBatch = async (mode: RecordingMode) => {
    if (!activeEvent) return;
    const created = await BatchRepository.createBatch(activeEvent.id, mode);
    await reloadEventData(activeEvent.id);
    setSelectedBatchId(created.id);
    setCurrentScreen('ROSTER_ENTRY');
  };

  const handleStartBatch = async () => {
    if (!selectedBatch) return;
    const startedAtWallClock = new Date().toISOString();
    const startedAtMonotonicMs = performance.now();

    await BatchRepository.startBatch({
      batchId: selectedBatch.id,
      startedAtWallClock,
      startedAtMonotonicMs,
    });
    registerSessionStartedBatch(selectedBatch.id);
    await reloadEventData(selectedBatch.eventId);
    setCurrentScreen('RUNNING');
  };

  if (loading) {
    return (
      <div className="screen-container">
        <div className="card">
          <p>Memuat penyimpanan lokal perangkat...</p>
        </div>
      </div>
    );
  }

  if (initError || !activeEvent) {
    return (
      <div className="screen-container">
        <div className="card warning-card" role="alert">
          <h1>Gagal Mengakses Penyimpanan Lokal</h1>
          <p>{initError ?? 'Penyimpanan IndexedDB tidak tersedia di browser ini.'}</p>
          <p>
            Pastikan browser tidak berada dalam mode pemblokiran penyimpanan penuh, lalu muat ulang halaman.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* Top Global Navigation Strip */}
      <nav className="app-top-nav" aria-label="Navigasi Utama">
        <button
          type="button"
          className={`app-top-nav__brand ${
            currentScreen === 'HOME' ? 'app-top-nav__brand--active' : ''
          }`}
          onClick={() => setCurrentScreen('HOME')}
        >
          ⏱ Run Timing
        </button>
        <div className="app-top-nav__links">
          <button
            type="button"
            className={`app-top-nav__link ${
              currentScreen === 'HOME' ? 'app-top-nav__link--active' : ''
            }`}
            onClick={() => setCurrentScreen('HOME')}
          >
            Beranda
          </button>
          <button
            type="button"
            className={`app-top-nav__link ${
              currentScreen === 'RESULTS' ? 'app-top-nav__link--active' : ''
            }`}
            onClick={() => setCurrentScreen('RESULTS')}
          >
            Hasil
          </button>
          <button
            type="button"
            className={`app-top-nav__link ${
              currentScreen === 'EXPORT' ? 'app-top-nav__link--active' : ''
            }`}
            onClick={() => setCurrentScreen('EXPORT')}
          >
            Ekspor/Backup
          </button>
        </div>
      </nav>

      <main className="app-main">
        {currentScreen === 'HOME' && (
          <DashboardScreen
            activeEvent={activeEvent}
            allEvents={allEvents}
            batches={batches}
            allFinishEvents={allFinishEvents}
            allBibEntries={allBibEntries}
            onCreateBatch={handleCreateBatch}
            onOpenBatch={handleOpenBatch}
            onNavigateResults={() => setCurrentScreen('RESULTS')}
            onNavigateExport={() => setCurrentScreen('EXPORT')}
            onUpdateEvent={async (name, eventDate) => {
              await EventRepository.updateEvent(activeEvent.id, {
                name,
                eventDate,
              });
              await reloadEventData(activeEvent.id);
            }}
            onCreateNewEvent={async (name, eventDate) => {
              const created = await EventRepository.createEvent(name, eventDate);
              await reloadEventData(created.id);
            }}
            onSwitchEvent={async (eventId) => {
              await EventRepository.switchActiveEvent(eventId);
              await reloadEventData(eventId);
            }}
          />
        )}

        {currentScreen === 'ROSTER_ENTRY' && selectedBatch && (
          <RosterEntryScreen
            batch={selectedBatch}
            roster={selectedBatchRoster}
            onAddBib={async ({ bibColor, bibNumber, participantName }) => {
              const entry = await BatchRepository.addBibToBatch({
                batchId: selectedBatch.id,
                bibColor,
                bibNumber,
                participantName,
              });
              await reloadEventData(selectedBatch.eventId);
              return entry;
            }}
            onUpdateBib={async ({
              entryId,
              bibColor,
              bibNumber,
              participantName,
            }) => {
              const updated = await BatchRepository.updateBibInDraftBatch({
                entryId,
                bibColor,
                bibNumber,
                participantName,
              });
              await reloadEventData(selectedBatch.eventId);
              return updated;
            }}
            onRemoveBib={async (entryId) => {
              await BatchRepository.removeBibFromDraftBatch(entryId);
              await reloadEventData(selectedBatch.eventId);
            }}
            onChangeMode={async (mode) => {
              await BatchRepository.updateRecordingMode(selectedBatch.id, mode);
              await reloadEventData(selectedBatch.eventId);
            }}
            onStartBatch={handleStartBatch}
            onBackHome={() => setCurrentScreen('HOME')}
          />
        )}

        {currentScreen === 'RUNNING' && selectedBatch && (
          <RunningBatchScreen
            batch={selectedBatch}
            roster={selectedBatchRoster}
            finishEvents={selectedBatchFinishes}
            onRecordTimestampFinish={async (timing: CapturedFinishTiming) => {
              const rec = await FinishEventRepository.recordTimestampFirstFinish({
                batchId: selectedBatch.id,
                recordedAtWallClock: timing.recordedAtWallClock,
                recordedAtMonotonicMs: timing.recordedAtMonotonicMs,
                elapsedMs: timing.elapsedMs,
                timingSource: timing.timingSource,
              });
              await reloadEventData(selectedBatch.eventId);
              return rec;
            }}
            onRecordDirectCardFinish={async (
              batchBibEntryId: string,
              timing: CapturedFinishTiming
            ) => {
              await FinishEventRepository.recordDirectCardFinish({
                batchId: selectedBatch.id,
                batchBibEntryId,
                recordedAtWallClock: timing.recordedAtWallClock,
                recordedAtMonotonicMs: timing.recordedAtMonotonicMs,
                elapsedMs: timing.elapsedMs,
                timingSource: timing.timingSource,
              });
              await reloadEventData(selectedBatch.eventId);
            }}
            onIdentifyFinish={async (finishEventId, batchBibEntryId, reason) => {
              await FinishEventRepository.identifyFinishEvent({
                finishEventId,
                batchBibEntryId,
                reason,
              });
              await reloadEventData(selectedBatch.eventId);
            }}
            onMarkFinishNeedsReview={async (finishEventId, notes) => {
              await FinishEventRepository.unassignOrMarkNeedsReview({
                finishEventId,
                targetStatus: 'NEEDS_REVIEW',
                notes,
              });
              await reloadEventData(selectedBatch.eventId);
            }}
            onCancelFinishEvent={async (finishEventId, reason) => {
              await FinishEventRepository.cancelFinishEvent({
                finishEventId,
                reason,
              });
              await reloadEventData(selectedBatch.eventId);
            }}
            onResumeRecoveryFallback={async () => {
              await BatchRepository.resumeBatchWithWallClockFallback(
                selectedBatch.id
              );
              registerSessionStartedBatch(selectedBatch.id);
              await reloadEventData(selectedBatch.eventId);
            }}
            onMarkRecoveryNeedsReview={async () => {
              await BatchRepository.transitionBatchStatus({
                batchId: selectedBatch.id,
                targetStatus: 'REVIEW',
                reason:
                  'Operator memilih meninjau batch setelah muat ulang halaman',
              });
              await reloadEventData(selectedBatch.eventId);
              setCurrentScreen('REVIEW');
            }}
            onMoveToReview={async () => {
              await BatchRepository.transitionBatchStatus({
                batchId: selectedBatch.id,
                targetStatus: 'REVIEW',
                reason: 'Masuk ke tahap Tinjau Hasil',
              });
              await reloadEventData(selectedBatch.eventId);
              setCurrentScreen('REVIEW');
            }}
            onChangeModeMidBatch={async (newMode: RecordingMode, reason: string) => {
              await BatchRepository.updateRecordingMode(
                selectedBatch.id,
                newMode,
                reason
              );
              await reloadEventData(selectedBatch.eventId);
            }}
            onAddEmergencyBib={async (
              bibColor: BibColor,
              bibNumber: number,
              reason: string
            ) => {
              await BatchRepository.addBibToBatch({
                batchId: selectedBatch.id,
                bibColor,
                bibNumber,
                allowRunningException: true,
                reason,
              });
              await reloadEventData(selectedBatch.eventId);
            }}
            onNavigateExport={() => setCurrentScreen('EXPORT')}
            onBackHome={() => setCurrentScreen('HOME')}
          />
        )}

        {currentScreen === 'REVIEW' && selectedBatch && (
          <ReviewBatchScreen
            batch={selectedBatch}
            roster={selectedBatchRoster}
            finishEvents={selectedBatchFinishes}
            onIdentifyFinish={async (finishEventId, batchBibEntryId, reason) => {
              await FinishEventRepository.identifyFinishEvent({
                finishEventId,
                batchBibEntryId,
                reason,
              });
              await reloadEventData(selectedBatch.eventId);
            }}
            onUnassignOrMarkFinish={async (
              finishEventId,
              targetStatus,
              reason
            ) => {
              await FinishEventRepository.unassignOrMarkNeedsReview({
                finishEventId,
                targetStatus,
                reason,
              });
              await reloadEventData(selectedBatch.eventId);
            }}
            onCancelFinish={async (finishEventId, reason) => {
              await FinishEventRepository.cancelFinishEvent({
                finishEventId,
                reason,
              });
              await reloadEventData(selectedBatch.eventId);
            }}
            onCorrectFinishTime={async (
              finishEventId,
              newElapsedMs,
              reason
            ) => {
              await FinishEventRepository.correctFinishElapsedTime({
                finishEventId,
                newElapsedMs,
                reason,
              });
              await reloadEventData(selectedBatch.eventId);
            }}
            onMarkParticipantStatus={async (
              batchBibEntryId: string,
              status: Exclude<ParticipantStatus, 'FINISHED'>,
              reason?: string
            ) => {
              await FinishEventRepository.markParticipantStatus({
                batchBibEntryId,
                status,
                reason,
              });
              await reloadEventData(selectedBatch.eventId);
            }}
            onReturnToRunning={async () => {
              await BatchRepository.transitionBatchStatus({
                batchId: selectedBatch.id,
                targetStatus: 'RUNNING',
                reason: 'Operator membuka kembali layar pencatatan finish',
              });
              await reloadEventData(selectedBatch.eventId);
              setCurrentScreen('RUNNING');
            }}
            onCompleteBatch={async (notes) => {
              await BatchRepository.completeBatch(selectedBatch.id, notes);
              await reloadEventData(selectedBatch.eventId);
              setCurrentScreen('RESULTS');
            }}
            onBackHome={() => setCurrentScreen('HOME')}
          />
        )}

        {currentScreen === 'RESULTS' && (
          <ResultsHistoryScreen
            activeEvent={activeEvent}
            batches={batches}
            allBibEntries={allBibEntries}
            allFinishEvents={allFinishEvents}
            auditLogs={auditLogs}
            onReopenBatchToReview={async (batch) => {
              if (batch.status === 'COMPLETED' || batch.status === 'NEEDS_REVIEW') {
                await BatchRepository.transitionBatchStatus({
                  batchId: batch.id,
                  targetStatus: 'REVIEW',
                  reason: 'Dibuka kembali ke layar Tinjau Hasil dari menu Hasil',
                });
                await reloadEventData(batch.eventId);
              }
              setSelectedBatchId(batch.id);
              setCurrentScreen('REVIEW');
            }}
            onCorrectFinishTime={async (
              finishEventId,
              newElapsedMs,
              reason
            ) => {
              await FinishEventRepository.correctFinishElapsedTime({
                finishEventId,
                newElapsedMs,
                reason,
              });
              await reloadEventData(activeEvent.id);
            }}
            onIdentifyFinish={async (finishEventId, batchBibEntryId, reason) => {
              await FinishEventRepository.identifyFinishEvent({
                finishEventId,
                batchBibEntryId,
                reason,
              });
              await reloadEventData(activeEvent.id);
            }}
            onNavigateExport={() => setCurrentScreen('EXPORT')}
            onBackHome={() => setCurrentScreen('HOME')}
          />
        )}

        {currentScreen === 'EXPORT' && (
          <ExportBackupScreen
            activeEvent={activeEvent}
            batches={batches}
            onDataImported={async () => {
              await reloadEventData();
            }}
            onBackHome={() => setCurrentScreen('HOME')}
          />
        )}
      </main>
    </div>
  );
};
