//! Ajnas owns application orchestration; reusable DSP and theory live in the libraries.
mod live;
mod settings;
mod teach;

use live::{Message, Processor};
use naghma_audio::{EngineSession, EngineStats, StreamInfo};
use naghma_core::maqam::MaqamDataset;
use serde::Serialize;
use settings::Settings;
use std::{
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{Manager, State, ipc::Channel};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct Runtime {
    session: EngineSession,
    mode: Option<bool>,
    channel: Option<Channel<Message>>,
}

impl Runtime {
    fn start(
        &mut self,
        processor: Arc<Mutex<Processor>>,
        simulation: bool,
        channel: Channel<Message>,
    ) -> Result<StreamInfo, String> {
        self.stop();
        let settings = {
            let mut p = processor.lock().expect("processor lock");
            p.reset();
            p.settings.clone()
        };
        let sink = channel.clone();
        let info = self
            .session
            .start(settings.engine_config(simulation), move |event| {
                let messages = processor.lock().expect("processor lock").event(event);
                for message in messages {
                    let _ = sink.send(message);
                }
            })
            .map_err(|e| e.to_string())?;
        self.mode = Some(simulation);
        self.channel = Some(channel);
        Ok(info)
    }

    fn stop(&mut self) {
        self.session.stop();
        self.mode = None;
        self.channel = None;
    }
}

struct AppState {
    runtime: Mutex<Runtime>,
    processor: Arc<Mutex<Processor>>,
    settings_path: PathBuf,
    dataset_path: PathBuf,
    warning: Mutex<Option<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    settings: Settings,
    dataset: Option<Arc<MaqamDataset>>,
    warning: Option<String>,
}

#[tauri::command]
fn snapshot(state: State<'_, AppState>) -> Snapshot {
    let p = state.processor.lock().expect("processor lock");
    Snapshot {
        settings: p.settings.clone(),
        dataset: p.dataset.clone(),
        warning: state.warning.lock().unwrap().clone(),
    }
}

#[tauri::command]
async fn update_settings(app: tauri::AppHandle, settings: Settings) -> Result<Settings, String> {
    settings.validate()?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut rt = state.runtime.lock().expect("runtime lock");
        // Persist before changing a running session. Failure leaves it untouched.
        settings
            .save(&state.settings_path)
            .map_err(|e| e.to_string())?;
        let restart = rt.mode.zip(rt.channel.clone());
        rt.stop();
        state.processor.lock().unwrap().configure(settings.clone());
        if let Some((mode, channel)) = restart {
            rt.start(state.processor.clone(), mode, channel)
                .map_err(|e| format!("Settings saved, but audio could not restart: {e}"))?;
        }
        Ok(settings)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn start_audio(
    app: tauri::AppHandle,
    simulation: bool,
    on_message: Channel<Message>,
) -> Result<StreamInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state
            .runtime
            .lock()
            .unwrap()
            .start(state.processor.clone(), simulation, on_message)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn stop_audio(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>().runtime.lock().unwrap().stop()
    })
    .await
    .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioStatus {
    info: StreamInfo,
    stats: EngineStats,
    simulation: bool,
}

#[tauri::command]
fn audio_status(state: State<'_, AppState>) -> Option<AudioStatus> {
    let rt = state.runtime.lock().unwrap();
    rt.session.status().map(|(info, stats)| AudioStatus {
        info,
        stats,
        simulation: rt.mode.unwrap_or(false),
    })
}

#[tauri::command]
async fn list_input_devices() -> Result<Vec<naghma_audio::capture::InputDevice>, String> {
    tauri::async_runtime::spawn_blocking(naghma_audio::capture::list_input_devices)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn fingerboard(
    state: State<'_, AppState>,
    maqam_id: Option<String>,
    tonic: Option<String>,
) -> Result<teach::Fingerboard, String> {
    let p = state.processor.lock().unwrap();
    teach::fingerboard(
        &p.settings,
        p.dataset.as_deref(),
        maqam_id.as_deref(),
        tonic.as_deref(),
    )
}

#[derive(Serialize)]
struct TonicOption {
    spelling: naghma_core::tuning::NoteSpelling,
    label: naghma_core::notation::NoteLabel,
}

#[tauri::command]
fn tonic_options(state: State<'_, AppState>) -> Vec<TonicOption> {
    use naghma_core::{
        notation::SpelledNote,
        tuning::{NoteSpelling, SpellingTable},
    };
    let p = state.processor.lock().unwrap();
    let table = SpellingTable::default_24();
    let mut labels = p.settings.notation.label_options();
    labels.show_octave = false;
    let mut spellings: Vec<NoteSpelling> = (0..24).map(|i| table.get(i)).collect();
    if let Some(tonic) = p.settings.maqam.tonic
        && !spellings.contains(&tonic)
    {
        spellings.push(tonic);
    }
    spellings
        .into_iter()
        .map(|spelling| TonicOption {
            label: SpelledNote::new(spelling.degree, spelling.accidental, 3).label(&labels),
            spelling,
        })
        .collect()
}

const MAX_DATASET_BYTES: u64 = 2 * 1024 * 1024;
fn read_dataset(path: &Path) -> Result<MaqamDataset, String> {
    let mut text = String::new();
    std::fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(MAX_DATASET_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    if text.len() as u64 > MAX_DATASET_BYTES {
        return Err("Dataset exceeds the 2 MiB limit".into());
    }
    MaqamDataset::from_json(&text).map_err(|e| e.to_string())
}

#[tauri::command]
async fn import_dataset(app: tauri::AppHandle) -> Result<Option<Arc<MaqamDataset>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("Maqam dataset", &["json"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let dataset = Arc::new(read_dataset(&path)?);
        let state = app.state::<AppState>();
        let _rt = state.runtime.lock().unwrap();
        let tmp = state.dataset_path.with_extension("json.tmp");
        std::fs::create_dir_all(state.dataset_path.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::write(
            &tmp,
            serde_json::to_vec_pretty(&*dataset).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        std::fs::rename(tmp, &state.dataset_path).map_err(|e| e.to_string())?;
        let mut p = state.processor.lock().unwrap();
        p.dataset = Some(dataset.clone());
        p.reset();
        Ok(Some(dataset))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn clear_dataset(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _rt = state.runtime.lock().unwrap();
        match std::fs::remove_file(&state.dataset_path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        let mut p = state.processor.lock().unwrap();
        p.dataset = None;
        p.reset();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            let settings_path = dir.join("settings.json");
            let dataset_path = dir.join("maqam-dataset.json");
            let mut warnings = Vec::new();
            let settings = Settings::load(&settings_path).unwrap_or_else(|e| {
                warnings.push(format!(
                    "Saved settings could not be read: {e}. Defaults are in use."
                ));
                Settings::default()
            });
            let dataset = if dataset_path.exists() {
                match read_dataset(&dataset_path) {
                    Ok(d) => Some(Arc::new(d)),
                    Err(e) => {
                        warnings.push(format!("Saved dataset could not be loaded: {e}"));
                        None
                    }
                }
            } else {
                None
            };
            app.manage(AppState {
                runtime: Mutex::new(Runtime::default()),
                processor: Arc::new(Mutex::new(Processor::new(settings, dataset))),
                settings_path,
                dataset_path,
                warning: Mutex::new((!warnings.is_empty()).then(|| warnings.join("\n"))),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            snapshot,
            update_settings,
            start_audio,
            stop_audio,
            audio_status,
            list_input_devices,
            fingerboard,
            tonic_options,
            import_dataset,
            clear_dataset
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                window
                    .app_handle()
                    .state::<AppState>()
                    .runtime
                    .lock()
                    .unwrap()
                    .stop();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Ajnas");
}
