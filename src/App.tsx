import { DesktopCapturerSource, ipcRenderer } from "electron";
import { writeFile } from "fs";
import { useEffect, useRef, useState } from "react";

export default function App() {
  const [inputSources, setInputSources] = useState<DesktopCapturerSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);

  useEffect(() => {
    (async () => {
      const sources = (await ipcRenderer.invoke(
        "getSources",
      )) as DesktopCapturerSource[];
      setInputSources(sources);
    })();
  }, []);

  const handleStartRecording = async () => {
    if (!selectedSourceId || !videoRef.current || isRecording) return;

    const os = (await ipcRenderer.invoke("getOperatingSystem")) as string;
    const audio =
      os === "darwin"
        ? false
        : {
            mandatory: {
              chromeMediaSource: "desktop",
            },
          };

    const constraints = {
      audio,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: selectedSourceId,
        },
      },
    } as unknown as MediaStreamConstraints;

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoRef.current.srcObject = stream;
    await videoRef.current.play();

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: "video/webm; codecs=vp9",
    });
    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.ondataavailable = (event: BlobEvent) => {
      recordedChunksRef.current.push(event.data);
    };
    mediaRecorder.onstop = handleSaveRecording;
    mediaRecorder.start();
    setIsRecording(true);
  };

  const handleStopRecording = () => {
    if (!mediaRecorderRef.current || !isRecording) return;
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream
      .getTracks()
      .forEach((track) => track.stop());
    setIsRecording(false);
  };

  const handleSaveRecording = async () => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = null;

    const blob = new Blob(recordedChunksRef.current, {
      type: "video/webm; codecs=vp9",
    });
    recordedChunksRef.current = [];

    const buffer = Buffer.from(await blob.arrayBuffer());
    const { canceled, filePath } = await ipcRenderer.invoke("showSaveDialog");
    if (canceled || !filePath) return;

    writeFile(filePath, buffer, () => console.log("video saved successfully!"));
  };

  return (
    <div>
      <video style={{ width: "640px", height: "480px" }} ref={videoRef}></video>

      <button
        className="btn btn-primary"
        onClick={handleStartRecording}
        disabled={!selectedSourceId || isRecording}
      >
        Start
      </button>
      <button
        className="btn btn-warning"
        onClick={handleStopRecording}
        disabled={!isRecording}
      >
        Stop
      </button>

      <select
        className="select"
        value={selectedSourceId ?? ""}
        onChange={(e) => setSelectedSourceId(e.target.value)}
      >
        <option value="" disabled>
          Select a source
        </option>
        {inputSources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
      </select>
    </div>
  );
}
