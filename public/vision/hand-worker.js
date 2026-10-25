/* Classic worker: MediaPipe's WASM loader uses importScripts on supported webviews.
 * All URLs are local assets prepared by scripts/prepare-vision.mjs. */
let landmarker;
let delegate = "CPU";
let initializing = false;
let createOptions;
let fileset;

async function create(requested) {
  return self.AjnasMediaPipe.HandLandmarker.createFromOptions(fileset, {
    ...createOptions,
    baseOptions: { ...createOptions.baseOptions, delegate: requested },
    canvas: new OffscreenCanvas(1, 1),
  });
}

self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    if (initializing || landmarker) return;
    initializing = true;
    try {
      if (typeof OffscreenCanvas === "undefined") throw new Error("OffscreenCanvas is unavailable in this worker.");
      const root = new URL(data.assetRoot);
      if (root.origin !== self.location.origin) throw new Error("Vision assets must be hosted by this application.");
      const options = data.options ?? {};
      importScripts(new URL("vision-classic.js", root).href);
      fileset = await self.AjnasMediaPipe.FilesetResolver.forVisionTasks(new URL("wasm/", root).href.replace(/\/$/, ""));
      createOptions = {
        baseOptions: { modelAssetPath: new URL("hand_landmarker.task", root).href },
        runningMode: "VIDEO",
        numHands: options.numHands ?? 2,
        minHandDetectionConfidence: options.minHandDetectionConfidence ?? 0.7,
        minHandPresenceConfidence: options.minHandPresenceConfidence ?? 0.7,
        minTrackingConfidence: options.minTrackingConfidence ?? 0.7,
      };
      const wanted = options.delegate ?? "CPU";
      landmarker = null;
      if (wanted === "GPU") {
        try {
          landmarker = await create("GPU");
          delegate = "GPU";
        } catch {
          landmarker = null; // WebGL2 unavailable in this worker: fall back below.
        }
      }
      if (!landmarker) {
        landmarker = await create("CPU");
        delegate = "CPU";
      }
      self.postMessage({ type: "ready", delegate });
    } catch (error) {
      self.postMessage({ type: "error", message: `Vision initialization failed: ${error instanceof Error ? error.message : error}. Run node scripts/prepare-vision.mjs and check webview support.` });
    }
  } else if (data.type === "frame") {
    const { bitmap } = data;
    try {
      if (!landmarker) throw new Error("Vision model is not ready.");
      const started = performance.now();
      let result;
      try {
        result = landmarker.detectForVideo(bitmap, data.capturedAt);
      } catch (error) {
        if (delegate !== "GPU") throw error;
        // A GPU context can fail at first use or be lost: continue on CPU once.
        landmarker.close();
        landmarker = await create("CPU");
        delegate = "CPU";
        result = landmarker.detectForVideo(bitmap, data.capturedAt);
      }
      // Raw MediaPipe labels assume a mirrored (selfie) image; the main window interprets them.
      // Handedness scores describe left/right classification, not fingertip reliability.
      const handedness = result.landmarks.map((_, i) => {
        const best = result.handedness?.[i]?.[0];
        return best ? { label: best.categoryName, score: best.score } : null;
      });
      self.postMessage({ type: "result", frameId: data.frameId, capturedAt: data.capturedAt,
        width: bitmap.width, height: bitmap.height, hands: result.landmarks, handedness, delegate,
        inferenceMs: performance.now() - started });
    } catch (error) {
      self.postMessage({ type: "error", message: `Vision inference failed: ${error instanceof Error ? error.message : error}` });
    } finally { bitmap.close(); }
  }
};
