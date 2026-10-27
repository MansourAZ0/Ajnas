/**
 * Follows the calibrated oud neck from frame to frame, so the calibration
 * keeps fitting when the oud or the camera moves. Pure computation (no DOM,
 * no ML): it runs in src/vision/neckWorker.ts on small greyscale frames.
 *
 * Method: Shi–Tomasi corners on and around the neck (pegbox, nut, body edge,
 * rosette), excluding the hands; pyramidal Lucas–Kanade optical flow from
 * frame to frame; a RANSAC similarity transform (shift, rotation, scale) from
 * each point's position in the reference frame to its current position; the
 * four calibration corners are carried by that transform. Fitting reference → current (rather than chaining
 * frame-to-frame steps) keeps errors from compounding. When too few points
 * agree the neck is "lost"; each later frame then tries to re-find the
 * reference points around the last good pose.
 */
import {
  homography,
  transformPoint,
  type Homography,
  type Point,
  type Quadrilateral,
} from "./geometry";

export interface Gray {
  width: number;
  height: number;
  data: Float32Array;
}
/** Normalised image rectangle (0–1), e.g. around a hand. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export type NeckStatus = "tracking" | "lost";
export interface NeckResult {
  status: NeckStatus;
  /** Current calibration corners (normalised), or null while lost. */
  corners: Quadrilateral | null;
  /** Points agreeing with the fitted motion. */
  inliers: number;
  /** Points followed this frame. */
  points: number;
  /** Largest corner displacement from the calibrated position, normalised to the image width. */
  moved: number;
}

export interface NeckTrackerOptions {
  /** Target number of followed points. */
  maxPoints: number;
  /** Minimum distance between points, in analysis pixels. */
  minDistance: number;
  /** Pyramid levels above the full analysis image. */
  levels: number;
  /** Half-size of the Lucas–Kanade window, in pixels. */
  window: number;
  /** RANSAC inlier threshold, in analysis pixels. */
  threshold: number;
  /** Fewest agreeing points that count as a fit. */
  minInliers: number;
  /** Consecutive failed frames before the neck counts as lost. */
  lostAfter: number;
  /** Corner movement below this (analysis pixels) is treated as noise. */
  deadBand: number;
}

export const DEFAULT_NECK_OPTIONS: NeckTrackerOptions = {
  maxPoints: 90,
  minDistance: 7,
  levels: 3,
  window: 7,
  threshold: 1.5,
  minInliers: 12,
  lostAfter: 4,
  deadBand: 0.35,
};

/** Board-coordinate region searched for points: beyond the nut and the end, and either side. */
const REGION = { along: [-0.3, 1.2], across: [-0.45, 1.45] } as const;

export function grayFromRGBA(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): Gray {
  const data = new Float32Array(width * height);
  for (let i = 0, j = 0; i < data.length; i++, j += 4)
    data[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return { width, height, data };
}

/** Below this standard deviation (grey levels) a frame is too flat to use, e.g. a camera still exposing. */
export const MIN_CONTRAST = 6;
/** A reference with fewer points is refused; the next frame is tried instead. */
export const MIN_REFERENCE_POINTS = 24;

/**
 * Zero-mean, fixed-contrast copy, so exposure changes (auto-exposure, a
 * fade, a lamp) do not break brightness matching. Null for a flat frame.
 */
export function normalise(g: Gray): Gray | null {
  const n = g.data.length;
  let sum = 0,
    squares = 0;
  for (let i = 0; i < n; i++) {
    sum += g.data[i];
    squares += g.data[i] * g.data[i];
  }
  const mean = sum / n;
  const deviation = Math.sqrt(Math.max(0, squares / n - mean * mean));
  if (!(deviation >= MIN_CONTRAST)) return null;
  const scale = 50 / deviation;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = 128 + (g.data[i] - mean) * scale;
  return { width: g.width, height: g.height, data };
}

function downsample(g: Gray): Gray {
  const width = g.width >> 1;
  const height = g.height >> 1;
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = 2 * y * g.width + 2 * x;
      data[y * width + x] =
        (g.data[i] +
          g.data[i + 1] +
          g.data[i + g.width] +
          g.data[i + g.width + 1]) /
        4;
    }
  return { width, height, data };
}

/** Image, horizontal and vertical gradient per pyramid level. */
interface Level {
  image: Gray;
  dx: Float32Array;
  dy: Float32Array;
}

