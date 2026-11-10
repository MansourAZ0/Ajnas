//! Companion stream presentation and opt-in rolling analysis.
//! Audio ownership and DSP stay in naghma-audio; musical rules stay in naghma-core.
use crate::settings::Settings;
use naghma_audio::{AnalysisFrame, EngineEvent};
use naghma_core::instrument::FingerPosition;
use naghma_core::interpret::NoteView;
use naghma_core::maqam::{
    MaqamDataset,
    analysis::{MaqamAnalysis, MaqamAnalyzer, MaqamCandidate},
};
use naghma_core::notation::NoteLabel;
use naghma_core::tracking::LiveState;
use naghma_core::tuning::NoteSpelling;
use serde::Serialize;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveNote {
    pub event_id: u64,
    pub label: NoteLabel,
    pub player_label: NoteLabel,
    pub sounding_label: NoteLabel,
    pub player_pitch: f64,
    pub hz: f64,
    pub target_hz: f64,
    pub cents: f64,
    pub holding: bool,
    /// Plausible positions from audio alone, never a claimed active course.
    pub positions: Vec<FingerPosition>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveFrame {
    pub t: f64,
    pub level_db: f64,
    pub confidence: f64,
    pub onset: bool,
    pub note: Option<LiveNote>,
    pub compute_us: f64,
    pub latency_ms: Option<f64>,
    pub window_ms: f64,
}

#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Message {
    Frame(LiveFrame),
    Analysis {
        analysis: MaqamAnalysis,
        #[serde(rename = "tonicLabels")]
        tonic_labels: Vec<NoteLabel>,
        /// Root and tonal centre of `analysis.activeJins`, if any.
        #[serde(rename = "activeJinsLabels")]
        active_jins_labels: Option<JinsLabels>,
        /// Root and tonal centre of `analysis.foreignJins`, if any.
        #[serde(rename = "foreignJinsLabels")]
        foreign_jins_labels: Option<JinsLabels>,
        /// Tonics of `analysis.performance.candidates`, in the same order.
        #[serde(rename = "performanceTonicLabels")]
        performance_tonic_labels: Vec<NoteLabel>,
    },
    Error {
        message: String,
    },
}

/// Spelled notes of a jins reading in the user's notation, without octave.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JinsLabels {
    pub root: NoteLabel,
    pub centre: NoteLabel,
}

pub struct Processor {
    pub settings: Settings,
    pub dataset: Option<Arc<MaqamDataset>>,
    analyzer: MaqamAnalyzer,
    last_analysis_s: f64,
}

impl Processor {
    pub fn new(settings: Settings, dataset: Option<Arc<MaqamDataset>>) -> Self {
        let analyzer = MaqamAnalyzer::new(settings.maqam.analyzer_config());
        Self {
            settings,
            dataset,
            analyzer,
            last_analysis_s: f64::NEG_INFINITY,
        }
    }

    pub fn reset(&mut self) {
        self.analyzer = MaqamAnalyzer::new(self.settings.maqam.analyzer_config());
        self.last_analysis_s = f64::NEG_INFINITY;
    }

    pub fn configure(&mut self, settings: Settings) {
        let reset = self.settings.maqam != settings.maqam
            || self.settings.notation.pitch_context() != settings.notation.pitch_context();
        self.settings = settings;
        if reset {
            self.reset();
        }
    }

    pub fn event(&mut self, event: EngineEvent) -> Vec<Message> {
        match event {
            EngineEvent::Frame(f) => {
                if self.settings.maqam.enabled {
                    if let Some(ended) = &f.update.ended {
                        self.analyzer.push_event(ended, f.observation.time_s);
                    }
                    self.analyzer.prune(f.observation.time_s);
                }
                let mut messages = vec![Message::Frame(self.frame(&f))];
                let now = f.observation.time_s;
                if self.settings.maqam.enabled
                    && now - self.last_analysis_s >= self.settings.maqam.interval_s
                {
                    self.last_analysis_s = now;
                    let mut labels = self.settings.notation.label_options();
                    labels.show_octave = false;
                    let analysis = self.analyzer.analyze(
                        self.dataset.as_deref(),
                        self.settings.maqam.tonic,
                        now,
                    );
                    let tonic_label = |c: &MaqamCandidate| {
                        let mut candidate_labels = labels;
                        candidate_labels.show_octave = c.tonic_octave.is_some();
                        naghma_core::notation::SpelledNote::new(
                            c.tonic.degree,
                            c.tonic.accidental,
                            c.tonic_octave.unwrap_or(3),
                        )
                        .label(&candidate_labels)
                    };
                    let tonic_labels = analysis.candidates.iter().map(tonic_label).collect();
                    let performance_tonic_labels = analysis
                        .performance
                        .iter()
                        .flat_map(|p| &p.candidates)
                        .map(tonic_label)
                        .collect();
                    let jins_labels = |root: NoteSpelling, centre: NoteSpelling| {
                        let label = |n: NoteSpelling| {
                            naghma_core::notation::SpelledNote::new(n.degree, n.accidental, 4)
                                .label(&labels)
                        };
                        JinsLabels {
                            root: label(root),
                            centre: label(centre),
                        }
                    };
                    let active_jins_labels = analysis
                        .active_jins
                        .as_ref()
                        .map(|j| jins_labels(j.root, j.centre));
                    let foreign_jins_labels = analysis
                        .foreign_jins
                        .as_ref()
                        .map(|j| jins_labels(j.root, j.centre));
                    messages.push(Message::Analysis {
                        analysis,
                        tonic_labels,
                        active_jins_labels,
                        foreign_jins_labels,
                        performance_tonic_labels,
                    });
                }
                messages
            }
            EngineEvent::NoteEnded(e) => {
                if self.settings.maqam.enabled {
                    self.analyzer.push_event(&e, e.end_s.unwrap_or(e.start_s));
                    self.analyzer.prune(e.end_s.unwrap_or(e.start_s));
                }
                Vec::new()
            }
            EngineEvent::Error { error } => vec![Message::Error {
                message: error.to_string(),
            }],
        }
    }

