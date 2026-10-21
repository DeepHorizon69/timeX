# Run Timing Web App — Implementation Plan for AI Coding Agent

> **Priority:** Deliver a dependable, mobile-first MVP for field use tomorrow.  
> **Scope:** One operator, one phone, local persistence. PortgasDB and Google Sheets integration are explicitly deferred unless all core requirements are implemented, tested, and there is sufficient time.  
> **Working title:** Run Timing  
> **Document purpose:** This file is the source of truth for implementation. Follow the requirements in order; do not expand scope without a clear reason.

---

## 0. Instructions to the coding agent

1. Inspect the existing repository before changing anything. Identify the framework, package manager, current routes, styling system, and existing code conventions.
2. Preserve working code and existing project conventions where practical. Do not replace the entire project or introduce a new framework without a concrete technical reason.
3. If the repository is empty, use the default stack in Section 2.
4. Implement the MVP end-to-end. Do not stop after creating mockups, a plan, or static UI.
5. Do not implement PortgasDB, a backend, authentication, multi-device synchronization, Google Sheets API integration, or cloud deployment during the core phase.
6. Do not fabricate successful persistence. Verify that local data survives refresh and that export files contain the expected data.
7. Do not use placeholder buttons. Every visible interactive control must work or be clearly disabled with an explanation.
8. Keep the interface Indonesian-first. Use concise, operational language suitable for a busy operator standing at a finish line.
9. Optimize for phones first. Desktop is a secondary responsive layout, not the design target.
10. At the end, report implemented features, commands run, test results, known limitations, and how to run the app.

## 1. Product goal and operating context

The app replaces two manual tasks:
- Running a stopwatch on a phone while observing participants.
- Writing bib numbers and elapsed times on paper, then transcribing them later.

The operator uses a phone at the running start/finish area. Before each batch, the operator records the bibs of participants who have actually gathered at the start line. The batch size and start time are unpredictable. A batch starts only when the operator explicitly presses **Mulai Batch**.

The available physical bib inventory is normally five colors with up to 50 numbers per color:
- Putih
- Hijau
- Merah
- Biru
- Kuning

Bibs may be reused across different participants and batches. The app must never identify a participant or result by bib label alone. For this MVP, the operator manually enters the bib used by each participant in each batch. Registration records from Google Sheets are not imported in this phase.

### Primary success criteria

- Operator can create a batch and add bibs with very few taps.
- Operator can start a batch and record finish events without searching a long participant list.
- A finish event is timestamped immediately; identifying the bib can happen afterward.
- Finish events and batch data survive page refresh under normal browser storage conditions.
- Results can be corrected, reviewed, exported to CSV, and backed up to JSON.
- Reusing a bib in another batch does not overwrite prior results.
- The app remains usable on common mobile screen widths and touch input.
- There are no fake claims of cloud synchronization or cross-device backup.

### Important measurement limitation

The app records the time at which the operator taps the control, not the exact physical instant a participant crosses the line. Human reaction delay remains. The UI and documentation must not claim photo-finish accuracy or fully automatic timing.

## 2. Technical approach

### 2.1 Repository-first rule

Inspect the existing project first. Reuse its current stack if it already runs and can support the requirements. If the project is empty, use:

- React
- TypeScript
- Vite
- A lightweight styling solution already present in the repository; if none exists, use CSS modules or plain CSS with design tokens.
- IndexedDB for persistent local storage, preferably through a small maintained wrapper such as `idb` if dependency installation is available.
- A lightweight charting library is not required.
- No backend or cloud services for the MVP.

Do not add large component libraries unless already installed. Keep the dependency footprint small.

### 2.2 Local persistence

Use IndexedDB as the source of truth for persistent app data:
- Events
- Batches
- Batch bib entries
- Finish events
- Corrections/audit history
- App preferences needed for operation

`localStorage` may be used only for non-critical preferences, not as the primary store for results.

Use a repository/data-access layer so the UI does not access IndexedDB directly. This makes future backend/PortgasDB integration possible without rewriting feature components.