export function pyramid(g: Gray, levels: number): Level[] {
  const out: Level[] = [];
  let image = g;
  for (let l = 0; l <= levels && image.width >= 16 && image.height >= 16; l++) {
    const { width, height, data } = image;
    const dx = new Float32Array(width * height);
    const dy = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        dx[i] = (data[i + 1] - data[i - 1]) / 2;
        dy[i] = (data[i + width] - data[i - width]) / 2;
      }
    out.push({ image, dx, dy });
    image = downsample(image);
  }
  return out;
}

function bilinear(
  data: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const cx = Math.min(width - 1.001, Math.max(0, x));
  const cy = Math.min(height - 1.001, Math.max(0, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const fx = cx - x0;
  const fy = cy - y0;
  const i = y0 * width + x0;
  return (
    (data[i] * (1 - fx) + data[i + 1] * fx) * (1 - fy) +
    (data[i + width] * (1 - fx) + data[i + width + 1] * fx) * fy
  );
}

/**
 * Shi–Tomasi features: the smaller eigenvalue of the 5×5 structure tensor,
 * strongest first, at least `minDistance` apart, where `accept(x, y)` holds.
 */
export function goodFeatures(
  level: Level,
  maxPoints: number,
  minDistance: number,
  accept: (x: number, y: number) => boolean,
  avoid: readonly Point[] = [],
): Point[] {
  const { width, height } = level.image;
  const { dx, dy } = level;
  const xx = new Float32Array(width * height);
  const yy = new Float32Array(width * height);
  const xy = new Float32Array(width * height);
  for (let i = 0; i < xx.length; i++) {
    xx[i] = dx[i] * dx[i];
    yy[i] = dy[i] * dy[i];
    xy[i] = dx[i] * dy[i];
  }
  const r = 2;
  const candidates: { x: number; y: number; score: number }[] = [];
  let best = 0;
  for (let y = r + 2; y < height - r - 2; y += 1)
    for (let x = r + 2; x < width - r - 2; x += 1) {
      if (!accept(x, y)) continue;
      let a = 0,
        b = 0,
        c = 0;
      for (let v = -r; v <= r; v++)
        for (let u = -r; u <= r; u++) {
          const i = (y + v) * width + x + u;
          a += xx[i];
          b += xy[i];
          c += yy[i];
        }
      const score = (a + c) / 2 - Math.sqrt(((a - c) / 2) ** 2 + b * b);
      if (score > best) best = score;
      if (score > 0) candidates.push({ x, y, score });
    }
  const floor = Math.max(best * 0.02, 1e-3);
  candidates.sort((p, q) => q.score - p.score);
  const cell = Math.max(1, minDistance);
  const columns = Math.ceil(width / cell) + 1;
  const taken = new Map<number, Point[]>();
  const near = (p: Point) => {
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    for (let j = cy - 1; j <= cy + 1; j++)
      for (let i = cx - 1; i <= cx + 1; i++)
        for (const q of taken.get(j * columns + i) ?? [])
          if (Math.hypot(q.x - p.x, q.y - p.y) < minDistance) return true;
    return false;
  };
  const take = (p: Point) => {
    const key = Math.floor(p.y / cell) * columns + Math.floor(p.x / cell);
    taken.set(key, [...(taken.get(key) ?? []), p]);
  };
  avoid.forEach(take);
  const out: Point[] = [];
  for (const c of candidates) {
    if (c.score < floor || out.length >= maxPoints) break;
    if (near(c)) continue;
    take(c);
    out.push({ x: c.x, y: c.y });
  }
  return out;
}

/**
 * Pyramidal Lucas–Kanade (Bouguet). `guesses` are optional predicted
 * positions in `next`. Returns null for points that cannot be followed.
 */
export function trackPoints(
  previous: Level[],
  next: Level[],
  points: readonly Point[],
  guesses: readonly Point[] | null,
  half: number,
): (Point | null)[] {
  const levels = Math.min(previous.length, next.length);
  return points.map((point, index) => {
    const guess = guesses?.[index] ?? point;
    let gx = (guess.x - point.x) / 2 ** (levels - 1);
    let gy = (guess.y - point.y) / 2 ** (levels - 1);
    for (let l = levels - 1; l >= 0; l--) {
      const scale = 2 ** l;
      const px = point.x / scale;
      const py = point.y / scale;
      const a = previous[l];
      const b = next[l];
      const { width, height } = a.image;
      if (px < 1 || py < 1 || px > width - 2 || py > height - 2) return null;
      let gxx = 0,
        gxy = 0,
        gyy = 0;
      const samples: number[] = [];
      for (let v = -half; v <= half; v++)
        for (let u = -half; u <= half; u++) {
          const ix = bilinear(a.dx, width, height, px + u, py + v);
          const iy = bilinear(a.dy, width, height, px + u, py + v);
          gxx += ix * ix;
          gxy += ix * iy;
          gyy += iy * iy;
          samples.push(
            bilinear(a.image.data, width, height, px + u, py + v),
            ix,
            iy,
          );
        }
      const det = gxx * gyy - gxy * gxy;
      const minEig =
        (gxx + gyy) / 2 - Math.sqrt(((gxx - gyy) / 2) ** 2 + gxy * gxy);
      if (det < 1e-6 || minEig / (2 * half + 1) ** 2 < 1e-3) return null;
      let dx = 0,
        dy = 0;
      for (let k = 0; k < 20; k++) {
        let bx = 0,
          by = 0,
          s = 0;
        for (let v = -half; v <= half; v++)
          for (let u = -half; u <= half; u++, s += 3) {
            const diff =
              samples[s] -
              bilinear(
                b.image.data,
                width,
                height,
                px + u + gx + dx,
                py + v + gy + dy,
              );
            bx += diff * samples[s + 1];
            by += diff * samples[s + 2];
          }
        const ex = (gyy * bx - gxy * by) / det;
        const ey = (gxx * by - gxy * bx) / det;
        dx += ex;
        dy += ey;
        if (ex * ex + ey * ey < 1e-4) break;
      }
      if (l > 0) {
        gx = 2 * (gx + dx);
        gy = 2 * (gy + dy);
      } else {
        gx += dx;
        gy += dy;
      }
    }
    const x = point.x + gx;
    const y = point.y + gy;
    const { width, height } = previous[0].image;
    return Number.isFinite(x) &&
      Number.isFinite(y) &&
      x >= 0 &&
      y >= 0 &&
      x < width &&
      y < height
      ? { x, y }
      : null;
  });
}

/** Deterministic generator, so tracking is reproducible. */
function random(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * Least-squares similarity (rotation, uniform scale, translation) mapping
 * `src` onto `dst`, as a homography. Null for coincident points.
 */
function leastSquaresSimilarity(
  src: readonly Point[],
  dst: readonly Point[],
): Homography | null {
  const n = src.length;
  let sx = 0,
    sy = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < n; i++) {
    sx += src[i].x;
    sy += src[i].y;
    dx += dst[i].x;
    dy += dst[i].y;
  }
  sx /= n;
  sy /= n;
  dx /= n;
  dy /= n;
  let norm = 0,
    ra = 0,
    rb = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i].x - sx;
    const y = src[i].y - sy;
    const u = dst[i].x - dx;
    const v = dst[i].y - dy;
    norm += x * x + y * y;
    ra += x * u + y * v;
    rb += x * v - y * u;
  }
  if (norm < 1e-9) return null;
  const a = ra / norm;
  const b = rb / norm;
  return [a, -b, dx - a * sx + b * sy, b, a, dy - b * sx - a * sy, 0, 0, 1];
}

