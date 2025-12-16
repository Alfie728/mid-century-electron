# Mid-Century CUA Electron - Design Document

## 1. Architecture

Electron's process model replaces the Chrome extension's service worker and offscreen document pattern with a simpler main/renderer split. The main process stays alive for the app's lifetime, eliminating suspension concerns.

- **Main Process**: Manages session lifecycle, system permissions, IPC routing, global input capture (via native modules), and file I/O. Acts as the central orchestrator.

- **Renderer Process**: Sole owner of `MediaStream`, `MediaRecorder`, and canvas screenshot pipeline. Handles UI and all stream-bound operations. Survives as long as its BrowserWindow exists.

- **Preload Scripts**: Secure bridge exposing a typed API from main to renderer via `contextBridge`. When `contextIsolation` is enabled, preload is the only safe channel between processes.

- **Global Input Service** (in Main Process): Captures clicks/scrolls/keys/hover system-wide using `iohook-macos`, normalizes raw events into high-level Action objects with timestamps and coordinates, and forwards them to the renderer via IPC.

- **Screenshot Service** (in Renderer): Given `MediaStream`, `ActionId`, and phase (before/during/after), grabs frames from a warmed `<video>` element and produces `ScreenshotArtifact` with dual timestamps (wall-clock + stream).

- **Video Recording Service** (in Renderer): Runs `MediaRecorder` with selected MIME/bitrate/timeslice, indexes emitted chunks by timecode and stream timestamp.

- **Upload Coordinator** (in Main Process): Batches uploads of actions, screenshots, and video chunks. Uses file locks or a simple queue to ensure only one uploader runs at a time.

---

## 2. Key APIs and Policies

### 2.1 Capture Source

- Use `desktopCapturer.getSources({ types: ["window", "screen"] })` in main process to enumerate available sources.
- Expose source list to renderer via IPC; let user choose screen or window.
- Persist `selectedSource: { type: "screen" | "window", sourceId, name, chosenAt }`. If user cancels, keep collecting actions but skip stream-bound artifacts.

### 2.2 Stream Acquisition

- Renderer calls `navigator.mediaDevices.getUserMedia` with `chromeMediaSourceId` from the selected source.
- Handle permission denial and track `ended` events; emit `stream-dead` to UI.
- Warm up a hidden `<video>` bound to the stream and draw once to canvas before first screenshot to avoid blank frames.
- Note: macOS does not support system audio capture via desktopCapturer; handle gracefully.

### 2.3 MediaRecorder

- Capability probe with `MediaRecorder.isTypeSupported`. Ordered candidates:
  1. `video/webm;codecs=vp9,opus`
  2. `video/webm;codecs=vp8,opus`
  3. `video/webm`
- Record with timeslices (e.g., 5-10s). Use `dataavailable.timecode` plus a shared `performance.now()` baseline to align chunk windows.
- Store chosen MIME/bitrate and actual timeslice variance for debugging.

### 2.4 Screenshots

- Given ActionId + phase, draw current frame from the warmed `<video>` to an offscreen `<canvas>`, encode to blob via `canvas.toBlob()`.
- Capture both wall-clock and stream `currentTime`; note capture latency.
- Provide redaction hooks (blur selectors, disable audio if captured).
- Send blob to main process via IPC for disk persistence.

### 2.5 Global Input Capture

- Use native Node modules in main process:
  - **iohook-macos**: Global mouse/keyboard hooks on macOS (native module; must be rebuilt against the Electron version via `electron-rebuild`)
  - **@nut-tree/nut-js**: Alternative with broader platform support
- Raw events are normalized into Action objects and forwarded to renderer via IPC.
- Filter sensitive contexts where possible (though system-wide capture has limited context).
- Event coverage implemented:
  - Clicks: `leftMouseDown/rightMouseDown/otherMouseDown` → `click`
  - Keys: `keyDown` → `keypress`
  - Scroll: `scrollWheel` → `scroll_start` / `scroll_end` (debounced)
  - Hover-ish movement: `mouseMoved` → `mouseover_start` / `mouseover_end` (debounced)

### 2.6 macOS Permissions

- **Screen Recording**: Required for `desktopCapturer`. Prompt user if `systemPreferences.getMediaAccessStatus("screen")` is not granted.
- **Accessibility**: Required for global input capture. Use `iohook-macos` helpers: `checkAccessibilityPermissions()` and `requestAccessibilityPermissions()`.
- Show clear instructions in UI when permissions are missing.

