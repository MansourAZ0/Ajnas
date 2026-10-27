import { describe, expect, it } from "vitest";
import {
  homography,
  transformPoint,
  type Homography,
  type Point,
  type Quadrilateral,
} from "./geometry";
import {
  NeckTracker,
  fitSimilarity,
  goodFeatures,
  MIN_REFERENCE_POINTS,
  handBox,
  normalise,
  pyramid,
  trackPoints,
  type Gray,
} from "./neckTracker";

const W = 240;
const H = 150;

/** Smooth random texture with plenty of corners (blurred noise). */
function texture(seed: number): Gray {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  let data = new Float32Array(W * H).map(() => rnd() * 255);
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let sum = 0,
          n = 0;
        for (let v = -1; v <= 1; v++)
          for (let u = -1; u <= 1; u++) {
            const xx = Math.min(W - 1, Math.max(0, x + u));
            const yy = Math.min(H - 1, Math.max(0, y + v));
            sum += data[yy * W + xx];
            n++;
          }
        out[y * W + x] = sum / n;
      }
    data = out;
  }
  return { width: W, height: H, data };
}

function sample(g: Gray, x: number, y: number): number {
  if (x < 0 || y < 0 || x > W - 1.001 || y > H - 1.001) return 128;
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    fx = x - x0,
    fy = y - y0,
    i = y0 * W + x0;
  return (
    (g.data[i] * (1 - fx) + g.data[i + 1] * fx) * (1 - fy) +
    (g.data[i + W] * (1 - fx) + g.data[i + W + 1] * fx) * fy
  );
}

/** Image seen after the scene moved by `h` (reference pixels → new pixels). */
function warp(
  g: Gray,
  h: Homography,
  occlude?: { x0: number; y0: number; x1: number; y1: number },
): Gray {
  const back = homography(
    [0, 1, 2, 3].map((i) =>
      transformPoint(h, corner(i))!,
    ) as unknown as Quadrilateral,
    [0, 1, 2, 3].map(corner) as unknown as Quadrilateral,
  );
  const data = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (
        occlude &&
        x >= occlude.x0 &&
        x <= occlude.x1 &&
        y >= occlude.y0 &&
        y <= occlude.y1
      ) {
        data[y * W + x] = 200;
        continue;
      }
      const p = transformPoint(back, { x, y })!;
      data[y * W + x] = sample(g, p.x, p.y);
    }
  return { width: W, height: H, data };
}
const corner = (i: number): Point =>
  [
    { x: 10, y: 10 },
    { x: 230, y: 10 },
    { x: 230, y: 140 },
    { x: 10, y: 140 },
  ][i];

/** Rotation by `deg` about the image centre, scaling and translation, in pixels. */
function motion(
  deg: number,
  scale: number,
  tx: number,
  ty: number,
): Homography {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a) * scale,
    s = Math.sin(a) * scale;
  const cx = W / 2,
    cy = H / 2;
  return [
    c,
    -s,
    cx - c * cx + s * cy + tx,
    s,
    c,
    cy - s * cx - c * cy + ty,
    0,
    0,
    1,
  ];
}

// A neck across the middle of the frame (normalised): nut-low, nut-high, end-high, end-low.
const neck: Quadrilateral = [
  { x: 0.7, y: 0.35 },
  { x: 0.72, y: 0.5 },
  { x: 0.3, y: 0.62 },
  { x: 0.28, y: 0.45 },
];
const pixels = (q: readonly Point[]) =>
  q.map((p) => ({ x: p.x * W, y: p.y * H }));

describe("Lucas–Kanade", () => {
  it("follows a sub-pixel shift", () => {
    const a = texture(3);
    const b = warp(a, motion(0, 1, 3.3, -2.1));
    const levels = pyramid(a, 3);
    const points = goodFeatures(
      levels[0],
      30,
      8,
      (x, y) => x > 20 && y > 20 && x < W - 20 && y < H - 20,
    );
    expect(points.length).toBeGreaterThan(20);
    const moved = trackPoints(levels, pyramid(b, 3), points, null, 7);
    const errors = moved.map((p, i) =>
      Math.hypot(p!.x - points[i].x - 3.3, p!.y - points[i].y + 2.1),
    );
    errors.sort((x, y) => x - y);
    expect(errors[Math.floor(errors.length / 2)]).toBeLessThan(0.1);
  });
});

describe("RANSAC similarity", () => {
  it("recovers the motion despite 30% outliers", () => {
    const h = motion(4, 1.05, 6, -3);
    const src: Point[] = [];
    const dst: Point[] = [];
    for (let i = 0; i < 60; i++) {
      const p = { x: 20 + ((i * 37) % 200), y: 15 + ((i * 53) % 120) };
      src.push(p);
      dst.push(
        i % 10 < 3
          ? { x: (i * 71) % W, y: (i * 29) % H }
          : transformPoint(h, p)!,
      );
    }
    const fit = fitSimilarity(src, dst, 1, 12)!;
    expect(fit).not.toBeNull();
    expect(fit.inliers.filter(Boolean).length).toBe(42);
    const probe = transformPoint(fit.h, { x: 100, y: 70 })!;
    const truth = transformPoint(h, { x: 100, y: 70 })!;
    expect(Math.hypot(probe.x - truth.x, probe.y - truth.y)).toBeLessThan(0.01);
  });

  it("refuses when nothing agrees", () => {
    const src = Array.from({ length: 20 }, (_, i) => ({
      x: i * 7,
      y: (i * 13) % 50,
    }));
    const dst = Array.from({ length: 20 }, (_, i) => ({
      x: (i * 97) % 200,
      y: (i * 61) % 140,
    }));
    expect(fitSimilarity(src, dst, 0.5, 12)).toBeNull();
  });
});

