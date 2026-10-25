import { transformPoint, type Homography, type Point } from "./geometry";
import type { Handedness, Landmark } from "./types";

/** The player's anatomical hand. A right-handed oud player frets with the left. */
export type HandSide = "left" | "right";

export interface SelectionOptions {
  /** Which of the player's hands stops the strings. */
  frettingHand: HandSide;
  /**
   * True when the image is mirrored like a selfie recording. The live camera
   * here is never mirrored.
   */
  mirrored: boolean;
  /** Image → normalised board homography, when calibrated. */
  board: Homography | null;
  /** Image width / height, so distances are isotropic. */
  aspect: number;
}

export type SelectionReason =
  /** Fingertips lie over the calibrated fingerboard. */
  | "fingerboard"
  /** MediaPipe handedness (interpreted for mirroring) matches the setting. */
  | "handedness"
  /** Continuation of the previously selected hand. */
  | "tracking"
  | "none";

export interface HandSelection {
  index: number | null;
  reason: SelectionReason;
  /** The selected hand is near the previous selection (same physical hand). */
  continued: boolean;
}

export const FRETTING_TIPS = [8, 12, 16, 20] as const;

/**
 * Which anatomical hand a raw MediaPipe label denotes for this image.
 *
 * MediaPipe's documentation says handedness assumes mirrored (selfie) input.
 * Measured with tasks-vision 0.10.32 on unmirrored oud videos, however, the
 * player's left (fretting) hand was labelled "Left" in 1,051 of 1,061 two-hand
 * frames (docs/VISION.md). So labels are taken literally for unmirrored images
 * and flipped only for mirrored ones.
 */
export function anatomicalSide(
  handedness: Handedness | null | undefined,
  mirrored: boolean,
): HandSide | null {
  if (!handedness) return null;
  const side = handedness.label === "Left" ? "left" : "right";
  if (!mirrored) return side;
  return side === "left" ? "right" : "left";
}

/**
 * Board coordinates of the fretting fingertips: along 0 = nut, 1 = marked end;
 * across 0–1 between the outer courses. Null where the projection fails.
 */
function boardTips(hand: readonly Landmark[], board: Homography) {
  return FRETTING_TIPS.map((i) =>
    hand[i] ? transformPoint(board, hand[i]) : null,
  );
}

/**
 * Fraction of fretting fingertips over (or just beside) the fingerboard. The
 * plucking hand works beyond the fingerboard end, near the soundhole/bridge.
 */
export function fingerboardScore(
  hand: readonly Landmark[],
  board: Homography,
): number {
  const tips = boardTips(hand, board);
  return (
    tips.filter(
      (p) => p && p.x >= -0.1 && p.x <= 1.02 && p.y >= -0.75 && p.y <= 1.75,
    ).length / FRETTING_TIPS.length
  );
}

const centre = (hand: readonly Landmark[]): Point => {
  // Wrist and the four finger bases: stable while fingers move.
  const ids = [0, 5, 9, 13, 17].filter((i) => hand[i]);
  return {
    x: ids.reduce((s, i) => s + hand[i].x, 0) / ids.length,
    y: ids.reduce((s, i) => s + hand[i].y, 0) / ids.length,
  };
};

export interface SelectorTuning {
  /** Selection memory: a hand seen within this time can be continued. */
  memoryMs: number;
  /** Max palm-centre movement (fraction of image height) to count as the same hand. */
  trackingRadius: number;
  /** Fingertips over the board needed to be a fretting candidate. */
  minFingerboardScore: number;
  /** Consecutive frames of contrary handedness needed to leave the tracked hand. */
  switchFrames: number;
}
export const DEFAULT_SELECTOR_TUNING: SelectorTuning = {
  memoryMs: 400,
  trackingRadius: 0.12,
  minFingerboardScore: 0.5,
  switchFrames: 3,
};

/**
 * Picks at most one hand, the fretting hand, from each observation. Calibrated:
 * fingertips must lie over the fingerboard. Otherwise MediaPipe handedness is
 * used. In both cases the hand whose palm stays close to the last selection is
 * preferred, so a brief misclassification does not flicker to the other hand.
 */
export class FrettingHandSelector {
  private last: { centre: Point; at: number } | null = null;
  private disagreements = 0;

  constructor(private tuning: SelectorTuning = DEFAULT_SELECTOR_TUNING) {}

  reset() {
    this.last = null;
    this.disagreements = 0;
  }

  select(
    hands: readonly (readonly Landmark[])[],
    handedness: readonly (Handedness | null)[],
    at: number,
    options: SelectionOptions,
  ): HandSelection {
    const aspect = options.aspect > 0 ? options.aspect : 16 / 9;
    const recent =
      this.last &&
      at - this.last.at >= 0 &&
      at - this.last.at <= this.tuning.memoryMs
        ? this.last
        : null;
    const distance = (hand: readonly Landmark[]) => {
      if (!recent) return Infinity;
      const c = centre(hand);
      return Math.hypot(
        (c.x - recent.centre.x) * aspect,
        c.y - recent.centre.y,
      );
    };
    const near = (i: number) =>
      distance(hands[i]) <= this.tuning.trackingRadius;
    const indices = hands.map((_, i) => i);
    let result: Omit<HandSelection, "continued"> = {
      index: null,
      reason: "none",
    };

    if (options.board) {
      const board = options.board;
      const scores = indices.map((i) => fingerboardScore(hands[i], board));
      const candidates = indices.filter(
        (i) => scores[i] >= this.tuning.minFingerboardScore,
      );
      const pick = candidates.sort(
        (a, b) =>
          Number(near(b)) - Number(near(a)) ||
          scores[b] - scores[a] ||
          distance(hands[a]) - distance(hands[b]),
      )[0];
      if (pick !== undefined) result = { index: pick, reason: "fingerboard" };
    } else {
      const matching = indices.filter(
        (i) =>
          anatomicalSide(handedness[i], options.mirrored) ===
          options.frettingHand,
      );
      const tracked = indices
        .filter(near)
        .sort((a, b) => distance(hands[a]) - distance(hands[b]))[0];
      if (matching.length === 1) {
        if (
          tracked !== undefined &&
          tracked !== matching[0] &&
          this.disagreements < this.tuning.switchFrames - 1
        ) {
          // Labels say "the other hand" while we track one: require persistence.
          this.disagreements++;
          result = { index: tracked, reason: "tracking" };
        } else {
          this.disagreements = 0;
          result = { index: matching[0], reason: "handedness" };
        }
      } else if (matching.length > 1) {
        // Both labelled the same: continue the tracked one, else stay unknown.
        if (tracked !== undefined && matching.includes(tracked))
          result = { index: tracked, reason: "tracking" };
      } else if (tracked !== undefined && hands.length === 1) {
        // A lone hand mislabelled for a frame or two, where the fretting hand just was.
        result = { index: tracked, reason: "tracking" };
      }
    }
    const continued = result.index !== null && near(result.index);
    if (result.index !== null)
      this.last = { centre: centre(hands[result.index]), at };
    return { ...result, continued };
  }
}