### 2.7 Upload Coordination

- Use file-based locks or an in-memory queue in main process.
- Batch uploads by size/time; mark records uploaded atomically to avoid duplicates.
- On failure, exponential backoff with cap and poison-pill state after N retries.

---

## 3. Data Model

### Session

```typescript
type Session = {
  sessionId: string;
  createdAt: number;
  endedAt?: number;
  source: {
    type: "screen" | "window";
    sourceId: string;
    name: string;
    chosenAt: number;
  } | null;
  limits: {
    maxBytes: number;
    maxDurationMs: number;
  };
  state: "idle" | "consenting" | "recording" | "paused" | "stopping" | "ended";
};
```

### Action

```typescript
type ActionType =
  | "click"
  | "scroll"
  | "scroll_start"
  | "scroll_end"
  | "keypress"
  | "drag_start"
  | "drag_end"
  | "mouseover_start"
  | "mouseover_end"
  | "input";

type Action = {
  actionId: string;
  sessionId: string;
  type: ActionType;
  happenedAt: number; // wall clock timestamp
  relativeTimeMs: number; // ms since session start
  streamTimestamp?: number; // time on the stream (if recording)
  coords: { x: number; y: number };
  pointerMeta?: {
    button: number;
    clickCount: number;
  };
  keyMeta?: {
    key: string;
    code: string;
    modifiers: { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean };
    keyCodes?: number[]; // for chords
  };
  inputValue?: string; // for input events, PII-filtered
  screenshotRef?: string; // during-event frame
  beforeScreenshotRef?: string;
  afterScreenshotRef?: string;
};
```

### VideoChunk

```typescript
type VideoChunk = {
  chunkId: string;
  sessionId: string;
  startStreamTime: number;
  endStreamTime: number;
  timecode: number; // from MediaRecorder
  wallClockCapturedAt: number;
  mimeType: string;
  bitrate?: number;
  filePath: string; // path on disk
};
```

### ScreenshotArtifact

```typescript
type ScreenshotArtifact = {
  screenshotId: string;
  sessionId: string;
  actionId: string;
  phase: "before" | "during" | "after";
  streamTimestamp?: number;
  wallClockCapturedAt: number;
  captureLatencyMs?: number;
  filePath: string; // path on disk
};
```

### UploadJob

```typescript
type UploadJob = {
  jobId: string;
  sessionId: string;
  itemRefs: string[]; // IDs of actions/chunks/screenshots
  status: "pending" | "uploading" | "failed" | "done";
  retries: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
};
```

---

## 4. Storage and Queueing

- **File System for Blobs**: Store video chunks and screenshots in app's userData directory (`app.getPath("userData")`). Organize by session: `sessions/{sessionId}/video/`, `sessions/{sessionId}/screenshots/`.

- **Metadata Storage**: Use SQLite (better-sqlite3) or JSON files for session metadata, actions, and upload jobs. SQLite preferred for querying and atomic operations.

- **Quotas**: Enforce max session length, total bytes, per-chunk size. When nearing limits, pause recording and prompt user or evict oldest pending artifacts (configurable).

- **Indexes**: Maintain indexes for pending uploads and active sessions. Mark uploaded items atomically.

- **Cleanup**: On session end or user request, provide "delete session" functionality. Auto-delete after N days (configurable).

---

## 5. End-to-End Flow

1. **User opens app**: Main process initializes, checks permissions, loads any persisted session state.

2. **User starts recording**: UI triggers start; main process sets session state to `consenting`.

3. **Source selection**: Main process calls `desktopCapturer.getSources`, sends list to renderer. User picks screen/window.

4. **Stream acquisition**: Renderer calls `getUserMedia` with `chromeMediaSourceId`; warms video/canvas with initial draw.

5. **Recording begins**: Renderer starts `MediaRecorder` (timesliced) and begins indexing chunks with timecodes. Session state becomes `recording`.

6. **Global input capture**: Main process listens for system-wide input events via native module, normalizes into Actions with wall-clock + perf baseline, forwards to renderer via IPC.

7. **Screenshot capture**: On each Action, renderer captures before/during/after screenshots, attaches stream/wall timestamps, sends blobs to main for disk storage.

