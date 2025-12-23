import { ipcRenderer } from "electron";
import type {
  ScreenshotCaptureResult,
  ScreenshotPhase,
} from "./screenshotService";

export type PersistedScreenshot = {
  screenshotId: string;
  screenshotRef: string;
  filePath: string;
};

export async function persistScreenshot(
  sessionId: string,
  capture: ScreenshotCaptureResult,
  options?: { relativeTimeMs?: number },
): Promise<PersistedScreenshot> {
  const bytes = await capture.blob.arrayBuffer();

  return (await ipcRenderer.invoke("persistScreenshot", {
    sessionId,
    actionId: capture.actionId,
    phase: capture.phase as ScreenshotPhase,
    mimeType: capture.mimeType,
    wallClockCapturedAt: capture.wallClockCapturedAt,
    streamTimestampMs: capture.streamTimestampMs,
    captureLatencyMs: capture.captureLatencyMs,
    relativeTimeMs: options?.relativeTimeMs,
    bytes,
  })) as PersistedScreenshot;
}

