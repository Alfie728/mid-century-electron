import { DesktopCapturerSource, ipcRenderer } from "electron";
import { useEffect, useState } from "react";

export function useDesktopSources() {
  const [sources, setSources] = useState<DesktopCapturerSource[]>([]);

  useEffect(() => {
    (async () => {
      const fetched = (await ipcRenderer.invoke(
        "getSources",
      )) as DesktopCapturerSource[];
      setSources(fetched);
    })();
  }, []);

  return sources;
}