8. **Artifact persistence**: Main process writes chunks and screenshots to disk, updates metadata in SQLite/JSON.

9. **Upload queue**: New artifacts enqueue UploadJobs; Upload Coordinator batches uploads to backend, marking successes atomically and backing off on failures.

10. **Stop/Pause**: On pause/stop/user close/track end events, renderer stops tracks/recorder, main flushes queues, session state becomes `ended`.

---

## 6. Privacy, UX, and Safety

- **Recording Indicator**: Show clear visual indicator when recording is active. Consider system tray icon or always-on-top mini window.

- **Controls**: Provide pause/stop controls accessible at all times (keyboard shortcuts, tray menu).

- **Sensitive Input Filtering**: Avoid capturing raw keystrokes for password fields where detectable. Support redaction/blur for specific screen regions in screenshots.

- **Permission Prompts**: On macOS, guide user through Screen Recording and Accessibility permission grants with clear instructions.

- **Retention Policy**: Show retention settings in UI; offer "delete session" control. Auto-delete after N days (configurable).

- **Storage Usage**: Display current storage usage in UI; warn when approaching limits.

---

## 7. Resilience and Errors

- **Permission Denial**: Detect and surface clearly. Guide user to System Preferences.

- **Stream Ended**: Handle track `ended` event (e.g., window closed mid-capture). Notify UI, finalize current session gracefully.

- **Recorder Errors**: Catch `MediaRecorder` error events, log details, attempt recovery or graceful stop.

- **Upload Failures**: Retry with capped exponential backoff. After N failures, mark as poison-pill; provide manual retry in UI.

- **App Restart**: On launch, check for incomplete sessions. Offer to resume upload queue or discard.

- **Clean Shutdown**: On app quit, stop all tracks, flush pending writes, update session state.

---

## 8. Testing and Validation

- **Platform Tests**: Verify desktopCapturer, MediaRecorder, and native input modules work on macOS, Windows, Linux.

- **Performance Tests**: Profile CPU/memory with recording + screenshot cadence on mid-tier hardware. Tune timeslice, bitrate, screenshot frequency.

- **Permission Tests**: Test flows when permissions are denied, revoked mid-session, or granted after prompt.

- **Edge Cases**: Multiple monitors, window resize during capture, very long sessions, disk full scenarios.

- **End-to-End Manual Run**: Start -> select source -> record actions -> stop -> verify artifacts -> upload.

---

## 9. Implementation Checklist

### Foundation (Completed)

- [x] Electron + React + TypeScript setup with Webpack/Forge
- [x] Main process with BrowserWindow, IPC handlers (`getSources`, `showSaveDialog`, `getOperatingSystem`)
- [x] Preload script (basic, contextIsolation currently disabled)
- [x] Renderer with React UI components

### Screen Capture (Completed)

- [x] `desktopCapturer.getSources` integration in main process
- [x] Source selection UI (`SourceSelect` component)
- [x] Stream acquisition with `getUserMedia` + `chromeMediaSourceId`
- [x] Live preview in `<video>` element (`useDesktopPreview` hook)
- [x] macOS audio handling (disabled on darwin)

### Video Recording (Completed)

- [x] Basic `MediaRecorder` implementation (`useRecorder` hook)
- [x] MIME type support (vp9)
- [x] Save dialog for webm export

### Video Recording (Pending Enhancements)

- [ ] MIME capability probe with fallback chain (vp9 -> vp8 -> webm)
- [ ] Timesliced recording (5-10s chunks) with timecode indexing
- [ ] Chunk metadata persistence (startStreamTime, endStreamTime, etc.)
- [ ] Auto-save chunks to disk during recording

### Screenshot Service (Pending)

- [ ] Canvas-based frame capture from `<video>` element
- [ ] Before/during/after screenshots around actions
- [ ] Wall-clock + stream timestamp capture
- [ ] Capture latency measurement
- [ ] Blob transfer to main process via IPC
- [ ] Disk persistence in session directory
- [ ] Optional redaction/blur hooks

### Global Input Capture (Pending)

- [x] Install `iohook-macos` and add `npm run rebuild` for Electron ABI
- [x] Basic event listeners in main process (click, keypress, scroll, mouseMoved)
- [x] Event normalization into Action objects
- [x] Scroll start/end detection with debounce
- [x] Mouseover start/end detection with debounce
- [ ] Drag start/end detection
- [ ] Input/change event markers
- [ ] IPC forwarding to renderer

