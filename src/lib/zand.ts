/**
 * The zand (زند, the oud's neck): note positions in board coordinates shared
 * by the animated fingerboard panel and anything drawn over the camera image.
 *
 * Board coordinates follow src/vision/geometry.ts: `along` runs 0 → 1 from the
 * nut to the marked fingerboard end, `across` 0 → 1 from the lowest-pitched to
 * the highest-pitched course.
 */
import type { NoteLabel } from "@naghma/ui";
import type { Fingerboard, LiveNote, Position } from "./types";

/** Half-width of a drawn intonation zone, matching the coach's "in tune" range. */
export const ZONE_CENTS = 10;

export interface ZandMark {
  key: string;
  targetId: string;
  course: number;
  distanceMm: number;
  along: number;
  across: number;
  /** Along-range of ±ZONE_CENTS around the position, clamped to the board. */
  zone: readonly [number, number];
  label: NoteLabel;
  /** Odd quarter-tone accidental (half-flat or half-sharp). */
  quarterTone: boolean;
  /** Tonic (or its octave) of the selected maqam. */
  tonic: boolean;
  open: boolean;
}

/** Distance from the nut that raises an ideal string by `cents`. */
export function distanceForCents(scaleLengthMm: number, cents: number): number {
  return scaleLengthMm * (1 - 2 ** (-cents / 1200));
}

export function across(course: number, courses: number): number {
  return courses > 1 ? course / (courses - 1) : 0.5;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Along-coordinate of a position on a board of this geometry. */
export function alongFor(board: Fingerboard, position: Position): number {
  return clamp01(position.distanceMm / board.fingerboardLengthMm);
}

export function zandMarks(board: Fingerboard): ZandMark[] {
  const length = board.fingerboardLengthMm;
  const courses = board.courses.length;
  if (!(length > 0) || courses < 1) return [];
  const tonicSteps = new Set(
    (board.scale?.notes ?? [])
      .filter((n) => Math.abs(n.cents - 1200 * Math.round(n.cents / 1200)) < 1)
      .map((n) => n.step),
  );
  return board.targets.flatMap((target) =>
    target.positions.map((position) => {
      const zone = [-ZONE_CENTS, ZONE_CENTS].map((offset) =>
        clamp01(
          distanceForCents(
            board.scaleLengthMm,
            Math.max(0, position.centsAboveOpen + offset),
          ) / length,
        ),
      );
      return {
        key: `${target.id}-${position.course}`,
        targetId: target.id,
        course: position.course,
        distanceMm: position.distanceMm,
        along: alongFor(board, position),
        across: across(position.course, courses),
        zone: [zone[0], zone[1]] as const,
        label: target.label,
        quarterTone: target.label.accidentalQuarterTones % 2 !== 0,
        tonic: target.step !== null && tonicSteps.has(target.step),
        open: position.distanceMm < 1e-6,
      };
    }),
  );
}

/** Drawing area of the panel, in SVG/canvas view units. */
export const ZAND_VIEW = {
  width: 960,
  height: 282,
  left: 100,
  right: 920,
  top: 38,
  bottom: 238,
  /** Course spread at the nut relative to the fingerboard end (the neck tapers). */
  nutSpread: 0.8,
} as const;

/** Panel position of a board coordinate. The courses fan out towards the body. */
export function zandPoint(along: number, acrossValue: number) {
  const v = ZAND_VIEW;
  const centre = (v.top + v.bottom) / 2;
  const spread = v.nutSpread + (1 - v.nutSpread) * along;
  return {
    x: v.left + along * (v.right - v.left),
    y: centre + (acrossValue - 0.5) * (v.bottom - v.top) * spread,
  };
}

export type Intonation = "inTune" | "flat" | "sharp";

export function intonation(cents: number): Intonation {
  return Math.abs(cents) <= ZONE_CENTS
    ? "inTune"
    : cents < 0
      ? "flat"
      : "sharp";
}

/** Content that must repaint even when motion is disabled and a note keeps its id. */
export function staticNoteKey(note: LiveNote | null): string {
  return JSON.stringify(
    note && [note.eventId, intonation(note.cents), note.positions],
  );
}

/** Shared colours: in tune teal-green, flat cool blue, sharp warm coral. */
export const INTONATION_COLOURS: Record<Intonation, string> = {
  inTune: "#6fe0b4",
  flat: "#7aa8ff",
  sharp: "#ff8a6b",
};
