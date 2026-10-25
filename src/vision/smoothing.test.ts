import { describe, expect, it } from "vitest";
import { LandmarkSmoother, OneEuroFilter } from "./smoothing";

const hand = (x: number, y = 0.5) =>
  Array.from({ length: 21 }, (_, i) => ({ x: x + i * 0.001, y, z: -i }));

describe("One-Euro landmark smoothing", () => {
  it("passes the first sample through and converges on a constant", () => {
    const filter = new OneEuroFilter();
    expect(filter.filter(0.4, 0)).toBe(0.4);
    let value = 0;
    for (let i = 1; i <= 60; i++) value = filter.filter(0.6, i / 30);
    expect(value).toBeCloseTo(0.6, 4);
  });
  it("reduces jitter on a still hand", () => {
    const filter = new OneEuroFilter();
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 90; i++) {
      const sample = 0.5 + (i % 2 ? 0.003 : -0.003);
      raw.push(sample);
      out.push(filter.filter(sample, i / 30));
    }
    const spread = (xs: number[]) =>
      Math.max(...xs.slice(30)) - Math.min(...xs.slice(30));
    expect(spread(out)).toBeLessThan(spread(raw) / 2);
  });
  it("follows a fast, steady movement with bounded lag", () => {
    const filter = new OneEuroFilter();
    let value = 0;
    for (let i = 0; i <= 30; i++) value = filter.filter(i * 0.02, i / 30); // 0.6/s
    expect(0.6 - value).toBeLessThan(0.02);
  });
  it("restarts after a gap or a timestamp that does not advance, and passes depth through", () => {
    const smoother = new LandmarkSmoother();
    smoother.smooth(hand(0.2), 0);
    const moved = smoother.smooth(hand(0.3), 33);
    expect(moved[0].x).toBeGreaterThan(0.2);
    expect(moved[0].x).toBeLessThan(0.3);
    expect(moved[5].z).toBe(-5);
    expect(smoother.smooth(hand(0.8), 1000)[0].x).toBe(0.8); // Gap: no smoothing across.
    expect(smoother.smooth(hand(0.1), 1000)[0].x).toBe(0.1); // Same timestamp.
  });
});
