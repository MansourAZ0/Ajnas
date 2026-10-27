# Progress and acceptance checks

## 2026-10-22 companion foundation

Implemented a real companion on the existing independently versioned libraries:
local audio IPC, live notation and tuning display, interactive geometry-derived
fingerboard, selected-target intonation practice, native dataset loading,
opt-in explainable maqam analysis, persistent settings and optional worker-based
camera tracking/calibration/fusion. No Watar application source was copied.

### Automated validation

- 9 Rust tests: settings/defaults, fractional dataset targets, transposition
  preserving positions, both pitch identities, opt-in analysis, sourced transpositions and bounded Saba.
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
- naghma-core v0.4.0: 62 existing core tests, 7 sourced-maqam integration tests,
  one documentation test and clean Clippy.

See VISION.md for the exact camera checks and limits. Synthetic musical fixtures
are not authoritative theory and are not bundled as selectable definitions.

### 0.2 sourced maqam integration

Opt-in researched eight-maqam illustrations now support all 24 tonic classes,
source-labelled upper-jins alternatives, full spelled-note charts, separate jins
placement/tonal-centre degrees and register-bounded Saba targets. Recognition
ranks alternatives separately and reports the winning route; Saba includes an
inferred tonic octave. See MAQAMAT.md and the core research record.

The packaged macOS 0.2 debug app was opened and verified through its native UI:
loading all eight sourced definitions, Bayati on La with the Rast route and
Fa half-sharp, updated jins notes, and Saba’s lowered eighth/upper natural third
with its register-specific warning. Microphone and camera remained off.

The source notation was visually checked and Bayati transpositions were cross-
checked against Sami Asmar. Numeric targets are written-note 24-EDO approximations,
not measured performance intonation. No real recordings were supplied for this
iteration, so structural and generated-melody tests do not establish real-world
recognition or teaching accuracy.

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
- Have a musician review the sourced provisional maqam/jins illustrations and
  intonation targets, then validate recognition on labelled real performances;
  scores are currently uncalibrated.
- Add tuning-profile import/editing, lesson progression and custom intonation
  profile selection. Dataset teaching already preserves custom target cents.
- Complete MPM comparison, Windows validation, accessibility review, signing,
  notarization and distribution packaging.

### Hosted CI status

The validation results above are local observations. Public CI uses anonymous
reads of tagged dependency repositories; see the current workflow for checks.
A successful hosted run is still required before release.

A local macOS **debug** bundle is preserved in `release-local/Ajnas.app` (gitignored).
It is for development validation, not a notarized public release.
