//! System-tray icon: tooltip with the remaining time and a quick-action menu.

use crate::state::AppState;
use crate::timer::{self, Kind, Snapshot};
use std::collections::HashMap;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

const TRAY_ID: &str = "main";

/// Labels come from the UI so every visible string lives in the i18n files.
pub fn label(app: &AppHandle, key: &str) -> String {
    let labels = app.state::<AppState>().tray_labels.lock().unwrap().clone();
    labels.get(key).cloned().unwrap_or_else(|| key.to_string())
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "show", label(app, "show"), true, None::<&str>)?,
            &MenuItem::with_id(app, "toggle", label(app, "toggle"), true, None::<&str>)?,
            &MenuItem::with_id(app, "finish", label(app, "finish"), true, None::<&str>)?,
            &MenuItem::with_id(app, "quit", label(app, "quit"), true, None::<&str>)?,
        ],
    )
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Kaizen Study")
        .menu(&build_menu(app)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "toggle" => timer::toggle_pause(app),
            "finish" => {
                let _ = timer::finish(app, None);
            }
            "quit" => {
                let _ = timer::finish(app, None);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Rebuilds the menu after the UI language labels change.
pub fn set_labels(app: &AppHandle, labels: HashMap<String, String>) {
    *app.state::<AppState>().tray_labels.lock().unwrap() = labels;
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY_ID), build_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
    update(app, timer::current(app).as_ref());
}

pub fn fmt_clock(secs: u64) -> String {
    format!("{:02}:{:02}", secs / 60, secs % 60)
}

pub fn update(app: &AppHandle, snap: Option<&Snapshot>) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let text = match snap {
        None => "Kaizen Study".to_string(),
        Some(s) => {
            let kind = label(app, if s.kind == Kind::Focus { "focus" } else { "break" });
            let clock = match s.duration {
                Some(d) => fmt_clock(d.saturating_sub(s.elapsed)),
                None => fmt_clock(s.elapsed),
            };
            let paused = if s.paused { format!(" ({})", label(app, "paused")) } else { String::new() };
            format!("Kaizen Study — {kind} {clock}{paused}\n{}", s.topic_name)
        }
    };
    let _ = tray.set_tooltip(Some(text));
}
