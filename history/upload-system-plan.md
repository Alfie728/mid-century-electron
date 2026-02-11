# Upload Coordination System — Implementation Plan

## Context

The app currently records screen sessions (video + screenshots + input actions) and exports them as zip bundles to the local filesystem. There is **no upload capability** — the entire Upload Coordination section from Design.md (Section 2.7, 9) is unimplemented. The user wants:

- **S3 direct upload** using AWS SDK (app holds credentials, generates presigned URLs)
- **Post-session bundle upload** — upload the complete zip after recording stops
- **Manual trigger** — user clicks "Upload" on a session
- **JSON file state persistence** — no SQLite
- **Retry with exponential backoff** on failure

---

## Architecture Overview

```
Renderer (App.tsx / SessionListView)
  │  ipcRenderer.invoke("uploadSession", sessionId)
  │  ipcRenderer.on("upload:progress", handler)
  ▼
Main Process (uploadIpc.ts)
  │  validates, enqueues
  ▼
UploadQueue (uploadQueue.ts)          UploadStateStore (uploadStateStore.ts)
  │  serial execution, backoff           │  read/write upload-state.json
  ▼                                      │  per session directory
UploadService (uploadService.ts)     ◄───┘
  │  @aws-sdk/lib-storage Upload
  ▼
S3 Bucket
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/main/uploadConfig.ts` | Read/write `upload-config.json` (bucket, region, credentials) |
| `src/main/uploadStateStore.ts` | Read/write `upload-state.json` per session dir |
| `src/main/uploadService.ts` | S3 client, multipart upload with progress + abort |
| `src/main/uploadQueue.ts` | In-memory FIFO queue, serial execution, exponential backoff |
| `src/main/uploadIpc.ts` | Register all upload IPC handlers, init queue on ready |
| `src/components/SessionListView.tsx` | Session list UI with upload controls |
| `src/components/SessionCard.tsx` | Individual session row with status/progress |
| `src/components/UploadConfigPanel.tsx` | S3 config form |
| `src/hooks/useSessions.ts` | Fetch session list + listen for progress events |

## Files to Modify

| File | Change |
|------|---------|
| `src/main/types.ts` | Add `UploadState`, `UploadConfig`, `SessionMeta`, `SessionListItem` types |
| `src/index.ts` | Import `uploadIpc`, call `initUploadSystem()` in `app.on("ready")`, modify `cleanupOrphanedSessions()` to respect upload state, add `saveSessionMeta` handler |
| `src/App.tsx` | Save `session-meta.json` after export, add view toggle (recording ↔ sessions) |
| `package.json` | Add `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/lib-storage` |

---

## New Types (`src/main/types.ts`)

```typescript
export type UploadStatus = "not_uploaded" | "pending" | "uploading" | "done" | "failed";

export type UploadState = {
  sessionId: string;
  status: UploadStatus;
  s3Key?: string;
  bytesUploaded: number;
  totalBytes: number;
  retryCount: number;
  maxRetries: number;
  lastError?: string;
  lastAttemptAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type UploadConfig = {
  bucket: string;
  region: string;
  keyPrefix: string;         // e.g. "sessions/"
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  maxRetries: number;        // default 10
  partSizeBytes: number;     // default 10MB
};

export type SessionMeta = {
  sessionId: string;
  createdAt: number;
  endedAt: number;
  actionCount: number;
  screenshotCount: number;
  videoRef?: string;
  zipPath?: string;
  fileSizeBytes?: number;
};

export type SessionListItem = {
  sessionId: string;
  createdAt: number;
  endedAt?: number;
  actionCount: number;
  fileSizeBytes?: number;
  zipPath?: string;
  isExported: boolean;
  uploadStatus: UploadStatus;
  uploadProgress?: number;    // 0-100
  lastUploadError?: string;
};

export type UploadProgressPayload = {
  sessionId: string;
  status: UploadStatus;
  bytesUploaded: number;
  totalBytes: number;
  progress: number;           // 0-100
  error?: string;
};
```

---

## New IPC Channels

| Channel | Type | Purpose |
|---------|------|---------|
| `getUploadConfig` | handle | Get current S3 config |
| `setUploadConfig` | handle | Save S3 config (validates first) |
| `validateUploadConfig` | handle | Test S3 credentials |
| `listSessions` | handle | List all sessions with upload status |
| `saveSessionMeta` | handle | Persist session metadata after export |
| `uploadSession` | handle | Enqueue session for upload |
| `retryUpload` | handle | Reset retry count, re-enqueue |
| `cancelUpload` | handle | Abort in-progress upload |
| `upload:progress` | send (push) | Progress events from main → renderer |

