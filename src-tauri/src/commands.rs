//! Tauri commands exposed to the UI. Thin wrappers over `db`, `storage` and `timer`.

use crate::db::{self, Note, Result, Subject, Topic};
use crate::state::AppState;
use crate::storage;
use crate::timer::{self, Snapshot, TimerConfig};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Alt+Shift+K";

fn with_db<T>(state: &State<AppState>, f: impl FnOnce(&rusqlite::Connection) -> Result<T>) -> Result<T> {
    let guard = state.db.lock().unwrap();
    f(guard.as_ref().ok_or("Primero elige una carpeta de datos.")?)
}

// ---------- Data folder ----------

#[derive(Serialize)]
pub struct AppInfo {
    data_dir: Option<String>,
    mica: bool,
    version: &'static str,
    shortcut_error: Option<String>,
    autostart_default: bool,
}

#[tauri::command]
pub fn app_info(state: State<AppState>) -> AppInfo {
    AppInfo {
        data_dir: state
            .data_dir
            .lock()
            .unwrap()
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned()),
        mica: *state.mica.lock().unwrap(),
        version: env!("CARGO_PKG_VERSION"),
        shortcut_error: state.shortcut_error.lock().unwrap().clone(),
        // Never register the dev build or a test run to start with Windows.
        autostart_default: !cfg!(debug_assertions) && std::env::var_os("KAIZEN_CONFIG_DIR").is_none(),
    }
}

/// Opens (or creates) the database in `dir` and remembers it.
pub fn open_data_dir(app: &AppHandle, dir: PathBuf) -> Result<()> {
    let state = app.state::<AppState>();
    let conn = db::open(&dir)?;
    db::close_stale_sessions(&conn)?;
    let _ = storage::auto_backup(&conn, &dir);
    let shortcut = db::get_setting(&conn, "shortcut")?.unwrap_or_else(|| DEFAULT_SHORTCUT.into());
    *state.db.lock().unwrap() = Some(conn);
    *state.data_dir.lock().unwrap() = Some(dir.clone());
    let _ = app.asset_protocol_scope().allow_directory(dir.join(storage::ATTACH_DIR), true);
    storage::save_config(&storage::Config { data_dir: Some(dir) })?;
    *state.shortcut_error.lock().unwrap() = register_shortcut(app, &shortcut).err();
    Ok(())
}

/// `mode`: "open" uses/creates data in `path`; "move" copies current data there first.
#[tauri::command]
pub fn set_data_dir(app: AppHandle, state: State<AppState>, path: String, mode: String) -> Result<()> {
    if state.timer.lock().unwrap().is_some() {
        return Err("Termina la sesión en curso antes de cambiar la carpeta.".into());
    }
    let dir = PathBuf::from(path);
    if mode == "move" {
        let from = state.data_dir.lock().unwrap().clone().ok_or("Sin carpeta de datos")?;
        with_db(&state, |c| storage::copy_data_to(c, &from, &dir))?;
    }
    if let Some(conn) = state.db.lock().unwrap().take() {
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    }
    open_data_dir(&app, dir)
}

// ---------- Subjects / topics ----------

#[tauri::command]
pub fn list_subjects(state: State<AppState>, include_archived: bool) -> Result<Vec<Subject>> {
    with_db(&state, |c| db::list_subjects(c, include_archived))
}

#[tauri::command]
pub fn save_subject(state: State<AppState>, subject: Subject) -> Result<Subject> {
    with_db(&state, |c| db::save_subject(c, &subject))
}

#[tauri::command]
pub fn delete_subject(state: State<AppState>, id: String) -> Result<()> {
    let active_topic = state.timer.lock().unwrap().as_ref().map(|t| t.topic_id.clone());
    with_db(&state, |c| {
        if let Some(topic) = active_topic {
            if db::get_topic(c, &topic).is_ok_and(|t| t.subject_id == id) {
                return Err(SESSION_IN_PROGRESS.into());
            }
        }
        db::delete_subject(c, &id)
    })
}

/// Deleting the topic of the running session would delete the session under the timer.
const SESSION_IN_PROGRESS: &str = "Hay una sesión en curso de este tema. Termínala antes de eliminarlo.";

