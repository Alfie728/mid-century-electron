import { useRef } from "react";
import { useDesktopSources } from "./hooks/useDesktopSources";
import { useDesktopPreview } from "./hooks/useDesktopPreview";
import { useRecorder } from "./hooks/useRecorder";
import { SourceSelect } from "./components/SourceSelect";
import { RecorderControls } from "./components/RecorderControls";

export default function App() {
  const inputSources = useDesktopSources();
  const videoRef = useRef<HTMLVideoElement>(null);
  const { selectedSourceId, previewSource, getPreviewStream } =
    useDesktopPreview(videoRef);
  const { isRecording, startRecording, stopRecording } =
    useRecorder(getPreviewStream);

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
                onStart={startRecording}
                onStop={stopRecording}
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
          </div>
        </div>
      </div>
    </div>
  );
}