Suggested abstraction:
- `EventRepository`
- `BatchRepository`
- `FinishEventRepository`
- `ExportService`

Do not over-engineer the abstraction or implement an unused cloud adapter.

### 2.3 Timekeeping

- Use `performance.now()` for elapsed-time measurement within a single page lifetime because it is monotonic.
- Capture a wall-clock timestamp (`new Date().toISOString()`) for each start/finish event for audit/export purposes.
- Never calculate elapsed duration solely by subtracting two wall-clock timestamps.
- Persist the start’s monotonic reading and wall-clock timestamp.
- On normal operation, compute elapsed time as `performance.now() - startMonotonicMs`.
- If the page reloads, the old `performance.now()` value cannot safely be treated as continuous across the reload. Do not silently continue or recalculate the batch time from wall-clock values. Show a **Pulihkan batch** workflow:
  - Show the last saved start timestamp and last saved finish event.
  - Allow the operator to export/backup current data.
  - Allow the operator to explicitly resume using a documented fallback based on wall-clock time, clearly warning that clock changes can affect the result; or mark the batch as `NEEDS_REVIEW` and start a new batch.
  - Default behavior must not silently claim exact continuity.
- Persist each finish event immediately after it is created.
- Do not tie timer accuracy to UI rendering intervals. A display interval may refresh the visible timer, but calculations must use the time source directly.

### 2.4 Data integrity

- Every event, batch, batch bib entry, finish event, and audit entry has a unique ID independent of bib label.
- A bib label is a combination of color and number, e.g. `B12`, `M07`; store canonical color and number separately.
- Duplicate bib entries in the same draft/running batch are blocked.
- Reusing `B12` in a later batch is allowed.
- A finish event must not be assigned to a bib automatically based on assumptions.
- Corrections must not erase history. Record the previous value, new value, reason (if supplied), and timestamp.
- Repeated finish taps on the same participant/card must be prevented or require explicit correction. For timestamp-first mode, each tap represents a new finish event, so provide a clear undo-last-event action.
- Local-only data is not synced to another device. State this clearly in the UI/help.

## 3. Scope and explicit exclusions

### 3.1 Must-have features (P0)

1. Create/open a local event.
2. Create a batch.
3. Add bibs to a batch using color + number input.
4. Review and edit batch roster before start.
5. Start batch and show a continuously updated timer.
6. Finish recording screen with:
   - A prominent **Catat Finish** button for timestamp-first operation.
   - A roster/card view as a secondary method for direct participant marking where it is safe and easy.
   - Finish-event queue with sequence number and timestamp.
   - Unidentified/identified status.
7. Identify a finish event by assigning a bib entry from the current batch.
8. Calculate elapsed time from batch start.
9. Correct an identified bib or finish record without silently destroying history.
10. Mark participants as `DNS`, `DNF`, or `NEEDS_REVIEW` when appropriate.
11. Complete/close a batch after review.
12. Browse previous batches and results.
13. Export CSV.
14. Export and import a full JSON backup.
15. Persist data in IndexedDB.
16. Handle refresh/reopen recovery explicitly.
17. Responsive mobile-first UI and touch-friendly controls.

### 3.2 Should-have features (P1, only after P0 works)

- Search/filter roster by bib label.
- Sort roster with a stable, predictable order.
- Summary counts: total roster, finish events, identified finishes, unidentified finishes, remaining participants.
- Confirmations for destructive or finalizing actions.
- Basic local audit log for corrections, cancellation, and batch completion.
- Event name/date editable before batch start.
- Installable PWA support if it can be implemented and tested quickly.
- Keep screen awake while running only if supported by the browser; otherwise explain the OS screen-lock setting.

### 3.3 Explicitly out of scope for tomorrow’s MVP

- PortgasDB integration.
- Google Sheets API and live sync.
- User accounts, role management, or multi-operator real-time editing.
- Multi-device shared stopwatch.
- Health screening or medical records.
- Participant registration management beyond manually entering bibs for a batch.
- Automatic camera/QR/computer-vision finish detection.
- Complex analytics, charts, animations, or admin dashboards.
- Public internet deployment or external hosting.