### Action System (Pending)

- [ ] Session-level clock baseline for `relativeTimeMs`
- [ ] Full ActionType coverage (click, scroll, drag, keypress, hover, input)
- [ ] Pointer metadata (button, clickCount, viewport coords)
- [ ] Key metadata (key, code, modifiers, keyCodes[] for chords)
- [ ] Input value capture with PII filtering
- [ ] Per-action screenshot refs
- [ ] Timing alignment between actions, screenshots, and video chunks

### Session Management (Pending)

- [ ] Session state machine (`idle` -> `consenting` -> `recording` -> `paused` -> `stopping` -> `ended`)
- [ ] Session persistence to disk (SQLite or JSON)
- [ ] Session resume on app restart
- [ ] Session limits enforcement (maxBytes, maxDuration)

### Storage Layer (Pending)

- [ ] Directory structure in userData (`sessions/{sessionId}/...`)
- [ ] SQLite or JSON store for metadata
- [ ] Atomic writes for session/action/chunk data
- [ ] Size tracking and quota enforcement
- [ ] Cleanup routines (delete session, auto-expire)
- [ ] Export bundle (actions + screenshots + video)

### Upload Coordination (Pending)

- [ ] Upload job queue in main process
- [ ] Batch uploads by size/time
- [ ] Atomic success marking
- [ ] Exponential backoff with cap
- [ ] Poison-pill after N failures
- [ ] Manual retry control in UI

### UX and UI (Partial)

- [x] Start/Stop controls (`RecorderControls` component)
- [x] Source selection dropdown (`SourceSelect` component)
- [x] Video preview
- [ ] Pause control
- [ ] Recording indicator (tray icon or overlay)
- [ ] Permission status display and guidance
- [ ] Storage usage display
- [ ] Error toasts (permission denied, stream ended, quota exceeded)
- [ ] Session list / history view
- [ ] Action timeline with thumbnails

### Privacy and Safety (Pending)

- [ ] Sensitive input filtering (password/CC field detection)
- [ ] Screenshot redaction hooks
- [ ] Retention settings UI
- [ ] "Delete session" control
- [ ] Auto-delete after N days

### Permissions (Pending)

- [ ] Screen recording permission check (`systemPreferences.getMediaAccessStatus`)
- [x] Accessibility permission check (`iohook-macos.checkAccessibilityPermissions`)
- [ ] Permission prompt UI with instructions
- [ ] Graceful degradation when permissions denied

### Resilience (Pending)

- [ ] Handle stream track `ended` event
- [ ] Handle `MediaRecorder` errors
- [ ] Upload auth failure handling
- [ ] Storage quota exceeded handling
- [ ] Clean shutdown on app quit
- [ ] Incomplete session recovery on restart

### Security (Pending)

- [ ] Enable `contextIsolation: true`
- [ ] Implement secure preload API via `contextBridge`
- [ ] Remove `nodeIntegration: true` from renderer
- [ ] Content Security Policy

---

## 10. Action Event Coverage

### Target Payload Shape

Every action carries:

- Session-relative timestamp (`relativeTimeMs`)
- Top-level pointer coords (`x`, `y`)
- Button metadata with click count (for clicks)
- A "during" screenshot ref
- Text for input/change events (post-redaction)
- Key chords as code arrays
- Markers for hover/drag phases

### Current State

Basic action capture is implemented in the main process (click, keypress, scroll start/end, mouseover start/end) and forwarded to the renderer via IPC.

### Planned Implementation

1. Add a session-level clock baseline so all actions include `relativeTimeMs` and reuse that zero-point for screenshot sequencing.

2. Implement global input listener with full ActionType coverage:
   - `click` (with button, clickCount, coords)
   - `scroll_start` / `scroll_end` (debounced)
   - `drag_start` / `drag_end`
   - `keypress` (with key, code, modifiers, keyCodes[])
   - `mouseover_start` / `mouseover_end` (if feasible with system-wide capture)
   - `input` (typed text with PII filtering)

3. Capture pointer data as top-level coords normalized to screen.

4. Capture input values with PII filtering (skip password fields, email, tel, CC patterns).

5. Attach `screenshotRef` per action (prefer the "during" frame) and align filenames/IDs to relative timestamps.

6. Forward all actions from main to renderer via IPC for screenshot capture coordination.
