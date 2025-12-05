import { DesktopCapturerSource } from "electron";

type Props = {
  sources: DesktopCapturerSource[];
  selectedId: string;
  onChange: (id: string) => void;
};

export function SourceSelect({ sources, selectedId, onChange }: Props) {
  return (
    <select
      className="select select-bordered w-full"
      value={selectedId}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" disabled>
        Select a source
      </option>
      {sources.map((source) => (
        <option key={source.id} value={source.id}>
          {source.name}
        </option>
      ))}
    </select>
  );
}
