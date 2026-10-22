import { describe, expect, it } from "vitest";
import {
  calibrationKey,
  loadCalibration,
  validateCalibration,
  type Calibration,
} from "./calibration";
import { BOARD_CORNERS } from "./geometry";

const saved: Calibration = {
  version: 1,
  cameraId: "camera-one",
  aspectRatio: 16 / 9,
  fingerboardLengthMm: 320,
  courses: 6,
  corners: BOARD_CORNERS,
  savedAt: 12345,
};
describe("persisted calibration", () => {
  it("loads only for the same camera, aspect and physical geometry", () => {
    const valid = (
      value: unknown,
      camera = "camera-one",
      aspect = 16 / 9,
      length = 320,
      courses = 6,
    ) => validateCalibration(value, camera, aspect, length, courses);
    expect(valid(saved)).toBe(true);
    expect(valid(saved, "camera-two")).toBe(false);
    expect(valid(saved, "camera-one", 4 / 3)).toBe(false);
    expect(valid(saved, "camera-one", 16 / 9, 330)).toBe(false);
    expect(valid(saved, "camera-one", 16 / 9, 320, 5)).toBe(false);
    expect(valid({ ...saved, version: 2 })).toBe(false);
    expect(valid({ ...saved, corners: [null, null, null, null] })).toBe(false);
    expect(valid({ ...saved, aspectRatio: NaN })).toBe(false);
  });
  it("survives corrupt JSON and storage denial", () => {
    expect(
      loadCalibration("camera-one", 16 / 9, 320, 6, { getItem: () => "{" }),
    ).toBeNull();
    expect(
      loadCalibration("camera-one", 16 / 9, 320, 6, {
        getItem: () => {
          throw new Error("denied");
        },
      }),
    ).toBeNull();
    expect(
      loadCalibration("camera-one", 16 / 9, 320, 6, {
        getItem: (key) =>
          key === calibrationKey("camera-one") ? JSON.stringify(saved) : null,
      }),
    ).toEqual(saved);
  });
});
