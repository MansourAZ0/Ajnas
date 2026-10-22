//! Ajnas settings, persisted as JSON in the app config directory.

use naghma_core::maqam::analysis::{AnalyzerConfig, PitchSpace};
use naghma_core::preferences::NotationPreferences;
use naghma_core::tuning::NoteSpelling;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::{fs, io};

pub const SETTINGS_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Language {
    #[default]
    En,
    Ar,
}

/// Maqam recognition. Disabled by default; nothing runs while disabled.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MaqamSettings {
    pub enabled: bool,
    /// Fixed tonic, or `None` to let the analyser consider likely tonics.
    pub tonic: Option<NoteSpelling>,
    pub pitch_space: PitchSpace,
    pub window_s: f64,
    pub interval_s: f64,
}

impl Default for MaqamSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            tonic: None,
            pitch_space: PitchSpace::Player,
            window_s: 25.0,
            interval_s: 5.0,
        }
    }
}

impl MaqamSettings {
    pub fn analyzer_config(&self) -> AnalyzerConfig {
        AnalyzerConfig {
            window_s: self.window_s,
            pitch_space: self.pitch_space,
            ..AnalyzerConfig::default()
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Visuals {
    #[default]
    Full,
    Reduced,
    Off,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub version: u32,
    pub language: Language,
    #[serde(flatten)]
    pub notation: NotationPreferences,
    pub input_device_id: Option<String>,
    pub silence_threshold_db: f64,
    pub min_confidence: f64,
    pub scale_length_mm: f64,
    pub fingerboard_length_mm: f64,
    pub position_offset_mm: f64,
    pub maqam: MaqamSettings,
    pub visuals: Visuals,
    pub show_diagnostics: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            language: Language::En,
            notation: NotationPreferences::default(),
            input_device_id: None,
            silence_threshold_db: -60.0,
            min_confidence: 0.8,
            scale_length_mm: 600.0,
            fingerboard_length_mm: 300.0,
            position_offset_mm: 0.0,
            maqam: MaqamSettings::default(),
            visuals: Visuals::Full,
            show_diagnostics: false,
        }
    }
}

impl Settings {
    pub fn instrument(&self) -> naghma_core::instrument::InstrumentProfile {
        let mut profile = naghma_core::instrument::InstrumentProfile::oud_6_course_example();
        profile.reference = self.notation.reference();
        profile.transposition = self.notation.transposition;
        profile.scale_length_mm = self.scale_length_mm;
        profile.fingerboard_length_mm = self.fingerboard_length_mm;
        profile.calibration.position_offset_mm = self.position_offset_mm;
        profile
    }

    pub fn engine_config(&self, simulation: bool) -> naghma_audio::EngineConfig {
        naghma_audio::EngineConfig {
            source: if simulation {
                naghma_audio::SourceConfig::Simulation(Default::default())
            } else {
                naghma_audio::SourceConfig::Microphone {
                    device_id: self.input_device_id.clone(),
                }
            },
            context: self.notation.pitch_context(),
            analysis: naghma_audio::AnalysisConfig {
                silence_threshold_db: self.silence_threshold_db,
                ..Default::default()
            },
            tracker: naghma_core::tracking::TrackerConfig {
                min_confidence: self.min_confidence,
                ..Default::default()
            },
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        self.notation.validate().map_err(|e| e.to_string())?;
        self.instrument().validate().map_err(|e| e.to_string())?;
        if !(400.0..=800.0).contains(&self.scale_length_mm)
            || !(-20.0..=20.0).contains(&self.position_offset_mm)
        {
            return Err(
                "scale length must be 400-800 mm and position correction within ±20 mm".into(),
            );
        }
        if !(-90.0..=-20.0).contains(&self.silence_threshold_db) {
            return Err("silence threshold must be between -90 and -20 dBFS".into());
        }
        if !(0.5..=0.99).contains(&self.min_confidence) {
            return Err("minimum confidence must be between 0.5 and 0.99".into());
        }
        let m = &self.maqam;
        if !(5.0..=120.0).contains(&m.window_s) || !(1.0..=30.0).contains(&m.interval_s) {
            return Err("maqam window must be 5-120 s and interval 1-30 s".into());
        }
        Ok(())
    }

    pub fn load(path: &Path) -> io::Result<Settings> {
        match fs::read_to_string(path) {
            Ok(text) => {
                let mut s: Settings = serde_json::from_str(&text)
                    .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
                s.version = SETTINGS_VERSION;
                s.validate()
                    .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
                Ok(s)
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Settings::default()),
            Err(e) => Err(e),
        }
    }

    pub fn save(&self, path: &Path) -> io::Result<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        fs::write(
            &tmp,
            serde_json::to_vec_pretty(self).map_err(io::Error::other)?,
        )?;
        fs::rename(tmp, path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_valid_maqam_off_and_round_trip() {
        let s = Settings::default();
        s.validate().unwrap();
        assert!(!s.maqam.enabled, "maqam recognition must be off by default");
        let json = serde_json::to_string(&s).unwrap();
        assert_eq!(serde_json::from_str::<Settings>(&json).unwrap(), s);
    }

    #[test]
    fn partial_files_load_with_defaults() {
        let s: Settings =
            serde_json::from_str(r#"{"maqam":{"enabled":true},"noteScript":"arabic"}"#).unwrap();
        assert!(s.maqam.enabled);
        assert_eq!(s.maqam.window_s, 25.0);
        assert_eq!(
            s.notation.note_script,
            naghma_core::notation::Script::Arabic
        );
    }

    #[test]
    fn rejects_bad_values() {
        let mut s = Settings::default();
        s.maqam.interval_s = 0.0;
        assert!(s.validate().is_err());
    }
}
