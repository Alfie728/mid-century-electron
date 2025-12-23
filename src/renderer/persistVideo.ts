import { ipcRenderer } from "electron";

export type PersistedVideo = {
  videoRef: string;
  filePath: string;
  mimeType: string;
};

export async function persistVideo(
  sessionId: string,
  blob: Blob,
): Promise<PersistedVideo> {
  const bytes = await blob.arrayBuffer();
  return (await ipcRenderer.invoke("persistVideo", {
    sessionId,
    mimeType: blob.type || "video/webm",
    wallClockCapturedAt: Date.now(),
    bytes,
  })) as PersistedVideo;
}

