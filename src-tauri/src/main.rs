#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use base64::{engine::general_purpose::STANDARD, Engine};
use longview_core::{
    search::{SearchDraft, SearchResults},
    session::{Opened, Session},
    Folder, Workspace,
};
use std::{ffi::OsString, sync::Mutex};
use tauri::State;
use tauri_plugin_opener::OpenerExt;

struct AppState {
    session: Mutex<Session>,
    startup_arguments: Mutex<Option<Vec<OsString>>>,
}

fn with_session<T>(
    state: &AppState,
    action: impl FnOnce(&mut Session) -> Result<T, String>,
) -> Result<T, String> {
    let mut session = state
        .session
        .lock()
        .map_err(|_| "The workspace is unavailable.")?;
    action(&mut session)
}

fn with_workspace<T>(
    state: &AppState,
    action: impl FnOnce(&Workspace) -> Result<T, String>,
) -> Result<T, String> {
    with_session(state, |session| action(session.workspace()?))
}

#[tauri::command]
async fn startup(state: State<'_, AppState>) -> Result<Option<Opened>, String> {
    let arguments = state
        .startup_arguments
        .lock()
        .map_err(|_| "Startup is unavailable.")?
        .take();
    match arguments {
        Some(arguments) => with_session(&state, |session| session.startup(&arguments)),
        None => Ok(None),
    }
}

#[tauri::command]
async fn open_folder(state: State<'_, AppState>) -> Result<Option<Opened>, String> {
    let chosen = rfd::AsyncFileDialog::new()
        .set_title("Open a Markdown folder")
        .pick_folder()
        .await;
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    with_session(&state, |session| session.open_path(chosen.path())).map(Some)
}

#[tauri::command]
async fn open_file(state: State<'_, AppState>) -> Result<Option<Opened>, String> {
    let chosen = rfd::AsyncFileDialog::new()
        .set_title("Open a Markdown file")
        .add_filter("Markdown", &["md", "markdown"])
        .pick_file()
        .await;
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    with_session(&state, |session| session.open_path(chosen.path())).map(Some)
}

#[tauri::command]
async fn list_files(state: State<'_, AppState>) -> Result<Folder, String> {
    with_workspace(&state, Workspace::list)
}

#[tauri::command]
async fn search_notes(
    query: String,
    draft: Option<SearchDraft>,
    state: State<'_, AppState>,
) -> Result<SearchResults, String> {
    let workspace = with_workspace(&state, |workspace| Ok(workspace.clone()))?;
    // Disk scanning must not block the UI or hold the session lock.
    tauri::async_runtime::spawn_blocking(move || workspace.search_notes(&query, draft.as_ref()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn parse_note(text: String) -> longview_core::metadata::ParsedNote {
    longview_core::metadata::parse_note(&text)
}

#[tauri::command]
async fn delete_file(path: String, state: State<'_, AppState>) -> Result<Option<String>, String> {
    with_session(&state, |session| session.delete_file(&path))
}

#[tauri::command]
fn read_note(path: String, remember: bool, state: State<'_, AppState>) -> Result<String, String> {
    with_session(&state, |session| session.read_note(&path, remember))
}

#[tauri::command]
fn save_note(
    path: String,
    text: String,
    expected: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    with_workspace(&state, |w| w.save_note(&path, &text, &expected))
}

#[tauri::command]
fn read_image(path: String, state: State<'_, AppState>) -> Result<String, String> {
    with_workspace(&state, |w| {
        let (mime, bytes) = w.read_image(&path)?;
        Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
    })
}

#[tauri::command]
fn open_external(url: String, app: tauri::AppHandle) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return Err("Only web and email links can open externally.".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            session: Mutex::new(Session::for_home(
                dirs::home_dir().expect("Unable to locate your home folder"),
            )),
            startup_arguments: Mutex::new(Some(std::env::args_os().skip(1).collect())),
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_folder,
            open_file,
            startup,
            list_files,
            search_notes,
            parse_note,
            delete_file,
            read_note,
            save_note,
            read_image,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start Longview");
}
