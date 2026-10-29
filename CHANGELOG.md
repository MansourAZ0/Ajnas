# Changelog

## [Unreleased]

### Changed
- Install the sibling shared UI dependencies explicitly for reproducible clean builds.
- Align shared-UI CI and setup with the existing naghma v0.5.0 dependency tag.
- Use anonymous public dependency fetching and read-only workflow permissions.
- Include Apache license text and third-party notices beside generated vision assets.
- Replace committed local Cargo configuration with an optional example.
- Remove internal account information from current public documentation.

### Added
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
