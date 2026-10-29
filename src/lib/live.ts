import { LiveStore } from "@naghma/ui";
import type { LiveFrame, Target } from "./types";

export class PerformanceStore extends LiveStore<LiveFrame> {
  receivedAt = 0;
  history: {
    eventId: number;
    pitch: number;
    text: string;
    cents: number;
    t: number;
  }[] = [];
  protected override onPush(frame: LiveFrame) {
    this.receivedAt = performance.now();
    const note = frame.note;
    if (note && this.history.at(-1)?.eventId !== note.eventId) {
      this.history.push({
        eventId: note.eventId,
        pitch: note.playerPitch,
        text: note.label.text,
        cents: note.cents,
        t: frame.t,
      });
      if (this.history.length > 160) this.history.shift();
    } else if (note) {
      const previous = this.history.at(-1)!;
      // The tracker renames a settling pluck in place, preserving its id.
      if (previous.text !== note.label.text) {
        previous.pitch = note.playerPitch;
        previous.text = note.label.text;
        previous.cents = note.cents;
      }
    }
  }
  protected override onReset() {
    this.history = [];
    this.receivedAt = 0;
  }
}

/**
 * Continuous target comparison, preserving custom intonation from Rust.
 * Cents are measured against the target's nearest octave; `octaves` reports
 * how many octaves away the played note is, so a correct pitch class in
 * another register is not shown as e.g. "+1200 cents".
 */
export function coaching(
  frame: LiveFrame | null,
  target: Target | null,
  receivedAt: number,
  now: number,
) {
  if (
    !frame?.note ||
    !target ||
    frame.note.holding ||
    frame.confidence < 0.8 ||
    now - receivedAt > 350
  )
    return null;
  const semitones = frame.note.playerPitch - target.playerPitch;
  const octaves = Math.round(semitones / 12);
  const cents = 100 * (semitones - 12 * octaves);
  return {
    cents,
    octaves,
    state:
      Math.abs(cents) <= 10
        ? ("inTune" as const)
        : cents < 0
          ? ("flat" as const)
          : ("sharp" as const),
  };
}