#[tauri::command]
pub fn list_topics(state: State<AppState>, subject_id: String) -> Result<Vec<Topic>> {
    with_db(&state, |c| db::list_topics(c, &subject_id))
}

#[tauri::command]
pub fn get_topic(state: State<AppState>, id: String) -> Result<Topic> {
    with_db(&state, |c| db::get_topic(c, &id))
}

#[tauri::command]
pub fn save_topic(state: State<AppState>, topic: Topic) -> Result<Topic> {
    with_db(&state, |c| db::save_topic(c, &topic))
}

#[tauri::command]
pub fn delete_topic(state: State<AppState>, id: String) -> Result<()> {
    if state.timer.lock().unwrap().as_ref().is_some_and(|t| t.topic_id == id) {
        return Err(SESSION_IN_PROGRESS.into());
    }
    with_db(&state, |c| db::delete_topic(c, &id))
}

#[tauri::command]
pub fn list_sessions(state: State<AppState>, topic_id: String) -> Result<Vec<db::Session>> {
    with_db(&state, |c| db::list_sessions(c, &topic_id))
}

// ---------- Notes ----------

#[tauri::command]
pub fn list_notes(state: State<AppState>, topic_id: String) -> Result<Vec<Note>> {
    with_db(&state, |c| db::list_notes(c, &topic_id))
}

#[tauri::command]
pub fn search_notes(state: State<AppState>, query: String) -> Result<Vec<db::NoteHit>> {
    with_db(&state, |c| db::search_notes(c, &query))
}

#[tauri::command]
pub fn save_note(state: State<AppState>, note: Note) -> Result<Note> {
    with_db(&state, |c| db::save_note(c, &note))
}

#[tauri::command]
pub fn delete_note(state: State<AppState>, id: String) -> Result<()> {
    with_db(&state, |c| db::delete_note(c, &id))
}

// ---------- Reviews / stats ----------

#[tauri::command]
pub fn list_reviews(state: State<AppState>, from: String, to: String) -> Result<Vec<db::Review>> {
    with_db(&state, |c| db::list_reviews(c, &from, &to))
}

#[tauri::command]
pub fn due_reviews(state: State<AppState>) -> Result<Vec<db::Review>> {
    with_db(&state, db::due_reviews)
}

#[tauri::command]
pub fn complete_review(state: State<AppState>, id: String, result: String) -> Result<()> {
    with_db(&state, |c| db::complete_review(c, &id, &result))
}

#[tauri::command]
pub fn stats(state: State<AppState>, days: i64) -> Result<db::Stats> {
    with_db(&state, |c| db::stats(c, days.clamp(1, 366)))
}

// ---------- Settings ----------

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<HashMap<String, String>> {
    with_db(&state, db::all_settings)
}

#[tauri::command]
pub fn set_setting(state: State<AppState>, key: String, value: String) -> Result<()> {
    with_db(&state, |c| db::set_setting(c, &key, &value))
}

fn register_shortcut(app: &AppHandle, shortcut: &str) -> Result<()> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.register(shortcut).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_shortcut(app: AppHandle, state: State<AppState>, shortcut: String) -> Result<()> {
    let previous = with_db(&state, |c| db::get_setting(c, "shortcut"))?
        .unwrap_or_else(|| DEFAULT_SHORTCUT.into());
    if let Err(err) = register_shortcut(&app, &shortcut) {
        *state.shortcut_error.lock().unwrap() = register_shortcut(&app, &previous).err();
        return Err(err);
    }
    *state.shortcut_error.lock().unwrap() = None;
    with_db(&state, |c| db::set_setting(c, "shortcut", &shortcut))
}

#[tauri::command]
pub fn set_tray_labels(app: AppHandle, labels: HashMap<String, String>) {
    crate::tray::set_labels(&app, labels);
}

// ---------- Backup ----------

#[tauri::command]
pub fn export_backup(state: State<AppState>, path: String) -> Result<()> {
    let dir = state.data_dir.lock().unwrap().clone().ok_or("Sin carpeta de datos")?;
    with_db(&state, |c| storage::export_backup(c, &dir, &PathBuf::from(path)))
}

