import { ipcRenderer } from "electron";
import { writeFile } from "fs";
import { useRef, useState } from "react";

type StreamGetter = () => MediaStream | null;

export function useRecorder(getStream: StreamGetter) {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);

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
    mediaRecorder.onstop = async () => {
      await saveRecording();
    };

    mediaRecorder.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current || !isRecording) return;
    mediaRecorderRef.current.stop();
    setIsRecording(false);
  };

  const saveRecording = async () => {
    const blob = new Blob(recordedChunksRef.current, {
      type: "video/webm; codecs=vp9",
    });
    recordedChunksRef.current = [];

    const buffer = Buffer.from(await blob.arrayBuffer());
    const { canceled, filePath } = await ipcRenderer.invoke("showSaveDialog");
    if (canceled || !filePath) return;

    writeFile(filePath, buffer, () => console.log("video saved successfully!"));
  };

  return {
    isRecording,
    startRecording,
    stopRecording,
  };
}
