import { describe, it, expect } from "vitest";
import { coaching, PerformanceStore } from "./live";
import type { LiveFrame, Target } from "./types";
const frame = {
  t: 1,
  confidence: 0.98,
  note: {
    eventId: 1,
    playerPitch: 63.57,
    holding: false,
    label: { text: "Mi half-flat 4" },
    cents: 7,
  },
} as LiveFrame;
const target = { playerPitch: 63.5 } as Target;
describe("target coaching", () => {
  it("uses continuous player pitch against the selected target", () => {
    expect(coaching(frame, target, 1000, 1050)?.cents).toBeCloseTo(7);
    expect(coaching(frame, target, 1000, 1050)?.state).toBe("inTune");
    expect(
      coaching(frame, { playerPitch: 64 } as Target, 1000, 1050)?.state,
    ).toBe("flat");
  });
  it("folds other octaves of the target and reports them", () => {
    const below = coaching(frame, { playerPitch: 75.5 } as Target, 1000, 1050);
    expect(below?.cents).toBeCloseTo(7);
    expect(below?.octaves).toBe(-1);
    expect(below?.state).toBe("inTune");
    const above = coaching(frame, { playerPitch: 51.6 } as Target, 1000, 1050);
    expect(above?.cents).toBeCloseTo(-3);
    expect(above?.octaves).toBe(1);
    expect(coaching(frame, target, 1000, 1050)?.octaves).toBe(0);
  });
  it("withholds stale, held and low confidence readings", () => {
    expect(coaching(frame, target, 1000, 1500)).toBeNull();
    expect(
      coaching({ ...frame, confidence: 0.5 }, target, 1000, 1050),
    ).toBeNull();
    expect(
      coaching(
        { ...frame, note: { ...frame.note!, holding: true } },
        target,
        1000,
        1050,
      ),
    ).toBeNull();
  });
  it("bounds history and starts a fresh history per session", () => {
    const store = new PerformanceStore();
    for (let i = 0; i < 200; i++)
      store.push({ ...frame, note: { ...frame.note!, eventId: i } });
    expect(store.history).toHaveLength(160);
    store.push({ ...frame, note: { ...frame.note!, eventId: 199 } });
    expect(store.history).toHaveLength(160);
    store.reset();
    expect(store.history).toHaveLength(0);
    expect(store.frame).toBeNull();
  });
});
