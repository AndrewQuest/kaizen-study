mod commands;
mod db;
mod dictation;
mod latex;
mod links;
mod media;
mod notify;
mod spell;
mod state;
mod storage;
mod timer;
mod tray;

use state::AppState;
use tauri::{Manager, WindowEvent};
use tauri_plugin_global_shortcut::ShortcutState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    // Test runs (isolated config) may run next to the user's own Kaizen Study.
    if std::env::var_os("KAIZEN_CONFIG_DIR").is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| tray::show_main(app)));
    }
    builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(links::navigation_guard())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        timer::toggle_pause(app);
                    }
                })
                .build(),
        )
        .manage(AppState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let window = app.get_webview_window("main").unwrap();

            #[cfg(target_os = "windows")]
            {
                let mica = window_vibrancy::apply_mica(&window, None).is_ok();
                *app.state::<AppState>().mica.lock().unwrap() = mica;
            }

            if let Some(dir) = storage::load_config().data_dir {
                if let Err(err) = commands::open_data_dir(&handle, dir) {
                    eprintln!("No se pudo abrir la carpeta de datos: {err}");
                }
            }
            tray::create(&handle)?;
            timer::spawn_ticker(handle.clone());
            notify::spawn_scheduler(handle.clone());
            // Compiled LaTeX PDFs are shown in the webview through the asset protocol.
            let _ = app.asset_protocol_scope().allow_directory(latex::output_root(), true);
            // Parse the spell-check dictionaries in the background so the first check is fast.
            std::thread::spawn(|| {
                spell::dictionaries();
            });
            // Started with Windows: stay in the tray (the window starts hidden, see tauri.conf.json).
            if !std::env::args().any(|a| a == "--minimized") {
                let _ = window.show();
            }

            // Closing the window keeps the app in the tray: the timer and the reminders keep
            // running. «Salir» in the tray menu quits for real.
            let h = handle.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Some(w) = h.get_webview_window("main") {
                        let _ = w.hide();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::set_data_dir,
            commands::list_subjects,
            commands::save_subject,
            commands::delete_subject,
            commands::list_topics,
            commands::get_topic,
            commands::save_topic,
            commands::delete_topic,
            commands::list_sessions,
            commands::list_notes,
            commands::search_notes,
            commands::save_note,
            commands::delete_note,
            commands::list_reviews,
            commands::due_reviews,
            commands::complete_review,
            commands::stats,
            commands::get_settings,
            commands::set_setting,
            commands::set_shortcut,
            commands::set_tray_labels,
            commands::export_backup,
            commands::import_backup,
            commands::start_session,
            commands::unfinished_session,
            commands::resume_session,
            commands::close_unfinished,
            commands::timer_state,
            commands::timer_toggle_pause,
            commands::timer_skip,
            commands::finish_session,
            commands::rate_session,
            commands::save_session_notes,
            commands::toggle_mini,
            commands::show_main,
            commands::open_external,
            commands::list_activities,
            commands::save_activity,
            commands::delete_activity,
            commands::save_planned,
            commands::get_planned,
            commands::delete_planned,
            commands::planned_occurrences,
            commands::upcoming_exams,
            commands::list_quick_notes,
            commands::search_quick_notes,
            commands::move_quick_note,
            commands::spell_languages,
            commands::spell_check,
            commands::spell_suggest,
            commands::dictionary_words,
            commands::dictionary_add,
            commands::dictionary_remove,
            commands::set_secret,
            commands::secrets_status,
            commands::phone_test,
            commands::phone_notify,
            commands::telegram_find_chat,
            commands::clear_quick_notes,
            commands::save_attachment,
            commands::import_attachment,
            commands::attachments_dir,
            commands::tools_status,
            commands::latex_install,
            commands::latex_uninstall,
            commands::latex_compile,
            commands::latex_export,
            commands::dictation_models,
            commands::dictation_install,
            commands::dictation_uninstall,
            commands::dictation_start,
            commands::dictation_devices,
            commands::dictation_stop,
            commands::dictation_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kaizen Study");
}
