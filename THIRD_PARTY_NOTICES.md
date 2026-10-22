# Third-party notices

Ajnas uses open-source libraries with their respective licenses. Cargo.lock and
package-lock.json record the exact dependency graph.

The packaged vision runtime includes Google MediaPipe Tasks Vision 0.10.32
(JavaScript and WASM), licensed under Apache License 2.0. The Hand Landmarker
float16/1 model is distributed from Google's official MediaPipe model repository.
Its pinned download URL and SHA-256 are in `scripts/prepare-vision.mjs` and in the
generated asset manifest. See the [MediaPipe repository](https://github.com/google-ai-edge/mediapipe)
and [Hand Landmarker documentation](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker).

The generated classic-worker wrapper is an integration adaptation around the
original package CJS bundle. Vendor bytes are otherwise preserved. Generated
assets are installed at build preparation and included in the app bundle.

The Apache-2.0 license is included as LICENSE-APACHE. Other dependency notices
must be retained by distributors as required by those dependencies.
