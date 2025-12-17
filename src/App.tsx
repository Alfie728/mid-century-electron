import { useCallback, useEffect, useRef, useState } from "react";
import { useDesktopSources } from "./hooks/useDesktopSources";
import { useDesktopPreview } from "./hooks/useDesktopPreview";
import { useRecorder } from "./hooks/useRecorder";
import { useActions } from "./hooks/useActions";
import { SourceSelect } from "./components/SourceSelect";
import { RecorderControls } from "./components/RecorderControls";
import { createScreenshotService, ScreenshotService } from "./renderer/screenshotService";
import { persistScreenshot } from "./renderer/persistScreenshot";
import { persistVideo } from "./renderer/persistVideo";
import { exportSessionBundle, ScreenshotExportMeta } from "./renderer/exportSessionBundle";

// Generate a unique session ID
function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export default function App() {
  const inputSources = useDesktopSources();
  const videoRef = useRef<HTMLVideoElement>(null);
  const { selectedSourceId, previewSource, getPreviewStream } =
    useDesktopPreview(videoRef);
  const { isRecording, startRecording, stopRecording } =
    useRecorder(getPreviewStream);
  const {
    actions,
    isCapturing,
    lastError,
    startCapture,
    stopCapture,
    clearActions,
    updateAction,
    getSessionStartTimeMs,
    checkAccessibilityPermission,
  } = useActions();
  console.log("actions", actions);

  const [accessibilityGranted, setAccessibilityGranted] = useState<
    boolean | null
  >(null);
  const [inputCaptureError, setInputCaptureError] = useState<string | null>(
    null,
  );
  const sessionIdRef = useRef<string>("");
  const screenshotServiceRef = useRef<ScreenshotService | null>(null);
  const screenshotMetaRef = useRef<ScreenshotExportMeta[]>([]);
  const captureQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastSeenActionIdRef = useRef<string>("");

  const captureAndPersist = async (
    actionId: string,
    phase: "before" | "during" | "after",
    relativeTimeMs?: number,
  ) => {
    if (!sessionIdRef.current) return null;
    const service = screenshotServiceRef.current;
    if (!service) return null;

    const capture = await service.capture({ actionId, phase });
    const persisted = await persistScreenshot(sessionIdRef.current, capture, {
      relativeTimeMs,
    });

    screenshotMetaRef.current.push({
      screenshotId: persisted.screenshotId,
      screenshotRef: persisted.screenshotRef,
      actionId,
      phase,
      mimeType: capture.mimeType,
      width: capture.width,
      height: capture.height,
      wallClockCapturedAt: capture.wallClockCapturedAt,
      streamTimestampMs: capture.streamTimestampMs,
      captureLatencyMs: capture.captureLatencyMs,
    });

    return { persisted, capture };
  };

  const enqueue = (job: () => Promise<void>) => {
    captureQueueRef.current = captureQueueRef.current
      .then(job)
      .catch((error) => {
        console.error("Screenshot capture job failed:", error);
      });
  };

  useEffect(() => {
    const latest = actions[actions.length - 1];
    if (!latest) return;
    if (latest.actionId === lastSeenActionIdRef.current) return;
    lastSeenActionIdRef.current = latest.actionId;

    if (!isRecording) return;
    if (!sessionIdRef.current) return;
    if (!screenshotServiceRef.current) return;

    enqueue(async () => {
      const shouldCaptureSingle =
        latest.type === "mouseover_start" ||
        latest.type === "mouseover_end" ||
        latest.type === "drag_start" ||
        latest.type === "drag_end" ||
        latest.type === "scroll_start" ||
        latest.type === "scroll_end";

      if (shouldCaptureSingle) {
        const result = await captureAndPersist(
          latest.actionId,
          "during",
          latest.relativeTimeMs,
        );
        if (!result) return;

        updateAction(latest.actionId, {
          screenshotRef: result.persisted.screenshotRef,
          streamTimestamp: result.capture.streamTimestampMs,
        });
        return;
      }

      const shouldCaptureBeforeAfter =
        latest.type === "click" || latest.type === "keypress";

      if (shouldCaptureBeforeAfter) {
        const before = await captureAndPersist(
          latest.actionId,
          "before",
          latest.relativeTimeMs,
        );
        if (before) {
          updateAction(latest.actionId, {
            beforeScreenshotRef: before.persisted.screenshotRef,
            streamTimestamp: before.capture.streamTimestampMs,
          });
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 120));

        const after = await captureAndPersist(
          latest.actionId,
          "after",
          latest.relativeTimeMs + 120,
        );
        if (after) {
          updateAction(latest.actionId, {
            afterScreenshotRef: after.persisted.screenshotRef,
          });
        }
      }
    });
  }, [actions, isRecording, updateAction]);

  // Check accessibility permission on mount
  useEffect(() => {
    checkAccessibilityPermission().then((result) => {
      setAccessibilityGranted(result.granted);
      if (!result.granted && result.platform === "darwin") {
        console.warn(
          "Accessibility permission not granted. Global input capture may not work.",
        );
      }
    });
  }, [checkAccessibilityPermission]);

  // Combined start handler
  const handleStart = useCallback(async () => {
    sessionIdRef.current = generateSessionId();
    screenshotMetaRef.current = [];
    lastSeenActionIdRef.current = "";
    clearActions();
    setInputCaptureError(null);
    startRecording();
    if (videoRef.current) {
      const service = createScreenshotService(videoRef.current);
      screenshotServiceRef.current = service;
      try {
        await service.warm();
      } catch (error) {
        console.warn("Screenshot warm-up failed:", error);
      }
    }
    try {
      await startCapture(sessionIdRef.current);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setInputCaptureError(message);
    }
  }, [startRecording, startCapture, clearActions]);

  // Combined stop handler
  const handleStop = useCallback(async () => {
    await stopCapture();
    const videoBlob = await stopRecording();
    await captureQueueRef.current;

    // Always attempt a final screenshot for the export (best-effort).
    if (sessionIdRef.current && screenshotServiceRef.current) {
      enqueue(async () => {
        await captureAndPersist("session_end", "after");
      });
      await captureQueueRef.current;
    }

    if (!sessionIdRef.current || !videoBlob) return;

    const persistedVideo = await persistVideo(sessionIdRef.current, videoBlob);
    const createdAt = getSessionStartTimeMs();
    const endedAt = Date.now();

    const exportResult = await exportSessionBundle({
      sessionId: sessionIdRef.current,
      createdAt,
      endedAt,
      actions,
      screenshots: screenshotMetaRef.current,
      video: { videoRef: persistedVideo.videoRef, mimeType: persistedVideo.mimeType },
    });
    if (exportResult) {
      console.log("Exported session bundle:", exportResult.zipPath);
    }
    console.log(
      `Session ${sessionIdRef.current} ended with ${actions.length} actions`,
    );
  }, [actions, getSessionStartTimeMs, stopCapture, stopRecording]);

  return (
    <div className="min-h-screen bg-linear-to-br from-base-200 via-base-100 to-base-200 text-base-content flex items-center justify-center px-6 py-10">
      <div className="w-full">
        <div className="card bg-base-100 shadow-2xl border border-base-200">
          <div className="card-body gap-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold">Screen Recorder</h1>
                <p className="text-sm text-base-content/70">
                  Pick a screen to preview, then start recording when ready.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-base-300 bg-base-200/60 p-3">
              <video
                className="w-full aspect-video rounded-lg bg-black/60 object-contain shadow-inner"
                ref={videoRef}
              ></video>
            </div>

            <div className="grid gap-4 md:grid-cols-[auto,1fr] items-center">
              <RecorderControls
                isRecording={isRecording}
                canRecord={Boolean(selectedSourceId)}
                onStart={handleStart}
                onStop={handleStop}
              />

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-base-content/70">
                  Choose a source
                </label>
                <SourceSelect
                  sources={inputSources}
                  selectedId={selectedSourceId}
                  onChange={(id) => previewSource(id)}
                />
              </div>
            </div>

            {/* Action capture status */}
            {isRecording && (
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isCapturing ? "bg-green-500 animate-pulse" : "bg-gray-400"
                    }`}
                  ></span>
                  <span className="text-base-content/70">
                    {isCapturing ? "Capturing input" : "Input capture stopped"}
                  </span>
                </div>
                <div className="badge badge-primary">
                  {actions.length} actions
                </div>
              </div>
            )}

            {/* Accessibility permission warning */}
            {accessibilityGranted === false && (
              <div className="alert alert-warning text-sm">
                <span>
                  Accessibility permission is required for global input capture
                  on macOS. Please grant permission in System Preferences.
                </span>
              </div>
            )}

            {/* Input capture error */}
            {(inputCaptureError || lastError) && (
              <div className="alert alert-error text-sm">
                <span>{inputCaptureError || lastError}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
