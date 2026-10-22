export interface Point {
  x: number;
  y: number;
}
/** Nut-low, nut-high, end-high, end-low. Low/high refer to pitch, not screen position. */
export type Quadrilateral = readonly [Point, Point, Point, Point];
export type Homography = readonly number[];

const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);

export function validateQuadrilateral(points: readonly Point[]): string | null {
  if (points.length !== 4) return "Mark all four corners.";
  if (
    points.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.x > 1 ||
        p.y < 0 ||
        p.y > 1,
    )
  )
    return "Corners must be inside the image.";
  const turns = points.map((p, i) =>
    cross(p, points[(i + 1) % 4], points[(i + 2) % 4]),
  );
  if (!turns.every((t) => t > 1e-5) && !turns.every((t) => t < -1e-5)) {
    return "Corners must form a convex boundary in the requested order.";
  }
  if (
    points.some(
      (p, i) =>
        Math.hypot(p.x - points[(i + 1) % 4].x, p.y - points[(i + 1) % 4].y) <
        0.01,
    )
  )
    return "Corners are too close together.";
  const area =
    Math.abs(
      points.reduce(
        (sum, p, i) =>
          sum + p.x * points[(i + 1) % 4].y - points[(i + 1) % 4].x * p.y,
        0,
      ),
    ) / 2;
  return area < 0.001 ? "Fingerboard is too small in the image." : null;
}

/** Solve the 8-parameter projective map, using partial pivoting. No DOM or ML dependency. */
export function homography(from: Quadrilateral, to: Quadrilateral): Homography {
  const matrix: number[][] = [];
  from.forEach(({ x, y }, i) => {
    const { x: u, y: v } = to[i];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col]))
        pivot = row;
    }
    if (Math.abs(matrix[pivot][col]) < 1e-10)
      throw new Error("Degenerate calibration.");
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    const divisor = matrix[col][col];
    for (let j = col; j < 9; j++) matrix[col][j] /= divisor;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = matrix[row][col];
      for (let j = col; j < 9; j++) matrix[row][j] -= factor * matrix[col][j];
    }
  }
  return [...matrix.map((row) => row[8]), 1];
}

export function transformPoint(h: Homography, { x, y }: Point): Point | null {
  const w = h[6] * x + h[7] * y + h[8];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-10) return null;
  const point = {
    x: (h[0] * x + h[1] * y + h[2]) / w,
    y: (h[3] * x + h[4] * y + h[5]) / w,
  };
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

export const BOARD_CORNERS: Quadrilateral = [
  { x: 0, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: 0 },
];

export function fingerboardHomography(corners: Quadrilateral): Homography {
  const error = validateQuadrilateral(corners);
  if (error) throw new Error(error);
  return homography(corners, BOARD_CORNERS);
}

export interface ProjectedPosition {
  /** Zero-based, lowest-pitched course first. */
  course: number | null;
  distanceMm: number;
  across: number;
}

export function projectFingertip(
  h: Homography,
  point: Point,
  lengthMm: number,
  courses: number,
): ProjectedPosition | null {
  if (
    !Number.isFinite(lengthMm) ||
    lengthMm <= 0 ||
    !Number.isInteger(courses) ||
    courses < 2
  )
    return null;
  const projected = transformPoint(h, point);
  if (
    !projected ||
    projected.x < -1e-7 ||
    projected.x > 1 + 1e-7 ||
    projected.y < -1e-7 ||
    projected.y > 1 + 1e-7
  )
    return null;
  const along = Math.min(1, Math.max(0, projected.x));
  const across = Math.min(1, Math.max(0, projected.y));
  const courseCoordinate = across * (courses - 1);
  const nearest = Math.round(courseCoordinate);
  // A broad fingertip between courses cannot identify a course from this view.
  const course = Math.abs(courseCoordinate - nearest) <= 0.3 ? nearest : null;
  return { course, distanceMm: along * lengthMm, across };
}
