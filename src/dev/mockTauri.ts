/**
 * Development-only Tauri IPC mock for previewing the UI in a plain browser.
 *
 * Loaded from `main.tsx` only when `import.meta.env.DEV` and the page URL has
 * `?mock`; production builds drop the import entirely. Payloads in
 * `mock-fixtures.json` were serialized by a scratch copy of this app's Rust
 * serializers (`src-tauri/src/{settings,live,teach}.rs`) against naghma-core
 * v0.4.0: the researched-eight dataset, catalogue, fingerboards, tonic
 * options, real note frames, and real analyzer results for synthetic scale
 * runs. Frames are replayed with a small synthetic intonation wobble; nothing
 * here is musical data of its own.
 *
 * Query parameters: `mock` (required), `lang=ar` (Arabic settings and note
 * script), `maqam=off`, `dataset=none`, `analysisMs=<ms>` (default 5000),
 * `diagnostics`, `zand=classic` (plain fingerboard map).
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Channel } from "@tauri-apps/api/core";
import fixturesUrl from "./mock-fixtures.json?url";
import type {
  Analysis,
  Dataset,
  Fingerboard,
  LiveFrame,
  LiveNote,
  Message,
  ScaleInfo,
  Settings,
  TonicOption,
} from "../lib/types";
import type { NoteLabel } from "@naghma/ui";

interface ScriptFixtures {
  settings: Settings;
  tonicOptions: TonicOption[];
  catalogue: ScaleInfo[];
  boards: Record<string, Fingerboard>;
  notes: LiveNote[];
  frame: LiveFrame & { type: "frame" };
  analyses: { analysis: Analysis; tonicLabels: NoteLabel[] }[];
}
interface Fixtures {
  dataset: Dataset;
  latin: ScriptFixtures;
  arabic: ScriptFixtures;
}

const NOTE_MS = 700;
const GAP_MS = 140;
const FRAME_MS = 1000 / 60;

/** Recorded notes as an ascending-then-descending run. */
const melodies = new WeakMap<LiveNote[], LiveNote[]>();
function melody(notes: LiveNote[]) {
  let run = melodies.get(notes);
  if (!run) {
    const up = [...notes].sort((a, b) => a.playerPitch - b.playerPitch);
    run = [...up, ...up.slice(1, -1).reverse()];
    melodies.set(notes, run);
  }
  return run;
}

export async function installMockTauri() {
  const fixtures = (await (await fetch(fixturesUrl)).json()) as Fixtures;
  const query = new URLSearchParams(location.search);
  const arabic = query.get("lang") === "ar";
  let settings: Settings = structuredClone(
    fixtures[arabic ? "arabic" : "latin"].settings,
  );
  // Fixtures predate the zand settings; fill the Rust default.
  settings.zand ??= { animated: query.get("zand") !== "classic" };
  if (query.get("maqam") === "off") settings.maqam.enabled = false;
  if (query.has("diagnostics")) settings.showDiagnostics = true;
  let dataset: Dataset | null =
    query.get("dataset") === "none" ? null : fixtures.dataset;
  const analysisMs = Number(query.get("analysisMs")) || 5000;
  const set = () =>
    fixtures[settings.noteScript === "arabic" ? "arabic" : "latin"];
  let stream: { stop: () => void; simulation: boolean } | null = null;

  const start = (channel: Channel<Message>, simulation: boolean) => {
    stream?.stop();
    const began = performance.now();
    let eventId = 0;
    let lastNote = -1;
    let analysisIndex = 0;
    const frames = setInterval(() => {
      const elapsed = performance.now() - began;
      const index = Math.floor(elapsed / (NOTE_MS + GAP_MS));
      const within = elapsed % (NOTE_MS + GAP_MS);
      const notes = melody(set().notes);
      const template = notes[index % notes.length];
      const sounding = within < NOTE_MS;
      if (sounding && index !== lastNote) {
        lastNote = index;
        eventId++;
      }
      // Gentle intonation drift so the meter and cents readouts move.
      const cents =
        6 * Math.sin(elapsed / 310 + index) + 2.5 * Math.sin(elapsed / 77);
      const note: LiveNote | null = sounding
        ? {
            ...template,
            eventId,
            cents,
            hz: template.targetHz * 2 ** (cents / 1200),
            playerPitch: Math.round(template.playerPitch * 2) / 2 + cents / 100,
            holding: within > NOTE_MS - 90,
          }
        : null;
      channel.onmessage({
        ...set().frame,
        type: "frame",
        t: elapsed / 1000,
        onset: sounding && within < FRAME_MS,
        levelDb: sounding ? -18 - within / 90 + Math.sin(elapsed / 50) : -72,
        confidence: sounding ? 0.97 + 0.02 * Math.sin(elapsed / 40) : 0.2,
        note,
      });
    }, FRAME_MS);
    const analyses = setInterval(() => {
      if (!settings.maqam.enabled) return;
      const list = set().analyses;
      const next = list[analysisIndex++ % list.length];
      channel.onmessage({
        type: "analysis",
        analysis: dataset
          ? next.analysis
          : { ...next.analysis, candidates: [] },
        tonicLabels: dataset ? next.tonicLabels : [],
      });
    }, analysisMs);
    stream = {
      simulation,
      stop: () => {
        clearInterval(frames);
        clearInterval(analyses);
      },
    };
  };

  mockWindows("main");
  mockIPC(async (cmd, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case "snapshot":
        return { settings, dataset, warning: null };
      case "update_settings":
        settings = args.settings as Settings;
        return settings;
      case "tonic_options":
        return set().tonicOptions;
      case "maqam_catalogue":
        return dataset ? set().catalogue : [];
      case "fingerboard": {
        const id = (args.maqamId as string | null) ?? "";
        const board = set().boards[id];
        if (!board || (id && !dataset))
          throw `Mock: no recorded fingerboard for "${id}"`;
        return board;
      }
      case "start_audio":
        start(args.onMessage as Channel<Message>, !!args.simulation);
        return null;
      case "stop_audio":
        stream?.stop();
        stream = null;
        return null;
      case "audio_status":
        return stream
          ? {
              info: {
                sampleRate: 48000,
                channels: 1,
                window: 4096,
                hop: 512,
                source: stream.simulation ? "simulation" : "Mock microphone",
              },
              stats: { frames: 0, droppedBlocks: 0 },
              simulation: stream.simulation,
            }
          : null;
      case "list_input_devices":
        return [{ id: "mock-mic", name: "Mock microphone", isDefault: true }];
      case "import_dataset":
      case "load_reference_dataset":
        dataset = fixtures.dataset;
        return dataset;
      case "clear_dataset":
        dataset = null;
        return null;
      default:
        throw `Mock: unhandled command ${cmd}`;
    }
  });
  (globalThis as { isTauri?: boolean }).isTauri = true;
}
