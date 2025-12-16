import { Action, ActionType } from "./types";
import iohookMacos, { type EventData, type MacOSEventHook } from "iohook-macos";
import { macKeyCodeToKeyAndCode } from "./macosKeyMap";

type ActionCallback = (action: Action) => void;
type Coords = { x: number; y: number };
type PointerButton = "left" | "right" | "other";

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

  // Drag tracking (left mouse button)
  private isLeftButtonDown = false;
  private isDragging = false;
  private dragStartCoords: Coords = { x: 0, y: 0 };
  private lastDragCoords: Coords = { x: 0, y: 0 };

  // mouse movement tracking
  private moveTimeout: NodeJS.Timeout | null = null;
  private isMoving = false;
  private lastMoveCoords: Coords = { x: 0, y: 0 };
  private moveDebounceMs = 350;

  private getIohook() {
    if (this.iohook) return this.iohook;
    if (process.platform !== "darwin") {
      throw new Error("Global input capture is only supported on macOS.");
    }
    try {
      this.iohook = iohookMacos;
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

  start(sessionId: string, sessionStartTime: number, callback: ActionCallback) {
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
    iohook.on("leftMouseUp", this.handleLeftMouseUp);
    iohook.on("leftMouseDragged", this.handleLeftMouseDragged);
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

  stop() {
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
    iohook?.removeListener("leftMouseUp", this.handleLeftMouseUp);
    iohook?.removeListener("leftMouseDragged", this.handleLeftMouseDragged);
    iohook?.removeListener("rightMouseDown", this.handleRightMouseDown);
    iohook?.removeListener("otherMouseDown", this.handleOtherMouseDown);
    iohook?.removeListener("keyDown", this.handleKeyDown);
    iohook?.removeListener("scrollWheel", this.handleMouseWheel);
    iohook?.removeListener("mouseMoved", this.handleMouseMoved);

    // Stop the hook
    iohook?.stopMonitoring();

    this.isRunning = false;
    this.callback = null;
    this.isLeftButtonDown = false;
    this.isDragging = false;
    console.log("InputService stopped");
  }

  private emitAction(action: Action) {
    if (this.callback) {
      this.callback(action);
    }
  }

  private createBaseAction(
    type: ActionType,
    coords: Coords,
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

  private emit(type: ActionType, coords: Coords, enrich?: (action: Action) => void) {
    const action = this.createBaseAction(type, coords);
    enrich?.(action);
    this.emitAction(action);
  }

  private coordsFrom(event: EventData): Coords {
    return { x: event.x ?? 0, y: event.y ?? 0 };
  }

  private handleLeftMouseDown = (event: EventData) => {
    const coords = this.coordsFrom(event);
    this.isLeftButtonDown = true;
    this.isDragging = false;
    this.dragStartCoords = coords;
    this.lastDragCoords = coords;
    this.handleMouseDown("left", event);
  };

  private handleLeftMouseUp = (event: EventData) => {
    const coords = this.coordsFrom(event);

    if (this.isDragging) {
      this.emit("drag_end", coords, (action) => {
        action.pointerMeta = { button: "left", clickCount: this.clickCount };
      });
    }

    this.isLeftButtonDown = false;
    this.isDragging = false;
    this.lastDragCoords = coords;
  };

  private handleLeftMouseDragged = (event: EventData) => {
    if (!this.isLeftButtonDown) return;
    const coords = this.coordsFrom(event);
    this.lastDragCoords = coords;

    if (!this.isDragging) {
      this.isDragging = true;

      // End any active "mouseover" session once a drag begins
      if (this.moveTimeout) {
        clearTimeout(this.moveTimeout);
        this.moveTimeout = null;
      }
      if (this.isMoving) {
        this.emitMoveEnd();
      }

      this.emit("drag_start", this.dragStartCoords, (action) => {
        action.pointerMeta = { button: "left", clickCount: this.clickCount };
      });
    }
  };

  private handleRightMouseDown = (event: EventData) => {
    this.handleMouseDown("right", event);
  };

  private handleOtherMouseDown = (event: EventData) => {
    this.handleMouseDown("other", event);
  };

  private handleMouseDown(button: PointerButton, event: EventData) {
    const now = Date.now();
    const coords = this.coordsFrom(event);

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

    this.emit("click", coords, (action) => {
      action.pointerMeta = { button, clickCount: this.clickCount };
    });
  }

  private handleKeyDown = (event: EventData) => {
    // Use (0,0) for keyboard events - no specific coords
    const keyCode = event.keyCode ?? -1;
    const { key, code } =
      keyCode === -1
        ? { key: "Unknown", code: "Unknown" }
        : macKeyCodeToKeyAndCode(keyCode, event.modifiers);

    this.emit("keypress", { x: 0, y: 0 }, (action) => {
      action.keyMeta = {
        key,
        code,
        modifiers: {
          ctrl: event.modifiers.control,
          shift: event.modifiers.shift,
          alt: event.modifiers.option,
          meta: event.modifiers.command,
        },
        keyCodes: keyCode === -1 ? undefined : [keyCode],
      };
    });
  };

  private handleMouseWheel = (event: EventData) => {
    const coords = this.coordsFrom(event);
    this.lastScrollCoords = coords;

    // If not currently scrolling, emit scroll_start
    if (!this.isScrolling) {
      this.isScrolling = true;
      this.emit("scroll_start", coords);
    }

    // Clear existing timeout and set a new one
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
    }

    this.scrollTimeout = setTimeout(() => {
      this.emitScrollEnd();
    }, this.scrollDebounceMs);
  };

  private emitScrollEnd() {
    if (this.isScrolling) {
      this.emit("scroll_end", this.lastScrollCoords);
      this.isScrolling = false;
    }
    this.scrollTimeout = null;
  }

  private handleMouseMoved = (event: EventData) => {
    // Only record mouseover movement when not dragging.
    if (this.isLeftButtonDown || this.isDragging) return;

    const coords = this.coordsFrom(event);
    this.lastMoveCoords = coords;

    // If not currently moving, emit mouseover_start
    if (!this.isMoving) {
      this.isMoving = true;
      this.emit("mouseover_start", coords);
    }

    // Clear existing timeout and set a new one
    if (this.moveTimeout) {
      clearTimeout(this.moveTimeout);
    }

    this.moveTimeout = setTimeout(() => {
      this.emitMoveEnd();
    }, this.moveDebounceMs);
  };

  private emitMoveEnd() {
    if (this.isMoving) {
      this.emit("mouseover_end", this.lastMoveCoords);
      this.isMoving = false;
    }
    this.moveTimeout = null;
  }
}

// Export singleton instance
export const inputService = new InputService();
