type Props = {
  isRecording: boolean;
  canRecord: boolean;
  onStart: () => void;
  onStop: () => void;
};

export function RecorderControls({
  isRecording,
  canRecord,
  onStart,
  onStop,
}: Props) {
  return (
    <div className="flex gap-2">
      <button
        className="btn btn-primary"
        onClick={onStart}
        disabled={!canRecord || isRecording}
      >
        Start
      </button>
      <button
        className="btn btn-ghost border border-base-300"
        onClick={onStop}
        disabled={!isRecording}
      >
        Stop
      </button>
    </div>
  );
}
