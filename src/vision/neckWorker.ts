/// <reference lib="webworker" />
/**
 * Module worker for src/vision/neckTracker.ts. Converts each transferred
 * bitmap to a small greyscale frame and runs one tracker step. Nothing is
 * stored beyond the tracker's in-memory reference frame.
 */
import { NeckTracker, grayFromRGBA } from "./neckTracker";
import type { NeckReply, NeckRequest } from "./neckFollower";

const tracker = new NeckTracker();
let canvas: OffscreenCanvas | null = null;
const scope = self as unknown as DedicatedWorkerGlobalScope;
const reply = (message: NeckReply) => scope.postMessage(message);

scope.onmessage = ({ data }: MessageEvent<NeckRequest>) => {
  const started = performance.now();
  const { bitmap } = data;
  try {
    const width = data.width;
    const height = Math.max(
      16,
      Math.round((width * bitmap.height) / bitmap.width),
    );
    if (!canvas || canvas.width !== width || canvas.height !== height)
      canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("No 2D context for neck tracking.");
    context.drawImage(bitmap, 0, 0, width, height);
    const frame = grayFromRGBA(
      context.getImageData(0, 0, width, height).data,
      width,
      height,
    );
    if (data.type === "reference")
      reply({
        type: "reference",
        points: tracker.setReference(frame, data.corners, data.exclude),
        ms: performance.now() - started,
      });
    else
      reply({
        type: "result",
        result: tracker.update(frame, data.exclude),
        ms: performance.now() - started,
      });
  } catch (error) {
    reply({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    bitmap.close();
  }
};
