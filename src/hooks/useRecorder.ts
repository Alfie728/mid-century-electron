import { useRef, useState, useCallback } from "react";
import { ipcRenderer } from "electron";

type StreamGetter = () => MediaStream | null;

export type VideoStreamResult = {
  videoRef: string;
  filePath: string;
  mimeType: string;
} | null;

export function useRecorder(getStream: StreamGetter) {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const stopResolveRef = useRef<((result: VideoStreamResult) => void) | null>(null);
  const chunkQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mimeTypeRef = useRef<string>("video/webm");

  const startRecording = useCallback(async (sessionId: string) => {
    if (isRecording) return;
    const stream = getStream();
    if (!stream) return;

    sessionIdRef.current = sessionId;
    const mimeType = "video/webm; codecs=vp9";
    mimeTypeRef.current = mimeType;

    // Initialize video stream on main process
    const initResult = await ipcRenderer.invoke("initVideoStream", {
      sessionId,
      mimeType,
    });

    if (!initResult.success) {
      console.error("Failed to init video stream:", initResult.error);
      return;
    }

    const mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = mediaRecorder;

    // Stream chunks to disk as they become available
    mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0 && sessionIdRef.current) {
        const currentSessionId = sessionIdRef.current;
        // Queue chunk writes to ensure order
        chunkQueueRef.current = chunkQueueRef.current.then(async () => {
          try {
            const chunk = await event.data.arrayBuffer();
            await ipcRenderer.invoke("appendVideoChunk", {
              sessionId: currentSessionId,
              chunk,
            });
          } catch (error) {
            console.error("Failed to write video chunk:", error);
          }
        });
      }
    };

    mediaRecorder.onstop = async () => {
      // Wait for all chunks to be written
      await chunkQueueRef.current;

      if (sessionIdRef.current) {
        // Finalize the video stream
        const result = await ipcRenderer.invoke("finalizeVideoStream", {
          sessionId: sessionIdRef.current,
        });

        if (result.success) {
          stopResolveRef.current?.({
            videoRef: result.videoRef,
            filePath: result.filePath,
            mimeType: result.mimeType,
          });
        } else {
          console.error("Failed to finalize video stream:", result.error);
          stopResolveRef.current?.(null);
        }
      } else {
        stopResolveRef.current?.(null);
      }
      stopResolveRef.current = null;
    };

    // Request data every 1 second for streaming
    mediaRecorder.start(1000);
    setIsRecording(true);
  }, [isRecording, getStream]);

  const stopRecording = useCallback(async (): Promise<VideoStreamResult> => {
    if (!mediaRecorderRef.current || !isRecording) return null;
    const recorder = mediaRecorderRef.current;

    const result = await new Promise<VideoStreamResult>((resolve) => {
      stopResolveRef.current = resolve;
      recorder.stop();
    });

    setIsRecording(false);
    sessionIdRef.current = null;
    return result;
  }, [isRecording]);

  return {
    isRecording,
    startRecording,
    stopRecording,
  };
}
