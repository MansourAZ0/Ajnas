# Ajnas · أجناس

An oud practice companion with a tuner, a fingerboard map, maqam teaching, and
optional camera tracking—all on one practice page.

Listen to a note, see its Arabic or Latin solfège name, and compare it with a
practice target. Choose a maqam to explore its written scale and fingerboard
positions. You can also use a camera to track the fretting hand.

**Early development, not a finished music tutor.** Maqam suggestions and camera
positions are aids to practice, with important limits described below.

## What works

- Microphone analysis, quarter-tone names, a cents meter, and recent-note trail.
- Player names and concert pitch, transposition, and adjustable reference pitch.
- English/Arabic interface with right-to-left layout.
- Interactive oud fingerboard, selectable targets, and electronic reference tones.
- Optional sourced illustrations of eight maqamat, with 24 tonic choices and
  separate upper-jins routes. Imported JSON can preserve custom intervals.
- Optional maqam suggestions, with supporting and contradicting evidence.
- Optional local hand tracking, fretting-hand selection, and manual calibration.
- Clearly labelled synthetic audio for trying the app without an instrument.

A quarter-tone is half a semitone. A cent is one hundredth of a semitone.
The example oud tuning is Do2–Fa2–La2–Re3–Sol3–Do4; instrument dimensions and
transposition are adjustable.

## Run from source

Install current stable Rust (the app declares 1.90+), Node 24+, and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
Linux also needs ALSA development headers. macOS is the main development
platform; Windows still needs validation.

Clone both repositories into the same parent folder. Ajnas uses the shared UI
and Rust libraries from `naghma-core` **v0.8.0**:

```sh
git clone --branch v0.8.0 https://github.com/MansourAZ0/naghma-core.git
git clone https://github.com/MansourAZ0/Ajnas.git
cd Ajnas
npm ci --prefix ../naghma-core/packages/naghma-ui
npm ci
npm run tauri dev
```

The first launch preparation downloads a pinned hand-tracking model and verifies
its SHA-256. Later builds reuse the verified local copy. Inference runs locally;
there is no runtime model CDN. See [vision setup](docs/VISION.md).

## Your first practice session

1. Choose **Microphone** and **Start listening**, or select **Synthetic simulation**.
2. In **Settings**, choose the language, note script, reference pitch, and
   transposition that match your instrument.
3. Use the **Tuner** tab to check a single sustained note.
4. In **Library**, choose **Load researched eight**. Open **Teach Me**, select a
   maqam, tonic and upper-jins route, then click a note to practise its target.
5. Start the camera only if you want hand tracking. Measure the instrument and
   calibrate the course centre lines while keeping the camera and oud still.

The camera view can display the live note, transposition, selected-target advice,
and recent maqam suggestions. Other panels remain available on the same page.
The [practice guide](docs/USER_GUIDE.md) explains these controls in more detail.

## Privacy

Microphone and camera stay off until started. The app does not record or upload
audio or video. Settings, imported maqam data and camera calibration are stored
locally. The build process needs network access for dependencies and the initial
model download. See [security and privacy](SECURITY.md).

## What the results mean

- **Pitch:** one note at a time. Noise, harmonics and overlapping strings can
  produce wrong or unstable estimates. Confidence is not a correctness probability.
- **Maqam:** a heuristic suggestion from recent notes, not an authoritative
  identification. A scale is only part of a maqam; phrasing and musical movement
  matter too. The eight examples approximate written notation in 24 equal steps,
  and still need musician review. See [sources and limits](docs/MAQAMAT.md).
- **Camera:** landmarks and calibrated positions, not verified finger contact
  with a string. Occlusion or moving the oud/camera can invalidate the result.
  Vision never changes the acoustically measured note.
- **Platforms:** packaged camera inference, physical permissions, latency,
  accessibility and public distribution still need broader validation.

## How the repositories fit together

| Repository | Role |
| --- | --- |
| [pitchforge-rs](https://github.com/MansourAZ0/pitchforge-rs) | Generic pitch estimation. |
| [naghma-core](https://github.com/MansourAZ0/naghma-core) | Music theory, audio worker, shared React components. |
| [watar-tuner](https://github.com/MansourAZ0/watar-tuner) | A standalone tuner using the same libraries. |
| **Ajnas** | Practice, teaching, camera and audio/vision coordination. |

Ajnas consumes the libraries directly; it does not depend on Watar. Rust releases
are pinned to `naghma-core`/`naghma-audio` **v0.8.0** and `pitchforge` **v0.1.1**
in `src-tauri/Cargo.lock`. New library fixes need new tags before reaching the app.

## Development

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

For browser-only UI development, `npm run dev` with `/?mock` enables a development
IPC fixture. It is excluded from production builds. See [contributing](CONTRIBUTING.md),
[existing validation](docs/PROGRESS.md) and the [current audit](docs/AUDIT.md).

## Credits and license

The pitch layer implements YIN by **Alain de Cheveigné and Hideki Kawahara**.
[Alessandro Genova's pitch-detection](https://github.com/alesgenova/pitch-detection)
is acknowledged as related Rust prior work. Arabic solfège, quarter-tones, maqam
structures and oud geometry are provided by this ecosystem's `naghma-core`.
Google MediaPipe supplies hand landmarks; Ajnas adds calibration and practice
integration. See [credits](CREDITS.md) for the scope of each contribution.

Project code: [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
Dependencies and model assets have their own terms. See
[third-party notices](THIRD_PARTY_NOTICES.md) and the
[open-source release guide](docs/OPEN_SOURCE.md).
