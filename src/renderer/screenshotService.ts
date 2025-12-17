export type ScreenshotPhase = "before" | "during" | "after";

export type ScreenshotCaptureOptions = {
  phase: ScreenshotPhase;
  actionId: string;
  mimeType?: "image/webp" | "image/png";
  quality?: number; // used for webp
  strategy?: "next-frame" | "immediate";
};

export type ScreenshotCaptureResult = {
  phase: ScreenshotPhase;
  actionId: string;
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  wallClockCapturedAt: number;
  streamTimestampMs?: number;
  captureLatencyMs: number;
};

export type ScreenshotService = {
  warm: () => Promise<void>;
  capture: (options: ScreenshotCaptureOptions) => Promise<ScreenshotCaptureResult>;
};

type VideoFrameMetadataLike = {
  mediaTime?: number; // seconds
};

function waitForEvent(target: EventTarget, type: string, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for '${type}' (${timeoutMs}ms)`));
    }, timeoutMs);

    const onEvent = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      clearTimeout(timeout);
      target.removeEventListener(type, onEvent);
    };

    target.addEventListener(type, onEvent, { once: true });
  });
}

function getStreamTimestampMsFromVideo(video: HTMLVideoElement) {
  const seconds = video.currentTime;
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return seconds * 1000;
}

function getCanvasForVideo(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
): { ctx: CanvasRenderingContext2D; width: number; height: number; dpr: number } {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    throw new Error("Video is not ready (videoWidth/videoHeight are 0).");
  }

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const targetWidth = Math.round(width * dpr);
  const targetHeight = Math.round(height * dpr);

  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Unable to acquire 2D canvas context.");

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  return { ctx, width, height, dpr };
}

function drawVideoFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(video, 0, 0, width, height);
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number | undefined,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("canvas.toBlob() returned null."));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

function requestNextVideoFrameMetadata(video: HTMLVideoElement) {
  const anyVideo = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (
      cb: (now: number, metadata: VideoFrameMetadataLike) => void,
    ) => number;
  };

  if (!anyVideo.requestVideoFrameCallback) return null;

  return new Promise<VideoFrameMetadataLike>((resolve) => {
    anyVideo.requestVideoFrameCallback((_now, metadata) => resolve(metadata));
  });
}

function hasRequestVideoFrameCallback(video: HTMLVideoElement) {
  return (
    typeof (
      video as HTMLVideoElement & {
        requestVideoFrameCallback?: unknown;
      }
    ).requestVideoFrameCallback === "function"
  );
}

async function ensureVideoReady(video: HTMLVideoElement) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
    return;
  }

  await waitForEvent(video, "loadeddata", 5_000);
  if (video.videoWidth <= 0) {
    await waitForEvent(video, "canplay", 5_000);
  }
}

async function warmVideo(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  await ensureVideoReady(video);

  try {
    if (video.paused) await video.play();
  } catch {
    // If autoplay is blocked, caller likely initiated capture from a user gesture.
    // Warm-up should still try to draw, but capture may be blank until playback starts.
  }

  const metadataPromise = requestNextVideoFrameMetadata(video);
  if (metadataPromise) {
    await metadataPromise;
  } else {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  const { ctx, width, height } = getCanvasForVideo(canvas, video);
  drawVideoFrame(ctx, video, width, height);
}

export function createScreenshotService(video: HTMLVideoElement): ScreenshotService {
  const canvas = document.createElement("canvas");

  return {
    warm: async () => {
      await warmVideo(video, canvas);
    },

    capture: async (options) => {
      const startedAt = performance.now();
      const wallClockCapturedAt = Date.now();

      const mimeType = options.mimeType ?? "image/webp";
      const quality = mimeType === "image/webp" ? (options.quality ?? 0.82) : undefined;

      await ensureVideoReady(video);

      const strategy =
        options.strategy ??
        (hasRequestVideoFrameCallback(video) ? "next-frame" : "immediate");

      let streamTimestampMs: number | undefined;
      if (strategy === "next-frame") {
        const metadata = await requestNextVideoFrameMetadata(video);
        if (metadata?.mediaTime != null && Number.isFinite(metadata.mediaTime)) {
          streamTimestampMs = metadata.mediaTime * 1000;
        } else {
          streamTimestampMs = getStreamTimestampMsFromVideo(video);
        }
      } else {
        streamTimestampMs = getStreamTimestampMsFromVideo(video);
      }

      const { ctx, width, height } = getCanvasForVideo(canvas, video);
      drawVideoFrame(ctx, video, width, height);
      const blob = await canvasToBlob(canvas, mimeType, quality);

      const captureLatencyMs = performance.now() - startedAt;

      return {
        phase: options.phase,
        actionId: options.actionId,
        blob,
        mimeType: blob.type || mimeType,
        width,
        height,
        wallClockCapturedAt,
        streamTimestampMs,
        captureLatencyMs,
      };
    },
  };
}
