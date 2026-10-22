# Camera foundation

`src/components/CameraPanel.tsx` is an optional local camera panel. The camera stays
off until **Start camera** is clicked. It requests video only, previews an
unmirrored stream, and transfers `ImageBitmap` frames to a classic worker. There
is at most one bitmap capture/inference in flight. The rate is adjustable from
1–30 fps; busy, duplicate and background-tab frames are skipped. Synchronous
MediaPipe inference never runs on the React thread. Audio runs independently.

## Integration

1. Add exact runtime dependency `@mediapipe/tasks-vision: "0.10.32"` and development
   dependency `vitest: "5.0.5"` to the parent-owned package manifest/lockfile.
2. Run `node scripts/prepare-vision.mjs` after installation and before Vite dev or
   production builds. Add it to `predev`/`prebuild` (or equivalent build hooks).
   The script checks the installed version, copies its JavaScript/WASM, downloads
   the official versioned float16/1 hand model at build preparation only, verifies
   its pinned SHA-256, and writes `public/vision/manifest.json` with all hashes.
   Generated assets are ignored by Git; deployments must prepare them before Vite
   copies `public` into `dist`. `node scripts/prepare-vision.mjs --check` verifies
   all prepared files without network requests. Subsequent normal preparations
   also work offline while the verified model and installed package are present.
3. Render `<CameraPanel arabic={arabic} audio={audioEvidence}
   fingerboardLengthMm={measuredNutToFingerboardEndMm} courses={courseCount} />`.
   Named and default exports are available. Existing `panel`, `button`, and
   `field` CSS classes are used; video/canvas alignment is inline.
4. `audioEvidence` is `{ receivedAt, playerPitch, confidence, positions }`, or
   `null`. Stamp `receivedAt` with **main-window `performance.now()`** when the
   acoustic event arrives. `playerPitch` is the continuous, player-relative
   acoustic pitch, and confidence is 0–1. `positions` contains all acoustically
   plausible `{ course, distanceMm }` pairs. **Courses are zero-based, lowest
   pitch first**. Convert backend indexing if necessary. Distance is measured
   from the nut. Never pass epoch, backend or worker clock timestamps here.
5. Run `npx vitest run src/vision` and the normal TypeScript/Vite build.

All worker/model/WASM requests are to the app's own `vision/` directory, respecting
Vite `BASE_URL`. There is no runtime CDN or cloud inference fallback. The worker
uses the package CJS bundle scoped to a local `exports` object so its WASM loader
can use classic-worker `importScripts`; a module worker is intentionally avoided.
The generated vendor bundle remains Apache-2.0; the model is retrieved from the
official MediaPipe model repository. Review distribution attribution as part of
the parent's release packaging.

Tauri/webview integration is parent-owned: provide platform camera usage strings
and required native capture entitlements. The webview must permit same-origin
workers/scripts/model requests and WASM compilation in its content security
policy (including `worker-src 'self'` and, where required, the engine's WASM CSP
directive). No broad remote host allowlist is needed. Test the actual WKWebView
and WebView2 versions before release. If worker `OffscreenCanvas`, ImageBitmap,
camera capture or WASM is unavailable, this panel reports an error and releases
the stream; it does not move inference onto the UI thread.

## Manual calibration

Keep the camera and oud stationary. Mark the **outer course centerlines**, rather
than decorative neck edges, in this precise order:

1. Nut at the lowest-pitched course.
2. Nut at the highest-pitched course.
3. Fingerboard end at the highest-pitched course.
4. Fingerboard end at the lowest-pitched course.

Low/high always describes pitch, regardless of image orientation. Confirm the
orientation and nut-to-end length before saving. `fingerboardLengthMm` means the
physical distance spanned by the marked nut and end points; it is **not** the
full vibrating scale length unless the marked region actually spans that length.
The parent must supply a measured/configurable value, not silently treat the
scale length as fingerboard length. Convexity, minimum size, finite coordinates,
and solvability are checked. Semantic labels depend on the user's confirmation;
geometry alone cannot recognize which end is the nut.

A pure homography maps the perspective quadrilateral onto a normalized board:
length 0→1 from nut to end; width 0→1 from low to high course. The four fretting
fingertips are projected into millimeters and course candidates. The thumb is
drawn but excluded from fretting evidence. A tip more than 0.3 course spacings
from a centerline has unknown course. Courses are assumed evenly spaced in the
rectified plane; the method does not resolve individual strings in a pair.

Calibration stores only corners, camera ID, aspect, instrument geometry, version
and save time in local storage. It is reused only for the same camera, aspect
(within 0.5%), length and course count. Raw frames/landmarks are not persisted.
Storage denial is handled. Moving the camera **or oud** requires recalibration;
there is no automatic instrument-motion detector yet. Recalibrate deletes the
old saved calibration immediately so an incomplete replacement cannot silently
reuse old geometry after restart.

## Timestamping and conservative fusion

The main window stamps capture before creating each bitmap. On worker receipt,
the main window stamps `receivedAt` and `timestamp` with `performance.now()`.
The worker clock is used only for the reported inference duration. Both clocks
used for freshness are therefore on the same main-window timebase as audio.

`fusePosition` returns an unmodified acoustic player pitch and a separate
`consistent`, `conflict` or `unknown` position state. Defaults: audio confidence
at least 0.8; audio receipt, video capture and video receipt no older than 300 ms;
capture/audio skew at most 150 ms; longitudinal tolerance 12 mm. These are
conservative engineering heuristics, not calibrated probabilities. The module
exports options for future measured tuning.

Uncalibrated/stale observations, future timestamps, multiple hands, between-course
tips and multiple matching fingers remain unknown. A single match means only
that the geometry is consistent with an audio-derived position. It does **not**
establish which finger is pressing a string or increase the acoustic detector's
confidence. Disagreement preserves the acoustic note. Handedness scores are not
misrepresented as finger-position confidence. The panel expires position evidence
even when a worker stops delivering results. Stop/unmount cancels animation and
timers, terminates the worker, releases all camera tracks and closes any bitmap
that arrives after stop. Late permission grants are immediately released.

## Validation and limits

Vitest fixtures cover perspective corner/interior transforms, reversed camera
orientation, malformed calibration, storage denial, camera/aspect/geometry
mismatches, freshness/skew/ambiguity/conflict, delayed camera permission, worker
startup cancellation and pending bitmap cleanup. Camera lifecycle tests use
explicit mocks; they are not hardware validation.

No real camera/oud inference, permission prompt, macOS/Windows packaged webview,
or realistic CPU/latency measurement is claimed by these tests. The UI's
inference duration and frame age are live diagnostics, not benchmark results.
On 2026-10-22, the production Vite build's local classic worker successfully
initialized the real pinned WASM/model in the T3 Chromium preview and processed
a generated 128×128 solid image, returning zero hands as expected. Cold inference
for that single synthetic smoke frame was approximately 599 ms. This establishes
local worker/model loading and inference only, not performance with a camera,
warm throughput or platform webview compatibility. Its frame would correctly
expire under the default 300 ms fusion limit.
Actual worker/WASM/webview compatibility, occlusion, multiple fingers, contact,
motion, course-spacing accuracy and performance alongside native audio require
physical-device testing. Canvas calibration currently requires a pointer.

References: [official Hand Landmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js)
documents local model setup and blocking inference; [model overview](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)
describes the hand model and landmark outputs.