#[tauri::command]
pub fn import_backup(app: AppHandle, state: State<AppState>, path: String) -> Result<()> {
    if state.timer.lock().unwrap().is_some() {
        return Err("Termina la sesión en curso antes de importar.".into());
    }
    let dir = state.data_dir.lock().unwrap().clone().ok_or("Sin carpeta de datos")?;
    // Safety net: keep a copy of the current data before replacing it.
    with_db(&state, |c| {
        let safety = dir.join("backups").join(format!(
            "antes-de-importar-{}.kaizen",
            chrono::Local::now().format("%Y%m%d-%H%M%S")
        ));
        std::fs::create_dir_all(safety.parent().unwrap()).map_err(|e| e.to_string())?;
        storage::export_backup(c, &dir, &safety)
    })?;
    drop(state.db.lock().unwrap().take());
    let result = storage::import_backup(&PathBuf::from(path), &dir);
    open_data_dir(&app, dir)?;
    result
}

// ---------- Timer ----------

#[tauri::command]
pub fn start_session(
    app: AppHandle,
    topic_id: String,
    template_id: Option<String>,
    config: TimerConfig,
) -> Result<Snapshot> {
    timer::start(&app, &topic_id, template_id, config, None)
}

#[tauri::command]
pub fn unfinished_session(state: State<AppState>) -> Result<Option<db::Session>> {
    if state.timer.lock().unwrap().is_some() {
        return Ok(None);
    }
    with_db(&state, db::unfinished_session)
}

#[tauri::command]
pub fn resume_session(app: AppHandle, state: State<AppState>, session_id: String) -> Result<Snapshot> {
    let s = with_db(&state, |c| {
        db::unfinished_session(c)?
            .filter(|s| s.id == session_id)
            .ok_or_else(|| "La sesión ya no está disponible.".to_string())
    })?;
    let config: TimerConfig = serde_json::from_str(&s.config_json).map_err(|e| e.to_string())?;
    timer::start(
        &app,
        &s.topic_id,
        s.template_id,
        config,
        Some((s.id, s.focus_seconds as u64, s.break_seconds as u64)),
    )
}

/// Closes an interrupted session from a previous run without resuming it.
#[tauri::command]
pub fn close_unfinished(state: State<AppState>, session_id: String) -> Result<()> {
    with_db(&state, |c| db::finish_session(c, &session_id, None, false))
}

#[tauri::command]
pub fn timer_state(app: AppHandle) -> Option<Snapshot> {
    timer::current(&app)
}

#[tauri::command]
pub fn timer_toggle_pause(app: AppHandle) {
    timer::toggle_pause(&app);
}

#[tauri::command]
pub fn timer_skip(app: AppHandle) {
    timer::advance(&app, false);
}

#[tauri::command]
pub fn finish_session(app: AppHandle) -> Result<Option<String>> {
    timer::finish(&app, None)
}

