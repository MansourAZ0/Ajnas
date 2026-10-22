//! Display-ready teaching targets derived exclusively from naghma-core.
use crate::settings::Settings;
use naghma_core::instrument::FingerPosition;
use naghma_core::maqam::MaqamDataset;
use naghma_core::notation::{NoteLabel, SpelledNote};
use naghma_core::pitch::Pitch;
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
pub struct Fingerboard {
    pub name: String,
    pub scale_length_mm: f64,
    pub fingerboard_length_mm: f64,
    pub courses: Vec<NoteLabel>,
    pub targets: Vec<Target>,
}

pub fn fingerboard(
    settings: &Settings,
    dataset: Option<&MaqamDataset>,
    maqam_id: Option<&str>,
    tonic: Option<&str>,
) -> Result<Fingerboard, String> {
    let profile = settings.instrument();
    let ctx = settings.notation.pitch_context();
    let labels = settings.notation.label_options();
    let notes: Vec<(SpelledNote, Pitch, Option<u8>)> = if let Some(id) = maqam_id {
        let maqam = dataset
            .and_then(|d| d.maqamat.iter().find(|m| m.id == id))
            .ok_or("Select a maqam from the loaded dataset")?;
        let root = tonic
            .map(str::parse::<SpelledNote>)
            .transpose()
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| maqam.default_tonic(3));
        // Extend the definition's intervals through the instrument range,
        // preserving its spelling and continuous intonation targets.
        let (lo, hi) = profile.player_range();
        (-2..=6)
            .flat_map(|octave| {
                let t = SpelledNote::new(root.degree, root.accidental, octave);
                maqam
                    .realize(t)
                    .into_iter()
                    .map(|n| (n.note, n.pitch, Some(n.step)))
            })
            .filter(|(_, p, _)| p.0 >= lo.0 && p.0 <= hi.0)
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
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use naghma_core::pitch::{IntervalUnit, Transposition};

    #[test]
    fn transpose_changes_target_sound_but_preserves_positions() {
        let mut s = Settings::default();
        let before = fingerboard(&s, None, None, None).unwrap();
        s.notation.transposition = Transposition::new(-2.0, IntervalUnit::Semitone);
        let after = fingerboard(&s, None, None, None).unwrap();
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
            Some("Do3"),
        )
        .unwrap();
        assert!(
            board
                .targets
                .iter()
                .any(|t| (t.player_pitch - 49.83).abs() < 1e-8)
        );
        assert!(fingerboard(&Settings::default(), None, Some("missing"), None).is_err());
    }
}
