import { ipcRenderer } from "electron";
import type { Action } from "../main/types";

export type ScreenshotExportMeta = {
  screenshotId: string;
  screenshotRef: string;
  actionId: string;
  phase: "before" | "during" | "after";
  mimeType: string;
  width: number;
  height: number;
  wallClockCapturedAt: number;
  streamTimestampMs?: number;
  captureLatencyMs: number;
};

export async function exportSessionBundle(params: {
  sessionId: string;
  createdAt: number;
  endedAt: number;
  actions: Action[];
  screenshots: ScreenshotExportMeta[];
  video: { videoRef: string; mimeType: string };
}): Promise<{ zipPath: string } | null> {
  const { canceled, filePath } = (await ipcRenderer.invoke(
    "showSaveExportDialog",
    `session-${params.sessionId}.zip`,
  )) as { canceled: boolean; filePath?: string };

  if (canceled || !filePath) return null;

  return (await ipcRenderer.invoke("exportSessionBundle", {
    ...params,
    zipPath: filePath,
  })) as { zipPath: string };
}

