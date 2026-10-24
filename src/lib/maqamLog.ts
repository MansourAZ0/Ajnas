import type { NoteLabel } from "@naghma/ui";
import type { Analysis } from "./types";

/** How long a detected maqam stays in the rolling log. */
export const MAQAM_LOG_WINDOW_MS = 30_000;
/**
 * Mirrors naghma-core's default `ambiguity_margin`: in an ambiguous result,
 * candidates this close to the best score are logged alongside it.
 */
export const AMBIGUITY_MARGIN = 0.08;
const MAX_AMBIGUOUS = 3;

export type SightingRole = "leading" | "ambiguous";

export interface MaqamSighting {
  maqam: string;
  /** Spelled tonic from the backend (`tonicLabels[i]`); may be absent. */
  tonic: NoteLabel | null;
  role: SightingRole;
  score: number;
  /** Main-window `performance.now()` when the analysis was received. */
  at: number;
}

export interface RecentMaqam extends MaqamSighting {
  ageMs: number;
}

/** Keep only sightings inside the window ending at `now`. */
export function pruneMaqamLog(
  log: readonly MaqamSighting[],
  now: number,
  windowMs = MAQAM_LOG_WINDOW_MS,
): MaqamSighting[] {
  return log.filter((s) => s.at <= now && now - s.at <= windowMs);
}

/**
 * Append the top candidate(s) of one backend analysis, then prune.
 * `likely` records the leading candidate; `ambiguous` records the close
 * contenders (at least two, at most three). Other statuses add nothing.
 */
export function recordAnalysis(
  log: readonly MaqamSighting[],
  analysis: Pick<Analysis, "status" | "candidates">,
  tonicLabels: readonly NoteLabel[] | undefined,
  at: number,
  windowMs = MAQAM_LOG_WINDOW_MS,
): MaqamSighting[] {
  const pruned = pruneMaqamLog(log, at, windowMs);
  const candidates = analysis.candidates;
  if (!candidates.length) return pruned;
  const sighting = (index: number, role: SightingRole): MaqamSighting => ({
    maqam: candidates[index].maqam,
    tonic: tonicLabels?.[index] ?? null,
    role,
    score: candidates[index].score,
    at,
  });
  if (analysis.status === "likely") return [...pruned, sighting(0, "leading")];
  if (analysis.status !== "ambiguous") return pruned;
  const best = candidates[0].score;
  const added: MaqamSighting[] = [];
  for (let i = 0; i < candidates.length && added.length < MAX_AMBIGUOUS; i++)
    if (i < 2 || best - candidates[i].score <= AMBIGUITY_MARGIN)
      added.push(sighting(i, "ambiguous"));
  return [...pruned, ...added];
}

/**
 * Distinct maqamat seen within the window, most recent first. Each entry
 * reflects its latest sighting (tonic, role, score); same-time sightings are
 * ordered by score.
 */
export function recentMaqamat(
  log: readonly MaqamSighting[],
  now: number,
  windowMs = MAQAM_LOG_WINDOW_MS,
): RecentMaqam[] {
  const latest = new Map<string, MaqamSighting>();
  for (const s of pruneMaqamLog(log, now, windowMs)) {
    const previous = latest.get(s.maqam);
    if (
      !previous ||
      s.at > previous.at ||
      (s.at === previous.at && s.score > previous.score)
    )
      latest.set(s.maqam, s);
  }
  return [...latest.values()]
    .sort((a, b) => b.at - a.at || b.score - a.score)
    .map((s) => ({ ...s, ageMs: now - s.at }));
}
