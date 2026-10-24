import { describe, expect, it } from "vitest";
import { agoText, signed, transpositionText } from "./format";

describe("overlay formatting", () => {
  it("signs numbers with a typographic minus and no negative zero", () => {
    expect(signed(-2)).toBe("−2");
    expect(signed(2.94, 1)).toBe("+2.9");
    expect(signed(-0.04, 1)).toBe("0.0");
    expect(signed(0)).toBe("0");
  });
  it("describes transposition in both languages", () => {
    expect(transpositionText({ amount: -2, unit: "semitone" }, false)).toBe(
      "\u2066−2\u2069 semitones",
    );
    expect(transpositionText({ amount: 1, unit: "wholeTone" }, false)).toBe(
      "\u2066+1\u2069 whole tone",
    );
    expect(transpositionText({ amount: 1.5, unit: "quarterTone" }, true)).toBe(
      "\u2066+1.5\u2069 ربع نغمة",
    );
    expect(transpositionText({ amount: 0, unit: "cent" }, false)).toBeNull();
  });
  it("reports elapsed seconds", () => {
    expect(agoText(400, false)).toBe("now");
    expect(agoText(12_700, false)).toBe("12s ago");
    expect(agoText(3_000, true)).toBe("منذ 3 ث");
  });
});
