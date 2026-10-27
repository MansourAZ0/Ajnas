import { describe, expect, it } from "vitest";
import type { NoteLabel } from "@naghma/ui";
import type { Fingerboard, Target } from "./types";
import {
  ZAND_VIEW,
  across,
  distanceForCents,
  intonation,
  zandMarks,
  zandPoint,
} from "./zand";

const label = (text: string, q = 0): NoteLabel => ({
  text,
  name: text,
  accidental: "",
  octave: "",
  degree: "do",
  accidentalQuarterTones: q,
  octaveNumber: 3,
});

function target(
  id: string,
  step: number | null,
  q: number,
  positions: [number, number][],
): Target {
  return {
    id,
    label: label(id, q),
    soundingLabel: label(id, q),
    playerPitch: 0,
    soundingHz: 0,
    step,
    positions: positions.map(([course, cents]) => ({
      course,
      centsAboveOpen: cents,
      distanceMm: distanceForCents(600, cents),
      fraction: distanceForCents(600, cents) / 600,
    })),
  };
}

const board = (scale: boolean): Fingerboard => ({
  name: "test",
  scaleLengthMm: 600,
  fingerboardLengthMm: 300,
  courses: [label("a"), label("b"), label("c")],
  targets: [
    target("do", 0, 0, [[1, 0]]),
    target("mi-half-flat", 2, -1, [[0, 350]]),
    target("do8", 7, 0, [[2, 1200]]),
  ],
  scale: scale
    ? {
        maqamId: "rast",
        tonic: label("do"),
        octaveRepeating: true,
        notes: [
          { label: label("do"), cents: 0, step: 0 },
          { label: label("mi"), cents: 350, step: 2 },
          { label: label("do"), cents: 1200, step: 7 },
        ],
        ajnas: [],
        sources: [],
      }
    : null,
});

describe("zand marks", () => {
  it("places positions in board coordinates with ±10-cent zones", () => {
    const [open, mi, octave] = zandMarks(board(true));
    expect(open.open).toBe(true);
    expect(open.along).toBe(0);
    expect(open.across).toBe(0.5);
    expect(mi.quarterTone).toBe(true);
    expect(mi.across).toBe(0);
    expect(mi.along).toBeCloseTo(distanceForCents(600, 350) / 300, 6);
    expect(mi.zone[0]).toBeLessThan(mi.along);
    expect(mi.zone[1]).toBeGreaterThan(mi.along);
    // An octave sits at half the scale length: beyond a 300 mm board's end.
    expect(octave.along).toBe(1);
    expect(octave.zone[1]).toBe(1);
  });

  it("marks the tonic and its octave only when a maqam is shown", () => {
    expect(zandMarks(board(true)).map((m) => m.tonic)).toEqual([
      true,
      false,
      true,
    ]);
    expect(zandMarks(board(false)).some((m) => m.tonic)).toBe(false);
  });

  it("returns nothing for an unusable board", () => {
    expect(zandMarks({ ...board(false), fingerboardLengthMm: 0 })).toEqual([]);
  });
});

describe("zand geometry", () => {
  it("tapers towards the nut and runs nut to end left to right", () => {
    const nutSpan = zandPoint(0, 1).y - zandPoint(0, 0).y;
    const endSpan = zandPoint(1, 1).y - zandPoint(1, 0).y;
    expect(nutSpan / endSpan).toBeCloseTo(ZAND_VIEW.nutSpread, 6);
    expect(zandPoint(0, 0).x).toBe(ZAND_VIEW.left);
    expect(zandPoint(1, 0).x).toBe(ZAND_VIEW.right);
    expect(zandPoint(1, 0).y).toBe(ZAND_VIEW.top);
    expect(across(5, 6)).toBe(1);
  });

  it("classifies intonation with the coach's ±10-cent window", () => {
    expect(intonation(9.9)).toBe("inTune");
    expect(intonation(-12)).toBe("flat");
    expect(intonation(12)).toBe("sharp");
  });
});
