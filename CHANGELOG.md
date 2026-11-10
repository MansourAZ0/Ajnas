# Changelog

## [Unreleased]

### Added
- Camera: a lost neck is found again by appearance wherever it returns in
  the picture (turned up to a quarter turn, between half and twice the
  size), usually within two frames of a sudden jump, without recalibrating.
  The oud around the neck is what is recognised (pegbox, face, rosettes),
  so this also works with a hand over the neck; the pose is then checked
  and settled on the neck itself.
  The tracker also returns to the calibration frame whenever the view is
  close to it, which removes drift built up over a long session.
- "Maqam of this piece": the maqam of the whole performance so far, shown
  above the jins reading (naghma-core/naghma-audio v0.8.0). It stays put
  while a passage visits another maqam, and a silence of 20 s starts a new
  piece. On full-length recordings it names the stated maqam at the end in
  91% (development) and 84% (held-out) of them, against 57% and 55% for the
  ten-second reading.

### Changed
- naghma-core/naghma-audio v0.7.0: a passage in a maqam's upper jins is
  read as that jins, not as another maqam (Hijaz's upper Nahawand on Sol no
  longer becomes maqam Nahawand). Recognition weighs phrase endings and keeps
  a fading memory of earlier material; live analyses naming a recording's
  stated maqam rose from 52% to 73% on the library's held-out recordings.
  "Possible modulation" now names a jins outside the maqam and appears far
  less often.
- naghma-core/naghma-audio v0.6.0 and pitchforge v0.1.1: maqam ranking over
  the last 10 s instead of 30 s (sections of a taqsim in different maqamat
  are no longer mixed), Sikah's Huzam route, fewer false notes from pluck
  transients and octave errors, notes shown about 20 ms sooner after a pluck,
  and the library's audio start/stop race fixed.
- Maqam analysis defaults to a 10 s window updated every 2 s. Settings saved
  with the old 30 s / 5 s defaults (there was no control for them) move to
  the new ones; other values are kept.
- Install the sibling shared UI dependencies explicitly for reproducible clean builds.
- Align shared-UI CI and setup with the existing naghma v0.5.0 dependency tag.
- Use anonymous public dependency fetching and read-only workflow permissions.
- Include Apache license text and third-party notices beside generated vision assets.
- Replace committed local Cargo configuration with an optional example.
- Remove internal account information from current public documentation.

### Added
- Maqam tab: *Now playing in* shows the jins of the leading maqam the last
  few seconds dwell in, labelled first jins (الجنس الأول) or second jins
  (الجنس الثاني), with a named possible modulation when the music leaves the
  maqam. Evidence chips show phrase endings on the tonic and the tonic
  register.
- Animated oud neck (zand, زند) for the fingerboard: tapered ebony neck, note
  labels and tonic highlighting for the selected maqam, ±10-cent halos,
  vibrating strings, intonation-coloured glow and pluck ripples. Optional
  (Settings → Display), and it follows the animation and reduced-motion settings.
- Camera: the fingertip at the heard note's position is drawn in its
  intonation colour with the note name (after calibration, when audio and
  vision agree); the other fingertip dots dim.
- Zand on the camera image: after calibration, virtual strings, ±10-cent
  zones for the shown notes, the selected target's ring and note names are
  drawn on the real neck. Optional (Settings → Display).
- Camera: follow the oud. After calibration, a worker tracks the neck
  (Lucas–Kanade against a keyframe, RANSAC similarity, exposure
  normalisation, hands excluded) and keeps the calibration on it as the oud or
  camera moves. It pauses positions when the neck is lost and saves the
  followed corners. Optional in the camera panel.
- Accessible README and practice guide, credits, privacy/contribution/release guides,
  audit, source exporter, secret/dependency checks and dependency update configuration.
