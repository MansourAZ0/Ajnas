import { describe, expect, it } from "vitest";
import { HandRoleLearner, pinchRatio } from "./handRole";
import type { Handedness, Landmark } from "./types";

/**
 * A hand with its palm at x: wrist (0) and middle-finger base (9) one palm
 * length (0.1) apart, and the thumb tip (4) `gap` palm lengths from the index
 * finger (6, 7, 8).
 */
const hand = (x: number, gap: number): Landmark[] =>
  Array.from({ length: 21 }, (_, i) => {
    if (i === 0) return { x, y: 0.6, z: 0 };
    if (i === 9) return { x, y: 0.5, z: 0 };
    if (i === 6 || i === 7 || i === 8) return { x: x + 0.02, y: 0.45, z: 0 };
    if (i === 4) return { x: x + 0.02 + gap * 0.1, y: 0.45, z: 0 };
    return { x, y: 0.5, z: 0 };
  });
const label = (l: "Left" | "Right"): Handedness => ({ label: l, score: 0.9 });
const pluck = (x = 0.3) => hand(x, 0.08);
const fret = (x = 0.7) => hand(x, 0.6);

describe("pinch ratio", () => {
  it("measures the thumb–index gap in palm lengths", () => {
    expect(pinchRatio(hand(0.5, 0.3), 1)).toBeCloseTo(0.3);
    expect(pinchRatio(pluck(), 1)).toBeLessThan(0.12);
    expect(pinchRatio(fret(), 1)).toBeGreaterThan(0.45);
  });
});

describe("hand role learner", () => {
  it("uses the prior until there is evidence", () => {
    const learner = new HandRoleLearner();
    expect(learner.frettingLabel("Left")).toBe("Left");
    expect(learner.frettingLabel("Right")).toBe("Right");
    expect(learner.confident).toBe(false);
  });

  it("learns that the fretting hand is labelled Right (mirrored image)", () => {
    const learner = new HandRoleLearner();
    for (let i = 0; i < 4; i++)
      learner.observe([pluck(), fret()], [label("Left"), label("Right")], 1);
    expect(learner.frettingLabel("Left")).toBe("Right");
    expect(learner.confident).toBe(true);
  });

  it("learns the unmirrored mapping and survives occasional wrong votes", () => {
    const learner = new HandRoleLearner();
    for (let i = 0; i < 20; i++) {
      const wrong = i % 5 === 4; // 80% of frames agree, as measured per frame
      learner.observe(
        [fret(), pluck()],
        wrong
          ? [label("Right"), label("Left")]
          : [label("Left"), label("Right")],
        1,
      );
      if (i >= 3) expect(learner.frettingLabel("Right")).toBe("Left");
    }
  });

  it("ignores ambiguous pairs and identical labels", () => {
    const learner = new HandRoleLearner();
    learner.observe(
      [hand(0.3, 0.3), hand(0.7, 0.35)],
      [label("Left"), label("Right")],
      1,
    );
    learner.observe([pluck(), fret()], [label("Left"), label("Left")], 1);
    learner.observe([pluck(), fret()], [label("Left"), null], 1);
    expect(learner.frettingLabel("Right")).toBe("Right");
  });

  it("takes half-weight votes from a lone hand only when its grip is clear", () => {
    const learner = new HandRoleLearner();
    learner.observe([hand(0.5, 0.3)], [label("Left")], 1);
    expect(learner.frettingLabel("Right")).toBe("Right");
    for (let i = 0; i < 3; i++) learner.observe([pluck()], [label("Left")], 1);
    expect(learner.frettingLabel("Left")).toBe("Right");
    expect(learner.confident).toBe(false);
    for (let i = 0; i < 4; i++) learner.observe([fret()], [label("Right")], 1);
    expect(learner.confident).toBe(true);
  });

  it("forgets everything on reset", () => {
    const learner = new HandRoleLearner();
    for (let i = 0; i < 5; i++)
      learner.observe([pluck(), fret()], [label("Left"), label("Right")], 1);
    learner.reset();
    expect(learner.frettingLabel("Left")).toBe("Left");
    expect(learner.confident).toBe(false);
  });
});
