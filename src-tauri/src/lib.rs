mod capture;
mod elevation;

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
fn load_data(app: AppHandle) -> Result<Option<String>, String> {
    let path = data_dir(&app)?.join("data.json");
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Writes to a temporary file first so a crash mid-write cannot corrupt the loadouts.
#[tauri::command]
fn save_data(app: AppHandle, json: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let tmp = dir.join("data.json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join("data.json")).map_err(|e| e.to_string())
}

/// Keeps a save file this version could not read, so it is never silently lost.
#[tauri::command]
fn backup_data(app: AppHandle, raw: String) -> Result<(), String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let path = data_dir(&app)?.join(format!("data.unreadable-{stamp}.json"));
    fs::write(path, raw).map_err(|e| e.to_string())
}

#[tauri::command]
fn start_capture() -> Result<(), String> {
    capture::set_active(true)
}

#[tauri::command]
fn stop_capture() -> Result<(), String> {
    capture::set_active(false)
}

#[tauri::command]
fn is_elevated() -> bool {
    elevation::is_elevated()
}

#[tauri::command]
fn relaunch_as_admin(app: AppHandle) -> Result<(), String> {
    elevation::relaunch_elevated()?;
    app.exit(0);
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            capture::spawn(app.handle().clone());
            Ok(())
        })
        // Closing the main window quits, even while the presentation window is still open.
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            backup_data,
            start_capture,
            stop_capture,
            is_elevated,
            relaunch_as_admin
        ])
        .run(tauri::generate_context!())
        .expect("error while running Genshin Training Wheels");
}
