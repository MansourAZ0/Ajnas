import type {
  Delegate,
  VisionObservation,
  WorkerOptions,
  WorkerReply,
} from "./types";

export interface CameraInfo {
  cameraId: string;
  width: number;
  height: number;
  /** Inference backend actually in use (GPU falls back to CPU automatically). */
  delegate: Delegate;
}
export type CameraState = "off" | "starting" | "running" | "error";
/** Default longest side of the model input; see docs/VISION.md for measurements. */
export const DEFAULT_MAX_INPUT_SIZE = 640;
/** First GPU inference slower than this is treated as a hung context. */
export const GPU_FIRST_FRAME_TIMEOUT_MS = 4000;
/**
 * Frame source. A string is a camera deviceId ("" = system default). A file
 * runs the identical capture/worker/fusion pipeline on a looping local video,
 * for testing without a camera; it is never uploaded.
 */
export type CameraSource =
  | string
  | { kind: "camera"; deviceId: string }
  | { kind: "file"; file: Blob; name: string };

export function cameraError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera permission denied. Allow camera access in system/browser settings, then try again.";
    case "NotFoundError":
      return "No camera is available. Connect a camera and refresh the list.";
    case "NotReadableError":
      return "Camera could not be opened. Close other apps using it, then try again.";
    case "NotSupportedError":
      return "This video file cannot be decoded here. Try an H.264 MP4 or WebM file.";
    case "OverconstrainedError":
      return "The selected camera is unavailable. Select another camera.";
    default:
      return error instanceof Error
        ? error.message
        : "Camera could not be started.";
  }
}

/** Owns every track, worker and scheduled frame for one explicit camera session. */
export class CameraSession {
  private generation = 0;
  private abort: AbortController | null = null;
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private animation = 0;
  private busy = false;
  /** 0 = as fast as the worker returns results (one frame in flight). */
  private fps = 0;
  private maxInputSize = DEFAULT_MAX_INPUT_SIZE;
  private lastCapture = -Infinity;
  private lastVideoTime = -1;
  /** Count of frames presented by the video element (requestVideoFrameCallback). */
  private presented = 0;
  private lastPresented = -1;
  private videoFrameCallback = 0;
  /** null = unknown; false = createImageBitmap ignores resize options (e.g. older WebKit). */
  private resizeSupported: boolean | null = null;
  private scratch: OffscreenCanvas | null = null;
  private pending: { frameId: number; width: number; height: number } | null =
    null;
  private frameId = 0;
  private initializationTimer: ReturnType<typeof setTimeout> | undefined;
  private frameTimer: ReturnType<typeof setTimeout> | undefined;
  private objectUrl: string | null = null;
  private delegate: Delegate = "CPU";
  /** True once the current worker returned a result (its delegate works). */
  private delegateConfirmed = false;
  private workerOptions: WorkerOptions = {};

  constructor(
    private video: HTMLVideoElement,
    private onState: (state: CameraState, error?: string) => void,
    private onObservation: (observation: VisionObservation) => void,
  ) {}

  /** Applies at the next start(): MediaPipe options are fixed per worker. */
  setWorkerOptions(options: WorkerOptions) {
    this.workerOptions = { ...options };
  }

  /** Frames per second, 1–30; 0 (default) = as fast as the worker returns. */
  setFps(value: number) {
    this.fps =
      value === 0
        ? 0
        : Math.min(30, Math.max(1, Number.isFinite(value) ? value : 0));
  }

  /**
   * Longest side, in pixels, of the bitmap sent to the worker (0 = full size).
   * Landmarks are normalised, so only the model input shrinks; the preview and
   * calibration keep the camera's full resolution.
   */
  setMaxInputSize(value: number) {
    this.maxInputSize = Number.isFinite(value) && value > 0 ? value : 0;
  }

