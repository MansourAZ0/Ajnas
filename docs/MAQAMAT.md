# Sourced maqam illustrations in Ajnas 0.2

Choose **Maqam Explorer → Load researched eight**, then **Teach Me**. Loading
persists this dataset locally and replaces the selected dataset. It is opt-in;
custom sourced JSON remains supported. All eight source-specific reference
scales appear in Explorer, with Arabic and Latin solfege labels.

Teach Me independently selects a maqam, one of 24 quarter-tone tonic classes,
an upper-jins route and a tonic octave. For periodic illustrations the board
covers reachable octaves. For Saba it shows only the source's illustrated span
above that particular tonic octave. A different octave moves that passage.

**Use this tonic for recognition** sets the analysis tonic in the existing
player/sounding analysis space. Teaching remains in player notation. Instrument
transposition changes target sound, while fingerboard positions keep their player
identity. Recognition still evaluates every maqam and its alternatives; choosing
a teaching route does not constrain recognition to that route.

## Source interpretation

The definitions live in the independent naghma-core v0.4.0 library. See its
[research record](https://github.com/MansourAZ0/naghma-core/blob/v0.4.0/docs/MAQAMAT_RESEARCH.md)
for MaqamWorld citations, exact reference tonics, Bayati on Re/Sol/La and the
[Asmar transposition chart](https://www.turath.org/Resources/MaqamTrans.htm).

- Upper Rast and Upper Ajam have their tonal centre at the top of their span.
  The chart distinguishes placement degree from tonal-centre degree.
- Bayati on La with the Rast upper route uses **Fa half-sharp**, while the
  Nahawand upper route uses Fa natural. It is not Fa half-flat.
- Saba's Nikriz route and Ajam route have different eighth degrees. They are
  separate illustrations, and neither is imposed as a universal octave pattern.
- Source reference tonics are teaching conventions, not restrictions. Mathematical
  transposition does not automatically confer another traditional maqam name.

## What evaluation establishes

Every numeric interval is an explicit 24-EDO approximation of written notation.
It is not measured Arabic intonation. These are provisional sourced illustrations,
not a complete theory of sayr, characteristic phrases or modulation. No such
phrases or modulation paths were invented.

Recognition compares alternatives separately rather than accepting their union.
It may score a real performance using several valid routes less well than a
single source illustration; “outside the selected illustration” does not mean
foreign to the whole maqam. Scores are heuristics, not probabilities. Nonperiodic
Saba recognition compares absolute pitches and reports the inferred tonic octave.

Automated checks cover canonical source spellings, all 24 tonic classes, Bayati
Re/Sol/La, separate route scoring, bounded Saba, jins placement and player/sounding
transposition. Real-performance accuracy remains unevaluated. Next validation
requires licensed or user-supplied labelled oud performances, including different
tonics, registers, ornamentation, ringing strings and instrument transpositions,
plus musician assessment of target intonation and teaching usefulness.
