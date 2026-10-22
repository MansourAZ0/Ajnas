# Ajnas · أجناس

A local-first desktop companion for oud practice. Tauri 2, Rust, React and
TypeScript; audio analysis uses our own YIN implementation through the shared
libraries. This is an incremental 0.2 application, not a finished music tutor.

## Working features

- Native microphone analysis and an explicitly labelled synthetic simulation.
- Continuous frequency, quarter-tone solfège, cents, periodicity confidence,
  a melodic trail and acoustic-reactive Canvas graphics.
- Separate player and sounding names, transposition in four interval units,
  reference pitch, 12-/24-EDO naming, Latin/Arabic note scripts and RTL interface.
- Interactive fretless fingerboard, all reachable positions for each note,
  selected-target intonation comparison and an electronic reference tone.
- Configurable vibrating length, nut-to-fingerboard-end length and position
  correction. The six-course tuning is the example Do2–Fa2–La2–Re3–Sol3–Do4.
- Opt-in sourced illustrations of the eight «صنع بسحرك» maqamat, with 24
  quarter-tone tonic choices, separately selectable upper-jins routes, spelled
  scale notes and geometry-derived teaching targets. Saba keeps its documented
  register rather than repeating an octave pattern.
- Local import, schema validation and persistence of user-provided maqam JSON.
  Dataset provenance and provisional/unvalidated warnings remain visible.
- Opt-in rolling maqam hypotheses with supporting and contradicting evidence.
  These are heuristic scores, not probabilities or authoritative identifications.
- Optional local MediaPipe hand tracking in a worker, camera selection, manual
  perspective calibration and conservative audio/position consistency checks.
  Vision never changes the acoustic note or claims verified string contact.

Microphone and camera stay off until started. No audio/video is recorded or
uploaded. Packaged inference uses local model and WASM assets; there is no runtime
CDN dependency. Camera calibration and settings are stored locally.

## Independent repositories

| Repository | Responsibility |
| --- | --- |
| [pitchforge-rs](https://github.com/MansourAZ0/pitchforge-rs) | Framework-free pitch DSP |
| [naghma-core](https://github.com/MansourAZ0/naghma-core) | Theory, instrument geometry, audio engine and shared UI |
| [watar-tuner](https://github.com/MansourAZ0/watar-tuner) | Standalone tuner product |
| Ajnas | Companion orchestration, teaching, camera and fusion |

Ajnas consumes `naghma-core` / `naghma-audio` at **v0.4.0**, and transitively
`pitchforge` at **v0.1.0**, pinned by Cargo.lock. It does not copy tuner source.
The shared React package is a file dependency on a sibling checkout; CI checks
that sibling out at **v0.4.0**. There is no cross-repository Cargo workspace.

## Run

Requirements: Rust 1.90+, Node 24+, the [Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/),
and access to the private dependency repositories. On Linux install ALSA headers
in addition to Tauri's dependencies. Clone `naghma-core` next to `Ajnas` and use its
`v0.4.0` tag for a reproducible UI build.

```sh
npm ci
npm run tauri dev
```

`predev` and `prebuild` prepare pinned MediaPipe assets. The first preparation
requires a build-time model download; its SHA-256 is verified. Later builds can
reuse the verified model offline. See [docs/VISION.md](docs/VISION.md).

```sh
npm run typecheck
npm test
npm run build
node scripts/prepare-vision.mjs --check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri build -- --bundles app
```

On macOS the app bundle includes microphone/camera usage descriptions and capture
entitlements. On Windows build the normal Tauri targets on Windows (override
`bundle.targets` as needed). Windows support is not yet validated.

For private GitHub dependencies, set a repository Actions secret `DEPS_TOKEN`
with read access to `naghma-core` and `pitchforge-rs`. The default Actions token
cannot read other private repositories. CI includes frontend checks and Rust
checks on macOS and Linux; local passes do not imply remote CI has passed.

## Practice

1. Select Microphone and Start listening, or choose Synthetic simulation to
   check the pipeline without hardware. Simulation is always visibly labelled.
2. Set transposition to match your instrument. Measured Hz stays unchanged;
   player notation moves relative to concert pitch.
3. Open Teach Me and choose a note on the fingerboard. The map always uses player
   notation. Reference tones and selected-target cents retain the original target
   pitch, including non-equal-tempered intervals in a loaded maqam dataset.
4. In Maqam Explorer select **Load researched eight**, or import your own sourced
   JSON. The bundled Saba, Nahawand, Ajam, Bayati, Sikah, Hijaz, Rast and Kurd
   illustrations follow MaqamWorld notation and are explicitly provisional
   24-EDO approximations. In Teach Me choose the maqam, tonic and upper-jins route.
   Bayati can be practiced from Re, Sol or La; the interval pattern is transposed
   with diatonic spelling preserved. Use the separate recognition control to set
   its tonic. The synthetic fixture remains test-only.
5. Before camera calibration, measure the instrument dimensions in Settings.
   Mark outer **course centerlines** at nut and fingerboard end in the on-screen
   order. Keep the oud and camera stationary, and recalibrate when either moves.

The dataset schema and validation rules are documented in
[naghma-core's maqam module](https://github.com/MansourAZ0/naghma-core/tree/v0.4.0/crates/naghma-core/src/maqam).
Import is limited to 2 MiB and uses a native file picker. Invalid imports leave
the current dataset intact.

See [docs/MAQAMAT.md](docs/MAQAMAT.md) for source choices, alternatives and
recognition limits. Written scales do not establish exact performance intonation
or a complete maqam sayr.

## Current limits

See [docs/PROGRESS.md](docs/PROGRESS.md) for measured validation and remaining
work. In particular, real oud recordings, physical camera/mic permission flows,
packaged WKWebView/WebView2 inference, field latency and intonation accuracy still
need validation. Camera projection assumes even course spacing and stationary
geometry. Sustained ongoing notes enter maqam history when completed. The current
UI uses one example tuning; arbitrary tuning-profile editing and full structured
lessons remain future work.

Licensed under MIT OR Apache-2.0. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