## 4. User roles and operating assumptions

For this MVP, there is one operator using one phone and one browser installation. Do not create a multi-user login system.

The app should support two recording patterns within the same data model:

### Mode A — Direct card tap
- Operator taps a participant card when the participant crosses the finish.
- App records the finish timestamp immediately and marks that roster entry as finished.
- Use when the participant is clearly identifiable and finish traffic is not too dense.
- Prevent duplicate finish taps.

### Mode B — Timestamp-first
- Operator taps **Catat Finish** once per person crossing the line.
- App immediately creates `F-001`, `F-002`, etc., with a timestamp and elapsed time.
- The operator identifies the finish event afterward by assigning the correct bib entry from the batch roster.
- If identity or order is uncertain, leave it unidentified or mark `NEEDS_REVIEW`; never guess.
- Provide **Urungkan finish terakhir** to cancel an accidental event. Require confirmation or a short undo affordance that is hard to trigger accidentally.
- This mode is the recommended method for dense finish traffic.

The operator can choose the mode at the start of a batch. Do not allow switching modes mid-batch without a warning and explicit handling of existing entries.

## 5. Domain model

Use typed models. Names below are suggestions; align with existing project conventions.

### 5.1 Event

```ts
type EventRecord = {
  id: string;
  name: string;
  createdAt: string; // ISO timestamp
  updatedAt: string;
  status: "ACTIVE" | "COMPLETED";
};
```

The MVP may support one active event at a time, but must preserve completed events and their results. A new event must not erase the previous event.

### 5.2 Batch

```ts
type BatchStatus =
  | "DRAFT"
  | "READY"
  | "RUNNING"
  | "REVIEW"
  | "COMPLETED"
  | "NEEDS_REVIEW";

type RecordingMode = "DIRECT_CARD" | "TIMESTAMP_FIRST";

type BatchRecord = {
  id: string;
  eventId: string;
  batchNumber: number;
  status: BatchStatus;
  recordingMode: RecordingMode;
  createdAt: string;
  startedAtWallClock?: string;
  startedAtMonotonicMs?: number; // valid only within same page lifetime
  completedAt?: string;
  recoveryRequired?: boolean;
};
```

Do not assume a batch size or schedule in advance.

### 5.3 Batch bib entry

```ts
type BibColor = "WHITE" | "GREEN" | "RED" | "BLUE" | "YELLOW";

type BatchBibEntry = {
  id: string;
  eventId: string;
  batchId: string;
  bibColor: BibColor;
  bibNumber: number; // validate range 1..50
  bibLabel: string; // derived for display, e.g. B12
  participantName?: string; // optional, not required for MVP
  status: "WAITING" | "FINISHED" | "DNS" | "DNF" | "NEEDS_REVIEW";
  finishEventId?: string;
  createdAt: string;
  updatedAt: string;
};
```

`bibLabel` is a derived display value, not a primary key. The same physical bib may occur in another batch. Prevent duplicates only within the same batch.

For the MVP, the app does not know which registered person holds a bib unless the operator enters that data. The app records the bib as observed at the start line.

### 5.4 Finish event

```ts
type FinishEventRecord = {
  id: string;
  eventId: string;
  batchId: string;
  sequence: number;
  recordedAtWallClock: string;
  recordedAtMonotonicMs?: number;
  elapsedMs?: number;
  batchBibEntryId?: string;
  status: "UNIDENTIFIED" | "IDENTIFIED" | "CANCELLED" | "NEEDS_REVIEW";
  correctionHistory: Array<{
    changedAt: string;
    field: string;
    oldValue: unknown;
    newValue: unknown;
    reason?: string;
  }>;
};
```

Prefer separate audit records if that is cleaner; do not use untyped `unknown` values in persisted data without validation. Use a migration/version field for JSON backups and IndexedDB schema changes.

### 5.5 Derived result

