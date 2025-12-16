import { Action, ActionType } from "./types";
import type { EventData, MacOSEventHook } from "iohook-macos";

type ActionCallback = (action: Action) => void;

// Generate unique action IDs
let actionCounter = 0;
function generateActionId(): string {
  return `action-${Date.now()}-${++actionCounter}`;
}

export class InputService {
  private sessionId = "";
  private sessionStartTime = 0;
  private callback: ActionCallback | null = null;
  private isRunning = false;
  private iohook: MacOSEventHook | null = null;

  // Scroll debouncing state
  private scrollTimeout: NodeJS.Timeout | null = null;
  private isScrolling = false;
  private lastScrollCoords: { x: number; y: number } = { x: 0, y: 0 };
  private scrollDebounceMs = 150;

  // Click count tracking
  private lastClickTime = 0;
  private lastClickCoords: { x: number; y: number } = { x: 0, y: 0 };
  private clickCount = 0;
  private clickThresholdMs = 500;
  private clickDistanceThreshold = 10;

  // mouse movement tracking
  private moveTimeout: NodeJS.Timeout | null = null;
  private isMoving = false;
  private lastMoveCoords: { x: number; y: number } = { x: 0, y: 0 };
  private moveDebounceMs = 350;

  constructor() {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleMouseWheel = this.handleMouseWheel.bind(this);
    this.handleMouseMoved = this.handleMouseMoved.bind(this);
    this.handleLeftMouseDown = this.handleLeftMouseDown.bind(this);
    this.handleRightMouseDown = this.handleRightMouseDown.bind(this);
    this.handleOtherMouseDown = this.handleOtherMouseDown.bind(this);
  }

