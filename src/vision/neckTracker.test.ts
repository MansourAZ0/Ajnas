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
  describe as describePoints,
  fitSimilarity,
  matchDescriptors,
  patchAgreement,
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

describe("appearance matching", () => {
  it("matches corners of a view turned by 30° and shifted", () => {
    const a = texture(31);
    const h = motion(30, 1, 12, -6);
    const b = warp(a, h);
    const inside = (x: number, y: number) =>
      x > 45 && y > 40 && x < W - 45 && y < H - 40;
    const from = describePoints(
      a,
      goodFeatures(pyramid(a, 0)[0], 60, 6, inside),
    );
    const to = describePoints(
      b,
      goodFeatures(
        pyramid(b, 0)[0],
        300,
        4,
        (x, y) => x > 20 && y > 20 && x < W - 20 && y < H - 20,
      ),
    );
    const matches = matchDescriptors(from, to);
    const right = matches.filter((m) => {
      const q = transformPoint(h, m.from)!;
      return Math.hypot(q.x - m.to.x, q.y - m.to.y) < 2;
    });
    expect(matches.length).toBeGreaterThan(15);
    expect(right.length / matches.length).toBeGreaterThan(0.7);
  });

  it("compares patches under the claimed motion", () => {
    const a = texture(31);
    const h = motion(20, 1.05, 8, 5);
    const b = warp(a, h);
    const points = goodFeatures(
      pyramid(a, 0)[0],
      50,
      6,
      (x, y) => x > 50 && y > 45 && x < W - 50 && y < H - 45,
    );
    const right = patchAgreement(a, b, points, h);
    expect(right.agree).toBeGreaterThan(0.9 * right.compared);
    const wrong = patchAgreement(a, b, points, motion(20, 1.05, 20, 5));
    expect(wrong.agree).toBeLessThan(0.2 * wrong.compared);
  });
});

describe("re-finding a lost neck", () => {
  const errors = (corners: readonly Point[], h: Homography) =>
    pixels(corners).map((p, i) => {
      const expected = transformPoint(h, pixels(neck)[i])!;
      return Math.hypot(p.x - expected.x, p.y - expected.y);
    });

  it("finds the neck again far from where it was, turned", () => {
    const base = texture(21);
    const tracker = new NeckTracker();
    tracker.setReference(base, neck);
    expect(tracker.update(base).status).toBe("tracking");
    // Out of view for a while ...
    const other = texture(99);
    let result = tracker.update(other);
    for (let i = 0; i < 6; i++) result = tracker.update(other);
    expect(result.status).toBe("lost");
    // ... and back 30 pixels away, turned by 25°: beyond optical flow.
    const h = motion(25, 1, 26, -14);
    const moved = warp(base, h);
    result = tracker.update(moved);
    expect(result.status).toBe("tracking");
    expect(Math.max(...errors(result.corners!, h))).toBeLessThan(2.5);
    // Following continues from there.
    const next = motion(26, 1, 27.5, -13);
    result = tracker.update(warp(base, next));
    expect(result.status).toBe("tracking");
    expect(Math.max(...errors(result.corners!, next))).toBeLessThan(2.5);
  });

  it("recovers from a sudden jump without ever reporting lost", () => {
    const base = texture(7);
    const tracker = new NeckTracker();
    tracker.setReference(base, neck);
    const h = motion(-18, 1, -28, 12);
    const moved = warp(base, h);
    const statuses: string[] = [];
    let result = tracker.update(moved);
    statuses.push(result.status);
    for (let i = 0; i < 3 && result.inliers === 0; i++) {
      result = tracker.update(moved);
      statuses.push(result.status);
    }
    expect(statuses).not.toContain("lost");
    expect(result.inliers).toBeGreaterThan(0);
    expect(Math.max(...errors(result.corners!, h))).toBeLessThan(2.5);
  });

  it("does not find the neck in a different scene", () => {
    const tracker = new NeckTracker();
    tracker.setReference(texture(21), neck);
    for (const seed of [99, 100, 101, 102, 103, 104, 105, 106]) {
      const result = tracker.update(texture(seed));
      expect(result.inliers).toBe(0);
    }
    expect(tracker.update(texture(107)).status).toBe("lost");
  });

  it("still finds the neck after a long absence, within a few frames", () => {
    const base = texture(21);
    const tracker = new NeckTracker();
    tracker.setReference(base, neck);
    const other = texture(99);
    for (let i = 0; i < 45; i++) tracker.update(other);
    const h = motion(25, 1, 26, -14);
    const moved = warp(base, h);
    let result = tracker.update(moved);
    let frames = 1;
    for (; frames < 4 && result.status !== "tracking"; frames++)
      result = tracker.update(moved);
    expect(result.status).toBe("tracking");
    expect(Math.max(...errors(result.corners!, h))).toBeLessThan(2.5);
  });

  it("does not accept the neck upside down", () => {
    const base = texture(21);
    const tracker = new NeckTracker();
    tracker.setReference(base, neck);
    // Found readily without the rule: the descriptors follow any rotation.
    const flipped = warp(base, motion(150, 1, 0, 0));
    let result = tracker.update(flipped);
    for (let i = 0; i < 6; i++) result = tracker.update(flipped);
    expect(result.status).toBe("lost");
  });

  it("can be switched off", () => {
    const base = texture(21);
    const tracker = new NeckTracker({ refindAfter: 0 });
    tracker.setReference(base, neck);
    const moved = warp(base, motion(25, 1, 26, -14));
    let result = tracker.update(moved);
    for (let i = 0; i < 5; i++) result = tracker.update(moved);
    expect(result.status).toBe("lost");
  });
});

describe("anchoring to the reference", () => {
  it("returns to the original frame, shedding the error of later keyframes", () => {
    const base = texture(13);
    const run = (anchorEvery: number) => {
      const tracker = new NeckTracker({ anchorEvery });
      tracker.setReference(base, neck);
      let result = tracker.update(base);
      // Turn away far enough to need new keyframes, then come back.
      const path = [
        ...Array.from({ length: 16 }, (_, i) => i + 1),
        ...Array.from({ length: 16 }, (_, i) => 15 - i),
      ];
      for (const step of path) {
        result = tracker.update(
          warp(
            base,
            motion(step * 1.6, 1 + step * 0.004, step * 1.2, -step * 0.7),
          ),
        );
        expect(result.status).toBe("tracking");
      }
      result = tracker.update(base);
      return Math.max(
        ...pixels(result.corners!).map((p, i) =>
          Math.hypot(p.x - pixels(neck)[i].x, p.y - pixels(neck)[i].y),
        ),
      );
    };
    const anchored = run(1);
    expect(anchored).toBeLessThan(0.15);
    expect(anchored).toBeLessThanOrEqual(run(0) + 1e-9);
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
