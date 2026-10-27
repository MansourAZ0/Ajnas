import { describe, expect, it } from "vitest";
import type { NoteLabel } from "@naghma/ui";
import type { ZandMark } from "../lib/zand";
import {
  fingerboardHomography,
  projectFingertip,
  type Quadrilateral,
} from "./geometry";
import { imageFromBoard, zandOverlayShapes } from "./zandOverlay";

// Perspective view: nut-low, nut-high, end-high, end-low.
const corners: Quadrilateral = [
  { x: 0.82, y: 0.3 },
  { x: 0.86, y: 0.42 },
  { x: 0.3, y: 0.62 },
  { x: 0.24, y: 0.45 },
];
const label = { text: "x", accidentalQuarterTones: 0 } as NoteLabel;
const mark = (
  key: string,
  along: number,
  across: number,
  extra: Partial<ZandMark> = {},
): ZandMark => ({
  key,
  targetId: key,
  course: Math.round(across * 5),
  distanceMm: along * 300,
  along,
  across,
  zone: [along - 0.01, along + 0.012],
  label,
  quarterTone: false,
  tonic: false,
  open: false,
  ...extra,
});

describe("zand overlay", () => {
  const map = imageFromBoard(corners);

  it("maps board corners back onto the marked image corners", () => {
    const { strings } = zandOverlayShapes(map, [], 6, null);
    expect(strings).toHaveLength(6);
    expect(strings[0][0].x).toBeCloseTo(corners[0].x, 9);
    expect(strings[0][0].y).toBeCloseTo(corners[0].y, 9);
    expect(strings[5][1].x).toBeCloseTo(corners[2].x, 9);
    expect(strings[5][1].y).toBeCloseTo(corners[2].y, 9);
  });

  it("is the inverse of fingertip projection", () => {
    const { labels } = zandOverlayShapes(
      map,
      [mark("a", 0.4, 0.6, { tonic: true })],
      6,
      null,
    );
    const back = projectFingertip(
      fingerboardHomography(corners),
      labels[0].point,
      300,
      6,
    );
    expect(back?.distanceMm).toBeCloseTo(120, 6);
    expect(back?.course).toBe(3);
  });

  it("draws zones for stopped positions, a ring and labels for the target, else tonic labels", () => {
    const shapes = zandOverlayShapes(
      map,
      [
        mark("open", 0, 0.2, { open: true }),
        mark("plain", 0.3, 0.4),
        mark("tonic", 0.5, 0.6, { tonic: true }),
        mark("target", 0.7, 0.8),
      ],
      6,
      "target",
    );
    expect(shapes.zones).toHaveLength(3);
    expect(shapes.zones.every((z) => z.points.length === 4)).toBe(true);
    expect(shapes.rings).toHaveLength(1);
    expect(shapes.labels.map((l) => l.mark.key)).toEqual(["target"]);
    const none = zandOverlayShapes(
      map,
      [
        mark("open", 0, 0.2, { open: true, tonic: true }),
        mark("tonic", 0.5, 0.6, { tonic: true }),
      ],
      6,
      null,
    );
    expect(none.labels.map((l) => l.mark.key)).toEqual(["tonic"]);
  });
});
