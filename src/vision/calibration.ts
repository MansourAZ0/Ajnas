import { validateQuadrilateral, type Quadrilateral } from "./geometry";

export interface Calibration {
  version: 1;
  cameraId: string;
  aspectRatio: number;
  fingerboardLengthMm: number;
  courses: number;
  corners: Quadrilateral;
  savedAt: number;
}

export const calibrationKey = (cameraId: string) =>
  `ajnas.vision.calibration.v1.${cameraId}`;

export function validateCalibration(
  value: unknown,
  cameraId: string,
  aspectRatio: number,
  lengthMm: number,
  courses: number,
): value is Calibration {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<Calibration>;
  return (
    c.version === 1 &&
    !!cameraId &&
    c.cameraId === cameraId &&
    Number.isFinite(aspectRatio) &&
    aspectRatio > 0 &&
    typeof c.aspectRatio === "number" &&
    Math.abs(c.aspectRatio / aspectRatio - 1) <= 0.005 &&
    Number.isFinite(lengthMm) &&
    lengthMm > 0 &&
    c.fingerboardLengthMm === lengthMm &&
    Number.isInteger(courses) &&
    courses >= 2 &&
    c.courses === courses &&
    typeof c.savedAt === "number" &&
    Number.isFinite(c.savedAt) &&
    c.savedAt > 0 &&
    Array.isArray(c.corners) &&
    c.corners.every((p) => p && typeof p === "object") &&
    validateQuadrilateral(c.corners) === null
  );
}

export function loadCalibration(
  cameraId: string,
  aspectRatio: number,
  lengthMm: number,
  courses: number,
  storage?: Pick<Storage, "getItem">,
): Calibration | null {
  try {
    const value: unknown = JSON.parse(
      (storage ?? localStorage).getItem(calibrationKey(cameraId)) ?? "null",
    );
    return validateCalibration(value, cameraId, aspectRatio, lengthMm, courses)
      ? value
      : null;
  } catch {
    return null;
  }
}
