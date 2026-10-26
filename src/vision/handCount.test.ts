import { describe, expect, it } from "vitest";
import { HandCountPolicy } from "./handCount";
import type { HandSelection } from "./handSelection";

const none: HandSelection = { index: null, reason: "none", continued: false };
const found: HandSelection = {
  index: 0,
  reason: "handedness",
  continued: true,
};

describe("adaptive MediaPipe hand count", () => {
  it("stays on one hand while the fretting hand is tracked or nothing is seen", () => {
    const policy = new HandCountPolicy();
    for (let i = 0; i < 20; i++)
      expect(policy.update(found, 1, i * 33)).toBe(1);
    for (let i = 20; i < 40; i++)
      expect(policy.update(none, 0, i * 33)).toBe(1);
  });

  it("searches with two hands when only the wrong hand is tracked, then returns", () => {
    const policy = new HandCountPolicy();
    expect(policy.update(none, 1, 0)).toBe(1);
    expect(policy.update(none, 1, 33)).toBe(1);
    expect(policy.update(found, 1, 66)).toBe(1); // A good frame resets the count.
    for (const at of [100, 133, 166])
      expect(policy.update(none, 1, at)).toBe(1);
    expect(policy.update(none, 1, 200)).toBe(2);
    // Found, but the minimum search time has not passed.
    for (const at of [233, 266, 300])
      expect(policy.update(found, 2, at)).toBe(2);
    expect(policy.update(found, 2, 1300)).toBe(1);
  });

  it("backs off exponentially when single-hand tracking keeps relocking the wrong hand", () => {
    const policy = new HandCountPolicy();
    let at = 0;
    const lockWrong = () => {
      for (let i = 0; i < 4; i++) policy.update(none, 1, (at += 33));
      expect(policy.numHands).toBe(2);
    };
    const searchUntilReturn = () => {
      const start = at;
      while (policy.update(found, 2, (at += 33)) === 2);
      return at - start;
    };
    lockWrong();
    expect(searchUntilReturn()).toBeLessThan(1100);
    lockWrong();
    expect(searchUntilReturn()).toBeGreaterThanOrEqual(2000);
    lockWrong();
    expect(searchUntilReturn()).toBeGreaterThanOrEqual(4000);
    // A long, successful single-hand period resets the back-off.
    for (let i = 0; i < 400; i++) policy.update(found, 1, (at += 33));
    lockWrong();
    expect(searchUntilReturn()).toBeLessThan(1100);
  });
  it("searches with two hands while asked to, then returns after the minimum search", () => {
    const policy = new HandCountPolicy();
    let at = 0;
    for (let i = 0; i < 10; i++)
      expect(policy.update(found, 1, (at += 33), true)).toBe(2);
    let back = at;
    while (policy.update(found, 2, (at += 33)) === 2);
    back = at - back;
    expect(back).toBeGreaterThanOrEqual(1000);
    expect(back).toBeLessThan(1100);
  });
});