    fn frame(&self, f: &AnalysisFrame) -> LiveFrame {
        let labels = self.settings.notation.label_options();
        let profile = self.settings.instrument();
        let note = if let LiveState::Note(n) = &f.update.state {
            let r = &n.reading;
            let shown = match self.settings.notation.note_view {
                NoteView::Player => &r.player,
                NoteView::Concert => &r.sounding,
            };
            Some(LiveNote {
                event_id: n.event_id,
                label: shown.note.label(&labels),
                player_label: r.player.note.label(&labels),
                sounding_label: r.sounding.note.label(&labels),
                player_pitch: r.player_pitch.0,
                hz: r.frequency_hz,
                target_hz: match self.settings.notation.note_view {
                    NoteView::Player => profile.transposition.player_to_sounding(r.player.target),
                    NoteView::Concert => r.sounding.target,
                }
                .to_frequency(profile.reference),
                cents: shown.deviation_cents,
                holding: n.holding,
                positions: profile.positions_for(r.player_pitch),
            })
        } else {
            None
        };
        LiveFrame {
            t: f.observation.time_s,
            level_db: f.observation.level_db,
            confidence: f.observation.confidence,
            onset: f.update.onset,
            note,
            compute_us: f.timing.compute_us,
            latency_ms: f.timing.pipeline_latency_ms,
            window_ms: f.timing.window_ms,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use naghma_audio::{AnalysisConfig, analyze_samples};
    use naghma_core::pitch::{IntervalUnit, Transposition};

    #[test]
    fn stream_maps_both_identities_and_maqam_is_opt_in() {
        let mut settings = Settings::default();
        settings.notation.transposition = Transposition::new(-2.0, IntervalUnit::Semitone);
        let samples = pitchforge::signals::harmonic(261.6256, 48000.0, 24000, 0.5, &[1.0, 0.4]);
        let config = settings.engine_config(true);
        let frames = analyze_samples(
            &samples,
            48000.0,
            AnalysisConfig::default(),
            config.tracker,
            config.context,
        )
        .unwrap();
        let mut p = Processor::new(settings.clone(), None);
        let last = p.frame(frames.last().unwrap()).note.unwrap();
        assert_eq!(last.player_label.text, "Re4");
        assert_eq!(last.sounding_label.text, "Do4");
        assert!(!last.positions.is_empty());
        let json = serde_json::to_value(Message::Frame(p.frame(frames.last().unwrap()))).unwrap();
        assert_eq!(json["type"], "frame");
        assert_eq!(json["note"]["playerLabel"]["text"], "Re4");
        assert!(
            p.event(EngineEvent::Frame(frames[0].clone()))
                .iter()
                .all(|m| !matches!(m, Message::Analysis { .. }))
        );
        settings.maqam.enabled = true;
        p.configure(settings);
        assert!(
            p.event(EngineEvent::Frame(frames[0].clone()))
                .iter()
                .any(|m| matches!(m, Message::Analysis { .. }))
        );
    }

    #[test]
    fn normal_frame_note_endings_fill_maqam_window() {
        let mut settings = Settings::default();
        settings.maqam.enabled = true;
        settings.maqam.interval_s = 1.0;
        let config = settings.engine_config(true);
        let mut samples = Vec::new();
        for pitch in [60.0, 62.0, 63.5, 65.0, 67.0, 65.0, 63.5, 62.0] {
            let hz = naghma_core::pitch::Pitch(pitch).to_frequency(Default::default());
            samples.extend(pitchforge::signals::harmonic(
                hz,
                48000.0,
                18000,
                0.5,
                &[1.0, 0.4],
            ));
        }
        samples.extend(vec![0.0; 48000]);
        let frames = analyze_samples(
            &samples,
            48000.0,
            config.analysis,
            config.tracker,
            config.context,
        )
        .unwrap();
        let dataset = MaqamDataset::from_json(include_str!(
            "../tests/fixtures/synthetic-maqam-dataset.json"
        ))
        .unwrap();
        let mut p = Processor::new(settings.clone(), Some(Arc::new(dataset)));
        let mut max_notes = 0;
        let mut ranked = false;
        let mut performance = false;
        for frame in frames {
            for message in p.event(EngineEvent::Frame(frame)) {
                if let Message::Analysis {
                    analysis,
                    performance_tonic_labels,
                    ..
                } = message
                {
                    max_notes = max_notes.max(analysis.notes);
                    ranked |= !analysis.candidates.is_empty();
                    let whole = analysis.performance.as_ref();
                    assert_eq!(
                        performance_tonic_labels.len(),
                        whole.map_or(0, |p| p.candidates.len())
                    );
                    performance |= whole.is_some();
                }
            }
        }
        assert!(
            max_notes >= 6,
            "normal endings must be collected: {max_notes}"
        );
        assert!(ranked);
        assert!(performance, "the piece as a whole is read too");
        settings.maqam.enabled = false;
        p.configure(settings);
        assert_eq!(p.analyzer.history().count(), 0);
    }
}
