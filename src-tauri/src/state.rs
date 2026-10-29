use crate::timer::ActiveTimer;
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;

/// Lock order when holding several: `timer` → `db`.
#[derive(Default)]
pub struct AppState {
    pub db: Mutex<Option<Connection>>,
    pub data_dir: Mutex<Option<PathBuf>>,
    pub timer: Mutex<Option<ActiveTimer>>,
    pub tray_labels: Mutex<HashMap<String, String>>,
    pub mica: Mutex<bool>,
    /// Set when the global shortcut could not be registered (e.g. taken by another app).
    pub shortcut_error: Mutex<Option<String>>,
    /// "planId@date" reminders already sent during this run.
    pub reminders_sent: Mutex<HashSet<String>>,
}
