/**
 * The zand's note positions projected onto the camera image through the
 * fingerboard calibration (board → image, the inverse of fingertip
 * projection). Pure geometry: shapes are in normalised image coordinates and
 * only need recomputing when the calibration or the shown notes change.
 */
import {
  BOARD_CORNERS,
  homography,
  transformPoint,
  type Homography,
  type Point,
  type Quadrilateral,
} from "./geometry";
import type { ZandMark } from "../lib/zand";

export interface ZandOverlayShapes {
  /** Course centrelines, nut to fingerboard end. */
  strings: Point[][];
  /** ±10-cent zones across each stopped position. */
  zones: { points: Point[]; colour: string; alpha: number }[];
  /** Selected target positions: centre and a point on the ring. */
  rings: { centre: Point; edge: Point }[];
  /** Positions that get a note-name label (target, else tonic; never open). */
  labels: { point: Point; mark: ZandMark }[];
}

/** Half-height of a zone across its course, in course spacings. */
const ZONE_HALF = 0.3;

export function imageFromBoard(corners: Quadrilateral): Homography {
  return homography(BOARD_CORNERS, corners);
}

export function zandOverlayShapes(
  map: Homography,
  marks: readonly ZandMark[],
  courses: number,
  selectedId: string | null,
): ZandOverlayShapes {
  const spacing = courses > 1 ? 1 / (courses - 1) : 1;
  const at = (along: number, across: number) =>
    transformPoint(map, { x: along, y: across });
  const strings: Point[][] = [];
  for (let c = 0; c < courses; c++) {
    const across = courses > 1 ? c / (courses - 1) : 0.5;
    const line = [at(0, across), at(1, across)];
    if (line.every(Boolean)) strings.push(line as Point[]);
  }
  const shapes: ZandOverlayShapes = {
    strings,
    zones: [],
    rings: [],
    labels: [],
  };
  const selected = marks.some((m) => m.targetId === selectedId);
  for (const mark of marks) {
    const centre = at(mark.along, mark.across);
    if (!centre) continue;
    const chosen = mark.targetId === selectedId;
    if (!mark.open) {
      const h = ZONE_HALF * spacing;
      const points = [
        at(mark.zone[0], mark.across - h),
        at(mark.zone[1], mark.across - h),
        at(mark.zone[1], mark.across + h),
        at(mark.zone[0], mark.across + h),
      ];
      if (points.every(Boolean))
        shapes.zones.push({
          points: points as Point[],
          colour:
            chosen || mark.tonic
              ? "#dec08a"
              : mark.quarterTone
                ? "#76bdb2"
                : "#f3e8cc",
          alpha: chosen ? 0.95 : mark.tonic ? 0.8 : 0.6,
        });
    }
    if (chosen) {
      const edge = at(mark.along, mark.across + 0.45 * spacing);
      if (edge) shapes.rings.push({ centre, edge });
    }
    // A small neck has no room for many names: the target's positions, or
    // the tonic's when nothing is selected. Open strings sit on the nut corners.
    if (!mark.open && (selected ? chosen : mark.tonic))
      shapes.labels.push({ point: centre, mark });
  }
  return shapes;
}
