import type { Landmark } from "./types";

export interface SmoothingOptions {
  minCutoff: number;
  beta: number;
  /** Restart (no smoothing across) when samples are further apart than this. */
  maxGapMs: number;
}
/**
 * Normalised image coordinates (0–1). Tuned offline on fretting-hand landmarks
 * recorded from oud videos at ~20 Hz (docs/VISION.md): still-hand jitter falls
 * from 6.4 to 4.2 px (1280-px frame) for ~22 ms lag on moving fingers. Heavier
 * settings cut jitter slightly more but cost ~30 ms, against the real-time goal.
 */
export const DEFAULT_SMOOTHING: SmoothingOptions = {
  minCutoff: 3,
  beta: 5,
  maxGapMs: 250,
};

/**
 * One-Euro filter (Casiez, Roussel & Vogel, CHI 2012): a low-pass filter whose
 * cutoff rises with speed, so a still hand stops jittering while a moving finger
 * keeps little lag. Times are in seconds.
 */
export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;

  constructor(
    minCutoff = DEFAULT_SMOOTHING.minCutoff,
    beta = DEFAULT_SMOOTHING.beta,
    dCutoff = 1,
  ) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  reset() {
    this.x = null;
    this.dx = 0;
  }

  /** Smoothed derivative (units per second) from the last filter step. */
  get velocity() {
    return this.dx;
  }

  filter(value: number, t: number): number {
    if (this.x === null || !(t > this.t)) {
      if (this.x === null) this.dx = 0;
      this.x = value;
      this.t = t;
      return value;
    }
    const dt = t - this.t;
    const rawDx = (value - this.x) / dt;
    this.dx += OneEuroFilter.alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuroFilter.alpha(cutoff, dt) * (value - this.x);
    this.t = t;
    return this.x;
  }
}

/** Smooths the x/y of one tracked hand's landmarks. Depth (z) is passed through. */
export class LandmarkSmoother {
  private filters: OneEuroFilter[][] = [];
  private lastAt = -Infinity;
  private options: SmoothingOptions;

  constructor(options: SmoothingOptions = DEFAULT_SMOOTHING) {
    this.options = options;
  }

  reset() {
    this.filters = [];
    this.lastAt = -Infinity;
  }

  /** `at` is the capture time in milliseconds (main-window clock). */
  smooth(hand: readonly Landmark[], at: number): Landmark[] {
    if (
      this.filters.length !== hand.length ||
      !(at > this.lastAt) ||
      at - this.lastAt > this.options.maxGapMs
    ) {
      this.filters = hand.map(() => [
        new OneEuroFilter(this.options.minCutoff, this.options.beta),
        new OneEuroFilter(this.options.minCutoff, this.options.beta),
      ]);
    }
    this.lastAt = at;
    const t = at / 1000;
    return hand.map((point, i) => ({
      x: this.filters[i][0].filter(point.x, t),
      y: this.filters[i][1].filter(point.y, t),
      z: point.z,
    }));
  }

  /** Per-landmark smoothed velocity in normalised units per second. */
  velocities(): { x: number; y: number }[] {
    return this.filters.map(([fx, fy]) => ({ x: fx.velocity, y: fy.velocity }));
  }
}
