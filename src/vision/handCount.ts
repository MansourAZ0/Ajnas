import type { HandSelection } from "./handSelection";

export interface HandCountTuning {
  /** Consecutive results tracking only a non-fretting hand before searching. */
  wrongFrames: number;
  /** Consecutive continued fretting selections before returning to one hand. */
  confirmFrames: number;
  /** Shortest two-hand search; doubles after each single-hand attempt that fails quickly. */
  minSearchMs: number;
  maxSearchMs: number;
  /** A single-hand period longer than this resets the search back-off. */
  stableMs: number;
}
export const DEFAULT_HAND_COUNT_TUNING: HandCountTuning = {
  wrongFrames: 4,
  confirmFrames: 3,
  minSearchMs: 1000,
  maxSearchMs: 16_000,
  stableMs: 10_000,
};

/**
 * Chooses MediaPipe's numHands. Tracking one hand is about twice as fast as
 * two (measured), but the model may lock onto the plucking hand and keep it.
 * So: track one hand; when only a non-fretting hand is being tracked, search
 * with two hands until the fretting hand is found again, then retry one hand.
 * Retries back off exponentially so a stubborn wrong lock cannot flicker.
 */
export class HandCountPolicy {
  private current = 1;
  private wrong = 0;
  private confirmed = 0;
  private since = -Infinity;
  private searchMs: number;

  constructor(private tuning: HandCountTuning = DEFAULT_HAND_COUNT_TUNING) {
    this.searchMs = tuning.minSearchMs;
  }

  get numHands() {
    return this.current;
  }

  reset() {
    this.current = 1;
    this.wrong = 0;
    this.confirmed = 0;
    this.since = -Infinity;
    this.searchMs = this.tuning.minSearchMs;
  }

  /** Feed every result; returns the numHands to use for the next frames. */
  update(selection: HandSelection, handsSeen: number, at: number): number {
    if (this.current === 1) {
      this.wrong =
        handsSeen > 0 && selection.index === null ? this.wrong + 1 : 0;
      if (this.wrong >= this.tuning.wrongFrames) {
        // A single-hand attempt that failed soon after starting: back off.
        this.searchMs =
          at - this.since < this.tuning.stableMs
            ? Math.min(this.tuning.maxSearchMs, this.searchMs * 2)
            : this.tuning.minSearchMs;
        this.current = 2;
        this.since = at;
        this.wrong = 0;
        this.confirmed = 0;
      }
    } else {
      this.confirmed =
        selection.index !== null && selection.continued
          ? this.confirmed + 1
          : 0;
      if (
        this.confirmed >= this.tuning.confirmFrames &&
        at - this.since >= this.searchMs
      ) {
        this.current = 1;
        this.since = at;
        this.wrong = 0;
      }
    }
    return this.current;
  }
}
