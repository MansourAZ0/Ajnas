import type { AudioEvidence, PositionCandidate, VisionEvidence } from "./types";

export type UnknownReason =
  | "no-audio"
  | "low-audio-confidence"
  | "stale-audio"
  | "no-vision"
  | "stale-vision"
  | "unsynchronized"
  | "uncalibrated"
  | "ambiguous"
  | "no-position";
export type FusionResult = {
  state: "unknown" | "consistent" | "conflict";
  /** Unmodified acoustic estimate; vision never generates or changes a note. */
  playerPitch: number | null;
  reason?: UnknownReason;
  candidate?: PositionCandidate;
};
export interface FusionOptions {
  maxAgeMs: number;
  maxSkewMs: number;
  minAudioConfidence: number;
  toleranceMm: number;
}
export const DEFAULT_FUSION_OPTIONS: FusionOptions = {
  maxAgeMs: 300,
  maxSkewMs: 150,
  minAudioConfidence: 0.8,
  toleranceMm: 12,
};

export function fusePosition(
  audio: AudioEvidence | null,
  vision: VisionEvidence | null,
  now: number,
  options: FusionOptions = DEFAULT_FUSION_OPTIONS,
): FusionResult {
  const playerPitch =
    audio && Number.isFinite(audio.playerPitch) ? audio.playerPitch : null;
  const unknown = (reason: UnknownReason): FusionResult => ({
    state: "unknown",
    playerPitch,
    reason,
  });
  const fresh = (time: number) =>
    Number.isFinite(time) &&
    Number.isFinite(now) &&
    now - time >= 0 &&
    now - time <= options.maxAgeMs;
  if (!audio || playerPitch === null) return unknown("no-audio");
  if (!fresh(audio.receivedAt)) return unknown("stale-audio");
  if (
    !Number.isFinite(audio.confidence) ||
    audio.confidence < options.minAudioConfidence ||
    audio.confidence > 1
  )
    return unknown("low-audio-confidence");
  if (!vision) return unknown("no-vision");
  if (!vision.calibrated) return unknown("uncalibrated");
  if (
    !fresh(vision.receivedAt) ||
    !fresh(vision.capturedAt) ||
    vision.receivedAt < vision.capturedAt
  )
    return unknown("stale-vision");
  if (Math.abs(audio.receivedAt - vision.capturedAt) > options.maxSkewMs)
    return unknown("unsynchronized");
  if (
    vision.handCount !== 1 ||
    vision.candidates.some((c) => c.course === null)
  )
    return unknown("ambiguous");
  const valid = vision.candidates.filter(
    (c) =>
      c.course !== null &&
      Number.isInteger(c.course) &&
      c.course >= 0 &&
      Number.isFinite(c.distanceMm) &&
      c.distanceMm >= 0,
  );
  const positions = audio.positions.filter(
    (p) =>
      Number.isInteger(p.course) &&
      p.course >= 0 &&
      Number.isFinite(p.distanceMm) &&
      p.distanceMm >= 0,
  );
  if (!valid.length || !positions.length) return unknown("no-position");
  const matches = valid.filter((c) =>
    positions.some(
      (p) =>
        p.course === c.course &&
        Math.abs(p.distanceMm - c.distanceMm) <= options.toleranceMm,
    ),
  );
  if (matches.length > 1) return unknown("ambiguous");
  if (matches.length === 0) return { state: "conflict", playerPitch };
  return { state: "consistent", playerPitch, candidate: matches[0] };
}
