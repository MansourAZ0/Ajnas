import type { VisionObservation, WorkerReply } from "./types";

export interface CameraInfo {
  cameraId: string;
  width: number;
  height: number;
}
export type CameraState = "off" | "starting" | "running" | "error";
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
  private frameDeadline = 0;
  private fps = 12;
  private lastCapture = -Infinity;
  private lastVideoTime = -1;
  private frameId = 0;
  private initializationTimer: ReturnType<typeof setTimeout> | undefined;
  private frameTimer: ReturnType<typeof setTimeout> | undefined;
  private objectUrl: string | null = null;

  constructor(
    private video: HTMLVideoElement,
    private onState: (state: CameraState, error?: string) => void,
    private onObservation: (observation: VisionObservation) => void,
  ) {}

  setFps(value: number) {
    this.fps = Math.min(30, Math.max(1, Number.isFinite(value) ? value : 12));
  }

  stop(notify = true) {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
    cancelAnimationFrame(this.animation);
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
      const worker = new Worker(new URL("hand-worker.js", assetRoot)); // Classic, for the WASM loader's importScripts.
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
            clearTimeout(this.initializationTimer);
            abort.signal.removeEventListener("abort", cancel);
            resolve();
          } else if (message.type === "result") {
            clearTimeout(this.frameTimer);
            this.busy = false;
            // Both matching clocks originate in this main window. Worker time is duration only.
            const receivedAt = performance.now();
            this.onObservation({
              ...message,
              timestamp: receivedAt,
              receivedAt,
            });
          }
        };
        worker.postMessage({ type: "init", assetRoot });
      });
      if (!active()) throw aborted();
      this.lastCapture = -Infinity;
      this.lastVideoTime = -1;
      this.onState("running");
      const tick = (now: number) => {
        if (!active()) return;
        this.animation = requestAnimationFrame(tick);
        if (
          this.busy ||
          document.hidden ||
          this.video.readyState < 2 ||
          now - this.lastCapture < 1000 / this.fps ||
          this.video.currentTime === this.lastVideoTime
        )
          return;
        this.lastCapture = now;
        this.lastVideoTime = this.video.currentTime;
        this.busy = true; // Covers bitmap creation too: no queued frames.
        this.frameDeadline = performance.now();
        const capturedAt = this.frameDeadline;
        const frameId = ++this.frameId;
        this.frameTimer = setTimeout(() => {
          if (active())
            this.fail(
              "Vision inference timed out. Stop and restart the camera.",
            );
        }, 10_000);
        void createImageBitmap(this.video).then(
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
      this.animation = requestAnimationFrame(tick);
      return {
        cameraId: file
          ? `file:${file.name}`
          : stream?.getVideoTracks()[0]?.getSettings().deviceId || deviceId,
        width: this.video.videoWidth,
        height: this.video.videoHeight,
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