/**
 * RANSAC similarity from `src` to `dst`; null when no motion fits enough
 * pairs. An oud moves in the image almost rigidly (shift, rotation, a little
 * scale). A full homography would be ill-conditioned when the visible points
 * cluster between the hands and extrapolate badly to the neck's corners.
 */
export function fitSimilarity(
  src: readonly Point[],
  dst: readonly Point[],
  threshold: number,
  minInliers: number,
  iterations = 100,
): { h: Homography; inliers: boolean[] } | null {
  const n = src.length;
  if (n < Math.max(2, minInliers)) return null;
  const next = random(n * 7919 + 17);
  const count = (h: Homography) => {
    const inliers = src.map((p, i) => {
      const q = transformPoint(h, p);
      return !!q && Math.hypot(q.x - dst[i].x, q.y - dst[i].y) <= threshold;
    });
    return { inliers, total: inliers.filter(Boolean).length };
  };
  let best: { h: Homography; inliers: boolean[]; total: number } | null = null;
  for (let k = 0; k < iterations; k++) {
    const i = Math.floor(next() * n);
    const j = Math.floor(next() * n);
    if (i === j) continue;
    const h = leastSquaresSimilarity([src[i], src[j]], [dst[i], dst[j]]);
    if (!h) continue;
    const c = count(h);
    if (!best || c.total > best.total) best = { h, ...c };
    if (best.total > 0.9 * n) break;
  }
  if (!best || best.total < minInliers) return null;
  // Refine on all inliers, twice (the inlier set can grow).
  for (let pass = 0; pass < 2; pass++) {
    const keep = best.inliers
      .map((ok, i) => (ok ? i : -1))
      .filter((i) => i >= 0);
    const refined = leastSquaresSimilarity(
      keep.map((i) => src[i]),
      keep.map((i) => dst[i]),
    );
    if (!refined) break;
    const c = count(refined);
    if (c.total < best.total) break;
    best = { h: refined, ...c };
  }
  return best.total >= minInliers ? { h: best.h, inliers: best.inliers } : null;
}

