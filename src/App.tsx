import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BatchRecord,
  BibColor,
  EventRecord,
  ParticipantStatus,
  RecordingMode,
} from './domain/types';
import {
  BatchRepository,
  EventRepository,
  FinishEventRepository,
} from './db/repositories';
import {
  getActiveSessionBatchIds,
  registerSessionStartedBatch,
} from './services/timekeeper';
import { DashboardScreen } from './screens/DashboardScreen';
import { RosterEntryScreen } from './screens/RosterEntryScreen';
import { RunningBatchScreen } from './screens/RunningBatchScreen';
import { ReviewBatchScreen } from './screens/ReviewBatchScreen';
import { ResultsHistoryScreen } from './screens/ResultsHistoryScreen';
import { ExportBackupScreen } from './screens/ExportBackupScreen';
import {
  assertCapturesSaved,
  downloadRescueFile,
  restoreCaptureJournal,
  retryCaptures,
  subscribeToSavedCaptures,
  useCaptureSession,
} from './services/captureSession';
import {
  applyBatchData,
  applySavedCapture,
  emptyBatchRows,
  EventData,
  readBatchData,
  readEventData,
} from './services/eventData';
import { useWriteAccess } from './services/writeAccess';
import { LiveTimer } from './components/LiveTimer';
import { QuickBackupButton } from './components/QuickBackupButton';
import { useOfflineSupport } from './services/offlineSupport';
import { getBatchName } from './domain/utils';
import { EventSetupScreen } from './screens/EventSetupScreen';
import { CopyrightFooter } from './components/CopyrightFooter';

export type ScreenName =
  | 'HOME'
  | 'ROSTER_ENTRY'
  | 'RUNNING'
  | 'REVIEW'
  | 'RESULTS'
  | 'EXPORT';

const emptyBatches: BatchRecord[] = [];

