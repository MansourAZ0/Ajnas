import { describe, expect, it } from "vitest";
import {
  BOARD_CORNERS,
  fingerboardHomography,
  homography,
  projectFingertip,
  transformPoint,
  validateQuadrilateral,
  type Quadrilateral,
} from "./geometry";

const perspective: Quadrilateral = [
  { x: 0.12, y: 0.19 },
  { x: 0.18, y: 0.39 },
  { x: 0.9, y: 0.83 },
  { x: 0.79, y: 0.15 },
];

describe("fingerboard perspective geometry", () => {
  it("maps physical corners in explicit nut-low, nut-high, end-high, end-low order", () => {
    const h = fingerboardHomography(perspective);
    perspective.forEach((point, i) => {
      expect(transformPoint(h, point)?.x).toBeCloseTo(BOARD_CORNERS[i].x, 8);
      expect(transformPoint(h, point)?.y).toBeCloseTo(BOARD_CORNERS[i].y, 8);
    });
  });
  it("recovers an interior position through strong perspective, not bilinear interpolation", () => {
    const intoImage = homography(BOARD_CORNERS, perspective);
    const pixel = transformPoint(intoImage, { x: 0.63, y: 0.4 })!;
    const result = projectFingertip(
      fingerboardHomography(perspective),
      pixel,
      320,
      6,
    )!;
    expect(result.distanceMm).toBeCloseTo(201.6, 7);
    expect(result.course).toBe(2);
    expect(result.across).toBeCloseTo(0.4, 8);
  });
  it("supports either camera orientation while preserving pitch-course labels", () => {
    const mirrored = perspective.map((p) => ({
      x: 1 - p.x,
      y: p.y,
    })) as unknown as Quadrilateral;
    expect(validateQuadrilateral(mirrored)).toBeNull();
    const h = fingerboardHomography(mirrored);
    expect(projectFingertip(h, mirrored[0], 320, 6)?.course).toBe(0);
    expect(projectFingertip(h, mirrored[1], 320, 6)?.course).toBe(5);
  });
  it("does not assign the midpoint between courses or points outside the board", () => {
    expect(
      projectFingertip(
        fingerboardHomography(BOARD_CORNERS),
        { x: 0.5, y: 0.1 },
        320,
        6,
      )?.course,
    ).toBeNull();
    expect(
      projectFingertip(
        fingerboardHomography(BOARD_CORNERS),
        { x: 1.1, y: 0.5 },
        320,
        6,
      ),
    ).toBeNull();
    expect(
      projectFingertip(
        fingerboardHomography(BOARD_CORNERS),
        { x: 0.5, y: 0 },
        NaN,
        6,
      ),
    ).toBeNull();
  });
  it("rejects crossed, concave, tiny, collinear and non-finite calibrations", () => {
    for (const points of [
      [],
      [perspective[0], perspective[2], perspective[1], perspective[3]],
      [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 0.2, y: 0.2 },
        { x: 1, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 0.001, y: 0 },
        { x: 0.001, y: 0.001 },
        { x: 0, y: 0.001 },
      ],
      [
        { x: 0, y: 0 },
        { x: 0.3, y: 0.3 },
        { x: 0.6, y: 0.6 },
        { x: 1, y: 1 },
      ],
      [{ x: NaN, y: 0 }, ...perspective.slice(1)],
      [{ x: 2, y: 0 }, ...perspective.slice(1)],
    ]) {
      expect(validateQuadrilateral(points)).not.toBeNull();
    }
    expect(() =>
      homography(
        [perspective[0], perspective[0], perspective[0], perspective[0]],
        BOARD_CORNERS,
      ),
    ).toThrow();
  });
});