---

## Key Design Decisions

1. **Multipart upload via `@aws-sdk/lib-storage`** — handles files of any size, provides progress callbacks, supports abort
2. **Serial queue (one upload at a time)** — avoids bandwidth saturation, simpler state
3. **JSON per-session (`upload-state.json`)** — matches existing per-session directory pattern, no new dependencies
4. **Session list in main window** — when not recording, show SessionListView. Avoids another BrowserWindow
5. **Progress via IPC push** — `webContents.send("upload:progress", ...)`, consistent with toolbar state pattern
6. **Credentials in plaintext JSON** — simple; can upgrade to `safeStorage` later

---

## Upload State Machine

```
not_uploaded → [user clicks Upload] → pending
pending → [queue picks up] → uploading
uploading → [success] → done
uploading → [failure, retries left] → pending (with backoff delay)
uploading → [failure, max retries] → failed (poison-pill)
failed → [user clicks Retry] → pending (reset retryCount)
uploading → [user clicks Cancel] → not_uploaded
```

**Backoff**: `min(1000 * 2^retryCount, 300000)` ms (1s → 2s → 4s → ... → 5min cap)

---

## Data Flows

### Upload Trigger
1. User clicks "Upload" on a SessionCard
2. Renderer → `ipcRenderer.invoke("uploadSession", sessionId)`
3. Main validates: session exists, is exported, zip exists, config is set
4. `uploadQueue.enqueue(sessionId)` → writes `upload-state.json { status: "pending" }`
5. Queue processes: `uploadService.uploadFile(zipPath, s3Key, onProgress)`
6. Progress callbacks → `writeUploadState()` + `webContents.send("upload:progress", ...)`
7. On success → `upload-state.json { status: "done" }`
8. On failure → retry with backoff or mark as "failed"

### App Startup Restoration
1. `cleanupOrphanedSessions()` — now also checks `upload-state.json` before deleting
2. `uploadQueue.restore()` — scans all `upload-state.json` files
3. Sessions with status `"uploading"` → reset to `"pending"` (interrupted)
4. Sessions with status `"pending"` or retriable `"failed"` → re-enqueue

### Session List Query
1. Renderer → `ipcRenderer.invoke("listSessions")`
2. Main scans `sessions/` dir, reads `session-meta.json` + `upload-state.json` + `.exported` marker
3. Returns `SessionListItem[]` sorted by `createdAt` desc

---

## On-Disk Layout (additions)

```
app.getPath("userData")/
├── upload-config.json                    # Global S3 config
└── sessions/
    └── {sessionId}/
        ├── session-meta.json             # NEW: lightweight metadata
        ├── upload-state.json             # NEW: upload tracking
        ├── .exported                     # Existing marker
        ├── actions.json                  # Existing
        ├── video/                        # Existing
        └── screenshots/                  # Existing
```

---

## Cleanup Modification (`cleanupOrphanedSessions`)

Current: delete sessions >24h old without `.exported` marker.

New logic: also skip sessions with `upload-state.json` where status is `"pending"`, `"uploading"`, or `"done"`. Only delete sessions that have no `.exported` AND no active upload state AND are >24h old.

---

## Estimated Timeline

### Phase 1: Upload Infrastructure Foundation — ~3-4 hours

| Story | Task | Estimate | Dependencies |
|-------|------|----------|--------------|
| 1 | AWS SDK deps + upload types | 20 min | — |
| 2 | Upload config manager (`uploadConfig.ts`) | 30 min | Story 1 |
| 3 | Upload state store (`uploadStateStore.ts`) | 30 min | Story 1 |
| 4 | S3 upload service (`uploadService.ts`) | 60 min | Stories 1-2 |
| 5 | Upload queue (`uploadQueue.ts`) | 60 min | Stories 3-4 |
| 6 | IPC handlers + `index.ts` integration | 45 min | Story 5 |

### Phase 2: Upload UI — ~2-3 hours

