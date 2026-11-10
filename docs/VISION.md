# Camera foundation

`src/components/CameraPanel.tsx` is an optional local camera panel. The camera stays
off until **Start camera** is clicked. It requests video only, previews an
unmirrored stream, and transfers `ImageBitmap` frames to a classic worker. There
is at most one bitmap capture/inference in flight. By default the next frame is
captured as soon as a result returns ("As fast as possible"); fixed rates of
2–30 fps remain selectable. Busy, duplicate and background-tab frames are
skipped. Synchronous MediaPipe inference never runs on the React thread. Audio
runs independently. Only the **fretting (note-stopping) hand** is drawn and used.

## Fretting hand only

`src/vision/handSelection.ts` picks at most one hand per result:

1. **Calibrated:** the hand with at least two of its four fretting fingertips
   over the marked fingerboard (slightly widened). The plucking hand works beyond
   the fingerboard end, so it is rejected regardless of labels.
2. **Uncalibrated:** the hand whose MediaPipe handedness label belongs to the
   fretting hand. With the **Fretting hand** setting on **Automatic** (default,
   saved locally) that label is learned from the risha grip, see below;
   **Left**/**Right** fix it for a right-/left-handed player on an unmirrored
   image.
3. **Tracking:** a hand whose palm stays within 12% of the image height of the
   previous selection (within 400 ms) is continued through a brief mislabel or a
   frame where both hands get the same label. Leaving the tracked hand for the
   other one requires three consecutive contrary frames. Otherwise, ambiguous
   frames select nothing rather than guess.

**Handedness finding.** MediaPipe documents that handedness assumes a mirrored
(selfie) image, which would mean swapped labels for this unmirrored camera.
Measured with tasks-vision 0.10.32 on unmirrored oud videos, it is **not**
swapped: in two-hand frames the hand at the neck (the player's left) was
labelled "Left" in 330/330, 472/473 and 249/258 frames on three right-handed
recordings. A neck-left recording (mirrored selfie video or left-handed player)
labelled the neck hand "Right" in 458/469. Labels are therefore taken literally.
For a mirrored test video, tick **Video is mirrored** (shown only for files) or
choose the other fretting hand. Both hands got the same label in 0–4% of
two-hand frames; tracking covers these.

**Automatic fretting hand (`src/vision/handRole.ts`).** A fixed label mapping
fails whenever the image is mirrored (selfie recordings, some virtual or phone
cameras) or the player is left-handed: on the neck-left recording above the
default put the dots on the plucking hand. The plucking hand holds the risha
between thumb and index, the fretting hand's thumb sits behind the neck. The
thumb-tip-to-index distance in palm lengths separates them (all 21 landmarks
re-extracted at 5 fps from the six test clips, 2026-10-26):

| | p10 | p50 | p90 |
| --- | --- | --- | --- |
| Fretting hand | 0.18 | 0.47 | 1.06 |
| Plucking hand | 0.08 | 0.17 | 0.23 |

Comparing the two hands per frame picks the fretting hand in 79–100% of frames
per clip, too noisy alone but mirror-independent; labels are reliable per frame
but their meaning is unknown. So pinch comparisons vote (with exponential
forgetting) on which label is the fretting hand, and selection then uses the
labels. Lone hands vote at half weight only with a clear grip (≤ 0.12 or
≥ 0.45; 94% correct). Until the vote is confident (|evidence| ≥ 3, about 1–2 s)
the worker runs with two hands so both grips are visible. Replaying the
extracted landmarks through the TypeScript selector: fretting hand selected in
698 of 718 measurable two-hand frames, plucking hand in 2, none in 18; on the
mirrored clip 213/216 with no plucking-hand frames (previously almost all).

`src/vision/handCount.ts` adapts MediaPipe's `numHands`: tracking one hand is
about twice as fast as two, but the model may lock onto the plucking hand. The
worker therefore runs with one hand and switches (without restarting) to two
when only a non-fretting hand has been tracked for 4 results, returning once
the fretting hand is confirmed. Retries back off from 1 s to 16 s. Pin
`advanced.worker.numHands` to disable this.

Fusion uses only the selected hand, with its raw landmarks and capture time.
The drawn dots are lightly smoothed (One-Euro, `src/vision/smoothing.ts`);
smoothing never blends across a switch to another hand.

## Real-time pipeline

- Capture is scheduled per presented video frame (`requestVideoFrameCallback`,
  with a `currentTime` fallback if callbacks stop) and immediately on each result.
- The overlay is drawn in a `requestAnimationFrame` loop from a ref, only when
  its content changes. The canvas backing store is resized only when the video
  size changes. Text, fusion and diagnostics re-render at 10 Hz, not per result.
- The model input is capped at 1280 px (longest side). Larger frames are
  downscaled with `createImageBitmap` resize options, or with an OffscreenCanvas
  where those are ignored.
- `advanced.worker.delegate: "GPU"` is supported. If the first GPU inference
  does not return within 4 s, the worker restarts on the CPU. CPU is the
  default (see measurements).
- Diagnostics show inference time, delegate, model input size, model hand
  count, achieved rate, frame age, hands seen and why the fretting hand was
  (not) selected.

Panel props added: `frettingHand?: "left" | "right"` (initial choice when none
is saved) and `advanced?: { worker?, maxInputSize?, smoothing? }` (testing and
tuning). `overlay` is unchanged and renders above the landmark canvas.

## Testing with a video file

**Test with a video file** runs the identical capture/worker/selection/fusion
pipeline on a looping, muted local video instead of the camera. A banner states
that it is a video-file test. Calibration is keyed to `file:<name>`. Nothing is
uploaded.

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
Storage denial is handled. With **Follow the oud** off, moving the camera or oud requires
recalibration; with it on, see "Following the neck" above. Recalibrate deletes the
old saved calibration immediately so an incomplete replacement cannot silently
reuse old geometry after restart.

## Zand overlay

`src/vision/zandOverlay.ts` projects the zand's note positions (`src/lib/zand.ts`)
back onto the image. It uses the homography from the board square to the marked
corners, which is the inverse of fingertip projection, and a unit test checks
this round trip. Shapes are recomputed only when the calibration or the shown
notes change, and the overlay canvas draws them with the existing per-result
redraw:

- course centrelines;
- a ±10-cent quadrilateral across each stopped position, 0.6 course spacings
  tall;
- a ring on each position of the selected target;
- HTML labels using `NoteName`, so quarter-tone glyphs and Arabic render as
  elsewhere. Labels show the target's positions, or the tonic's when nothing is
  selected; open strings get none.

The calibration outline is hidden while the overlay is shown, because the
virtual strings already show it. `CameraPanel` takes this as the optional `zand`
prop (`marks`, `selectedId`, `accidentalStyle`); `null` or no prop draws
nothing. Accuracy is that of the calibration: the even course spacing and the
marked length directly place each zone.

## Following the neck

The neck tracker (`src/vision/neckTracker.ts`) keeps a saved calibration on
the neck when the oud or the camera moves. It runs in a separate module worker
(`neckWorker.ts`, fed by `neckFollower.ts`) on 480 px greyscale frames, about
15 per second, one frame in flight, independent of the hand model.

- **Reference.** When following starts, the current frame becomes the
  reference with the saved corners. Shi–Tomasi corners are taken around the
  neck: 0.3 of its length beyond the nut and 0.2 beyond the end, and 0.45 of
  its width either side, covering the pegbox, nut, rosette and body edge. Hand
  boxes, widened by the tracking window, are excluded.
- **Brightness.** Each frame is normalised to zero mean and fixed contrast, so
  auto-exposure or a fade does not break matching. A flat frame, or a
  reference with fewer than 24 points, is refused and retried on the next
  frame. This covers a camera that is still exposing.
- **Matching.** Every frame is matched directly against a keyframe with
  pyramidal Lucas–Kanade, predicted from the last motion. There is no
  frame-to-frame chaining, so points on strings cannot creep along them. A new
  keyframe is taken only when fewer than 45% of the keyframe's points still
  match.
- **Motion model.** The fit is a RANSAC similarity transform (shift, rotation,
  scale), refined by least squares. The points cluster between the hands, and
  there a full homography extrapolates badly to the corners.
- **Lost.** After 4 failed frames the neck counts as lost. Positions, fusion
  and the zand overlay then pause ("uncalibrated"), and the panel says so.
  Later frames keep trying the keyframe around the last pose.
- **Re-finding.** Optical flow reaches only a few dozen pixels. From the
  second failed frame the neck is looked for across the whole frame, against
  the latest keyframe and the original reference:
  1. *Recognise the oud.* Corners of the oud around the neck (one neck length
     behind the nut to three beyond it, three neck widths either side: the
     pegbox and the face with its rosettes) are matched to corners of the
     frame by appearance: 256-bit rotation-steered BRIEF descriptors, as in
     ORB, mutual nearest neighbours with a ratio test. Strings on dark wood
     alone give too few matches, least of all with a hand over them.
  2. *Rough pose.* A RANSAC similarity that at least 6 matches agree on.
     Where the camera stayed put and only the oud moved, the room agrees on
     "nothing moved", so up to three groups of matches are tried.
  3. *Confirm.* The frame is resampled to undo the rough pose and the
     keyframe's corners are followed into it as in ordinary tracking. At
     least 20% of them (and 12) must agree within 1.5 px on a correction of
     under 14 px, and their 9×9 patches must correlate.
  4. *The neck itself.* The room could pass step 3 on its own, so the neck's
     own corners must look as they did (≥ 8 patches and ≥ 40% of those
     compared). Of the groups that pass, the one with the best share wins.
  5. *Settle on the neck.* The oud is not flat and the camera not far, so
     the pose that suits the whole instrument is a little off at the neck:
     where enough of the neck's corners can be followed, the pose is refitted
     to them alone.

  The frame then becomes the new keyframe. A pose turned more than a quarter
  turn from calibration, or scaled beyond 0.5–2×, is refused. The same
  search runs after a leap of more than 14 px between two frames, where flow
  can settle a little way along the strings; its answer is preferred. After
  30 failed frames (two seconds) only every fourth frame is searched, so an
  oud that has been put down does not keep a core busy.
- **Anchoring.** Every new keyframe inherits the small error of the one
  before. Once a second while following a later keyframe, and whenever a new
  one is due, the original reference frame is followed directly from the
  current pose; if it fits (≥ 45% of its points, within 28 px of the current
  pose) the tracker returns to it and the accumulated error is gone.
- **Noise.** Movement under 0.35 analysis pixels is ignored, so a still oud
  keeps exactly still corners.
- **Saving.** Followed corners are written back to the saved calibration at
  most every 3 s, once they have moved ≥ 0.2% of the width with ≥ 20 agreeing
  points. The next session therefore starts where the neck was. No frames or
  points are stored.

"Follow the oud" in the camera panel (on by default, saved locally) turns this
off.

Measurements (2026-10-27, Apple M2):

- **Speed.** A tracker step on synthetic 480×270 frames took 3.6 ms at the
  median and 15 ms at most, and the reference took 35 ms. The in-app worker
  reported 6–12 ms per frame on the Taqasim School clip in headless Chromium.
- **Accuracy offline.** On that clip, extracted at 15 fps with hand-sized
  exclusion boxes, the tracked nut corner moved from (1124, 235) to (1082, 188)
  over 15 s. It was hand-read at about (1120, 240) and (1080, 190) on the
  1280×720 frames.
- **In the app.** The overlay stayed on the neck while the oud tilted, with
  46–57 agreeing points per frame. With following off, the fixed calibration
  visibly slid off the neck by the end of the clip.
- **Unit tests** use synthetic warps: shift and rotation, a hand-sized
  occluder, a brightness change, an unrelated view and recovery. The
  occluded-nut case keeps the corners within 0.6 px on a 240 px frame.

Re-finding and anchoring (2026-11-10, same machine). Offline numbers are on
480 px frames at 15 fps without hand boxes unless stated.

- **Jumps, six clips.** Real frames of each clip were turned, shifted or
  scaled by a known amount mid-clip (eight jumps per clip: 8° to 50°, 30 to
  70 px, ×0.85 and ×1.2), and the result compared with the same tracker on
  the untouched clip. In 18 of the 48 the neck ends within 20 px of the
  frame edge or partly outside it.

  | | First version (12 matches, neck only) | Now |
  |---|---|---|
  | Followed again within 5 frames | 26 | 48 |
  | … and within 4 px three seconds later | 16 | 35 |
  | Never found in three seconds | 19 | 0 |

  Now the neck is followed again in the same frame or the next, first
  within 0.2–2.1 px on five clips and up to 5.7 px on the shallow-focus
  close-up. The 13 that end more than 4 px off: seven on that close-up,
  five where the neck is at the frame edge, one after a ×1.2 zoom. In each
  the error appears later, when ordinary tracking takes a new keyframe from
  a weak fit; that is not new and is the next thing to fix.
- **With the hand boxes the app sends.** The first version passed its
  offline test and then failed in the app: the fretting hand's box hides
  much of the neck, leaving about 30 points and 5–13 matches. Replaying
  the app's recorded boxes offline reproduced it (never found in 10 s);
  recognising the oud rather than the neck is what fixed it.
- **In the app** (the panel's video-file source in headless Chromium, real
  worker and hand model, Polat clip). A 20° turn and shift cut into the
  clip for ten seconds: lost for the whole ten seconds before; now followed
  again 0.15 s after the cut and 0.16 s after the cut back. Eight seconds
  of another player's clip, then the first back turned −15° and shifted:
  lost throughout the other clip, as it should be, and followed again 0.2–
  0.4 s after the oud returned (never before). The outline sat on the neck
  in every screenshot. Worker time per frame: 5.6 ms median, 12 ms at the
  95th percentile; searching frames up to about 115 ms.
- **Wrong scene.** With each clip's reference, 120 frames of each other
  clip of the same size (2 400 frames in all) gave no fit, and the neck was
  followed at once when its own clip returned. Three of the clips cut to
  another camera or another day mid-way; the neck is reported lost there.
- **Drift.** Over the 45 s Polat clip the unanchored track stretched the
  far (body) end of the board by 6 px while the nut end agreed within
  1.7 px. In the synthetic turn-away-and-back test the corners end
  0.0002 px from the start with anchoring and 0.69 px without.
- **Cost.** Following is unchanged (4–6 ms mean). A searching frame costs
  about 50–100 ms on a 480×270 frame, more than the 66 ms frame interval,
  so the rate drops to about 10 per second while the neck is being looked
  for; it runs in the worker and only then.

Not measured: a live camera, and an oud moving in front of a still room in
real footage (every jump above moves the whole picture; the still-room case
is covered by a synthetic unit test only). There is no hand-marked ground
truth: errors are against the same tracker on the untouched clip, and on
the Polat clip two variants that agreed within 1 px at the nut differed by
4 px at the far end of the board with nothing to say which was right.

Limits: descriptors are single-scale and compared with the keyframes held
in memory, so an oud that returns much nearer or farther, or after a
restart, is not re-found. A wrong saved calibration, for example after the
oud moved between sessions, still reads as lost rather than being
corrected; recalibrate then. Where the room behind the neck fills most of
the tracked region and the oud moves beyond the reach of flow, ordinary
tracking can still settle on the room.

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

Uncalibrated/stale observations, future timestamps, no selected fretting hand,
between-course tips and multiple matching fingers remain unknown. A single match means only
that the geometry is consistent with an audio-derived position. It does **not**
establish which finger is pressing a string or increase the acoustic detector's
confidence. Disagreement preserves the acoustic note. Handedness scores are not
misrepresented as finger-position confidence.

**Matching fingertip.** When the state is `consistent`, that fingertip's
dot is drawn larger, in the heard note's intonation colour from
`src/lib/zand.ts` (within ±10 cents teal-green, flat blue, sharp coral). It
gets a white ring and the note's name, and the other dots dim. `AudioEvidence`
carries the optional `cents` and `label` for this. The highlight shows that
the fingertip is *at* the heard position. It still does not prove that the
finger is pressing the string. Conflict and unknown states keep plain white
dots.

The panel expires position evidence
even when a worker stops delivering results. Stop/unmount cancels animation and
timers, terminates the worker, releases all camera tracks and closes any bitmap
that arrives after stop. Late permission grants are immediately released.

## Validation and limits

Vitest fixtures cover perspective corner/interior transforms, reversed camera
orientation, malformed calibration, storage denial, camera/aspect/geometry
mismatches, freshness/skew/ambiguity/conflict, delayed camera permission, worker
startup cancellation and pending bitmap cleanup. Camera lifecycle tests use
explicit mocks; they are not hardware validation.

These unit tests are not hardware validation. Real-model measurements on
recorded oud video are summarised above; no live camera, permission prompt or
macOS/Windows packaged webview measurement is claimed. The UI's
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

## Measurements on recorded oud video (2026-10-25)

Six YouTube recordings of oud players (front, over-the-shoulder, close-up,
neck-left, 360p webcam; 18–50 s clips) were played through the panel's
video-file source in Playwright's headless Chromium on an Apple M2, using the
real worker and model. Results were recorded from worker messages and canvas
draw calls. "Before" is the previous pipeline with only the video source
added; runs alternated per clip so both saw the same machine load (other jobs
were running; absolute numbers are noisy). Ranges are across the six clips.

| | Before (default 12 fps) | Before (max 30 fps) | After (default) |
|---|---|---|---|
| Results per second | 10.4–10.5 | 18.1–20.5 | 23.3–29.9 |
| Inference p50 | 37–41 ms | 33–38 ms | 18–21 ms (33 ms while searching) |
| Capture → display p50 / p95 | 67 / 67–84 ms | 67 / 67–84 ms | 50–61 / 51–79 ms |
| Age of dots on screen p50 / p95 | 41–58 / 125–136 ms | 34–54 / 72–96 ms | 33–44 / 35–62 ms |
| Results with both hands drawn | up to 99% (front views) | up to 99% | 0% |
| Exactly one hand drawn | 0.6–88% | 0–89% | 46–99% (rest: none) |

Capture → display counts to the next frame boundary after the draw (draws
outside an animation frame wait one more frame). With the two-hand model pinned
the rate was 22–28/s at 33–38 ms per inference. When two hands were detected and
one was drawn, it was the neck-side hand in 466/466, 743/743, 746/747 and
337/337 frames on four clips. On two clips, the apparent disagreements were
duplicate detections of the same hand. In 72 sampled screenshots (12 per clip)
no dots were drawn on the plucking hand. Misses (no dots) occurred mainly with
an over-the-shoulder view where the fretting hand is under the neck (4/12) and
on the 360p webcam clip (about 5/12).

Calibrating a video frame through the UI worked. The fingerboard criterion then
selected exactly one hand in 100% of results. Replaying those landmarks through
geometry and fusion: audio at a fingertip's position was `consistent` and far
audio a `conflict` in the same 99 of 375 frames. The rest were `unknown`,
mostly because a lifted finger lay between courses. Fusion is therefore
decisive in a minority of frames; this is the existing conservative rule.

**What did not help:** downscaling the model input to 640/480/320 px. On 120
still frames, detection time was unchanged (MediaPipe resizes to fixed model
inputs) while fingertips moved by p90 18–25 px on close-ups at 640 px. Lowering
the confidence thresholds to 0.5 was not faster (p50 51 vs 44 ms on one clip,
measured under load), so they stay at 0.7. **GPU delegate:** in headed Chrome it ran at ~25 ms against ~36 ms
CPU under the same load; in headless Chromium/Chrome its first inference never
returned (hence the watchdog). It stays opt-in until tested in the packaged
WKWebView/WebView2.

**Smoothing** (One-Euro, minCutoff 3 Hz, beta 5) was tuned offline on recorded
fretting-hand landmarks. Still-hand jitter fell from 6.4 to 4.2 px (1280-px
frame) for ~22 ms lag on moving fingers; heavier settings cost ~30 ms. Disable
it with `advanced.smoothing: false`.

These are headless-Chromium measurements on downloaded video. They are not a
packaged WKWebView/WebView2, a live camera (which adds sensor/exposure latency)
or an idle machine.

References: [official Hand Landmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js)
documents local model setup and blocking inference; [model overview](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)
describes the hand model and landmark outputs.
