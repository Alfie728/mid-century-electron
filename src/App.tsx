import { useCallback, useEffect, useRef, useState } from "react";
import { ipcRenderer } from "electron";
import { useDesktopSources } from "./hooks/useDesktopSources";
import { useDesktopPreview } from "./hooks/useDesktopPreview";
import { useRecorder, VideoStreamResult } from "./hooks/useRecorder";
import { useActions } from "./hooks/useActions";
import { createScreenshotService, ScreenshotService } from "./renderer/screenshotService";
import { persistScreenshot } from "./renderer/persistScreenshot";
import type { ScreenshotExportMeta } from "./renderer/exportSessionBundle";

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

  // Broadcast state updates to toolbar
  useEffect(() => {
    ipcRenderer.send("main:stateUpdate", {
      state: isRecording ? "recording" : "idle",
      selectedSourceId,
      sources: inputSources,
    });
  }, [isRecording, selectedSourceId, inputSources]);

  // Combined start handler
  const handleStart = useCallback(async () => {
    const sessionId = generateSessionId();
    sessionIdRef.current = sessionId;
    screenshotMetaRef.current = [];
    lastSeenActionIdRef.current = "";
    clearActions();
    setInputCaptureError(null);
    // Start recording with sessionId for streaming to disk
    await startRecording(sessionId);
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
      await startCapture(sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setInputCaptureError(message);
    }
  }, [startRecording, startCapture, clearActions]);

  // Combined stop handler
  const handleStop = useCallback(async () => {
    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId) return;

    const createdAt = getSessionStartTimeMs();
    const endedAt = Date.now();

    // Stop recording IMMEDIATELY when user clicks stop
    stopCapture();

    // Start video finalization (don't await yet - let it run in background)
    const videoResultPromise = stopRecording();

    // Show save dialog while video finalizes in background
    const { canceled, filePath } = (await ipcRenderer.invoke(
      "showSaveExportDialog",
      `session-${currentSessionId}.zip`,
    )) as { canceled: boolean; filePath?: string };

    // Now wait for video finalization to complete
    const videoResult = await videoResultPromise;
    await captureQueueRef.current;

    if (canceled || !filePath) {
      // User canceled - cleanup
      await ipcRenderer.invoke("cleanupSession", currentSessionId);
      return;
    }

    // Final screenshot is best-effort and non-blocking - don't wait for it
    if (screenshotServiceRef.current) {
      enqueue(async () => {
        await captureAndPersist("session_end", "after").catch(console.error);
      });
      // Don't await - let it complete in background
    }

    if (!videoResult) {
      console.error("No video result after stopping recording");
      return;
    }

    // Export - video is already on disk
    const exportResult = (await ipcRenderer.invoke("exportSessionBundle", {
      sessionId: currentSessionId,
      createdAt,
      endedAt,
      actions,
      screenshots: screenshotMetaRef.current,
      video: { videoRef: videoResult.videoRef, mimeType: videoResult.mimeType },
      zipPath: filePath,
    })) as { zipPath: string };

    // Mark session as successfully exported
    await ipcRenderer.invoke("markSessionExported", currentSessionId);

    console.log("Exported session bundle:", exportResult.zipPath);
    console.log(
      `Session ${currentSessionId} ended with ${actions.length} actions`,
    );
  }, [actions, getSessionStartTimeMs, stopCapture, stopRecording]);

  // Listen for toolbar commands
  useEffect(() => {
    const handleSelectSource = (_event: Electron.IpcRendererEvent, sourceId: string) => {
      previewSource(sourceId);
    };

    const handleToolbarStart = () => {
      handleStart();
    };

    const handleToolbarStop = () => {
      handleStop();
    };

    // TODO: Implement pause/resume in useRecorder hook
    const handleToolbarPause = () => {
      console.log("Pause not implemented yet");
    };

    const handleToolbarResume = () => {
      console.log("Resume not implemented yet");
    };

    ipcRenderer.on("toolbar:selectSource", handleSelectSource);
    ipcRenderer.on("toolbar:start", handleToolbarStart);
    ipcRenderer.on("toolbar:stop", handleToolbarStop);
    ipcRenderer.on("toolbar:pause", handleToolbarPause);
    ipcRenderer.on("toolbar:resume", handleToolbarResume);

    return () => {
      ipcRenderer.removeListener("toolbar:selectSource", handleSelectSource);
      ipcRenderer.removeListener("toolbar:start", handleToolbarStart);
      ipcRenderer.removeListener("toolbar:stop", handleToolbarStop);
      ipcRenderer.removeListener("toolbar:pause", handleToolbarPause);
      ipcRenderer.removeListener("toolbar:resume", handleToolbarResume);
    };
  }, [handleStart, handleStop, previewSource]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/10">
        <h1 className="text-lg font-medium text-white/90">
          {isRecording ? "Recording..." : "Preview"}
        </h1>
        <p className="text-sm text-white/50">
          {isRecording
            ? `Capturing ${actions.length} actions`
            : selectedSourceId
              ? "Ready to record"
              : "Select a screen from the toolbar below"}
        </p>
      </div>

      {/* Video Preview */}
      <div className="flex-1 p-4">
        <div className="h-full rounded-xl border border-white/10 bg-black/40 overflow-hidden">
          <video
            className="w-full h-full object-contain"
            ref={videoRef}
          ></video>
        </div>
      </div>

      {/* Status Bar */}
      <div className="px-6 py-3 border-t border-white/10 flex items-center gap-4 text-sm">
        {/* Recording status */}
        {isRecording && (
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                isCapturing ? "bg-green-500 animate-pulse" : "bg-gray-400"
              }`}
            />
            <span className="text-white/70">
              {isCapturing ? "Capturing input" : "Input capture stopped"}
            </span>
          </div>
        )}

        {/* Accessibility permission warning */}
        {accessibilityGranted === false && (
          <div className="flex items-center gap-2 text-yellow-400">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <span>Accessibility permission required</span>
          </div>
        )}

        {/* Error */}
        {(inputCaptureError || lastError) && (
          <div className="flex items-center gap-2 text-red-400">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <span>{inputCaptureError || lastError}</span>
          </div>
        )}
      </div>
    </div>
  );
}
