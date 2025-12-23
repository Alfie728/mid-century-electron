export type ActionType =
  | "click"
  | "scroll"
  | "scroll_start"
  | "scroll_end"
  | "keypress"
  | "drag_start"
  | "drag_end"
  | "mouseover_start"
  | "mouseover_end"
  | "input";

export type PointerMeta = {
  button: "left" | "right" | "other";
  clickCount: number;
};

export type KeyMeta = {
  key: string;
  code: string;
  modifiers: {
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
  };
  keyCodes?: number[];
};

export type Action = {
  actionId: string;
  sessionId: string;
  type: ActionType;
  happenedAt: number;
  relativeTimeMs: number;
  streamTimestamp?: number;
  coords: { x: number; y: number };
  pointerMeta?: PointerMeta;
  keyMeta?: KeyMeta;
  inputValue?: string;
  screenshotRef?: string;
  beforeScreenshotRef?: string;
  afterScreenshotRef?: string;
};

export type SessionState =
  | "idle"
  | "consenting"
  | "recording"
  | "paused"
  | "stopping"
  | "ended";

export type Session = {
  sessionId: string;
  createdAt: number;
  endedAt?: number;
  source: {
    type: "screen" | "window";
    sourceId: string;
    name: string;
    chosenAt: number;
  } | null;
  state: SessionState;
};

