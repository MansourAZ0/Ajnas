import type { Transposition } from "@naghma/ui";

const UNITS: Record<
  Transposition["unit"],
  { one: string; many: string; ar: string }
> = {
  semitone: { one: "semitone", many: "semitones", ar: "نصف نغمة" },
  wholeTone: { one: "whole tone", many: "whole tones", ar: "نغمة" },
  quarterTone: { one: "quarter tone", many: "quarter tones", ar: "ربع نغمة" },
  cent: { one: "cent", many: "cents", ar: "سنت" },
};

/** Signed number with a typographic minus, e.g. "−2", "+0.5", "0". */
export function signed(value: number, digits = 0): string {
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return (0).toFixed(digits);
  return (value < 0 ? "−" : "+") + text;
}

/** "−2 semitones" / "−2 نصف نغمة"; null when there is no transposition. */
export function transpositionText(
  { amount, unit }: Transposition,
  arabic: boolean,
): string | null {
  if (!amount) return null;
  const digits = Number.isInteger(amount) ? 0 : 1;
  const name = UNITS[unit] ?? UNITS.semitone;
  // Isolate the signed number so "−2" keeps its sign in Arabic (RTL) text.
  return `\u2066${signed(amount, digits)}\u2069 ${
    arabic ? name.ar : Math.abs(amount) === 1 ? name.one : name.many
  }`;
}

/** Compact elapsed time for overlays: "now", "12s ago". */
export function agoText(ms: number, arabic: boolean): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 1) return arabic ? "الآن" : "now";
  return arabic ? `منذ ${s} ث` : `${s}s ago`;
}

/** Explains that intonation is compared with the target's nearest octave. */
export function octaveHint(
  octaves: number,
  tr: (en: string, ar: string) => string,
) {
  const n = Math.abs(octaves);
  return octaves > 0
    ? tr(
        n === 1
          ? "Played an octave above the target."
          : `Played ${n} octaves above the target.`,
        n === 1
          ? "عُزفت أعلى من الهدف بأوكتاف."
          : `عُزفت أعلى من الهدف بـ${n} أوكتاف.`,
      )
    : tr(
        n === 1
          ? "Played an octave below the target."
          : `Played ${n} octaves below the target.`,
        n === 1
          ? "عُزفت أخفض من الهدف بأوكتاف."
          : `عُزفت أخفض من الهدف بـ${n} أوكتاف.`,
      );
}