describe("NeckTracker", () => {
  it("carries the calibration corners as the oud moves, with a hand over the neck", () => {
    const base = texture(11);
    const tracker = new NeckTracker();
    expect(tracker.setReference(base, neck)).toBeGreaterThan(30);
    let result = tracker.update(base);
    expect(result.status).toBe("tracking");
    let h: Homography = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let step = 1; step <= 6; step++) {
      h = motion(step * 0.8, 1 + step * 0.006, step * 1.6, -step * 0.9);
      // A "hand" covering part of the neck in later frames.
      const hand = step > 3 ? { x0: 130, y0: 50, x1: 175, y1: 110 } : undefined;
      result = tracker.update(
        warp(base, h, hand),
        hand ? [{ x0: 130 / W, y0: 50 / H, x1: 175 / W, y1: 110 / H }] : [],
      );
      expect(result.status).toBe("tracking");
    }
    const expected = pixels(neck).map((p) => transformPoint(h, p)!);
    const got = pixels(result.corners!);
    got.forEach((p, i) =>
      expect(Math.hypot(p.x - expected[i].x, p.y - expected[i].y)).toBeLessThan(
        0.6,
      ),
    );
    expect(result.moved).toBeGreaterThan(0.02);
  });

  it("keeps still corners exactly still", () => {
    const base = texture(5);
    const tracker = new NeckTracker();
    tracker.setReference(base, neck);
    const first = tracker.update(base).corners!;
    const again = tracker.update(base).corners!;
    expect(again).toEqual(first);
    expect(first[0].x).toBeCloseTo(neck[0].x, 6);
  });

  it("reports lost on an unrelated view, then re-finds the neck", () => {
    const base = texture(21);
    const tracker = new NeckTracker();
    tracker.setReference(base, neck);
    const other = texture(99);
    let result = tracker.update(other);
    for (let i = 0; i < 5; i++) result = tracker.update(other);
    expect(result.status).toBe("lost");
    expect(result.corners).toBeNull();
    result = tracker.update(warp(base, motion(0.5, 1, 2, 1)));
    expect(result.status).toBe("tracking");
    const expected = pixels(neck).map((p) =>
      transformPoint(motion(0.5, 1, 2, 1), p)!,
    );
    pixels(result.corners!).forEach((p, i) =>
      expect(Math.hypot(p.x - expected[i].x, p.y - expected[i].y)).toBeLessThan(
        0.6,
      ),
    );
  });
});

describe("exposure", () => {
  it("refuses a flat reference frame (camera still exposing) and keeps waiting", () => {
    const tracker = new NeckTracker();
    const dark: Gray = {
      width: W,
      height: H,
      data: new Float32Array(W * H).fill(3),
    };
    expect(normalise(dark)).toBeNull();
    expect(tracker.setReference(dark, neck)).toBeLessThan(MIN_REFERENCE_POINTS);
    expect(tracker.ready).toBe(false);
    expect(tracker.update(texture(4)).status).toBe("lost");
    expect(tracker.setReference(texture(4), neck)).toBeGreaterThanOrEqual(
      MIN_REFERENCE_POINTS,
    );
    expect(tracker.ready).toBe(true);
  });

  it("keeps following through a brightness and contrast change", () => {
    const base = texture(8);
    const tracker = new NeckTracker();
    tracker.setReference(base, neck);
    const h = motion(1, 1.01, 2.5, 1.5);
    const moved = warp(base, h);
    const darker: Gray = {
      ...moved,
      data: moved.data.map((v) => v * 0.45 + 12),
    };
    const result = tracker.update(darker);
    expect(result.status).toBe("tracking");
    const expected = pixels(neck).map((p) => transformPoint(h, p)!);
    pixels(result.corners!).forEach((p, i) =>
      expect(Math.hypot(p.x - expected[i].x, p.y - expected[i].y)).toBeLessThan(
        0.6,
      ),
    );
  });
});

describe("handBox", () => {
  it("widens the landmark bounds", () => {
    expect(
      handBox(
        [
          { x: 0.4, y: 0.4 },
          { x: 0.6, y: 0.5 },
        ],
        0.5,
      ),
    ).toMatchObject({
      x0: expect.closeTo(0.3, 9),
      y0: expect.closeTo(0.35, 9),
      x1: expect.closeTo(0.7, 9),
      y1: expect.closeTo(0.55, 9),
    });
    expect(handBox([])).toBeNull();
  });
});