#[tauri::command]
pub fn rate_session(state: State<AppState>, session_id: String, rating: i64) -> Result<()> {
    with_db(&state, |c| {
        c.execute(
            "UPDATE sessions SET rating=?2 WHERE id=?1",
            rusqlite::params![session_id, rating.clamp(1, 5)],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn save_session_notes(state: State<AppState>, session_id: String, notes: String) -> Result<()> {
    with_db(&state, |c| db::update_session_notes(c, &session_id, &notes))
}

/// Must be async: creating a window from a synchronous command deadlocks on Windows
/// (the command would block the main thread the new webview needs).
#[tauri::command]
pub async fn toggle_mini(app: AppHandle) -> Result<bool> {
    if let Some(w) = app.get_webview_window("mini") {
        w.close().map_err(|e| e.to_string())?;
        return Ok(false);
    }
    WebviewWindowBuilder::new(&app, "mini", WebviewUrl::App("mini".into()))
        .title("Kaizen Study")
        .inner_size(260.0, 100.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn show_main(app: AppHandle) {
    crate::tray::show_main(&app);
}

// ---------- Break activities ----------

#[tauri::command]
pub fn list_activities(state: State<AppState>) -> Result<Vec<db::BreakActivity>> {
    with_db(&state, db::list_activities)
}

#[tauri::command]
pub fn save_activity(state: State<AppState>, activity: db::BreakActivity) -> Result<db::BreakActivity> {
    with_db(&state, |c| db::save_activity(c, &activity))
}

#[tauri::command]
pub fn delete_activity(state: State<AppState>, id: String) -> Result<()> {
    with_db(&state, |c| db::delete_activity(c, &id))
}

// ---------- Planned studies / exams ----------

#[tauri::command]
pub fn save_planned(state: State<AppState>, plan: db::PlannedStudy) -> Result<db::PlannedStudy> {
    with_db(&state, |c| db::save_planned(c, &plan))
}

#[tauri::command]
pub fn get_planned(state: State<AppState>, id: String) -> Result<db::PlannedStudy> {
    with_db(&state, |c| db::get_planned(c, &id))
}

#[tauri::command]
pub fn delete_planned(state: State<AppState>, id: String) -> Result<()> {
    with_db(&state, |c| db::delete_planned(c, &id))
}

#[tauri::command]
pub fn planned_occurrences(state: State<AppState>, from: String, to: String) -> Result<Vec<db::PlannedOccurrence>> {
    with_db(&state, |c| db::planned_occurrences(c, &from, &to))
}

#[tauri::command]
pub fn upcoming_exams(state: State<AppState>) -> Result<Vec<db::Exam>> {
    with_db(&state, db::upcoming_exams)
}

// ---------- Quick notes ----------

#[tauri::command]
pub fn list_quick_notes(state: State<AppState>, topic_id: String) -> Result<Vec<db::Session>> {
    with_db(&state, |c| db::list_quick_notes(c, &topic_id))
}

#[tauri::command]
pub fn search_quick_notes(state: State<AppState>, query: String) -> Result<Vec<db::QuickNoteHit>> {
    with_db(&state, |c| db::search_quick_notes(c, &query))
}

#[tauri::command]
pub fn move_quick_note(
    state: State<AppState>,
    session_id: String,
    target: Option<String>,
    title: String,
    heading: String,
) -> Result<Note> {
    with_db(&state, |c| db::move_quick_note(c, &session_id, target.as_deref(), &title, &heading))
}

// ---------- Spell checking ----------

#[tauri::command]
pub fn spell_languages() -> Vec<&'static str> {
    crate::spell::LANGUAGES.to_vec()
}

#[tauri::command]
pub async fn spell_check(app: AppHandle, words: Vec<String>, langs: Vec<String>) -> Result<Vec<bool>> {
    let personal: std::collections::HashSet<String> = {
        let state = app.state::<AppState>();
        with_db(&state, db::dictionary_words)?.into_iter().map(|w| w.to_lowercase()).collect()
    };
    tauri::async_runtime::spawn_blocking(move || crate::spell::check(&words, &langs, &personal))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn spell_suggest(word: String, langs: Vec<String>) -> Result<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || crate::spell::suggest(&word, &langs))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dictionary_words(state: State<AppState>) -> Result<Vec<String>> {
    with_db(&state, db::dictionary_words)
}

#[tauri::command]
pub fn dictionary_add(state: State<AppState>, word: String) -> Result<()> {
    with_db(&state, |c| db::add_dictionary_word(c, word.trim()))
}

#[tauri::command]
pub fn dictionary_remove(state: State<AppState>, word: String) -> Result<()> {
    with_db(&state, |c| db::remove_dictionary_word(c, &word))
}

// ---------- Phone notifications ----------

#[tauri::command]
pub fn set_secret(key: String, value: String) -> Result<()> {
    crate::notify::set_secret(&key, value.trim())
}

/// Which secrets are stored (never returns their values).
#[tauri::command]
pub fn secrets_status() -> HashMap<String, bool> {
    crate::notify::SECRETS
        .iter()
        .map(|k| (k.to_string(), crate::notify::get_secret(k).is_some()))
        .collect()
}

/// Sends a test message through one channel ("ntfy" | "telegram" | "email").
#[tauri::command]
pub async fn phone_test(app: AppHandle, channel: String, title: String, body: String) -> Result<()> {
    let ch = {
        let state = app.state::<AppState>();
        with_db(&state, |c| crate::notify::channels(c, Some(&channel)))?
    };
    let results = tauri::async_runtime::spawn_blocking(move || crate::notify::send(&ch, &title, &body))
        .await
        .map_err(|e| e.to_string())?;
    match results.into_iter().find_map(|r| r.error) {
        Some(err) => Err(err),
        None => Ok(()),
    }
}

/// Forwards an app event to the phone if that event is enabled in the settings.
#[tauri::command]
pub fn phone_notify(app: AppHandle, event: String, title: String, body: String) {
    crate::notify::phone_event(&app, &event, title, body);
}

/// Detects and saves the Telegram chat id of the user who pressed «Start» in their bot.
#[tauri::command]
pub async fn telegram_find_chat(app: AppHandle) -> Result<String> {
    let token = crate::notify::get_secret("telegram_token").ok_or("Primero guarda el token del bot.")?;
    let chat = tauri::async_runtime::spawn_blocking(move || crate::notify::telegram_find_chat(&token))
        .await
        .map_err(|e| e.to_string())??;
    let state = app.state::<AppState>();
    with_db(&state, |c| db::set_setting(c, "telegram_chat_id", &chat))?;
    Ok(chat)
}

// ---------- Quick notes cleanup ----------

/// Clears the text of these sessions' quick notes; the sessions (time, rating) are kept.
#[tauri::command]
pub fn clear_quick_notes(state: State<AppState>, ids: Vec<String>) -> Result<()> {
    with_db(&state, |c| {
        for id in &ids {
            c.execute("UPDATE sessions SET notes_md='', notes_moved=0 WHERE id=?1", [id])
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
}

// ---------- Attachments & links ----------

/// Raw body = file bytes; header `x-name` = original file name (URI-encoded).
#[tauri::command]
pub fn save_attachment(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Se esperaban los bytes del archivo.".into());
    };
    let name = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_else(|| "imagen.png".into());
    crate::media::save_bytes(&app, &name, bytes)
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
pub fn import_attachment(app: AppHandle, path: String) -> Result<String> {
    crate::media::import_file(&app, &PathBuf::from(path))
}

#[tauri::command]
pub fn attachments_dir(app: AppHandle) -> Result<String> {
    Ok(crate::media::attach_dir(&app)?.to_string_lossy().into_owned())
}

// ---------- Optional tools: LaTeX compiler & dictation models ----------

#[derive(Serialize)]
pub struct ToolsStatus {
    latex: bool,
    whisper: Option<String>,
    recording: bool,
}

#[tauri::command]
pub fn tools_status() -> ToolsStatus {
    ToolsStatus {
        latex: crate::latex::exe().exists(),
        whisper: crate::dictation::installed(),
        recording: crate::dictation::is_recording(),
    }
}

#[tauri::command]
pub async fn latex_install(app: AppHandle) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || crate::latex::install(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn latex_uninstall() -> Result<()> {
    crate::latex::uninstall()
}

#[tauri::command]
pub async fn latex_compile(note_id: String, source: String) -> Result<crate::latex::CompileResult> {
    tauri::async_runtime::spawn_blocking(move || crate::latex::compile(&note_id, &source))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn latex_export(note_id: String, dest: String) -> Result<()> {
    let pdf = crate::latex::output_root().join(&note_id).join("main.pdf");
    if note_id.contains(['/', '\\', '.']) || !pdf.exists() {
        return Err("Todavía no hay un PDF compilado para esta nota.".into());
    }
    std::fs::copy(pdf, dest).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dictation_models() -> Vec<crate::dictation::ModelInfo> {
    crate::dictation::models()
}

#[tauri::command]
pub async fn dictation_install(app: AppHandle, id: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || crate::dictation::install(&app, &id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn dictation_uninstall() -> Result<()> {
    crate::dictation::uninstall()
}

/// `device`: microphone name from `dictation_devices` (empty = Windows default).
#[tauri::command]
pub async fn dictation_start(device: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || crate::dictation::start(device))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn dictation_devices() -> Result<Vec<String>> {
    tauri::async_runtime::spawn_blocking(crate::dictation::input_devices)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dictation_stop(lang: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let audio = crate::dictation::stop()?;
        crate::dictation::transcribe(&audio, &lang)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn dictation_cancel() {
    crate::dictation::cancel();
}

/// Opens a web/mail/phone link in the user's default browser (never inside the app).
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<()> {
    crate::links::open(&app, &url)
}
