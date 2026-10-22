import { describe, expect, it } from "vitest";
import { fusePosition } from "./fusion";
import type { AudioEvidence, VisionEvidence } from "./types";

const audio: AudioEvidence = {
  receivedAt: 1000,
  playerPitch: 62.5,
  confidence: 0.95,
  positions: [
    { course: 2, distanceMm: 120 },
    { course: 3, distanceMm: 40 },
  ],
};
const vision: VisionEvidence = {
  capturedAt: 990,
  receivedAt: 1020,
  calibrated: true,
  handCount: 1,
  candidates: [
    { course: 2, distanceMm: 125, across: 0.4, handIndex: 0, landmarkIndex: 8 },
  ],
};
describe("conservative audio/vision consistency", () => {
  it("compares physical positions, retaining the continuous acoustic pitch", () => {
    const result = fusePosition(audio, vision, 1030);
    expect(result.state).toBe("consistent");
    expect(result.playerPitch).toBe(62.5);
    expect(result.candidate?.course).toBe(2);
  });
  it("never manufactures or overrides a note", () => {
    expect(fusePosition(null, vision, 1030)).toMatchObject({
      state: "unknown",
      playerPitch: null,
    });
    expect(
      fusePosition(
        audio,
        {
          ...vision,
          candidates: [{ ...vision.candidates[0], distanceMm: 200 }],
        },
        1030,
      ),
    ).toEqual({ state: "conflict", playerPitch: 62.5 });
  });
  it("expires captured frames even if a slow worker just delivered them", () => {
    expect(
      fusePosition(
        audio,
        { ...vision, capturedAt: 600, receivedAt: 1029 },
        1030,
      ).reason,
    ).toBe("stale-vision");
    expect(
      fusePosition({ ...audio, receivedAt: 600 }, vision, 1030).reason,
    ).toBe("stale-audio");
    expect(
      fusePosition(audio, { ...vision, receivedAt: 600 }, 1030).reason,
    ).toBe("stale-vision");
  });
  it("rejects unsynchronized and future timestamps, uncalibrated and weak evidence", () => {
    expect(
      fusePosition(audio, { ...vision, capturedAt: 800 }, 1030).reason,
    ).toBe("unsynchronized");
    expect(
      fusePosition(audio, { ...vision, capturedAt: 1100 }, 1030).reason,
    ).toBe("stale-vision");
    expect(
      fusePosition({ ...audio, receivedAt: 1100 }, vision, 1030).reason,
    ).toBe("stale-audio");
    expect(
      fusePosition(audio, { ...vision, calibrated: false }, 1030).reason,
    ).toBe("uncalibrated");
    expect(
      fusePosition({ ...audio, confidence: 0.5 }, vision, 1030).reason,
    ).toBe("low-audio-confidence");
    expect(
      fusePosition({ ...audio, confidence: NaN }, vision, 1030).reason,
    ).toBe("low-audio-confidence");
  });
  it("leaves multiple hands, multiple matching fingers and between-course tips unknown", () => {
    expect(fusePosition(audio, { ...vision, handCount: 2 }, 1030).reason).toBe(
      "ambiguous",
    );
    expect(
      fusePosition(
        audio,
        {
          ...vision,
          candidates: [
            ...vision.candidates,
            { ...vision.candidates[0], landmarkIndex: 12 },
          ],
        },
        1030,
      ).reason,
    ).toBe("ambiguous");
    expect(
      fusePosition(
        audio,
        { ...vision, candidates: [{ ...vision.candidates[0], course: null }] },
        1030,
      ).reason,
    ).toBe("ambiguous");
  });
  it("handles no hands, no positions and no vision as unknown", () => {
    expect(
      fusePosition(audio, { ...vision, handCount: 0, candidates: [] }, 1030)
        .state,
    ).toBe("unknown");
    expect(fusePosition({ ...audio, positions: [] }, vision, 1030).reason).toBe(
      "no-position",
    );
    expect(fusePosition(audio, null, 1030).reason).toBe("no-vision");
  });
});
