import { DesktopCapturerSource } from "electron";
import type { ToolbarState } from "../ToolbarApp";

type Props = {
  state: ToolbarState;
  sources: DesktopCapturerSource[];
  selectedSourceId: string;
  recordingDuration: number;
  isPickerOpen: boolean;
  onPickerToggle: (open: boolean) => void;
  onSourceChange: (sourceId: string) => void;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
};

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function FloatingToolbar({
  state,
  sources,
  selectedSourceId,
  recordingDuration,
  isPickerOpen,
  onPickerToggle,
  onSourceChange,
  onStart,
  onStop,
  onPause,
  onResume,
}: Props) {
  const isIdle = state === "idle";
  const isRecording = state === "recording";
  const isPaused = state === "paused";

  const selectedSource = sources.find((s) => s.id === selectedSourceId);

  const handleSourceSelect = (sourceId: string) => {
    onSourceChange(sourceId);
    onPickerToggle(false);
  };

  return (
    <div className="flex flex-col items-center">
      {/* Screen Picker - shown above controls when open */}
      {isPickerOpen && isIdle && (
        <div
          className="
            mb-3 p-3
            bg-white/10 backdrop-blur-sm
            rounded-xl
            border border-white/20
          "
          data-clickable
        >
          <div className="grid grid-cols-2 gap-3">
            {sources.map((source) => (
              <button
                key={source.id}
                data-clickable
                onClick={() => handleSourceSelect(source.id)}
                className={`
                  relative group
                  rounded-lg overflow-hidden
                  border-2 transition-all duration-150
                  ${source.id === selectedSourceId
                    ? "border-blue-500 ring-2 ring-blue-500/30"
                    : "border-transparent hover:border-white/30"
                  }
                `}
              >
                {/* Thumbnail or fallback */}
                <div className="w-full aspect-video bg-gray-700/50 flex items-center justify-center">
                  {source.thumbnail ? (
                    <img
                      src={source.thumbnail.toDataURL()}
                      alt={source.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        // Hide broken image, show fallback
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-white/60">
                      <svg className="w-8 h-8 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                </div>
                {/* Label overlay */}
                <div
                  className="
                    absolute bottom-0 left-0 right-0
                    px-2 py-1
                    bg-gradient-to-t from-black/70 to-transparent
                    text-white text-[11px] font-medium
                    truncate
                  "
                >
                  {source.name}
                </div>
                {/* Selection indicator */}
                {source.id === selectedSourceId && (
                  <div className="absolute top-1.5 right-1.5 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Controls */}
      <div className="flex items-center gap-2 px-4 py-2">
        {isIdle ? (
          // Idle state: Source selection + Record button
          <>
            {/* Source selector button */}
            <button
              data-clickable
              onClick={() => onPickerToggle(!isPickerOpen)}
              className={`
                flex items-center gap-2
                pl-3.5 pr-2.5 py-1.5
                bg-black/20 hover:bg-black/30
                text-gray-800 dark:text-white text-[13px] font-medium
                rounded-lg
                border border-white/20
                transition-colors duration-150
                min-w-[150px]
                ${isPickerOpen ? "bg-black/30" : ""}
              `}
            >
              <span className="flex-1 text-left truncate">
                {selectedSource?.name || "Select screen..."}
              </span>
              <svg
                className={`w-3.5 h-3.5 text-gray-600 dark:text-white/70 transition-transform duration-200 ${isPickerOpen ? "rotate-180" : ""
                  }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Record button */}
            <button
              data-clickable
              onClick={onStart}
              disabled={!selectedSourceId}
              className="
                flex items-center gap-2
                px-3.5 py-1.5
                bg-[#ff3b30] hover:bg-[#ff453a]
                disabled:bg-[#ff3b30]/50 disabled:cursor-not-allowed
                text-white text-[13px] font-semibold
                rounded-lg
                transition-all duration-150
                shadow-sm
              "
            >
              <span className="w-2.5 h-2.5 rounded-full bg-white" />
              Record
            </button>
          </>
        ) : (
          // Recording/Paused state
          <>
            {/* Recording indicator + Timer */}
            <div className="flex items-center gap-2 px-2.5 py-1 bg-black/10 rounded-lg border border-white/10">
              <span
                className={`
                  w-2 h-2 rounded-full
                  ${isRecording ? "bg-[#ff3b30] animate-pulse" : "bg-[#ff9500]"}
                `}
              />
              <span className="text-gray-800 dark:text-white font-mono text-[13px] font-medium tracking-wide">
                {formatDuration(recordingDuration)}
              </span>
            </div>

            {/* Pause/Resume button */}
            <button
              data-clickable
              onClick={isPaused ? onResume : onPause}
              className="
                flex items-center justify-center
                w-8 h-8
                bg-black/10 hover:bg-black/20
                text-gray-700 dark:text-white
                rounded-lg
                border border-white/10
                transition-colors duration-150
              "
              title={isPaused ? "Resume" : "Pause"}
            >
              {isPaused ? (
                // Play icon
                <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              ) : (
                // Pause icon
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              )}
            </button>

            {/* Stop button */}
            <button
              data-clickable
              onClick={onStop}
              className="
                flex items-center justify-center
                w-8 h-8
                bg-[#ff3b30] hover:bg-[#ff453a]
                text-white
                rounded-lg
                transition-colors duration-150
                shadow-sm
              "
              title="Stop"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
