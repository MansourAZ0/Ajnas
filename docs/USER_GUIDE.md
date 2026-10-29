# Practice guide


Everything lives on one page built around the camera view. The header holds
the audio source, **Start listening** / **End session** and **Settings** (a
drawer with instrument, notation and display options). Synthetic simulation is
always labelled, both in a banner and inside the camera view.

- **Camera view.** Start the camera and calibrate inside the camera panel.
  Cards along the top edge of the video leave the oud and hand clear: the
  live note (player or concert per Settings, cents, the other name and input
  level, dimmed between notes), the current transposition with the La4
  reference, and the maqamat detected during the last 30 seconds, newest first,
  marked leading or ambiguous, with their age. A selected teaching target adds
  a coaching card. Maqam cards are heuristic and show dataset provenance.
- **Side panel tabs.** *Tuner*: note, cents meter, Hz, periodicity, input
  level and the melodic trail. *Maqam*: hypotheses with evidence and
  provenance. *Teach Me*: maqam, tonic, upper-jins route and octave,
  selected-target coaching and the reference tone. *Library*: load the
  researched eight, import or remove a dataset, recognition options and the
  maqam explorer.
- **Below the camera.** The fretless fingerboard (always player notation)
  and, for a selected maqam, its scale and ajnas. Diagnostics appear here when
  enabled in Settings.
- **The animated zand (زند).** By default the fingerboard is drawn as an oud
  neck. With a maqam selected each position is labelled and the tonic is gold.
  A faint halo marks ±10 cents around each theoretical position. While you
  play, the strings that could have produced the note vibrate beyond the
  stopped point and the position glows teal-green (within ±10 cents), blue
  (flat) or coral (sharp). Audio alone cannot tell which course you used, so
  every candidate position lights. Turn the zand off in Settings → Display
  to get the plain map. The Animation setting and the system's reduced-motion
  preference also apply: Reduced animation drops the ripples and keeps only a
  small string movement, and Off draws only the glow.

1. Select Microphone and Start listening, or choose Synthetic simulation to
   check the pipeline without hardware.
2. Set transposition in Settings to match your instrument. Measured Hz stays
   unchanged; player notation moves relative to concert pitch.
3. Pick a note on the fingerboard. Reference tones and selected-target cents
   keep the original target pitch, including non-equal-tempered intervals in a
   loaded maqam dataset.
4. In Library select **Load researched eight**, or import your own sourced
   JSON, and enable analysis. The bundled Saba, Nahawand, Ajam, Bayati, Sikah,
   Hijaz, Rast and Kurd illustrations follow MaqamWorld notation and are
   explicitly provisional 24-EDO approximations. In Teach Me choose the maqam,
   tonic and upper-jins route. Bayati can be practiced from Re, Sol or La; the
   interval pattern is transposed with diatonic spelling preserved. Use the
   separate recognition control to set its tonic. The synthetic fixture
   remains test-only.
5. Before camera calibration, measure the instrument dimensions in Settings.
   Mark outer **course centerlines** at nut and fingerboard end in the on-screen
   order. Keep the oud and camera stationary, and recalibrate when either moves.
   Once calibrated, the white fingertip dot that sits at the heard note's
   position lights up in the intonation colour, with the note's name. Teal-green
   means within ±10 cents, blue flat and coral sharp.
6. With a calibration saved, the zand is also drawn on the real neck in the
   camera image. Faint virtual strings run along the courses, and a small
   ±10-cent zone sits at every position of the shown notes (tonic gold,
   quarter tones teal). The selected target gets a ring and its name. With no
   target selected, the tonic positions are named instead. If the virtual
   strings do not lie on the real ones, recalibrate. The zones are only as
   accurate as the four marked corners and the measured length. Turn this off
   in Settings → Display.

For browser-only UI work, `npm run dev` and open `/?mock` to use a dev-only
Tauri IPC mock (`src/dev/mockTauri.ts`; options `lang=ar`, `maqam=off`,
`dataset=none`, `analysisMs=`). It replays fixtures serialized from the Rust
backend and is excluded from production builds.

The dataset schema and validation rules are documented in
[naghma-core's maqam module](https://github.com/MansourAZ0/naghma-core/tree/v0.5.0/crates/naghma-core/src/maqam).
Import is limited to 2 MiB and uses a native file picker. Invalid imports leave
the current dataset intact.

See [docs/MAQAMAT.md](docs/MAQAMAT.md) for source choices, alternatives and
recognition limits. Written scales do not establish exact performance intonation
or a complete maqam sayr.
