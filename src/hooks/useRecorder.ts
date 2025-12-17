import { useRef, useState } from "react";

type StreamGetter = () => MediaStream | null;

export function useRecorder(getStream: StreamGetter) {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const stopResolveRef = useRef<((blob: Blob | null) => void) | null>(null);

  const startRecording = () => {
    if (isRecording) return;
    const stream = getStream();
    if (!stream) return;

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: "video/webm; codecs=vp9",
    });
    mediaRecorderRef.current = mediaRecorder;
    recordedChunksRef.current = [];

    mediaRecorder.ondataavailable = (event: BlobEvent) => {
      recordedChunksRef.current.push(event.data);
    };
    mediaRecorder.onstop = () => {
      const blob =
        recordedChunksRef.current.length > 0
          ? new Blob(recordedChunksRef.current, {
              type: mediaRecorder.mimeType || "video/webm",
            })
          : null;
      recordedChunksRef.current = [];
      stopResolveRef.current?.(blob);
      stopResolveRef.current = null;
    };

    mediaRecorder.start();
    setIsRecording(true);
  };

  const stopRecording = async () => {
    if (!mediaRecorderRef.current || !isRecording) return;
    const recorder = mediaRecorderRef.current;

    const blob = await new Promise<Blob | null>((resolve) => {
      stopResolveRef.current = resolve;
      recorder.stop();
    });

    setIsRecording(false);
    return blob;
  };

  return {
    isRecording,
    startRecording,
    stopRecording,
  };
}
