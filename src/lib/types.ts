import type {
  AccidentalStyle,
  Degree,
  NoteLabel,
  NoteView,
  Script,
  Transposition,
} from "@naghma/ui";
export interface Settings {
  version: number;
  language: "en" | "ar";
  referenceHz: number;
  transposition: Transposition;
  tuning: "edo24" | "edo12";
  noteScript: Script;
  accidentalStyle: AccidentalStyle;
  arabicDigits: boolean;
  noteView: NoteView;
  inputDeviceId: string | null;
  silenceThresholdDb: number;
  minConfidence: number;
  scaleLengthMm: number;
  fingerboardLengthMm: number;
  positionOffsetMm: number;
  maqam: {
    enabled: boolean;
    tonic: { degree: Degree; accidental: number } | null;
    pitchSpace: "player" | "sounding";
    windowS: number;
    intervalS: number;
    /** Accepted intonation error in cents (= % of a semitone). */
    toleranceCents: number;
    /** Instrument tuning offset in cents; null = estimate automatically. */
    tuningOffsetCents: number | null;
  };
  visuals: "full" | "reduced" | "off";
  /** The drawn oud neck (zand, زند). */
  zand: {
    /** Animated neck instead of the plain fingerboard map. */
    animated: boolean;
    /** Draw the note positions on the calibrated camera image. */
    overlay: boolean;
  };
  showDiagnostics: boolean;
}
export interface Position {
  course: number;
  distanceMm: number;
  fraction: number;
  centsAboveOpen: number;
}
export interface LiveNote {
  eventId: number;
  label: NoteLabel;
  playerLabel: NoteLabel;
  soundingLabel: NoteLabel;
  playerPitch: number;
  hz: number;
  targetHz: number;
  cents: number;
  holding: boolean;
  positions: Position[];
}
export interface LiveFrame {
  t: number;
  levelDb: number;
  confidence: number;
  onset: boolean;
  note: LiveNote | null;
  computeUs: number;
  latencyMs: number | null;
  windowMs: number;
}
/** Root and tonal centre of a jins reading, spelled in the user's notation. */
export interface JinsLabels {
  root: NoteLabel;
  centre: NoteLabel;
}
export type JinsRole = "lower" | "upper" | { other: string };
/** A jins of the leading maqam that the latest passage dwells in. */
export interface ActiveJins {
  jins: string;
  onStep: number;
  role: JinsRole;
  root: { degree: Degree; accidental: number };
  centre: { degree: Degree; accidental: number };
  fit: number;
}
/** A jins outside the leading maqam that explains the latest passage. */
export interface ForeignJins {
  jins: string;
  root: { degree: Degree; accidental: number };
  centre: { degree: Degree; accidental: number };
  fit: number;
}
export interface MaqamCandidate {
  maqam: string;
  tonic: { degree: Degree; accidental: number };
  variant?: string | null;
  tonicOctave?: number | null;
  score: number;
  supporting: Evidence[];
  contradicting: Evidence[];
}
/** The maqam of the piece as a whole, over everything played since it began. */
export interface PerformanceReading {
  window: [number, number];
  notes: number;
  status: "unknown" | "ambiguous" | "likely";
  candidates: MaqamCandidate[];
  tuningOffsetCents: number;
}
export interface Analysis {
  tonicLabels?: NoteLabel[];
  /** Tonics of `performance.candidates`, in the same order. */
  performanceTonicLabels?: NoteLabel[];
  activeJinsLabels?: JinsLabels | null;
  foreignJinsLabels?: JinsLabels | null;
  window: [number, number];
  notes: number;
  status: "insufficientData" | "unknown" | "ambiguous" | "likely";
  candidates: MaqamCandidate[];
  possibleModulation: boolean;
  /** Absent from engines before the performance reading, and until enough is played. */
  performance?: PerformanceReading | null;
  /** Tuning offset (cents) removed before scoring. */
  tuningOffsetCents?: number;
  /** Which jins of the leading maqam the latest passage dwells in. */
  activeJins?: ActiveJins | null;
  /** A jins outside the leading maqam: a possible modulation. */
  foreignJins?: ForeignJins | null;
}
export interface Evidence {
  kind: string;
  share?: number;
  heard?: number;
  total?: number;
  completeness?: number;
  jins?: string;
  count?: number;
}
export type Message =
  | ({ type: "frame" } & LiveFrame)
  | {
      type: "analysis";
      analysis: Analysis;
      tonicLabels: NoteLabel[];
      activeJinsLabels?: JinsLabels | null;
      foreignJinsLabels?: JinsLabels | null;
      performanceTonicLabels?: NoteLabel[];
    }
  | { type: "error"; message: string };
export interface TonicOption {
  spelling: { degree: Degree; accidental: number };
  label: NoteLabel;
}
export interface Target {
  id: string;
  label: NoteLabel;
  soundingLabel: NoteLabel;
  playerPitch: number;
  soundingHz: number;
  positions: Position[];
  step: number | null;
}
export interface Fingerboard {
  name: string;
  scaleLengthMm: number;
  fingerboardLengthMm: number;
  courses: NoteLabel[];
  targets: Target[];
  scale: ScaleInfo | null;
}
export interface Name {
  arabic: string;
  latin: string;
}
export interface ScaleDegree {
  step: number;
  cents: number;
}
export interface Maqam {
  id: string;
  name: Name;
  description?: string;
  family?: string;
  tonic: { degree: Degree; accidental: number };
  ascending: ScaleDegree[];
  octaveRepeating?: boolean;
  variants?: {
    id: string;
    name: Name;
    ascending: ScaleDegree[];
    description?: string;
    sources?: string[];
  }[];
  sources?: string[];
  descending?: ScaleDegree[];
  ajnas: { jins: string; onStep: number; role: string }[];
  restingSteps: number[];
  phrases: { steps: number[]; description?: string }[];
}
export interface Dataset {
  schemaVersion: number;
  provenance: {
    status: string;
    source: string;
    version?: string;
    notes?: string;
  };
  maqamat: Maqam[];
  ajnas: {
    id: string;
    name: Name;
    degrees: ScaleDegree[];
    description?: string;
  }[];
}
export interface Snapshot {
  settings: Settings;
  dataset: Dataset | null;
  warning: string | null;
}
export interface Device {
  id: string;
  name: string;
  isDefault: boolean;
}
export interface AudioStatus {
  info: {
    sampleRate: number;
    channels: number;
    window: number;
    hop: number;
    source: string;
  };
  stats: Record<string, number>;
  simulation: boolean;
}

export interface ScaleInfo {
  maqamId: string;
  tonic: NoteLabel;
  octaveRepeating: boolean;
  notes: { label: NoteLabel; cents: number; step: number }[];
  ajnas: {
    name: Name;
    onStep: number;
    tonicStep: number;
    notes: NoteLabel[];
  }[];
  sources: string[];
}