| Story | Task | Estimate | Dependencies |
|-------|------|----------|--------------|
| 7 | Session metadata persistence | 20 min | Story 6 |
| 8 | `useSessions` hook | 25 min | Story 6 |
| 9 | SessionCard + UploadProgress components | 45 min | Story 8 |
| 10 | UploadConfigPanel component | 35 min | Story 6 |
| 11 | SessionListView + App.tsx integration | 40 min | Stories 7-10 |

### Phase 3: Upload Resilience — ~1 hour

| Story | Task | Estimate | Dependencies |
|-------|------|----------|--------------|
| 12 | Queue restoration on startup | 30 min | Story 6 |
| 13 | Error handling polish | 30 min | Story 6 |

### Total Estimated: ~6-8 hours

---

## Beads Epics & Stories (to create)

### Epic: Upload Infrastructure (`upload-infra`)

```
Title: Upload Infrastructure — S3 Upload Coordination
Type: epic
Priority: 1
Labels: upload, s3, infrastructure
Description:
  Implement the upload coordination system described in Design.md Section 2.7.
  Direct S3 upload using AWS SDK with multipart support, in-memory queue with
  exponential backoff, and JSON-based state persistence per session.
```

#### Story 1: `upload-infra.1` — AWS SDK dependencies + upload types
```
Title: Add AWS SDK dependencies and upload types
Type: task
Priority: 1
Labels: upload, types, setup
Dependencies: parent of upload-infra
Description:
  Install @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @aws-sdk/lib-storage.
  Add UploadStatus, UploadState, UploadConfig, SessionMeta, SessionListItem,
  UploadProgressPayload types to src/main/types.ts. Verify Webpack build works.
Acceptance Criteria:
  - npm install succeeds for all three AWS SDK packages
  - Types compile without errors
  - `npm start` still launches the app
```

#### Story 2: `upload-infra.2` — Upload config manager
```
Title: Upload config manager (uploadConfig.ts)
Type: task
Priority: 1
Labels: upload, config
Dependencies: blocks upload-infra.1
Description:
  Create src/main/uploadConfig.ts. Reads/writes upload-config.json in
  app.getPath("userData"). Validates required fields (bucket, region,
  accessKeyId, secretAccessKey). Provides defaults for maxRetries (10)
  and partSizeBytes (10MB). Uses existing writeFileAtomic pattern.
Acceptance Criteria:
  - loadUploadConfig() returns null when no config file exists
  - saveUploadConfig() writes valid JSON atomically
  - validateUploadConfig() rejects missing required fields
```

#### Story 3: `upload-infra.3` — Upload state store
```
Title: Upload state store (uploadStateStore.ts)
Type: task
Priority: 1
Labels: upload, state
Dependencies: blocks upload-infra.1
Description:
  Create src/main/uploadStateStore.ts. Reads/writes upload-state.json per
  session directory. Uses writeFileAtomic for crash safety. Provides
  scanAllUploadStates() to enumerate all session upload states on startup.
Acceptance Criteria:
  - readUploadState() returns null for missing file
  - writeUploadState() + readUploadState() roundtrip preserves data
  - scanAllUploadStates() finds states across multiple session directories
```

#### Story 4: `upload-infra.4` — S3 upload service
```
Title: S3 upload service (uploadService.ts)
Type: task
Priority: 1
Labels: upload, s3
Dependencies: blocks upload-infra.1, upload-infra.2
Description:
  Create src/main/uploadService.ts. UploadService class that initializes
  S3Client from UploadConfig. Uses @aws-sdk/lib-storage Upload class for
  multipart upload with progress callbacks. Supports AbortController for
  cancellation. Files streamed via fs.createReadStream() (no full-memory load).
  validateCredentials() calls HeadBucket. Error classification: retryable
  (network/5xx) vs permanent (auth/404/bad request).
Acceptance Criteria:
  - uploadFile() streams a file to S3 with progress callbacks
  - AbortController cancels an in-progress upload
  - validateCredentials() returns { valid, error? }
  - isRetryableError() correctly classifies network vs auth errors
```

