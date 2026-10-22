# Progress and acceptance checks

## 2026-10-22 companion foundation

Implemented a real companion on the existing independently versioned libraries:
local audio IPC, live notation and tuning display, interactive geometry-derived
fingerboard, selected-target intonation practice, native dataset loading,
opt-in explainable maqam analysis, persistent settings and optional worker-based
camera tracking/calibration/fusion. No Watar application source was copied.

### Automated validation

- 7 Rust tests: settings/defaults, fractional dataset targets, transposition
  preserving positions, both pitch identities and opt-in analysis.
- 20 frontend tests: continuous target coaching, stale/held/low-confidence rejection,
  bounded session history, perspective projection, calibration storage/validation,
  fusion freshness/ambiguity/conflict and camera lifecycle races.
- TypeScript, production Vite build, Rust formatting and Clippy.
- MediaPipe local asset hashes and real WASM/model synthetic-image smoke in
  Chromium. This establishes loading/inference, not physical camera tracking.

- Native macOS debug bundle built and opened successfully. Verified the real
  generated-audio DSP stream, quarter-tone labels, cents, melodic history, stop,
  teaching positions and target selection through the UI. Arabic UI and note
  script persistence and signed numeric transposition entry were also checked.
- Independent review found and fixed missing normal note endings in analysis,
  settings failure reconciliation, provenance/tonic display and calibrated
  geometry; the shared geometry correction is naghma-core v0.3.1.
- naghma-core v0.3.1: 62 core tests plus one documentation test and clean Clippy.

See VISION.md for the exact camera checks and limits. Synthetic musical fixtures
are not authoritative theory and are not bundled as selectable definitions.

### Required before a public release

- Validate Watar and Ajnas using licensed/user-supplied real oud recordings,
  covering low courses, strong harmonics, ringing strings, tremolo and vibrato.
- Validate physical microphone permission/device changes and camera permission
  flows in packaged macOS and Windows applications.
- Measure onset-to-display latency, dropped samples, sustained CPU/memory use,
  camera throughput and frame timing alongside audio. UI diagnostics are not a
  substitute for these measurements.
- Evaluate calibration accuracy against measured finger positions, occlusion,
  course spacing and movement. Contact/active finger is not resolved today.
- Supply musician-reviewed maqam/jins datasets with provenance, then validate
  recognition on labelled real performances; scores are currently uncalibrated.
- Add tuning-profile import/editing, lesson progression and custom intonation
  profile selection. Dataset teaching already preserves custom target cents.
- Complete MPM comparison, Windows validation, accessibility review, signing,
  notarization and distribution packaging.

CI requires a dependency-read token while the foundation repositories are private.
