/* Classic worker: MediaPipe's WASM loader uses importScripts on supported webviews.
 * All URLs are local assets prepared by scripts/prepare-vision.mjs. */
let landmarker;
let initializing = false;
self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    if (initializing || landmarker) return;
    initializing = true;
    try {
      if (typeof OffscreenCanvas === "undefined") throw new Error("OffscreenCanvas is unavailable in this worker.");
      const root = new URL(data.assetRoot);
      if (root.origin !== self.location.origin) throw new Error("Vision assets must be hosted by this application.");
      importScripts(new URL("vision-classic.js", root).href);
      const { FilesetResolver, HandLandmarker } = self.AjnasMediaPipe;
      const fileset = await FilesetResolver.forVisionTasks(new URL("wasm/", root).href.replace(/\/$/, ""));
      landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: new URL("hand_landmarker.task", root).href, delegate: "CPU" },
        canvas: new OffscreenCanvas(1, 1),
        runningMode: "VIDEO", numHands: 2,
        minHandDetectionConfidence: 0.7, minHandPresenceConfidence: 0.7, minTrackingConfidence: 0.7,
      });
      self.postMessage({ type: "ready" });
    } catch (error) {
      self.postMessage({ type: "error", message: `Vision initialization failed: ${error instanceof Error ? error.message : error}. Run node scripts/prepare-vision.mjs and check webview support.` });
    }
  } else if (data.type === "frame") {
    const { bitmap } = data;
    try {
      if (!landmarker) throw new Error("Vision model is not ready.");
      const started = performance.now();
      const result = landmarker.detectForVideo(bitmap, data.capturedAt);
      // Handedness scores describe left/right classification, not fingertip reliability.
      self.postMessage({ type: "result", frameId: data.frameId, capturedAt: data.capturedAt,
        width: bitmap.width, height: bitmap.height, hands: result.landmarks,
        inferenceMs: performance.now() - started });
    } catch (error) {
      self.postMessage({ type: "error", message: `Vision inference failed: ${error instanceof Error ? error.message : error}` });
    } finally { bitmap.close(); }
  }
};
