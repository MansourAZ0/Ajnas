# Third-party notices

Project code is offered under MIT OR Apache-2.0; see LICENSE-MIT and
LICENSE-APACHE. This choice does not relicense dependencies, external datasets,
models, or recordings. Retain their applicable notices when redistributing.

See [CREDITS.md](CREDITS.md) for YIN's authors and related prior work. Genova's
library is acknowledged as prior work, not listed as a verified copied dependency.
The lockfiles record resolved software dependencies. Cargo and npm packages may
have different terms, including platform-specific dependencies.

Before distributing a compiled application, collect the copyright, license and
NOTICE files for its resolved Rust and JavaScript dependencies. A source license
alone is not a complete binary-distribution notice bundle.

## MediaPipe runtime and model

The build copies `@mediapipe/tasks-vision` **0.10.32** JavaScript and WASM assets
into the application. The npm package declares Apache-2.0. The classic worker
wrapper is an Ajnas integration adaptation; the vendor bundle is otherwise
preserved. The generated asset directory includes a copy of the Apache license
and this notice. See the [MediaPipe source](https://github.com/google-ai-edge/mediapipe).

The separately downloaded Hand Landmarker model is `float16/1`. Its official URL
and SHA-256 are pinned in `scripts/prepare-vision.mjs` and the generated manifest.
See the [Hand Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker).
The npm runtime's license declaration does not itself establish the separate
model's redistribution terms. Confirm and retain the terms for that exact asset
before publishing a bundle containing it. Source exports omit the downloaded
model; the preparation script retrieves it during development.

## Musical references and recordings

Maqam data contains source-labelled interval transcriptions and original project
summaries. Keep its provenance and provisional status. External notation images,
reference-page prose, evaluation recordings and videos are not included in the
source export or relicensed by this project. Links in research/evaluation docs
credit their sources; a link does not grant permission to redistribute media.