  private getIohook(): MacOSEventHook {
    if (this.iohook) return this.iohook;
    if (process.platform !== "darwin") {
      throw new Error("Global input capture is only supported on macOS.");
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.iohook = require("iohook-macos") as MacOSEventHook;
      return this.iohook;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        [
          "Failed to load iohook-macos native module.",
          message,
          "",
          "Fix:",
          "  - Ensure Xcode Command Line Tools are installed",
          "  - Run: npm run rebuild",
        ].join("\n"),
      );
    }
  }

  start(
    sessionId: string,
    sessionStartTime: number,
    callback: ActionCallback,
  ): Promise<void> {
    if (this.isRunning) {
      console.warn("InputService is already running");
      return Promise.resolve();
    }

    const iohook = this.getIohook();
    const permissions = iohook.checkAccessibilityPermissions();
    if (!permissions.hasPermissions) {
      const request = iohook.requestAccessibilityPermissions();
      throw new Error(request.message || permissions.message);
    }

    this.sessionId = sessionId;
    this.sessionStartTime = sessionStartTime;
    this.callback = callback;
    this.isRunning = true;

    // Register event handlers (iohook-macos)
    iohook.on("leftMouseDown", this.handleLeftMouseDown);
    iohook.on("rightMouseDown", this.handleRightMouseDown);
    iohook.on("otherMouseDown", this.handleOtherMouseDown);
    iohook.on("keyDown", this.handleKeyDown);
    iohook.on("scrollWheel", this.handleMouseWheel);
    iohook.on("mouseMoved", this.handleMouseMoved);

    // Reduce event volume for cursor tracking (mouseover start/end only)
    iohook.setMouseMoveThrottling(50);

    // Start monitoring
    iohook.startMonitoring();
    console.log("InputService started");
    return Promise.resolve();
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }
    const iohook = this.iohook;

    // Clear any pending scroll timeout
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
      this.scrollTimeout = null;
    }

    // If we were scrolling, emit scroll_end
    if (this.isScrolling) {
      this.emitScrollEnd();
    }

    // Clear any pending move timeout
    if (this.moveTimeout) {
      clearTimeout(this.moveTimeout);
      this.moveTimeout = null;
    }

    // If we were moving, emit mouseover_end
    if (this.isMoving) {
      this.emitMoveEnd();
    }

    // Remove event handlers
    iohook?.removeListener("leftMouseDown", this.handleLeftMouseDown);
    iohook?.removeListener("rightMouseDown", this.handleRightMouseDown);
    iohook?.removeListener("otherMouseDown", this.handleOtherMouseDown);
    iohook?.removeListener("keyDown", this.handleKeyDown);
    iohook?.removeListener("scrollWheel", this.handleMouseWheel);
    iohook?.removeListener("mouseMoved", this.handleMouseMoved);

    // Stop the hook
    iohook?.stopMonitoring();

    this.isRunning = false;
    this.callback = null;
    console.log("InputService stopped");
  }

  private emitAction(action: Action): void {
    if (this.callback) {
      this.callback(action);
    }
  }

  private createBaseAction(
    type: ActionType,
    coords: { x: number; y: number },
  ): Action {
    const now = Date.now();
    return {
      actionId: generateActionId(),
      sessionId: this.sessionId,
      type,
      happenedAt: now,
      relativeTimeMs: now - this.sessionStartTime,
      coords,
    };
  }

  private handleLeftMouseDown(event: EventData): void {
    this.handleMouseDown(1, event);
  }

  private handleRightMouseDown(event: EventData): void {
    this.handleMouseDown(2, event);
  }

  private handleOtherMouseDown(event: EventData): void {
    this.handleMouseDown(3, event);
  }

  private handleMouseDown(button: number, event: EventData): void {
    const now = Date.now();
    const coords = { x: event.x ?? 0, y: event.y ?? 0 };

    // Calculate click count (for double/triple clicks)
    const timeSinceLastClick = now - this.lastClickTime;
    const distance = Math.sqrt(
      Math.pow(coords.x - this.lastClickCoords.x, 2) +
        Math.pow(coords.y - this.lastClickCoords.y, 2),
    );

    if (
      timeSinceLastClick < this.clickThresholdMs &&
      distance < this.clickDistanceThreshold
    ) {
      this.clickCount++;
    } else {
      this.clickCount = 1;
    }

    this.lastClickTime = now;
    this.lastClickCoords = coords;

    const action = this.createBaseAction("click", coords);
    action.pointerMeta = {
      button,
      clickCount: this.clickCount,
    };

    this.emitAction(action);
  }

  private handleKeyDown(event: EventData): void {
    // Use (0,0) for keyboard events - no specific coords
    const action = this.createBaseAction("keypress", { x: 0, y: 0 });
    const keyCode = event.keyCode ?? -1;

    action.keyMeta = {
      key: keyCode === -1 ? "Unknown" : `KeyCode(${keyCode})`,
      code: keyCode === -1 ? "Unknown" : `MacKeyCode(${keyCode})`,
      modifiers: {
        ctrl: event.modifiers.control,
        shift: event.modifiers.shift,
        alt: event.modifiers.option,
        meta: event.modifiers.command,
      },
      keyCodes: keyCode === -1 ? undefined : [keyCode],
    };

    this.emitAction(action);
  }

  private handleMouseWheel(event: EventData): void {
    const coords = { x: event.x ?? 0, y: event.y ?? 0 };
    this.lastScrollCoords = coords;

    // If not currently scrolling, emit scroll_start
    if (!this.isScrolling) {
      this.isScrolling = true;
      const action = this.createBaseAction("scroll_start", coords);
      this.emitAction(action);
    }

    // Clear existing timeout and set a new one
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
    }

    this.scrollTimeout = setTimeout(() => {
      this.emitScrollEnd();
    }, this.scrollDebounceMs);
  }

  private emitScrollEnd() {
    if (this.isScrolling) {
      const action = this.createBaseAction("scroll_end", this.lastScrollCoords);
      this.emitAction(action);
      this.isScrolling = false;
    }
    this.scrollTimeout = null;
  }
  private handleMouseMoved(event: EventData): void {
    const coords = { x: event.x ?? 0, y: event.y ?? 0 };
    this.lastMoveCoords = coords;

    // If not currently moving, emit mouseover_start
    if (!this.isMoving) {
      this.isMoving = true;
      const action = this.createBaseAction("mouseover_start", coords);
      this.emitAction(action);
    }

    // Clear existing timeout and set a new one
    if (this.moveTimeout) {
      clearTimeout(this.moveTimeout);
    }

    this.moveTimeout = setTimeout(() => {
      this.emitMoveEnd();
    }, this.moveDebounceMs);
  }

  private emitMoveEnd() {
    if (this.isMoving) {
      const action = this.createBaseAction("mouseover_end", this.lastMoveCoords);
      this.emitAction(action);
      this.isMoving = false;
    }
    this.moveTimeout = null;
  }
}

// Export singleton instance
export const inputService = new InputService();
