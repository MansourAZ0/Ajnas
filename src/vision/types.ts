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
export interface VisionObservation {
  frameId: number;
  /** Main-window performance.now() before bitmap capture; never a worker clock. */
  capturedAt: number;
  receivedAt: number;
  timestamp: number;
  width: number;
  height: number;
  inferenceMs: number;
  hands: Landmark[][];
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
  | { type: "ready" }
  | { type: "error"; message: string }
  | {
      type: "result";
      frameId: number;
      capturedAt: number;
      width: number;
      height: number;
      inferenceMs: number;
      hands: Landmark[][];
    };