Elapsed time is `finish.elapsedMs`, measured relative to the start of the same batch. Do not recompute old results from a different batch start. If start time is corrected, require explicit review and recompute affected results with an audit entry.

Display elapsed times as `MM:SS.cc` or `HH:MM:SS.cc` when needed. Internally store integer milliseconds. Avoid floating-point rounding drift.

## 6. Detailed UI and interaction requirements

### 6.1 General mobile layout

- Design target: phone screens from approximately 320 px wide upward.
- Use a single-column layout for primary tasks.
- Primary controls should be reachable with one thumb, ideally in the lower portion of the screen.
- Use large touch targets, preferably around 48 × 48 CSS px or larger for critical actions.
- Avoid tiny text and tightly packed controls.
- Respect mobile safe areas and browser viewport behavior.
- Use sticky headers for batch identity and timer where useful.
- Use a bottom action area for primary actions, ensuring it does not cover content.
- Avoid modal dialogs during repeated input.
- Use clear contrast and visible focus states.
- Never communicate status using color alone; pair color with text/icon.
- Ensure number entry works with both an on-screen keypad and the phone’s numeric keyboard.
- Do not make the timer depend on animation frames or visible tick counters.

### 6.2 Color palette and bib labels

Use a consistent mapping:
- Putih: white surface, dark text, visible border.
- Hijau: green surface, white/dark text with sufficient contrast.
- Merah: red surface, white text.
- Biru: blue surface, white text.
- Kuning: yellow surface, dark text.

Always display the color name or an accessible text label as well as color. Do not rely only on color swatches.

### 6.3 Screen A — Home / event dashboard

Purpose: get the operator to the next task in one or two taps.

Must show:
- Event name.
- Current local data status (e.g. `Tersimpan di perangkat ini`).
- Active/recovery-required batch if one exists.
- Number of completed batches.
- Total finish records and records needing identification.
- Primary actions:
  - `Buat Batch Baru`
  - `Lanjutkan Batch` if a batch is active/recoverable
  - `Lihat Hasil`
  - `Ekspor / Backup`

Do not imply server synchronization. Use wording such as `Data tersimpan di perangkat ini` and `Belum disinkronkan ke server`.

### 6.4 Screen B — Create batch / roster entry

Purpose: quickly enter all bibs visible at the start line.

Requirements:
- Select one of the five bib colors.
- Enter bib number 1–50 using a numeric keypad/input.
- `Tambah` adds the bib entry to the roster immediately.
- Preserve the selected color until the operator changes it, to reduce taps for groups wearing the same color.
- Clear the number field after a successful add and focus it again when appropriate.
- Show a visible roster count.
- Show newly added entries near the input area or in a stable roster list.
- Prevent duplicate color+number in the same batch and explain the duplicate.
- Allow removing or editing a roster entry while the batch is `DRAFT` or `READY`.
- Do not silently accept invalid number, empty input, or unknown color.
- Provide a clear `Mulai Batch` action.
- Before start, show a compact review summary and ask for confirmation if the roster is empty or has potential conflicts.
- Once the batch starts, freeze roster membership by default. If an exception requires roster editing, provide a deliberate, audited action; do not permit accidental changes.

### 6.5 Screen C — Running / finish capture

This is the most important screen. It must minimize visual search and typing while participants cross the finish line.

Always show:
- Batch number and `RUNNING` status.
- Large elapsed batch timer.
- Total participants in the batch.
- Finish count and remaining count.
- Local save status.

#### Timestamp-first mode (recommended in crowded conditions)

- A very large primary button labeled `CATAT FINISH`.
- A tap immediately creates a unique finish event and stores it in IndexedDB.
- Show a monotonically increasing sequence (`F-001`, `F-002`, …).
- Show the newest finish event at the top, with its elapsed time.
- Each event is initially `Belum diidentifikasi`.
- The operator can select an event and associate it with one of the current batch’s bib entries.
- When identifying, filter out participants already linked to a non-cancelled finish event.
- If two people cross at nearly the same time and order is unclear, allow `Perlu diperiksa`; do not force an identity.
- Provide an obvious but safe `Urungkan finish terakhir` action.
- Do not open a modal after every finish tap.
- Never require bib number entry before the timestamp is captured.