  stop(notify = true) {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
    cancelAnimationFrame(this.animation);
    if (this.videoFrameCallback)
      this.video.cancelVideoFrameCallback?.(this.videoFrameCallback);
    this.videoFrameCallback = 0;
    clearTimeout(this.initializationTimer);
    clearTimeout(this.frameTimer);
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    if (this.objectUrl) {
      this.video.removeAttribute("src");
      this.video.loop = false;
      this.video.load(); // Releases the decoder.
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.busy = false;
    this.pending = null;
    this.scratch = null;
    if (notify) this.onState("off");
  }

  async start(source: CameraSource): Promise<CameraInfo> {
    const file =
      typeof source === "object" && source.kind === "file" ? source : null;
    const deviceId =
      typeof source === "string"
        ? source
        : source.kind === "camera"
          ? source.deviceId
          : "";
    this.stop(false);
    const generation = this.generation;
    const active = () => this.generation === generation;
    const aborted = () =>
      new DOMException("Camera session stopped.", "AbortError");
    const abort = new AbortController();
    this.abort = abort;
    this.onState("starting");
    try {
      if (!file && !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Camera capture requires a secure origin and a supported webview.",
        );
      if (
        typeof Worker === "undefined" ||
        typeof createImageBitmap !== "function" ||
        typeof OffscreenCanvas === "undefined"
      )
        throw new Error(
          "This webview does not support worker camera inference (ImageBitmap/OffscreenCanvas required).",
        );
      let stream: MediaStream | null = null;
      if (file) {
        this.objectUrl = URL.createObjectURL(file.file);
        this.video.srcObject = null;
        this.video.loop = true;
        this.video.muted = true;
        this.video.addEventListener(
          "error",
          () => {
            if (active())
              this.fail(
                "This video file cannot be decoded here. Try an H.264 MP4 or WebM file.",
              );
          },
          { signal: abort.signal },
        );
        this.video.src = this.objectUrl;
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            width: { ideal: 960 },
            height: { ideal: 540 },
            frameRate: { ideal: 24, max: 30 },
          },
        });
        // getUserMedia cannot be aborted: release a stream granted after stop/unmount.
        if (!active()) {
          stream.getTracks().forEach((track) => track.stop());
          throw aborted();
        }
        this.stream = stream;
        for (const track of stream.getVideoTracks())
          track.addEventListener(
            "ended",
            () => {
              if (active())
                this.fail("Camera disconnected or access was revoked.");
            },
            { signal: abort.signal },
          );
        this.video.srcObject = stream;
      }
      await this.video.play();
      if (!active()) throw aborted();
      if (!this.video.videoWidth || !this.video.videoHeight) {
        await new Promise<void>((resolve, reject) => {
          const done = () => {
            cleanup();
            resolve();
          };
          const cancel = () => {
            cleanup();
            reject(aborted());
          };
          const timeout = setTimeout(() => {
            cleanup();
            reject(new Error("Camera did not deliver video metadata."));
          }, 10_000);
          const cleanup = () => {
            clearTimeout(timeout);
            this.video.removeEventListener("loadedmetadata", done);
            abort.signal.removeEventListener("abort", cancel);
          };
          this.video.addEventListener("loadedmetadata", done, { once: true });
          abort.signal.addEventListener("abort", cancel, { once: true });
        });
      }
      if (!active()) throw aborted();
      const assetRoot = new URL(
        `${import.meta.env.BASE_URL}vision/`,
        window.location.href,
      ).href;
      let worker: Worker;
      const spawn = async (options: WorkerOptions) => {
        worker = new Worker(new URL("hand-worker.js", assetRoot)); // Classic, for the WASM loader's importScripts.
        this.worker = worker;
        await new Promise<void>((resolve, reject) => {
          let ready = false;
          const cancel = () => reject(aborted());
          abort.signal.addEventListener("abort", cancel, { once: true });
          const fail = (message: string) => {
            clearTimeout(this.initializationTimer);
            abort.signal.removeEventListener("abort", cancel);
            if (!ready) reject(new Error(message));
            else if (active()) this.fail(message);
          };
          this.initializationTimer = setTimeout(
            () =>
              fail(
                "Vision initialization timed out. Prepare local assets and check webview WASM support.",
              ),
            25_000,
          );
          worker.onerror = (event) =>
            fail(
              event.message ||
                "Vision worker failed. Check local assets and content security policy.",
            );
          worker.onmessageerror = () =>
            fail("Vision worker returned an unreadable message.");
          worker.onmessage = (event: MessageEvent<WorkerReply>) => {
            if (!active()) return;
            const message = event.data;
            if (message.type === "error") {
              fail(message.message);
              return;
            }
            if (message.type === "ready") {
              ready = true;
              this.delegate = message.delegate ?? "CPU";
              clearTimeout(this.initializationTimer);
              abort.signal.removeEventListener("abort", cancel);
              resolve();
            } else if (message.type === "result") {
              clearTimeout(this.frameTimer);
              this.delegateConfirmed = true;
              this.busy = false;
              // Both matching clocks originate in this main window. Worker time is duration only.
              const receivedAt = performance.now();
              const { type: _type, width, height, ...result } = message;
              const source =
                this.pending?.frameId === message.frameId ? this.pending : null;
              this.pending = null;
              this.onObservation({
                ...result,
                width: source?.width ?? width,
                height: source?.height ?? height,
                inputWidth: width,
                inputHeight: height,
                handedness: result.handedness ?? result.hands.map(() => null),
                delegate: result.delegate ?? this.delegate,
                timestamp: receivedAt,
                receivedAt,
              });
              // Start the next inference now rather than at the next animation frame.
              if (active()) capture(performance.now());
            }
          };
          worker.postMessage({
            type: "init",
            assetRoot,
            options,
          });
        });
      };
      await spawn(this.workerOptions);
      // A GPU context that never returns (seen with software WebGL) must not
      // stall tracking: restart once on the CPU if the first GPU frame hangs.
      this.delegateConfirmed = false;
      const fallBackToCpu = async () => {
        worker.terminate();
        this.busy = true; // Blocks capture while the CPU worker starts.
        this.pending = null;
        try {
          await spawn({ ...this.workerOptions, delegate: "CPU" });
        } catch (error) {
          if (active()) this.fail(cameraError(error));
          return;
        }
        if (active()) this.busy = false;
      };
      if (!active()) throw aborted();
      this.lastCapture = -Infinity;
      this.lastVideoTime = -1;
      this.presented = 0;
      this.lastPresented = -1;
      this.resizeSupported = null;
      this.onState("running");
      const video = this.video;
      const countFrames = typeof video.requestVideoFrameCallback === "function";
      if (countFrames) {
        const onFrame = () => {
          if (!active()) return;
          this.presented++;
          this.videoFrameCallback = video.requestVideoFrameCallback(onFrame);
        };
        this.videoFrameCallback = video.requestVideoFrameCallback(onFrame);
      }
      const bitmapOf = async (): Promise<ImageBitmap> => {
        const width = video.videoWidth;
        const height = video.videoHeight;
        const scale =
          this.maxInputSize > 0
            ? Math.min(1, this.maxInputSize / Math.max(width, height))
            : 1;
        if (scale >= 1) return createImageBitmap(video);
        const w = Math.max(1, Math.round(width * scale));
        const h = Math.max(1, Math.round(height * scale));
        if (this.resizeSupported !== false) {
          const bitmap = await createImageBitmap(video, {
            resizeWidth: w,
            resizeHeight: h,
            resizeQuality: "low",
          });
          this.resizeSupported = bitmap.width === w && bitmap.height === h;
          return bitmap; // Full size if unsupported: still correct, just slower.
        }
        // Fallback for engines that ignore resize options: GPU-side scaled copy.
        if (
          !this.scratch ||
          this.scratch.width !== w ||
          this.scratch.height !== h
        )
          this.scratch = new OffscreenCanvas(w, h);
        const context = this.scratch.getContext("2d");
        if (!context) return createImageBitmap(video);
        context.drawImage(video, 0, 0, w, h);
        return this.scratch.transferToImageBitmap();
      };
      const capture = (now: number) => {
        if (
          this.busy ||
          document.hidden ||
          video.readyState < 2 ||
          (this.fps > 0 && now - this.lastCapture < 1000 / this.fps - 1)
        )
          return;
        if (countFrames) {
          if (this.presented === this.lastPresented) return;
        } else if (video.currentTime === this.lastVideoTime) return;
        this.lastCapture = now;
        this.lastVideoTime = video.currentTime;
        this.lastPresented = this.presented;
        this.busy = true; // Covers bitmap creation too: no queued frames.
        const capturedAt = performance.now();
        const frameId = ++this.frameId;
        this.pending = {
          frameId,
          width: video.videoWidth,
          height: video.videoHeight,
        };
        const untested = this.delegate === "GPU" && !this.delegateConfirmed;
        this.frameTimer = setTimeout(
          () => {
            if (!active()) return;
            if (untested) void fallBackToCpu();
            else
              this.fail(
                "Vision inference timed out. Stop and restart the camera.",
              );
          },
          untested ? GPU_FIRST_FRAME_TIMEOUT_MS : 10_000,
        );
        void bitmapOf().then(
          (bitmap) => {
            if (!active()) {
              bitmap.close();
              return;
            }
            try {
              worker.postMessage(
                { type: "frame", frameId, capturedAt, bitmap },
                [bitmap],
              );
            } catch (error) {
              bitmap.close();
              if (active()) this.fail(cameraError(error));
            }
          },
          (error) => {
            if (active()) this.fail(cameraError(error));
          },
        );
      };
      const tick = (now: number) => {
        if (!active()) return;
        this.animation = requestAnimationFrame(tick);
        capture(now);
      };
      this.animation = requestAnimationFrame(tick);
      return {
        cameraId: file
          ? `file:${file.name}`
          : stream?.getVideoTracks()[0]?.getSettings().deviceId || deviceId,
        width: this.video.videoWidth,
        height: this.video.videoHeight,
        delegate: this.delegate,
      };
    } catch (error) {
      if (active()) this.fail(cameraError(error));
      throw error;
    }
  }

  private fail(message: string) {
    this.stop(false);
    this.onState("error", message);
  }
}
