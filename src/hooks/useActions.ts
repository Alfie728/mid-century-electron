import { ipcRenderer, IpcRendererEvent } from "electron";
import { useCallback, useEffect, useRef, useState } from "react";
import { Action } from "../main/types";

type UseActionsOptions = {
  onAction?: (action: Action) => void;
};

type UseActionsReturn = {
  actions: Action[];
  isCapturing: boolean;
  lastError: string | null;
  startCapture: (sessionId: string) => Promise<void>;
  stopCapture: () => Promise<void>;
  clearActions: () => void;
  updateAction: (actionId: string, patch: Partial<Action>) => void;
  getSessionStartTimeMs: () => number;
  checkAccessibilityPermission: () => Promise<{
    granted: boolean;
    platform: string;
  }>;
};

export function useActions(options?: UseActionsOptions): UseActionsReturn {
  const [actions, setActions] = useState<Action[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const sessionStartTimeRef = useRef<number>(0);

  // Handle incoming actions from main process
  useEffect(() => {
    const handleAction = (_event: IpcRendererEvent, action: Action) => {
      setActions((prev) => [...prev, action]);
      options?.onAction?.(action);
    };

    ipcRenderer.on("action", handleAction);

    return () => {
      ipcRenderer.removeListener("action", handleAction);
    };
  }, [options?.onAction]);

  const startCapture = useCallback(
    async (sessionId: string) => {
      if (isCapturing) {
        console.warn("Already capturing actions");
        return;
      }

      setLastError(null);
      sessionStartTimeRef.current = Date.now();
      const result = (await ipcRenderer.invoke(
        "startInputCapture",
        sessionId,
        sessionStartTimeRef.current
      )) as { success: boolean; error?: string };

      if (!result.success) {
        const message = result.error || "Failed to start input capture.";
        setLastError(message);
        throw new Error(message);
      }

      setIsCapturing(true);
    },
    [isCapturing]
  );

  const stopCapture = useCallback(async () => {
    if (!isCapturing) {
      return;
    }

    await ipcRenderer.invoke("stopInputCapture");
    setIsCapturing(false);
  }, [isCapturing]);

  const clearActions = useCallback(() => {
    setActions([]);
  }, []);

  const updateAction = useCallback((actionId: string, patch: Partial<Action>) => {
    setActions((prev) =>
      prev.map((action) => (action.actionId === actionId ? { ...action, ...patch } : action)),
    );
  }, []);

  const getSessionStartTimeMs = useCallback(() => sessionStartTimeRef.current, []);

  const checkAccessibilityPermission = useCallback(async () => {
    const result = await ipcRenderer.invoke("checkAccessibilityPermission");
    return result as { granted: boolean; platform: string };
  }, []);

  return {
    actions,
    isCapturing,
    lastError,
    startCapture,
    stopCapture,
    clearActions,
    updateAction,
    getSessionStartTimeMs,
    checkAccessibilityPermission,
  };
}