#### Direct-card mode

- Show roster cards with large bib labels and color names.
- A card tap records the finish time immediately.
- After finish, the card changes state and shows elapsed time.
- Finished cards must remain in a stable position; do not reorder automatically.
- Prevent a second tap from creating another finish. To correct, use an explicit correction/undo action.
- Provide search/filter as an auxiliary tool, not as the main workflow under dense finish traffic.

#### Shared requirements

- Do not automatically assign finish events by sequence to bibs unless the operator explicitly confirms that mapping. Finish sequence can differ from crossing order due to human reaction.
- Keep timestamp capture independent of identification and UI rendering.
- A finish event is saved before showing a success state.
- If saving fails, show a clear blocking warning and do not falsely indicate success.
- The operator can move between finish queue and roster without losing the running timer.
- Confirm before ending the batch; never make the end button adjacent to the primary finish button in a way that risks mis-taps.

### 6.6 Screen D — Review batch

Show:
- Total roster entries.
- Identified finish count.
- Unidentified finish count.
- Participants still waiting.
- DNS/DNF/needs-review count.
- Data quality warnings.

Actions:
- Identify unresolved finish events.
- Correct a finish-to-bib assignment.
- Correct a timestamp only with explicit confirmation and audit history.
- Mark a participant `DNS`, `DNF`, or `NEEDS_REVIEW`.
- Reopen or return to a batch only with a clear status transition.
- Complete the batch after review.

Do not force all roster entries to be finished before completion, but require the operator to review and explicitly account for remaining entries.

### 6.7 Screen E — Results and history

- List batches in reverse chronological order.
- Show each batch’s status and participant/finish counts.
- Open a batch to view bib label, finish sequence, elapsed time, and status.
- Search by bib label.
- Allow corrections through a deliberate action and add an audit record.
- Reusing a bib in a later batch must never change an earlier batch’s result.

### 6.8 Screen F — Export and backup

Provide:
1. **Export CSV results**: one row per batch bib entry/result, including event, batch, bib color, bib number, finish sequence, elapsed milliseconds, formatted elapsed time, status, and timestamps.
2. **Export JSON backup**: complete local dataset, app schema version, and export timestamp.
3. **Import JSON backup**: validate file structure/version before modifying data; show a preview and confirmation. Never replace existing data silently.
4. A clear local-data warning: exports/backups must be copied somewhere outside the device if they need to survive device/browser loss.

CSV requirements:
- Properly quote commas, quotes, and line breaks.
- Use UTF-8.
- Include column headers.
- Use stable field names.
- Do not export secrets (there should be none).
- Verify CSV by opening/parsing it in tests if tooling allows.

## 7. Timekeeping implementation detail

### 7.1 Start

On `Mulai Batch`:
1. Validate roster.
2. Set status to `RUNNING`.
3. Capture `startedAtWallClock = new Date().toISOString()`.
4. Capture `startedAtMonotonicMs = performance.now()`.
5. Persist the batch.
6. Start the display refresh loop only after successful persistence.

If persistence fails, do not start the batch and show an actionable error.

### 7.2 Finish capture

On finish tap:
1. Capture `recordedAtMonotonicMs = performance.now()` immediately, before any unrelated async work.
2. Capture `recordedAtWallClock = new Date().toISOString()`.
3. Compute `elapsedMs = recordedAtMonotonicMs - startedAtMonotonicMs`.
4. Create a unique finish event ID and sequence.
5. Persist the event immediately.
6. Update the UI after the write succeeds.
7. If the write fails, show a prominent error and retain enough in-memory state to let the operator retry without generating a duplicate.

The finish event’s elapsed time is immutable by default. Corrections must be explicit and audited.

### 7.3 Display formatting

- Under one hour: `MM:SS.cc` or `MM:SS.d` depending on available screen space. Prefer hundredths (`cc`) for result display if UI remains readable.
- One hour or longer: `HH:MM:SS.cc`.
- Store integer milliseconds.
- Avoid formatting that rounds the internal value and then uses the rounded value for calculations.