#### Story 5: `upload-infra.5` — Upload queue
```
Title: Upload queue (uploadQueue.ts)
Type: task
Priority: 1
Labels: upload, queue
Dependencies: blocks upload-infra.3, upload-infra.4
Description:
  Create src/main/uploadQueue.ts. UploadQueue class with in-memory FIFO,
  serial execution (one upload at a time). Exponential backoff:
  min(1000 * 2^n, 300000) ms. Max retries from config (default 10), then
  poison-pill status. Methods: enqueue(), retry() (resets retryCount),
  cancel() (aborts via AbortController), restore() (re-populates from disk).
  State transitions: not_uploaded → pending → uploading → done/failed.
Acceptance Criteria:
  - enqueue() starts processing immediately if queue is idle
  - Only one upload runs at a time (serial)
  - Failed uploads retry with increasing delays up to 5 min
  - After maxRetries, status becomes "failed"
  - retry() resets retryCount and re-enqueues
  - cancel() aborts the current upload and resets state
  - restore() re-enqueues pending/interrupted sessions from disk
```

#### Story 6: `upload-infra.6` — IPC handlers + main process integration
```
Title: Upload IPC handlers and main process integration
Type: task
Priority: 1
Labels: upload, ipc
Dependencies: blocks upload-infra.5
Description:
  Create src/main/uploadIpc.ts with all upload IPC handlers:
  getUploadConfig, setUploadConfig, validateUploadConfig, listSessions,
  saveSessionMeta, uploadSession, retryUpload, cancelUpload.
  Broadcast upload:progress to all windows via webContents.send.
  Add initUploadSystem() that creates UploadService + UploadQueue on app ready.
  Modify cleanupOrphanedSessions() in index.ts to check upload-state.json
  before deleting sessions.
Acceptance Criteria:
  - All IPC channels respond correctly from renderer
  - upload:progress events broadcast to all windows during upload
  - Queue initializes and restores from disk on app startup
  - Orphan cleanup skips sessions with active upload state
```

### Epic: Upload UI (`upload-ui`)

```
Title: Upload UI — Session List and Upload Controls
Type: epic
Priority: 1
Labels: upload, ui
Description:
  Build the renderer-side UI for browsing sessions and managing uploads.
  Session list view with upload/retry/cancel controls, progress bars,
  status badges, and S3 configuration panel.
```

#### Story 7: `upload-ui.1` — Session metadata persistence
```
Title: Persist session metadata after export
Type: task
Priority: 1
Labels: upload, metadata
Dependencies: blocks upload-infra.6
Description:
  After successful export in App.tsx handleStop, call saveSessionMeta IPC
  to write session-meta.json with: sessionId, createdAt, endedAt,
  actionCount, screenshotCount, videoRef, zipPath, fileSizeBytes.
Acceptance Criteria:
  - session-meta.json written to session directory after every export
  - Includes accurate action count and file size
```

#### Story 8: `upload-ui.2` — useSessions hook
```
Title: useSessions hook for session list
Type: task
Priority: 1
Labels: upload, hook
Dependencies: blocks upload-infra.6
Description:
  Create src/hooks/useSessions.ts. Fetches session list via listSessions IPC.
  Listens for upload:progress events and updates matching sessions in state.
  Exposes sessions array, loading state, and refresh() function.
Acceptance Criteria:
  - Returns session list sorted by date (newest first)
  - Updates individual session progress in real-time from upload:progress events
  - refresh() re-fetches the full list
```

#### Story 9: `upload-ui.3` — SessionCard + UploadProgress components
```
Title: SessionCard and UploadProgress UI components
Type: task
Priority: 1
Labels: upload, ui, components
Dependencies: blocks upload-ui.2
Description:
  Create src/components/SessionCard.tsx — displays session date, action count,
  file size, upload status badge. Upload/Retry/Cancel buttons based on state.
  Create src/components/UploadProgress.tsx — progress bar with percentage,
  colored status badges (gray=not uploaded, blue=uploading, green=done, red=failed).
  Match existing Tailwind + dark theme styling.
Acceptance Criteria:
  - SessionCard shows correct metadata from SessionListItem
  - Upload button enabled only for exported, not-yet-uploaded sessions
  - Progress bar updates in real-time during upload
  - Retry button visible for failed uploads
  - Cancel button visible during active upload
```

#### Story 10: `upload-ui.4` — UploadConfigPanel
```
Title: S3 configuration panel component
Type: task
Priority: 1
Labels: upload, ui, config
Dependencies: blocks upload-infra.6
Description:
  Create src/components/UploadConfigPanel.tsx — form with inputs for bucket,
  region, key prefix, access key ID, secret access key. "Test Connection"
  button calls validateUploadConfig. "Save" button calls setUploadConfig.
  Inline validation errors. Collapsible/expandable.
Acceptance Criteria:
  - Form loads existing config if present
  - Test Connection shows success/failure feedback
  - Save persists config and validation errors shown inline
```