function insideConvex(
  polygon: readonly Point[],
  x: number,
  y: number,
): boolean {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/** 3×3 product `a · b` (apply `b`, then `a`). */
function compose(a: Homography, b: Homography): Homography {
  const out: number[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      out.push(
        a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c],
      );
  return out.map((v) => v / out[8]);
}

const IDENTITY: Homography = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** A frame whose points every later frame is matched against directly. */
interface Keyframe {
  levels: Level[];
  points: Point[];
  /** Reference → this keyframe. */
  pose: Homography;
}

export class NeckTracker {
  private options: NeckTrackerOptions;
  private key: Keyframe | null = null;
  /** Calibration corners in reference analysis pixels. */
  private referenceCorners: Point[] = [];
  private size = { width: 1, height: 1 };
  /** Keyframe → latest frame: the prediction for the next one. */
  private motion: Homography = IDENTITY;
  private shown: Point[] = [];
  private failures = 0;
  private status: NeckStatus = "lost";

  constructor(options: Partial<NeckTrackerOptions> = {}) {
    this.options = { ...DEFAULT_NECK_OPTIONS, ...options };
  }

  get ready(): boolean {
    return this.key !== null;
  }

  reset() {
    this.key = null;
    this.status = "lost";
  }

  /**
   * Starts following from this frame, where `corners` (normalised) are
   * correct. Returns the number of points found; below MIN_REFERENCE_POINTS
   * the frame is refused (nothing changes) and the caller should retry.
   */
  setReference(
    input: Gray,
    corners: Quadrilateral,
    exclude: readonly Box[] = [],
  ): number {
    const frame = normalise(input);
    if (!frame) return 0;
    const previous = {
      key: this.key,
      corners: this.referenceCorners,
      size: this.size,
    };
    this.size = { width: frame.width, height: frame.height };
    this.referenceCorners = corners.map((p) => ({
      x: p.x * frame.width,
      y: p.y * frame.height,
    }));
    this.shown = this.referenceCorners;
    this.failures = 0;
    this.status = "tracking";
    this.key = this.keyframe(
      pyramid(frame, this.options.levels),
      IDENTITY,
      exclude,
    );
    const found = this.key.points.length;
    if (found < MIN_REFERENCE_POINTS) {
      this.key = previous.key;
      this.referenceCorners = previous.corners;
      this.size = previous.size;
      this.shown = previous.corners;
      this.status = previous.key ? this.status : "lost";
    }
    return found;
  }

  /**
   * Matches the keyframe's points directly in this frame, so errors do not
   * accumulate from frame to frame (points on strings could otherwise creep
   * along them). A new keyframe is taken only when too few points still match.
   */
  update(input: Gray, exclude: readonly Box[] = []): NeckResult {
    const key = this.key;
    if (!key) return this.result(0, 0);
    const frame = normalise(input);
    if (!frame) {
      if (++this.failures >= this.options.lostAfter) this.status = "lost";
      return this.result(0, 0);
    }
    const levels = pyramid(frame, this.options.levels);
    const { window, threshold, minInliers } = this.options;
    const guesses = key.points.map((p) => transformPoint(this.motion, p) ?? p);
    const found = trackPoints(key.levels, levels, key.points, guesses, window);
    const pairs = key.points
      .map((from, i) => ({ from, to: found[i] }))
      .filter(
        (pair): pair is { from: Point; to: Point } =>
          !!pair.to && !this.excluded(pair.to, frame, exclude),
      );
    const fit = fitSimilarity(
      pairs.map((p) => p.from),
      pairs.map((p) => p.to),
      threshold,
      minInliers,
    );
    if (!fit) {
      if (++this.failures >= this.options.lostAfter) this.status = "lost";
      return this.result(0, pairs.length);
    }
    this.failures = 0;
    this.status = "tracking";
    this.motion = fit.h;
    const pose = compose(fit.h, key.pose);
    const inliers = fit.inliers.filter(Boolean).length;
    // The view has changed too much for the keyframe: start a new one here.
    if (inliers < key.points.length * 0.45) {
      this.key = this.keyframe(levels, pose, exclude);
      this.motion = IDENTITY;
    }
    const corners = this.referenceCorners.map(
      (p) => transformPoint(pose, p) ?? p,
    );
    const still = corners.every(
      (p, i) =>
        Math.hypot(p.x - this.shown[i].x, p.y - this.shown[i].y) <
        this.options.deadBand,
    );
    if (!still) this.shown = corners;
    return this.result(inliers, pairs.length);
  }

  private keyframe(
    levels: Level[],
    pose: Homography,
    exclude: readonly Box[],
  ): Keyframe {
    return { levels, pose, points: this.detect(levels[0], pose, exclude) };
  }

  private result(inliers: number, points: number): NeckResult {
    const { width, height } = this.size;
    const corners =
      this.status === "tracking"
        ? (this.shown.map((p) => ({
            x: p.x / width,
            y: p.y / height,
          })) as unknown as Quadrilateral)
        : null;
    const moved = this.referenceCorners.reduce(
      (max, p, i) =>
        Math.max(
          max,
          this.shown[i]
            ? Math.hypot(this.shown[i].x - p.x, this.shown[i].y - p.y) / width
            : 0,
        ),
      0,
    );
    return { status: this.status, corners, inliers, points, moved };
  }

  /**
   * Inside a hand box, widened by the tracking window: a point whose window
   * overlaps the hand's edge follows the hand, not the neck.
   */
  private excluded(p: Point, frame: Gray, exclude: readonly Box[]): boolean {
    const padX = (this.options.window + 2) / frame.width;
    const padY = (this.options.window + 2) / frame.height;
    const x = p.x / frame.width;
    const y = p.y / frame.height;
    return exclude.some(
      (b) =>
        x >= b.x0 - padX &&
        x <= b.x1 + padX &&
        y >= b.y0 - padY &&
        y <= b.y1 + padY,
    );
  }

  /** Neck region under `pose` (reference → image), as an image polygon. */
  private region(pose: Homography): Point[] | null {
    const [nutLow, nutHigh, endHigh, endLow] = this.referenceCorners;
    let toImage: Homography;
    try {
      toImage = homography(
        [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
          { x: 1, y: 1 },
          { x: 1, y: 0 },
        ],
        [nutLow, nutHigh, endHigh, endLow],
      );
    } catch {
      return null;
    }
    const [a0, a1] = REGION.along;
    const [c0, c1] = REGION.across;
    const corners = [
      { x: a0, y: c0 },
      { x: a0, y: c1 },
      { x: a1, y: c1 },
      { x: a1, y: c0 },
    ].map((p) => {
      const inReference = transformPoint(toImage, p);
      return inReference && transformPoint(pose, inReference);
    });
    return corners.every(Boolean) ? (corners as Point[]) : null;
  }

  private detect(
    level: Level,
    pose: Homography,
    exclude: readonly Box[],
  ): Point[] {
    const polygon = this.region(pose);
    if (!polygon) return [];
    return goodFeatures(
      level,
      this.options.maxPoints,
      this.options.minDistance,
      (x, y) =>
        insideConvex(polygon, x, y) &&
        !this.excluded({ x, y }, level.image, exclude),
    );
  }
}

/** Normalised box around a hand's landmarks, widened by `margin` of its size. */
export function handBox(
  landmarks: readonly Point[],
  margin = 0.05,
): Box | null {
  if (!landmarks.length) return null;
  const xs = landmarks.map((p) => p.x);
  const ys = landmarks.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const mx = (x1 - x0) * margin;
  const my = (y1 - y0) * margin;
  return { x0: x0 - mx, y0: y0 - my, x1: x1 + mx, y1: y1 + my };
}