### 7.4 Recovery after reload

A browser reload destroys the previous page’s monotonic time origin. Do not use a persisted `performance.now()` as if it remained valid.

On app startup:
- Find batches with `RUNNING` status.
- Mark them as recovery-required in the UI, not necessarily as completed.
- Show the start timestamp, last finish timestamp, roster, and saved finish records.
- Offer:
  1. Export/backup.
  2. Resume with explicit warning using wall-clock fallback, if allowed by product requirements.
  3. Mark `NEEDS_REVIEW` and close or start a new batch.
- Clearly explain that wall-clock fallback can be affected by device clock changes and is less reliable than uninterrupted monotonic timing.
- Never silently reset the timer to zero or claim an exact continuous measurement after reload.

## 8. Persistence and repository implementation

### 8.1 IndexedDB

Create a versioned IndexedDB schema. Store related records in separate object stores or an equivalent structure:
- `events`
- `batches`
- `batchBibEntries`
- `finishEvents`
- `auditLogs`
- `settings`

Use transactions for related changes where possible, such as assigning a finish event to a bib entry and updating the bib entry’s status. Handle quota/storage errors and surface them visibly.

### 8.2 Repository layer

All features use repositories, not direct IndexedDB calls from components.

Example:
- `createEvent`
- `createBatch`
- `addBibToBatch`
- `removeBibFromDraftBatch`
- `startBatch`
- `recordFinishEvent`
- `identifyFinishEvent`
- `markParticipantStatus`
- `correctFinishEvent`
- `completeBatch`
- `listBatches`
- `getBatchResults`
- `exportCsv`
- `exportJson`
- `importJson`

Keep repository methods typed and validate inputs. Use transaction-level safeguards to prevent duplicate bib entries in a batch and duplicate active finish assignments.

### 8.3 Future PortgasDB integration

Do not implement this in the MVP. Keep the repository boundary clean so a future backend adapter can be added. The future architecture should be:
- Browser PWA → backend API → PortgasDB.
- Never connect browser code directly to PostgreSQL or expose DB credentials.
- Add conflict handling and synchronization only when multi-device/shared data is explicitly in scope.

## 9. Visual design system

The app is a field tool, not a marketing site. Visual clarity and speed take priority over decorative effects.

### Design principles
- Mobile-first, operational, high contrast, calm, low-clutter.
- Avoid large hero sections, excessive gradients, heavy animation, and decorative illustrations.
- Use color primarily to distinguish bib colors and statuses.
- Provide a compact sticky header with batch/timer context.
- Use bottom-anchored primary controls where ergonomic.
- Keep core actions visually distinct.
- Use clear Indonesian labels:
  - `Buat Batch`
  - `Tambah Nomor`
  - `Mulai Batch`
  - `Catat Finish`
  - `Identifikasi`
  - `Urungkan`
  - `Tinjau Hasil`
  - `Selesaikan Batch`
  - `Ekspor CSV`
  - `Backup JSON`
- Use accessible contrast and do not rely on color alone.
- Support dark and light environments if this can be done without delaying core work; default to the mode with best readability on the target device.

### Responsive behavior
- 320–430 px: primary target; one-column layout.
- 431–768 px: wider phone/small tablet; preserve single-handed operation.
- 769 px and above: optional wider layout with side-by-side panels, while keeping the same workflow.
- Do not hide critical actions behind hover-only interactions.
- Avoid horizontal scrolling on the main workflow.

## 10. Error handling and edge cases

Implement visible, actionable handling for:
- Empty/invalid bib number.
- Number outside 1–50.
- Duplicate bib in same batch.
- Unknown or missing color.
- Attempt to start an empty batch.
- Attempt to add participants after batch starts.
- Duplicate finish assignment.
- Accidental finish tap.
- Finish event with unknown identity.
- Operator trying to finish a batch with unresolved records.
- IndexedDB write failure/quota exceeded.
- Corrupt or unsupported JSON backup.
- Import that would overwrite existing data.
- Page refresh while batch is running.
- Browser closed and reopened after a batch started.
- Multiple finish events with similar timestamps.
- Reusing the same bib in a later batch.
- CSV fields containing commas, quotes, or newlines.
- Attempting to start a new batch while another is still running.

