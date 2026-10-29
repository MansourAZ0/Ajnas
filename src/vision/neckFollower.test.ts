import { describe, expect, it } from "vitest";
import { neckTrackingUsable, type NeckUpdate } from "./neckFollower";

const pose: NeckUpdate = {
  status: "tracking",
  capturedAt: 1000,
  corners: [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 0 },
  ],
  inliers: 30,
  points: 40,
  moved: 0,
  ms: 5,
};

describe("neck pose freshness", () => {
  it("pauses position evidence when a worker stalls or its result arrives too late", () => {
    expect(neckTrackingUsable(pose, 1100)).toBe(true);
    expect(neckTrackingUsable(pose, 1501)).toBe(false);
    expect(neckTrackingUsable({ ...pose, capturedAt: 1600 }, 1700)).toBe(true);
  });

  it("withholds positions before the first pose and after tracking is lost", () => {
    expect(neckTrackingUsable(null, 1100)).toBe(false);
    expect(
      neckTrackingUsable({ ...pose, status: "lost", corners: null }, 1100),
    ).toBe(false);
    expect(neckTrackingUsable(pose, 999)).toBe(false);
  });
});
