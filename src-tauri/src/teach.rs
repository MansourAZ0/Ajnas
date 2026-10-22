//! Display-ready teaching targets derived exclusively from naghma-core.
use crate::settings::Settings;
use naghma_core::instrument::FingerPosition;
use naghma_core::maqam::MaqamDataset;
use naghma_core::maqam::{Maqam, Name};
use naghma_core::notation::{NoteLabel, SpelledNote};
use naghma_core::pitch::Pitch;
use naghma_core::tuning::NoteSpelling;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub id: String,
    pub label: NoteLabel,
    pub sounding_label: NoteLabel,
    pub player_pitch: f64,
    pub sounding_hz: f64,
    pub positions: Vec<FingerPosition>,
    pub step: Option<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScaleNote {
    pub label: NoteLabel,
    pub cents: f64,
    pub step: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JinsInfo {
    pub name: Name,
    pub on_step: u8,
    pub tonic_step: u8,
    pub notes: Vec<NoteLabel>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScaleInfo {
    pub maqam_id: String,
    pub tonic: NoteLabel,
    pub octave_repeating: bool,
    pub notes: Vec<ScaleNote>,
    pub ajnas: Vec<JinsInfo>,
    pub sources: Vec<String>,
}

pub fn scale_info(
    settings: &Settings,
    dataset: &MaqamDataset,
    maqam: &Maqam,
    root: SpelledNote,
    variant: Option<&str>,
) -> Result<ScaleInfo, String> {
    let labels = settings.notation.label_options();
    let degrees = maqam.scale(variant).map_err(|e| e.to_string())?;
    let realized = maqam
        .realize_variant(root, variant)
        .map_err(|e| e.to_string())?;
    let notes = realized
        .iter()
        .zip(degrees)
        .map(|(n, d)| ScaleNote {
            label: n.note.label(&labels),
            cents: d.cents,
            step: d.step,
        })
        .collect();
    let ajnas = maqam
        .placements(variant)
        .map_err(|e| e.to_string())?
        .iter()
        .filter_map(|p| {
            let jins = dataset.jins(&p.jins)?;
            let base_cents = degrees.iter().find(|d| d.step == p.on_step)?.cents;
            let joined: Vec<naghma_core::maqam::ScaleDegree> = jins
                .degrees
                .iter()
                .map(|d| naghma_core::maqam::ScaleDegree {
                    step: p.on_step + d.step,
                    cents: base_cents + d.cents,
                })
                .collect();
            let jins_notes = naghma_core::maqam::realize(root, &joined);
            Some(JinsInfo {
                name: jins.name.clone(),
                on_step: p.on_step,
                tonic_step: p.on_step + jins.tonic_step,
                notes: jins_notes.iter().map(|n| n.note.label(&labels)).collect(),
            })
        })
        .collect();
    let sources = variant
        .and_then(|id| maqam.variants.iter().find(|v| v.id == id))
        .map_or_else(|| maqam.sources.clone(), |v| v.sources.clone());
    Ok(ScaleInfo {
        maqam_id: maqam.id.clone(),
        tonic: root.label(&labels),
        octave_repeating: maqam.octave_repeating,
        notes,
        ajnas,
        sources,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fingerboard {
    pub name: String,
    pub scale_length_mm: f64,
    pub fingerboard_length_mm: f64,
    pub courses: Vec<NoteLabel>,
    pub targets: Vec<Target>,
    pub scale: Option<ScaleInfo>,
}

pub fn fingerboard(
    settings: &Settings,
    dataset: Option<&MaqamDataset>,
    maqam_id: Option<&str>,
    tonic: Option<NoteSpelling>,
    octave: i8,
    variant: Option<&str>,
) -> Result<Fingerboard, String> {
    let profile = settings.instrument();
    let ctx = settings.notation.pitch_context();
    let labels = settings.notation.label_options();
    let mut scale = None;
    let notes: Vec<(SpelledNote, Pitch, Option<u8>)> = if let Some(id) = maqam_id {
        let maqam = dataset
            .and_then(|d| d.maqamat.iter().find(|m| m.id == id))
            .ok_or("Select a maqam from the loaded dataset")?;
        if !(0..=6).contains(&octave) {
            return Err("tonic octave must be 0-6".into());
        }
        let spelling = tonic.unwrap_or(maqam.tonic);
        let root = SpelledNote::new(spelling.degree, spelling.accidental, octave);
        scale = Some(scale_info(
            settings,
            dataset.expect("maqam was found"),
            maqam,
            root,
            variant,
        )?);
        let (lo, hi) = profile.player_range();
        maqam
            .targets_between(root, variant, lo, hi)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|n| (n.note, n.pitch, Some(n.step)))
            .collect()
    } else {
        profile
            .fingerboard_map(&ctx.tuning)
            .into_iter()
            .map(|n| (n.note, n.pitch, None))
            .collect()
    };
    let mut targets: Vec<Target> = notes
        .into_iter()
        .filter_map(|(note, pitch, step)| {
            let positions = profile.positions_for(pitch);
            if positions.is_empty() {
                return None;
            }
            let sounding = profile.transposition.player_to_sounding(pitch);
            let sounding_hz = sounding.to_frequency(profile.reference);
            let sounding_note = ctx.read(sounding_hz)?.sounding.note;
            Some(Target {
                id: format!("{:.6}", pitch.0),
                label: note.label(&labels),
                sounding_label: sounding_note.label(&labels),
                player_pitch: pitch.0,
                sounding_hz,
                positions,
                step,
            })
        })
        .collect();
    targets.sort_by(|a, b| a.player_pitch.total_cmp(&b.player_pitch));
    targets.dedup_by(|a, b| (a.player_pitch - b.player_pitch).abs() < 1e-8);
    Ok(Fingerboard {
        name: profile.name,
        scale_length_mm: profile.scale_length_mm,
        fingerboard_length_mm: profile.fingerboard_length_mm,
        courses: profile
            .courses
            .iter()
            .map(|c| c.open.label(&labels))
            .collect(),
        targets,
        scale,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use naghma_core::pitch::{IntervalUnit, Transposition};

    #[test]
    fn transpose_changes_target_sound_but_preserves_positions() {
        let mut s = Settings::default();
        let before = fingerboard(&s, None, None, None, 3, None).unwrap();
        s.notation.transposition = Transposition::new(-2.0, IntervalUnit::Semitone);
        let after = fingerboard(&s, None, None, None, 3, None).unwrap();
        for (a, b) in before.targets.iter().zip(&after.targets) {
            assert_eq!(a.positions, b.positions);
            assert_eq!(a.label, b.label);
            assert!((1200.0 * (a.sounding_hz / b.sounding_hz).log2() - 200.0).abs() < 1e-7);
        }
        assert!(after.targets.iter().any(|t| t.positions.len() > 1));
    }

    #[test]
    fn maqam_targets_retain_custom_cents_instead_of_snapping() {
        let mut ds = MaqamDataset::from_json(include_str!(
            "../tests/fixtures/synthetic-maqam-dataset.json"
        ))
        .unwrap();
        ds.maqamat[0].ascending[1].cents = 183.0;
        let board = fingerboard(
            &Settings::default(),
            Some(&ds),
            Some(&ds.maqamat[0].id),
            Some(NoteSpelling::new(
                naghma_core::notation::Degree::Do,
                naghma_core::notation::Accidental::NATURAL,
            )),
            3,
            None,
        )
        .unwrap();
        assert!(
            board
                .targets
                .iter()
                .any(|t| (t.player_pitch - 49.83).abs() < 1e-8)
        );
        assert!(fingerboard(&Settings::default(), None, Some("missing"), None, 3, None).is_err());
    }

    #[test]
    fn sourced_bayati_transposes_chart_and_positions_without_changing_sound_identity() {
        let ds = MaqamDataset::teaching_eight_24edo();
        let mut s = Settings::default();
        s.notation.transposition = Transposition::new(-2.0, IntervalUnit::Semitone);
        let la = Some(NoteSpelling::new(
            naghma_core::notation::Degree::La,
            naghma_core::notation::Accidental::NATURAL,
        ));
        let board = fingerboard(&s, Some(&ds), Some("bayati"), la, 3, Some("rast-upper")).unwrap();
        let chart = board.scale.unwrap();
        assert_eq!(chart.notes[5].label.text, "Fa𝄲4");
        assert_eq!(chart.tonic.text, "La3");
        let target = board
            .targets
            .iter()
            .find(|t| t.label.text == "Fa𝄲4")
            .unwrap();
        assert!(!target.positions.is_empty());
        assert!(
            (target.sounding_hz
                - Pitch(target.player_pitch - 2.0).to_frequency(s.notation.reference()))
            .abs()
                < 1e-8
        );
    }

    #[test]
    fn sourced_saba_board_is_bounded_to_selected_register_and_upper_tonic_is_visible() {
        let ds = MaqamDataset::teaching_eight_24edo();
        let board =
            fingerboard(&Settings::default(), Some(&ds), Some("saba"), None, 3, None).unwrap();
        assert!(
            board
                .targets
                .iter()
                .all(|t| t.player_pitch >= 50.0 && t.player_pitch <= 65.0)
        );
        assert!(!board.scale.unwrap().octave_repeating);
        let rast = scale_info(
            &Settings::default(),
            &ds,
            ds.maqam("rast").unwrap(),
            "Do3".parse().unwrap(),
            None,
        )
        .unwrap();
        assert_eq!(rast.ajnas[1].tonic_step, 7);
        assert_eq!(rast.ajnas[1].on_step, 4);
    }
}