export const App: React.FC = () => {
  const {
    access,
    checking: checkingAccess,
    retryAccess,
    error: accessError,
  } = useWriteAccess();
  const captureSession = useCaptureSession();
  const [actionError, setActionError] = useState<string | null>(null);
  const [completedBatch, setCompletedBatch] = useState<BatchRecord | null>(
    null
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [initError, setInitError] = useState<string | null>(null);

  const [allEvents, setAllEvents] = useState<EventRecord[]>([]);
  const [eventData, setEventData] = useState<EventData | null>(null);
  const activeEvent = eventData?.event;
  const batches = eventData?.batches ?? emptyBatches;
  const offlineReady = useOfflineSupport(
    loading ||
      access !== 'writer' ||
      batches.some((batch) => batch.status === 'RUNNING') ||
      captureSession.pending.length > 0
  );

  const [currentScreen, setCurrentScreen] = useState<ScreenName>('HOME');
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const eventReloadVersion = useRef(0);

  const reloadEventData = useCallback(async (targetEventId?: string) => {
    const version = ++eventReloadVersion.current;
    let events = await EventRepository.listEvents();

    let event: EventRecord | undefined;
    if (targetEventId) {
      event = events.find((e) => e.id === targetEventId);
    }
    if (!event) {
      event = events.find((e) => e.status === 'ACTIVE') ?? events[0];
    }
    if (!event) {
      if (eventReloadVersion.current !== version) return;
      setAllEvents(events);
      setEventData(null);
      return;
    }
    const data = await readEventData(event);
    if (eventReloadVersion.current !== version) return;
    setAllEvents(events);
    setEventData(data);
  }, []);

  async function reloadBatchData(batchId: string) {
    const data = await readBatchData(batchId);
    setEventData((previous) => applyBatchData(previous, data));
  }

  useEffect(() => {
    return subscribeToSavedCaptures((capture) => {
      setEventData((previous) => applySavedCapture(previous, capture));
      const batch = capture.batch;
      if (batch) {
        setCompletedBatch((previous) =>
          previous?.id === batch.id ? batch : previous
        );
      }
    });
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (captureSession.pending.length) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [captureSession.pending.length]);

  useEffect(() => {
    if (access === 'loading') return;
    let mounted = true;
    async function init() {
      try {
        setInitError(null);
        if (access === 'writer') {
          restoreCaptureJournal();
          await EventRepository.removeEmptyDefaultEvents();
          await BatchRepository.flagRunningBatchesForRecovery(
            getActiveSessionBatchIds()
          );
        }
        await reloadEventData();
        if (access === 'writer') void retryCaptures();
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
  }, [reloadEventData, access]);

  const selectedBatch = batches.find((b) => b.id === selectedBatchId) ?? null;
  const rowsByBatch = eventData?.rowsByBatch;
  const selectedRows =
    (selectedBatchId ? rowsByBatch?.get(selectedBatchId) : undefined) ??
    emptyBatchRows;
  const nextBatch =
    batches.find((batch) => batch.status === 'RUNNING') ??
    batches.find((batch) => batch.status === 'DRAFT' || batch.status === 'READY');
  const pendingShownInDock =
    currentScreen === 'RUNNING' &&
    selectedBatch &&
    !selectedBatch.recoveryRequired &&
    captureSession.pending.every((item) => item.batchId === selectedBatch.id);
  const showEventFinishes =
    currentScreen === 'HOME' || currentScreen === 'RESULTS';
  const allFinishEvents = useMemo(() => {
    if (!showEventFinishes || !rowsByBatch) return [];
    return Array.from(rowsByBatch.values()).flatMap((rows) => rows.finishes);
  }, [rowsByBatch, showEventFinishes]);
  const allBibEntries = useMemo(() => {
    if (currentScreen !== 'RESULTS' || !rowsByBatch) return [];
    return Array.from(rowsByBatch.values()).flatMap((rows) => rows.roster);
  }, [rowsByBatch, currentScreen]);

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
    assertCapturesSaved();
    if (!activeEvent) return;
    const created = await BatchRepository.createBatch(activeEvent.id, mode);
    await reloadEventData(activeEvent.id);
    setSelectedBatchId(created.id);
    setCurrentScreen('ROSTER_ENTRY');
  };

  const handleStartBatch = async () => {
    assertCapturesSaved();
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

  if (loading || access === 'loading') {
    return (
      <div className="screen-container">
        <div className="card">
          <p>Memuat penyimpanan lokal perangkat...</p>
        </div>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="screen-container">
        <div className="card warning-card" role="alert">
          <h1>Gagal Mengakses Penyimpanan Lokal</h1>
          <p>
            {initError ??
              'Penyimpanan IndexedDB tidak tersedia di browser ini.'}
          </p>
          <p>
            Pastikan browser tidak berada dalam mode pemblokiran penyimpanan
            penuh, lalu muat ulang halaman.
          </p>
          {access === 'reader' && (
            <button
              className="btn btn--secondary"
              disabled={checkingAccess}
              onClick={retryAccess}
            >
              {checkingAccess ? 'Memeriksa akses…' : 'Coba akses pencatatan'}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!eventData || !activeEvent) {
    return (
      <EventSetupScreen
        writable={access === 'writer'}
        checkingAccess={checkingAccess}
        onRetryAccess={retryAccess}
        onCreate={async (name, date) => {
          const created = await EventRepository.createEvent(name, date);
          await reloadEventData(created.id);
        }}
      />
    );
  }

  return (
    <div
      className={`app-shell ${currentScreen === 'RUNNING' ? 'app-shell--recording' : ''}`}
    >
      {/* Top Global Navigation Strip */}
      <header className="app-brand-header">
        <span className="wordmark">
          time<span>X</span>
        </span>
        <span className="device-status">Lokal di perangkat ini</span>
      </header>
      {currentScreen !== 'RUNNING' &&
        currentScreen !== 'ROSTER_ENTRY' &&
        currentScreen !== 'REVIEW' && (
          <nav className="app-top-nav" aria-label="Navigasi Utama">
            <div className="app-top-nav__links">
              <button
                type="button"
                aria-current={currentScreen === 'HOME' ? 'page' : undefined}
                className={`app-top-nav__link ${
                  currentScreen === 'HOME' ? 'app-top-nav__link--active' : ''
                }`}
                onClick={() => setCurrentScreen('HOME')}
              >
                Kegiatan
              </button>
              <button
                type="button"
                aria-current={currentScreen === 'RESULTS' ? 'page' : undefined}
                className={`app-top-nav__link ${
                  currentScreen === 'RESULTS' ? 'app-top-nav__link--active' : ''
                }`}
                onClick={() => setCurrentScreen('RESULTS')}
              >
                Hasil
              </button>
              <button
                type="button"
                aria-current={currentScreen === 'EXPORT' ? 'page' : undefined}
                className={`app-top-nav__link ${
                  currentScreen === 'EXPORT' ? 'app-top-nav__link--active' : ''
                }`}
                onClick={() => setCurrentScreen('EXPORT')}
              >
                Perangkat
              </button>
            </div>
          </nav>
        )}

      {access === 'reader' && (
        <div
          className="inline-alert inline-alert--warning access-banner"
          role="status"
        >
          <p>
            {accessError
              ? `Akses pencatatan belum tersedia. ${accessError}`
              : 'Tab lain sedang memegang akses pencatatan. Tutup tab tersebut. Akses di sini akan pulih otomatis.'}
          </p>
          <button
            className="btn btn--secondary"
            disabled={checkingAccess}
            onClick={retryAccess}
          >
            {checkingAccess ? 'Memeriksa akses…' : 'Coba akses pencatatan'}
          </button>
        </div>
      )}
      {actionError && (
        <div className="inline-alert inline-alert--error" role="alert">
          {actionError}
          <button
            className="btn btn--small"
            onClick={() => {
              setActionError(null);
              void reloadEventData();
            }}
          >
            Muat ulang daftar
          </button>
        </div>
      )}
      {captureSession.journalError && captureSession.pending.length === 0 && (
        <aside className="capture-status" role="alert">
          <p>
            Salinan darurat sesi sebelumnya gagal dibaca. Unduh penyelamatan
            untuk menyimpan isinya sebelum menutup halaman.
          </p>
          <button className="btn btn--secondary" onClick={downloadRescueFile}>
            Unduh penyelamatan
          </button>
        </aside>
      )}
      {captureSession.pending.length > 0 &&
        !pendingShownInDock && (
        <aside className="capture-status" role="status">
          <div>
            <strong>
              {captureSession.pending.length} finish{' '}
              {captureSession.saving ? 'sedang disimpan' : 'belum tersimpan'}
            </strong>
            {!captureSession.saving && (
              <p>
                {captureSession.pending[0].error ??
                  'Catatan dipulihkan dari sesi sebelumnya.'}
              </p>
            )}
            {captureSession.journalError && (
              <p>
                Salinan darurat gagal disimpan. Unduh penyelamatan sebelum
                menutup halaman.
              </p>
            )}
          </div>
          <div className="button-row">
            <button
              className="btn btn--warning"
              disabled={captureSession.saving || access !== 'writer'}
              onClick={() => void retryCaptures()}
            >
              Simpan ulang
            </button>
            <button className="btn btn--secondary" onClick={downloadRescueFile}>
              Unduh penyelamatan
            </button>
          </div>
        </aside>
      )}
      {currentScreen !== 'RUNNING' &&
        batches.some((batch) => batch.status === 'RUNNING') && (
          <button
            className="active-session-banner"
            onClick={() =>
              handleOpenBatch(
                batches.find((batch) => batch.status === 'RUNNING')!
              )
            }
          >
            <span>Kembali ke gelombang berjalan</span>
            <LiveTimer
              batch={batches.find((batch) => batch.status === 'RUNNING')!}
              compact
            />
          </button>
        )}

      <main className="app-main">
        <fieldset className="write-surface" disabled={access !== 'writer'}>
          {completedBatch && currentScreen === 'RESULTS' && (
            <section className="completion-summary">
              <p className="eyebrow">Pencatatan selesai</p>
              <h2 className="batch-name">
                {getBatchName(completedBatch)} tersimpan.
              </h2>
              <p>
                {completedBatch.status === 'NEEDS_REVIEW'
                  ? 'Ada hasil yang ditandai untuk diperiksa.'
                  : 'Hasil siap dilihat dan diekspor.'}
              </p>
              <div className="completion-actions">
                <button
                  className="btn btn--primary"
                  onClick={() => {
                    void handleCreateBatch('TIMESTAMP_FIRST')
                      .then(() => setCompletedBatch(null))
                      .catch((error: Error) => setActionError(error.message));
                  }}
                >
                  Siapkan gelombang berikutnya
                </button>
                <QuickBackupButton key={completedBatch.id} />
              </div>
            </section>
          )}
          {currentScreen === 'HOME' && (
            <DashboardScreen
              activeEvent={activeEvent}
              allEvents={allEvents}
              batches={batches}
              allFinishEvents={allFinishEvents}
              nextBatchBibCount={
                eventData.rowsByBatch.get(nextBatch?.id ?? '')?.roster.length ?? 0
              }
              onCreateBatch={handleCreateBatch}
              onOpenBatch={handleOpenBatch}
              onRenameBatch={async (batchId, name) => {
                await BatchRepository.renamePreparedBatch(batchId, name);
                await reloadEventData(activeEvent.id);
              }}
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
                assertCapturesSaved();
                if (batches.some((batch) => batch.status === 'RUNNING'))
                  throw new Error(
                    'Tutup pencatatan gelombang sebelum membuat kegiatan.'
                  );
                const created = await EventRepository.createEvent(
                  name,
                  eventDate
                );
                await reloadEventData(created.id);
              }}
              onSwitchEvent={async (eventId) => {
                assertCapturesSaved();
                if (batches.some((batch) => batch.status === 'RUNNING'))
                  throw new Error(
                    'Tutup pencatatan gelombang sebelum mengganti kegiatan.'
                  );
                await EventRepository.switchActiveEvent(eventId);
                await reloadEventData(eventId);
              }}
            />
          )}

          {currentScreen === 'ROSTER_ENTRY' && selectedBatch && (
            <RosterEntryScreen
              batch={selectedBatch}
              roster={selectedRows.roster}
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
                await BatchRepository.updateRecordingMode(
                  selectedBatch.id,
                  mode
                );
                await reloadEventData(selectedBatch.eventId);
              }}
              onStartBatch={handleStartBatch}
              onBackHome={() => setCurrentScreen('HOME')}
            />
          )}

          {currentScreen === 'RUNNING' && selectedBatch && (
            <RunningBatchScreen
              batch={selectedBatch}
              roster={selectedRows.roster}
              finishEvents={selectedRows.finishes}
              onIdentifyFinish={async (
                finishEventId,
                batchBibEntryId,
                reason
              ) => {
                await FinishEventRepository.identifyFinishEvent({
                  finishEventId,
                  batchBibEntryId,
                  reason,
                });
                await reloadBatchData(selectedBatch.id);
              }}
              onMarkFinishNeedsReview={async (finishEventId, notes) => {
                await FinishEventRepository.unassignOrMarkNeedsReview({
                  finishEventId,
                  targetStatus: 'NEEDS_REVIEW',
                  notes,
                });
                await reloadBatchData(selectedBatch.id);
              }}
              onCancelFinishEvent={async (finishEventId, reason) => {
                await FinishEventRepository.cancelFinishEvent({
                  finishEventId,
                  reason,
                });
                await reloadBatchData(selectedBatch.id);
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
                assertCapturesSaved();
                await BatchRepository.transitionBatchStatus({
                  batchId: selectedBatch.id,
                  targetStatus: 'REVIEW',
                  reason: 'Masuk ke tahap Tinjau Hasil',
                });
                await reloadEventData(selectedBatch.eventId);
                setCurrentScreen('REVIEW');
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
                await reloadBatchData(selectedBatch.id);
              }}
              onNavigateExport={() => setCurrentScreen('EXPORT')}
              onBackHome={() => setCurrentScreen('HOME')}
            />
          )}

          {currentScreen === 'REVIEW' && selectedBatch && (
            <ReviewBatchScreen
              batch={selectedBatch}
              roster={selectedRows.roster}
              finishEvents={selectedRows.finishes}
              onIdentifyFinish={async (
                finishEventId,
                batchBibEntryId,
                reason
              ) => {
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
              onBulkMarkWaiting={async (ids, status) => {
                await BatchRepository.markWaitingParticipants(
                  selectedBatch.id,
                  ids,
                  status
                );
                await reloadEventData(selectedBatch.eventId);
              }}
              onDeferReview={async (notes) => {
                assertCapturesSaved();
                const completed = await BatchRepository.deferReview(
                  selectedBatch.id,
                  notes
                );
                setCompletedBatch(completed);
                await reloadEventData(selectedBatch.eventId);
                setCurrentScreen('RESULTS');
              }}
              onReturnToRunning={async () => {
                assertCapturesSaved();
                await BatchRepository.transitionBatchStatus({
                  batchId: selectedBatch.id,
                  targetStatus: 'RUNNING',
                  reason: 'Operator membuka kembali layar pencatatan finish',
                });
                await reloadEventData(selectedBatch.eventId);
                setCurrentScreen('RUNNING');
              }}
              onCompleteBatch={async (notes) => {
                assertCapturesSaved();
                const completed = await BatchRepository.completeBatch(
                  selectedBatch.id,
                  notes
                );
                setCompletedBatch(completed);
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
              auditLogs={eventData.auditLogs}
              onReopenBatchToReview={async (batch) => {
                if (
                  batch.status === 'RUNNING' ||
                  batch.status === 'DRAFT' ||
                  batch.status === 'READY'
                ) {
                  handleOpenBatch(batch);
                  return;
                }
                if (
                  batch.status === 'COMPLETED' ||
                  batch.status === 'NEEDS_REVIEW'
                ) {
                  await BatchRepository.transitionBatchStatus({
                    batchId: batch.id,
                    targetStatus: 'REVIEW',
                    reason:
                      'Dibuka kembali ke layar Tinjau Hasil dari menu Hasil',
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
              onIdentifyFinish={async (
                finishEventId,
                batchBibEntryId,
                reason
              ) => {
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
              offlineReady={offlineReady}
              activeEvent={activeEvent}
              batches={batches}
              onDataImported={async () => {
                await reloadEventData();
                void retryCaptures();
              }}
              onHistoryCleared={async () => {
                setCompletedBatch(null);
                setSelectedBatchId(null);
                setActionError(null);
                await reloadEventData();
              }}
              onBackHome={() => setCurrentScreen('HOME')}
            />
          )}
        </fieldset>
      </main>
      {(currentScreen === 'HOME' ||
        currentScreen === 'RESULTS' ||
        currentScreen === 'EXPORT') && <CopyrightFooter />}
    </div>
  );
};
