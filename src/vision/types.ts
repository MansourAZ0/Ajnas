import type { Point, ProjectedPosition } from "./geometry";

export interface Landmark extends Point {
  z: number;
}
export interface AudioEvidence {
  /** Main-window performance.now(), at receipt of the acoustic observation. */
  receivedAt: number;
  playerPitch: number;
  confidence: number;
  positions: { course: number; distanceMm: number }[];
}
/**
 * Raw MediaPipe handedness. MediaPipe assumes a mirrored (selfie) image, so on
 * an unmirrored camera image "Left" usually denotes the person's right hand.
 * The score is classification confidence, not landmark reliability.
 */
export interface Handedness {
  label: "Left" | "Right";
  score: number;
}
export type Delegate = "CPU" | "GPU";
/** Sent to the worker at initialization. */
export interface WorkerOptions {
  numHands?: number;
  delegate?: Delegate;
  minHandDetectionConfidence?: number;
  minHandPresenceConfidence?: number;
  minTrackingConfidence?: number;
}
export interface VisionObservation {
  frameId: number;
  /** Main-window performance.now() before bitmap capture; never a worker clock. */
  capturedAt: number;
  receivedAt: number;
  timestamp: number;
  /** Source video size at capture; landmarks are normalised to this image. */
  width: number;
  height: number;
  /** Size of the (possibly downscaled) bitmap the model saw. */
  inputWidth: number;
  inputHeight: number;
  inferenceMs: number;
  hands: Landmark[][];
  /** Same order as hands; null when the model gave no label. */
  handedness: (Handedness | null)[];
  delegate: Delegate;
}
export interface PositionCandidate extends ProjectedPosition {
  handIndex: number;
  landmarkIndex: number;
}
export interface VisionEvidence {
  capturedAt: number;
  receivedAt: number;
  calibrated: boolean;
  handCount: number;
  candidates: PositionCandidate[];
}
export type WorkerReply =
  | { type: "ready"; delegate: Delegate }
  | { type: "error"; message: string }
  | {
      type: "result";
      frameId: number;
      capturedAt: number;
      width: number;
      height: number;
      inferenceMs: number;
      hands: Landmark[][];
      handedness?: (Handedness | null)[];
      delegate?: Delegate;
    };
