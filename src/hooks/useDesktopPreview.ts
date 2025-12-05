import { ipcRenderer } from "electron";
import { RefObject, useEffect, useRef, useState } from "react";

type ConstraintsBuilder = (sourceId: string) => Promise<MediaStreamConstraints>;

const buildConstraints: ConstraintsBuilder = async (sourceId) => {
  const os = (await ipcRenderer.invoke("getOperatingSystem")) as string;
  const audio =
    os === "darwin"
      ? false
      : {
          mandatory: {
            chromeMediaSource: "desktop",
          },
        };

  return {
    audio,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
      },
    },
  } as unknown as MediaStreamConstraints;
};

export function useDesktopPreview(videoRef: RefObject<HTMLVideoElement>) {
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const previewStreamRef = useRef<MediaStream | null>(null);

  useEffect(
    () => () => {
      stopPreviewStream();
    },
    [],
  );

  const stopPreviewStream = () => {
    previewStreamRef.current?.getTracks().forEach((track) => track.stop());
    previewStreamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const previewSource = async (sourceId: string) => {
    if (!videoRef.current || !sourceId) return;
    setSelectedSourceId(sourceId);
    stopPreviewStream();
    const constraints = await buildConstraints(sourceId);
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    previewStreamRef.current = stream;
    videoRef.current.srcObject = stream;
    await videoRef.current.play();
  };

  const getPreviewStream = () => previewStreamRef.current;

  return {
    selectedSourceId,
    previewSource,
    stopPreviewStream,
    getPreviewStream,
  };
}
