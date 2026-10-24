import { describe, expect, it } from "vitest";
import type { NoteLabel } from "@naghma/ui";
import {
  MAQAM_LOG_WINDOW_MS,
  pruneMaqamLog,
  recentMaqamat,
  recordAnalysis,
} from "./maqamLog";
import type { Analysis } from "./types";

const label = (text: string) => ({ text }) as NoteLabel;
const candidate = (maqam: string, score: number) => ({
  maqam,
  score,
  tonic: { degree: "do" as const, accidental: 0 },
  supporting: [],
  contradicting: [],
});
const analysis = (
  status: Analysis["status"],
  ...candidates: ReturnType<typeof candidate>[]
) => ({ status, candidates });

describe("rolling maqam log", () => {
  it("records only the leading candidate of a likely analysis", () => {
    const log = recordAnalysis(
      [],
      analysis("likely", candidate("rast", 2.1), candidate("bayati", 1.9)),
      [label("Do"), label("Re")],
      1000,
    );
    expect(log).toEqual([
      {
        maqam: "rast",
        tonic: label("Do"),
        role: "leading",
        score: 2.1,
        at: 1000,
      },
    ]);
  });

  it("records close contenders of an ambiguous analysis", () => {
    const log = recordAnalysis(
      [],
      analysis(
        "ambiguous",
        candidate("rast", 1.91),
        candidate("sikah", 1.9),
        candidate("bayati", 1.86),
        candidate("hijaz", 1.11),
      ),
      [label("Do"), label("Mi𝄳"), label("Re"), label("Re")],
      5,
    );
    expect(log.map((s) => [s.maqam, s.role, s.tonic?.text])).toEqual([
      ["rast", "ambiguous", "Do"],
      ["sikah", "ambiguous", "Mi𝄳"],
      ["bayati", "ambiguous", "Re"],
    ]);
    const two = recordAnalysis(
      [],
      analysis("ambiguous", candidate("a", 2), candidate("b", 1.5)),
      undefined,
      5,
    );
    expect(two.map((s) => [s.maqam, s.tonic])).toEqual([
      ["a", null],
      ["b", null],
    ]);
  });

  it("ignores insufficient, unknown and empty analyses", () => {
    const start = recordAnalysis(
      [],
      analysis("likely", candidate("rast", 2)),
      [],
      0,
    );
    for (const status of ["insufficientData", "unknown"] as const)
      expect(
        recordAnalysis(start, analysis(status, candidate("kurd", 3)), [], 10),
      ).toEqual(start);
    expect(recordAnalysis(start, analysis("likely"), [], 10)).toEqual(start);
  });

  it("prunes entries older than 30 seconds and future entries", () => {
    let log = recordAnalysis(
      [],
      analysis("likely", candidate("rast", 2)),
      [],
      0,
    );
    log = recordAnalysis(
      log,
      analysis("likely", candidate("hijaz", 2)),
      [],
      20_000,
    );
    expect(pruneMaqamLog(log, MAQAM_LOG_WINDOW_MS)).toHaveLength(2);
    expect(pruneMaqamLog(log, MAQAM_LOG_WINDOW_MS + 1)).toHaveLength(1);
    expect(pruneMaqamLog(log, 10_000)).toHaveLength(1);
    log = recordAnalysis(
      log,
      analysis("likely", candidate("kurd", 2)),
      [],
      40_000,
    );
    expect(log.map((s) => s.maqam)).toEqual(["hijaz", "kurd"]);
  });

  it("lists distinct maqamat by their latest sighting, newest first", () => {
    let log = recordAnalysis(
      [],
      analysis("likely", candidate("bayati", 2)),
      [label("Re")],
      1_000,
    );
    log = recordAnalysis(
      log,
      analysis("ambiguous", candidate("rast", 1.9), candidate("bayati", 1.88)),
      [label("Do"), label("La")],
      6_000,
    );
    log = recordAnalysis(
      log,
      analysis("likely", candidate("hijaz", 2)),
      [label("Re")],
      11_000,
    );
    const recent = recentMaqamat(log, 12_000);
    expect(
      recent.map((r) => [r.maqam, r.role, r.tonic?.text, r.ageMs]),
    ).toEqual([
      ["hijaz", "leading", "Re", 1_000],
      ["rast", "ambiguous", "Do", 6_000],
      ["bayati", "ambiguous", "La", 6_000],
    ]);
    expect(recentMaqamat(log, 37_000).map((r) => r.maqam)).toEqual(["hijaz"]);
    expect(recentMaqamat([], 0)).toEqual([]);
  });
});