#### Story 11: `upload-ui.5` — SessionListView + App.tsx integration
```
Title: Session list view and App.tsx view switching
Type: task
Priority: 1
Labels: upload, ui, integration
Dependencies: blocks upload-ui.1, upload-ui.3, upload-ui.4
Description:
  Create src/components/SessionListView.tsx composing SessionCard list +
  UploadConfigPanel. Add view state to App.tsx ("recording" | "sessions").
  When not recording, show session list. Add mechanism to switch views
  (e.g., toolbar button or automatic after stop).
Acceptance Criteria:
  - Session list shows all recorded sessions with upload status
  - Can upload, retry, and cancel from the session list
  - S3 config panel accessible from session list view
  - Smooth transition between recording and session list views
```

### Epic: Upload Resilience (`upload-resilience`)

```
Title: Upload Resilience — Startup Recovery and Error Handling
Type: epic
Priority: 2
Labels: upload, resilience
Description:
  Harden the upload system for crash recovery and improved error handling.
  Restore upload queue from disk on startup and classify errors for
  appropriate retry/fail behavior.
```

#### Story 12: `upload-resilience.1` — Queue restoration on startup
```
Title: Restore upload queue from disk on startup
Type: task
Priority: 2
Labels: upload, resilience
Dependencies: blocks upload-infra.6
Description:
  On app startup (after cleanupOrphanedSessions), scan all session
  upload-state.json files. Reset "uploading" → "pending" (interrupted by crash).
  Re-enqueue "pending" and retriable "failed" sessions. Ensure queue processes
  restored items.
Acceptance Criteria:
  - Interrupted uploads resume after app restart
  - Pending uploads are picked up after restart
  - Failed uploads below maxRetries are retried
  - Failed uploads at maxRetries remain failed
```

#### Story 13: `upload-resilience.2` — Error handling polish
```
Title: Error classification and user-facing error messages
Type: task
Priority: 2
Labels: upload, errors
Dependencies: blocks upload-infra.6
Description:
  Implement distinct error messages for: invalid credentials (403),
  bucket not found (404), network failure (timeout/DNS), file missing
  (zip deleted). Non-retryable errors (auth, config) skip backoff and
  immediately mark as failed. Error details visible in SessionCard tooltip
  or expandable section.
Acceptance Criteria:
  - Auth errors fail immediately (no retry)
  - Network errors retry with backoff
  - Error messages are user-readable (not raw AWS SDK errors)
  - Failed SessionCard shows the error reason
```

---

## Implementation Sequence

```
Phase 1 (Foundation):  Story 1 → Story 2 + Story 3 (parallel) → Story 4 → Story 5 → Story 6
Phase 2 (UI):          Story 7 + Story 8 (parallel) → Story 9 + Story 10 (parallel) → Story 11
Phase 3 (Resilience):  Story 12 + Story 13 (parallel)
```

### Gantt-style Timeline

```
Hour 0-1:   [Story 1: SDK + types] → [Story 2: config] + [Story 3: state store]
Hour 1-2:   [Story 4: S3 service                                              ]
Hour 2-3:   [Story 5: queue                                                    ]
Hour 3-4:   [Story 6: IPC + integration                                        ]
Hour 4-5:   [Story 7: meta] + [Story 8: hook] → [Story 9: cards] + [Story 10: config panel]
Hour 5-6:   [Story 11: SessionListView + App.tsx                               ]
Hour 6-7:   [Story 12: queue restoration] + [Story 13: error polish            ]
Hour 7-8:   [Manual E2E testing + bug fixes                                    ]
```

**Total: ~6-8 hours** (single developer, including testing)

---

## Verification

1. **Build check**: `npm start` — app launches, no Webpack errors from AWS SDK
2. **Config flow**: Open app → navigate to session list → configure S3 → test connection → save
3. **Upload flow**: Record session → stop → export → open session list → click Upload → observe progress → verify file in S3 bucket
4. **Retry flow**: Configure invalid credentials → upload → see failure → fix credentials → click Retry → success
5. **Cancel flow**: Start upload → click Cancel → verify upload aborted, state reset
6. **Restart resilience**: Start upload → kill app → restart → verify upload resumes automatically
7. **Cleanup safety**: Verify orphaned session cleanup does not delete sessions with pending uploads
