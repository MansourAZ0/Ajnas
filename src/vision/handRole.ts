import type { Handedness, Landmark } from "./types";

type Label = Handedness["label"];

/**
 * Thumb tip to the nearest index-finger joint (PIP, DIP or tip), in palm
 * lengths (wrist → middle-finger base). The plucking hand pinches the risha
 * between thumb and index; the fretting hand's thumb sits behind the neck.
 * Measured on six oud videos (docs/VISION.md): fretting p10/p50 = 0.18/0.47,
 * plucking p50/p90 = 0.17/0.23.
 */
export function pinchRatio(hand: readonly Landmark[], aspect: number): number {
  const d = (a: number, b: number) =>
    Math.hypot((hand[a].x - hand[b].x) * aspect, hand[a].y - hand[b].y);
  const palm = d(0, 9);
  if (!(palm > 0)) return NaN;
  return Math.min(d(4, 6), d(4, 7), d(4, 8)) / palm;
}

export interface HandRoleTuning {
  /** Evidence kept per new vote (exponential forgetting). */
  decay: number;
  /** Two hands: minimum pinch difference for a vote. */
  pairMargin: number;
  /** One hand: at or below this it looks like the plucking (risha) grip. */
  pluckBelow: number;
  /** One hand: at or above this it looks like the fretting hand. */
  fretAbove: number;
  /** Weight of a lone-hand vote relative to a two-hand comparison. */
  singleWeight: number;
  /** |evidence| needed before the learned mapping is trusted. */
  confidentAt: number;
}
export const DEFAULT_HAND_ROLE_TUNING: HandRoleTuning = {
  decay: 0.97,
  pairMargin: 0.1,
  pluckBelow: 0.12,
  fretAbove: 0.45,
  singleWeight: 0.5,
  confidentAt: 3,
};

/**
 * Learns which MediaPipe handedness label belongs to the fretting hand.
 *
 * Labels are consistent within a video but their meaning depends on mirroring
 * and on whether the player is left-handed (a mirrored selfie recording of a
 * right-handed player was labelled exactly backwards, 1.4% "correct"). The
 * pinch grip is mirror-independent but noisy per frame, so it votes on the
 * label mapping over time; per-frame selection then uses the reliable labels.
 * Offline on the six test clips this chose the fretting hand in every
 * two-hand frame, deciding within about 1.5–2 s.
 */
export class HandRoleLearner {
  /** > 0: the fretting hand is labelled "Left"; < 0: labelled "Right". */
  private evidence = 0;

  constructor(private tuning: HandRoleTuning = DEFAULT_HAND_ROLE_TUNING) {}

  reset() {
    this.evidence = 0;
  }

  get confident() {
    return Math.abs(this.evidence) >= this.tuning.confidentAt;
  }

  /** The label of the fretting hand; `prior` until any evidence exists. */
  frettingLabel(prior: Label): Label {
    return this.evidence > 0 ? "Left" : this.evidence < 0 ? "Right" : prior;
  }

  observe(
    hands: readonly (readonly Landmark[])[],
    handedness: readonly (Handedness | null)[],
    aspect: number,
  ) {
    const t = this.tuning;
    const vote = (frettingIsLeft: boolean, weight: number) => {
      this.evidence =
        this.evidence * t.decay + (frettingIsLeft ? weight : -weight);
    };
    if (hands.length === 2) {
      const labels = handedness.map((h) => h?.label);
      if (!labels[0] || !labels[1] || labels[0] === labels[1]) return;
      const left = labels.indexOf("Left");
      const diff =
        pinchRatio(hands[left], aspect) - pinchRatio(hands[1 - left], aspect);
      // The hand with the wider thumb–index gap is the fretting hand.
      if (Math.abs(diff) >= t.pairMargin) vote(diff > 0, 1);
    } else if (hands.length === 1 && handedness[0]) {
      const pinch = pinchRatio(hands[0], aspect);
      const isLeft = handedness[0].label === "Left";
      if (pinch <= t.pluckBelow) vote(!isLeft, t.singleWeight);
      else if (pinch >= t.fretAbove) vote(isLeft, t.singleWeight);
    }
  }
}
