import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraSession, cameraError } from "./camera";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(getUserMedia: () => Promise<MediaStream>) {
  const track = Object.assign(new EventTarget(), {
    stop: vi.fn(),
    getSettings: () => ({ deviceId: "camera" }),
  });
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  const video = Object.assign(new EventTarget(), {
    pause: vi.fn(),
    play: vi.fn(async () => {}),
    srcObject: null,
    videoWidth: 960,
    videoHeight: 540,
    readyState: 4,
    currentTime: 1,
    loop: false,
    muted: false,
    src: "",
    removeAttribute: vi.fn(),
    load: vi.fn(),
  }) as unknown as HTMLVideoElement;
  const frames: FrameRequestCallback[] = [];
  class WorkerMock {
    static instances: WorkerMock[] = [];
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    terminate = vi.fn();
    postMessage = vi.fn();
    constructor() {
      WorkerMock.instances.push(this);
    }
  }
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("Worker", WorkerMock);
  vi.stubGlobal("OffscreenCanvas", class {});
  vi.stubGlobal("createImageBitmap", vi.fn());
  vi.stubGlobal("window", { location: { href: "http://localhost/" } });
  vi.stubGlobal("document", { hidden: false });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const onState = vi.fn();
  const onObservation = vi.fn();
  const session = new CameraSession(video, onState, onObservation);
  return {
    session,
    track,
    stream,
    video,
    onState,
    onObservation,
    frames,
    WorkerMock,
  };
}
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("camera session lifecycle without camera hardware", () => {
  it("releases permission granted after a stop, without creating a worker", async () => {
    const permission = deferred<MediaStream>();
    const fixture = setup(() => permission.promise);
    const start = fixture.session.start("").catch((error) => error);
    fixture.session.stop();
    permission.resolve(fixture.stream);
    expect((await start).name).toBe("AbortError");
    expect(fixture.track.stop).toHaveBeenCalledTimes(1);
    expect(fixture.WorkerMock.instances).toHaveLength(0);
    expect(fixture.video.srcObject).toBeNull();
  });
  it("terminates an initializing worker and stops tracks on cancellation", async () => {
    const fixture = setup(async () => fixture.stream);
    const start = fixture.session.start("").catch((error) => error);
    await flush();
    expect(fixture.WorkerMock.instances).toHaveLength(1);
    fixture.session.stop();
    expect((await start).name).toBe("AbortError");
    expect(fixture.WorkerMock.instances[0].terminate).toHaveBeenCalledTimes(1);
    expect(fixture.track.stop).toHaveBeenCalledTimes(1);
  });
  it("drops frames while bitmap capture is busy and closes a bitmap delivered after stop", async () => {
    const fixture = setup(async () => fixture.stream);
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const capture = deferred<ImageBitmap>();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => capture.promise),
    );
    const start = fixture.session.start("");
    await flush();
    const worker = fixture.WorkerMock.instances[0];
    worker.onmessage?.({ data: { type: "ready" } } as MessageEvent);
    await start;
    fixture.frames.shift()!(performance.now() + 100);
    fixture.frames.shift()!(performance.now() + 300);
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    fixture.session.stop();
    capture.resolve(bitmap);
    await flush();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledTimes(1); // Initialization only.
    expect(fixture.onObservation).not.toHaveBeenCalled();
  });
  it("runs a local video file through the same worker without requesting a camera", async () => {
    const getUserMedia = vi.fn();
    const fixture = setup(getUserMedia);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const start = fixture.session.start({
      kind: "file",
      file: new Blob(),
      name: "oud.mp4",
    });
    await flush();
    const worker = fixture.WorkerMock.instances[0];
    worker.onmessage?.({ data: { type: "ready" } } as MessageEvent);
    const info = await start;
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(info.cameraId).toBe("file:oud.mp4");
    expect(fixture.video.src).toBe("blob:test");
    expect(fixture.video.loop).toBe(true);
    fixture.session.stop();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    expect(fixture.video.removeAttribute).toHaveBeenCalledWith("src");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it("restarts on the CPU when the first GPU inference never returns", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const fixture = setup(async () => fixture.stream);
      vi.stubGlobal(
        "createImageBitmap",
        vi.fn(async () => ({ close: vi.fn(), width: 640, height: 360 })),
      );
      fixture.session.setWorkerOptions({ delegate: "GPU", numHands: 2 });
      const start = fixture.session.start("");
      await flush();
      const gpu = fixture.WorkerMock.instances[0];
      expect(gpu.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ options: { delegate: "GPU", numHands: 2 } }),
      );
      gpu.onmessage?.({
        data: { type: "ready", delegate: "GPU" },
      } as MessageEvent);
      await start;
      fixture.frames.shift()!(performance.now() + 100);
      await flush();
      expect(gpu.postMessage).toHaveBeenCalledTimes(2); // init + frame
      vi.advanceTimersByTime(4000);
      await flush();
      expect(gpu.terminate).toHaveBeenCalledTimes(1);
      const cpu = fixture.WorkerMock.instances[1];
      expect(cpu.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ options: { delegate: "CPU", numHands: 2 } }),
      );
      expect(fixture.onState).not.toHaveBeenCalledWith(
        "error",
        expect.anything(),
      );
      fixture.session.stop();
    } finally {
      vi.useRealTimers();
    }
  });
  it("labels permission and device failures without substituting fake observations", async () => {
    const fixture = setup(async () => {
      throw new DOMException("Denied", "NotAllowedError");
    });
    await expect(fixture.session.start("")).rejects.toThrow();
    expect(fixture.onState).toHaveBeenLastCalledWith(
      "error",
      expect.stringContaining("permission denied"),
    );
    expect(fixture.onObservation).not.toHaveBeenCalled();
    expect(cameraError(new DOMException("Busy", "NotReadableError"))).toContain(
      "other apps",
    );
  });
});
