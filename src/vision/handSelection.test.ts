import { describe, expect, it } from "vitest";
import { fingerboardHomography, type Quadrilateral } from "./geometry";
import {
  anatomicalSide,
  fingerboardScore,
  FrettingHandSelector,
  type SelectionOptions,
} from "./handSelection";
import type { Handedness, Landmark } from "./types";

/** A hand whose palm is at (x, y) and whose fingertips are offset by (tx, ty). */
const hand = (x: number, y: number, tx = 0, ty = -0.05): Landmark[] =>
  Array.from({ length: 21 }, (_, i) =>
    [4, 8, 12, 16, 20].includes(i)
      ? { x: x + tx + (i - 12) * 0.002, y: y + ty, z: 0 }
      : { x, y, z: 0 },
  );
const label = (l: "Left" | "Right", score = 0.95): Handedness => ({
  label: l,
  score,
});
// Unmirrored view of a right-handed player: neck toward image right.
const neck: Quadrilateral = [
  { x: 0.9, y: 0.3 }, // nut, low course
  { x: 0.9, y: 0.4 }, // nut, high course
  { x: 0.5, y: 0.5 }, // end, high course
  { x: 0.5, y: 0.4 }, // end, low course
];
const base: SelectionOptions = {
  frettingHand: "left",
  mirrored: false,
  board: null,
  aspect: 16 / 9,
};
const fretting = hand(0.75, 0.42, 0, -0.04); // Tips on the neck.
const plucking = hand(0.3, 0.6, 0.02, -0.08); // Near the soundhole.

describe("fretting-hand selection", () => {
  it("takes labels literally for unmirrored images (measured), flipped when mirrored", () => {
    expect(anatomicalSide(label("Left"), false)).toBe("left");
    expect(anatomicalSide(label("Right"), false)).toBe("right");
    expect(anatomicalSide(label("Right"), true)).toBe("left");
    expect(anatomicalSide(null, false)).toBeNull();
  });

  it("selects exactly the fretting hand by handedness when uncalibrated", () => {
    const selector = new FrettingHandSelector();
    const pick = selector.select(
      [plucking, fretting],
      [label("Right"), label("Left")],
      0,
      base,
    );
    expect(pick).toMatchObject({ index: 1, reason: "handedness" });
    const lefty = new FrettingHandSelector().select(
      [plucking, fretting],
      [label("Right"), label("Left")],
      0,
      { ...base, frettingHand: "right" },
    );
    expect(lefty.index).toBe(0);
  });

  it("does not draw a lone plucking hand", () => {
    const selector = new FrettingHandSelector();
    expect(
      selector.select([plucking], [label("Right")], 0, base),
    ).toMatchObject({
      index: null,
      reason: "none",
    });
  });

  it("keeps the tracked hand through a brief mislabel, but not after the memory expires", () => {
    const selector = new FrettingHandSelector();
    selector.select([fretting], [label("Left")], 0, base);
    const moved = hand(0.76, 0.43);
    expect(selector.select([moved], [label("Right")], 70, base)).toMatchObject({
      index: 0,
      reason: "tracking",
    });
    expect(selector.select([moved], [label("Right")], 1000, base).index).toBe(
      null,
    );
  });

  it("disambiguates two same-labelled hands by tracking, else reports none", () => {
    const selector = new FrettingHandSelector();
    const both = [label("Left"), label("Left")];
    expect(selector.select([plucking, fretting], both, 0, base).index).toBe(
      null,
    );
    selector.select([fretting], [label("Left")], 10, base);
    expect(selector.select([plucking, fretting], both, 40, base)).toMatchObject(
      {
        index: 1,
        reason: "tracking",
      },
    );
  });

  it("needs persistent contrary labels to leave the tracked hand", () => {
    const selector = new FrettingHandSelector();
    const swapped = [label("Left"), label("Right")]; // Both wrong this frame.
    expect(
      selector.select(
        [plucking, fretting],
        [label("Right"), label("Left")],
        0,
        base,
      ),
    ).toMatchObject({ index: 1, continued: false });
    expect(
      selector.select([plucking, fretting], swapped, 30, base),
    ).toMatchObject({ index: 1, reason: "tracking", continued: true });
    expect(selector.select([plucking, fretting], swapped, 60, base).index).toBe(
      1,
    );
    expect(
      selector.select([plucking, fretting], swapped, 90, base),
    ).toMatchObject({ index: 0, reason: "handedness", continued: false });
  });

  it("prefers fingertips over the calibrated fingerboard regardless of labels", () => {
    const board = fingerboardHomography(neck);
    expect(fingerboardScore(fretting, board)).toBe(1);
    expect(fingerboardScore(plucking, board)).toBe(0);
    const selector = new FrettingHandSelector();
    const wrongLabels = [label("Left"), label("Right")];
    expect(
      selector.select([plucking, fretting], wrongLabels, 0, { ...base, board }),
    ).toMatchObject({ index: 1, reason: "fingerboard" });
    expect(
      selector.select([plucking], wrongLabels, 30, { ...base, board }).index,
    ).toBeNull();
  });

  it("among two hands over the board, continues the tracked one", () => {
    const board = fingerboardHomography(neck);
    const other = hand(0.6, 0.47, 0, -0.03);
    expect(fingerboardScore(other, board)).toBeGreaterThanOrEqual(0.5);
    const selector = new FrettingHandSelector();
    selector.select([fretting], [null], 0, { ...base, board });
    expect(
      selector.select([other, fretting], [null, null], 30, { ...base, board })
        .index,
    ).toBe(1);
  });
});