Do not use alert dialogs for every routine event. Use inline validation, toast/status messages for non-blocking feedback, and confirmation dialogs for destructive/final actions.

## 11. Testing and acceptance criteria

The MVP is not complete until these tests pass.

### Functional
- Create an event and two batches.
- Add multiple bib colors and numbers.
- Reject duplicate bib within one batch.
- Allow same bib in another batch.
- Start a batch and verify timer progresses.
- Record finish and verify elapsed time is computed from the correct batch start.
- Identify finish event after timestamp capture.
- Ensure a finish event cannot be assigned to two active roster entries.
- Correct a result and verify audit history.
- Mark DNS/DNF/needs-review.
- Complete batch and verify results remain accessible.
- Create a second batch without modifying the first.

### Persistence and recovery
- Refresh after adding roster entries; entries remain.
- Refresh after recording finishes; records remain.
- Simulate a running batch on reload; recovery warning is shown.
- Export JSON, clear test data, import backup, and verify restoration.
- Export CSV and verify rows, headers, values, and encoding.
- Simulate IndexedDB write failure where practical; UI must not falsely show saved status.

### Mobile UX
- Test at 320, 360, 390, and 430 px widths.
- Confirm no horizontal overflow on core screens.
- Confirm critical controls are large enough for touch.
- Confirm keyboard does not obscure the current number input or primary action.
- Confirm card order remains stable after finishes.
- Test with one hand and rapid repeated input.
- Ensure finish capture does not open a modal on every tap.
- Check readable contrast for white and yellow bibs.

### Field simulation
Run a realistic simulation:
1. Create a batch with 10–20 bib entries.
2. Start the batch.
3. Record several finishes in quick succession.
4. Leave some events unidentified, then identify them afterward.
5. Correct one mistaken identity.
6. Finish the batch with at least one DNF/needs-review.
7. Export CSV and JSON.
8. Create a new batch reusing some of the same bibs.
9. Verify previous results remain unchanged.

### Acceptance criteria
- No result is lost during normal operation or refresh under available browser storage.
- No result from one batch overwrites another.
- No duplicate bib is silently accepted within a batch.
- No unidentified finish is silently assigned.
- No cloud-sync claim appears in the UI.
- Critical operations are usable on a phone without horizontal scrolling.
- All visible buttons work.
- The README explains local-only storage, backup/export, limitations, and startup commands.

## 12. Suggested implementation order

Follow this order and verify each stage before continuing:

1. Inspect repository and confirm stack.
2. Create types/domain models and IndexedDB schema.
3. Build repository functions and basic persistence tests.
4. Build event dashboard and batch creation.
5. Build bib entry keypad and roster review.
6. Implement start/timekeeping and recovery logic.
7. Implement timestamp-first finish capture.
8. Implement direct-card finish mode.
9. Implement finish identification, correction, and review.
10. Implement results/history.
11. Implement CSV export and JSON backup/restore.
12. Polish mobile responsive UX.
13. Run functional, persistence, and mobile tests.
14. Write/update README and report limitations.
15. Only if every P0/P1 acceptance criterion passes and time remains, assess whether PortgasDB integration is feasible. Do not begin integration at the cost of an untested MVP.

## 13. Required final report from the agent

When done, report:
- Stack found/used.
- Files created or modified.
- Features implemented.
- Commands run.
- Tests executed and pass/fail status.
- How to run the app.
- How to export CSV and back up/restore JSON.
- Known limitations, especially timestamp accuracy, local-only storage, and reload recovery.
- Whether PortgasDB was integrated; if not, state clearly that it remains deferred.

Do not claim a test passed if it was not run. Do not claim the app is production-ready merely because it compiles.
