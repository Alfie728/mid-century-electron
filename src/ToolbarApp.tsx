import { useCallback, useEffect, useState } from "react";
import { ipcRenderer, DesktopCapturerSource } from "electron";
import { FloatingToolbar } from "./components/FloatingToolbar";

export type ToolbarState = "idle" | "recording" | "paused";

export function ToolbarApp() {
  const [state, setState] = useState<ToolbarState>("idle");
  const [sources, setSources] = useState<DesktopCapturerSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // Fetch sources on mount
  useEffect(() => {
    const fetchSources = async () => {
      const sources = await ipcRenderer.invoke("getSources");
      setSources(sources);
    };
    fetchSources();
  }, []);

  // Listen for state updates from main window
  useEffect(() => {
    const handleStateUpdate = (
      _event: Electron.IpcRendererEvent,
      payload: {
        state: ToolbarState;
        selectedSourceId?: string;
        sources?: DesktopCapturerSource[];
      }
    ) => {
      if (payload.state) setState(payload.state);
      if (payload.selectedSourceId !== undefined)
        setSelectedSourceId(payload.selectedSourceId);
      if (payload.sources) setSources(payload.sources);
    };

    ipcRenderer.on("toolbar:stateUpdate", handleStateUpdate);
    return () => {
      ipcRenderer.removeListener("toolbar:stateUpdate", handleStateUpdate);
    };
  }, []);

  // Recording duration timer
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (state === "recording") {
      setRecordingDuration(0);
      interval = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } else if (state === "paused") {
      // Keep duration but stop incrementing
    } else {
      setRecordingDuration(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [state]);

  // Notify main process when picker opens/closes to resize window
  useEffect(() => {
    ipcRenderer.send("toolbar:pickerStateChanged", isPickerOpen, sources.length);
  }, [isPickerOpen, sources.length]);

  const handleSourceChange = useCallback((sourceId: string) => {
    setSelectedSourceId(sourceId);
    ipcRenderer.send("toolbar:selectSource", sourceId);
  }, []);

  const handleStart = useCallback(() => {
    if (!selectedSourceId) return;
    ipcRenderer.send("toolbar:start");
  }, [selectedSourceId]);

  const handleStop = useCallback(() => {
    ipcRenderer.send("toolbar:stop");
  }, []);

  const handlePause = useCallback(() => {
    ipcRenderer.send("toolbar:pause");
  }, []);

  const handleResume = useCallback(() => {
    ipcRenderer.send("toolbar:resume");
  }, []);

  const handlePickerToggle = useCallback((open: boolean) => {
    setIsPickerOpen(open);
  }, []);

  return (
    <FloatingToolbar
      state={state}
      sources={sources}
      selectedSourceId={selectedSourceId}
      recordingDuration={recordingDuration}
      isPickerOpen={isPickerOpen}
      onPickerToggle={handlePickerToggle}
      onSourceChange={handleSourceChange}
      onStart={handleStart}
      onStop={handleStop}
      onPause={handlePause}
      onResume={handleResume}
    />
  );
}
