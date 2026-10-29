//! Phone notifications (ntfy, Telegram bot, e-mail via the user's own SMTP account) and the
//! reminder scheduler. Secrets live in the Windows Credential Manager, never in the database.
//!
//! Nothing goes through a Kaizen Study server: messages travel from this PC to ntfy,
//! Telegram or the user's mail provider, and from there to the user's phone.

use crate::db;
use crate::state::AppState;
use chrono::{Duration, Local, NaiveDateTime, NaiveTime};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

const SERVICE: &str = "KaizenStudy";
pub const SECRETS: &[&str] = &["telegram_token", "smtp_password", "ntfy_token"];
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

// ---------- Secrets (Windows Credential Manager) ----------

fn entry(key: &str) -> Result<keyring::Entry, String> {
    if !SECRETS.contains(&key) {
        return Err(format!("Credencial desconocida: {key}"));
    }
    keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

/// Stores a secret; an empty value deletes it.
pub fn set_secret(key: &str, value: &str) -> Result<(), String> {
    let entry = entry(key)?;
    if value.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    } else {
        entry.set_password(value).map_err(|e| e.to_string())
    }
}

pub fn get_secret(key: &str) -> Option<String> {
    entry(key).ok()?.get_password().ok().filter(|s| !s.is_empty())
}

// ---------- Channels ----------

#[derive(Clone, Default)]
pub struct Channels {
    ntfy: Option<(String, String, Option<String>)>,
    telegram: Option<(String, String)>,
    email: Option<Smtp>,
}

#[derive(Clone)]
struct Smtp {
    host: String,
    port: u16,
    security: String,
    user: String,
    password: String,
    to: String,
}

fn setting(s: &HashMap<String, String>, key: &str) -> String {
    s.get(key).cloned().unwrap_or_default().trim().to_string()
}

fn enabled(s: &HashMap<String, String>, key: &str) -> bool {
    s.get(key).is_some_and(|v| v == "true")
}

/// Reads the configured channels; `only` restricts to one channel (for the test button).
pub fn channels(conn: &Connection, only: Option<&str>) -> Result<Channels, String> {
    let s = db::all_settings(conn)?;
    let want = |name: &str, key: &str| match only {
        Some(o) => o == name,
        None => enabled(&s, key),
    };
    let mut ch = Channels::default();
    if want("ntfy", "phone_ntfy") {
        let server = setting(&s, "ntfy_server");
        let server = if server.is_empty() { "https://ntfy.sh".to_string() } else { server };
        let topic = setting(&s, "ntfy_topic");
        if topic.is_empty() {
            return Err("Falta el tema de ntfy.".into());
        }
        ch.ntfy = Some((server.trim_end_matches('/').to_string(), topic, get_secret("ntfy_token")));
    }
    if want("telegram", "phone_telegram") {
        let token = get_secret("telegram_token").ok_or("Falta el token del bot de Telegram.")?;
        let chat = setting(&s, "telegram_chat_id");
        if chat.is_empty() {
            return Err("Falta el chat de Telegram (usa «Detectar chat»).".into());
        }
        ch.telegram = Some((token, chat));
    }
    if want("email", "phone_email") {
        let port = setting(&s, "smtp_port").parse().unwrap_or(587);
        let smtp = Smtp {
            host: setting(&s, "smtp_host"),
            port,
            security: setting(&s, "smtp_security"),
            user: setting(&s, "smtp_user"),
            password: get_secret("smtp_password").ok_or("Falta la contraseña de aplicación del correo.")?,
            to: setting(&s, "smtp_to"),
        };
        if smtp.host.is_empty() || smtp.user.is_empty() {
            return Err("Faltan el servidor o el usuario del correo.".into());
        }
        ch.email = Some(smtp);
    }
    Ok(ch)
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .http_status_as_error(false)
        .build()
        .into()
}

fn send_ntfy(server: &str, topic: &str, token: Option<&str>, title: &str, body: &str) -> Result<(), String> {
    // JSON publishing avoids HTTP-header encoding issues with accents/emoji.
    let mut req = agent().post(server);
    if let Some(t) = token {
        req = req.header("Authorization", &format!("Bearer {t}"));
    }
    let mut res = req
        .send_json(serde_json::json!({ "topic": topic, "title": title, "message": body, "tags": ["books"] }))
        .map_err(|e| format!("ntfy: {e}"))?;
    if res.status().is_success() {
        Ok(())
    } else {
        Err(format!("ntfy respondió {}: {}", res.status(), res.body_mut().read_to_string().unwrap_or_default()))
    }
}

fn send_telegram(token: &str, chat: &str, title: &str, body: &str) -> Result<(), String> {
    let mut res = agent()
        .post(&format!("https://api.telegram.org/bot{token}/sendMessage"))
        .send_json(serde_json::json!({ "chat_id": chat, "text": format!("{title}\n{body}") }))
        .map_err(|e| format!("Telegram: {e}"))?;
    let json: serde_json::Value = res.body_mut().read_json().map_err(|e| format!("Telegram: {e}"))?;
    if json["ok"] == true {
        Ok(())
    } else {
        Err(format!("Telegram: {}", json["description"].as_str().unwrap_or("error desconocido")))
    }
}

fn send_email(s: &Smtp, title: &str, body: &str) -> Result<(), String> {
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{Message, SmtpTransport, Transport};
    let to = if s.to.is_empty() { &s.user } else { &s.to };
    let msg = Message::builder()
        .from(format!("Kaizen Study <{}>", s.user).parse().map_err(|e| format!("Correo (remitente): {e}"))?)
        .to(to.parse().map_err(|e| format!("Correo (destinatario): {e}"))?)
        .subject(title)
        .body(body.to_string())
        .map_err(|e| format!("Correo: {e}"))?;
    let builder = if s.security == "tls" {
        SmtpTransport::relay(&s.host)
    } else {
        SmtpTransport::starttls_relay(&s.host)
    }
    .map_err(|e| format!("Correo: {e}"))?;
    builder
        .port(s.port)
        .credentials(Credentials::new(s.user.clone(), s.password.clone()))
        .timeout(Some(TIMEOUT))
        .build()
        .send(&msg)
        .map(|_| ())
        .map_err(|e| format!("Correo: {e}"))
}

#[derive(Serialize)]
pub struct SendResult {
    pub channel: &'static str,
    pub error: Option<String>,
}

/// Sends to every configured channel (blocking; call from a background thread).
pub fn send(ch: &Channels, title: &str, body: &str) -> Vec<SendResult> {
    let mut out = Vec::new();
    if let Some((server, topic, token)) = &ch.ntfy {
        out.push(SendResult { channel: "ntfy", error: send_ntfy(server, topic, token.as_deref(), title, body).err() });
    }
    if let Some((token, chat)) = &ch.telegram {
        out.push(SendResult { channel: "telegram", error: send_telegram(token, chat, title, body).err() });
    }
    if let Some(smtp) = &ch.email {
        out.push(SendResult { channel: "email", error: send_email(smtp, title, body).err() });
    }
    out
}

/// Fire-and-forget delivery to the phone if `event` is enabled (`phone_ev_<event>`).
pub fn phone_event(app: &AppHandle, event: &str, title: String, body: String) {
    let state = app.state::<AppState>();
    let ch = {
        let guard = state.db.lock().unwrap();
        let Some(conn) = guard.as_ref() else { return };
        let on = db::get_setting(conn, &format!("phone_ev_{event}")).ok().flatten();
        if on.as_deref() != Some("true") {
            return;
        }
        match channels(conn, None) {
            Ok(ch) => ch,
            Err(err) => {
                eprintln!("Notificación al teléfono no enviada: {err}");
                return;
            }
        }
    };
    std::thread::spawn(move || {
        for r in send(&ch, &title, &body) {
            if let Some(err) = r.error {
                eprintln!("{}: {err}", r.channel);
            }
        }
    });
}

/// Finds the chat id of the last person who wrote to the bot (the user, after pressing Start).
pub fn telegram_find_chat(token: &str) -> Result<String, String> {
    let mut res = agent()
        .get(&format!("https://api.telegram.org/bot{token}/getUpdates"))
        .call()
        .map_err(|e| format!("Telegram: {e}"))?;
    let json: serde_json::Value = res.body_mut().read_json().map_err(|e| format!("Telegram: {e}"))?;
    if json["ok"] != true {
        return Err(format!("Telegram: {}", json["description"].as_str().unwrap_or("token no válido")));
    }
    json["result"]
        .as_array()
        .and_then(|updates| {
            updates.iter().rev().find_map(|u| u["message"]["chat"]["id"].as_i64().map(|id| id.to_string()))
        })
        .ok_or_else(|| "No hay mensajes: abre tu bot en Telegram, pulsa «Iniciar» y vuelve a intentarlo.".into())
}

// ---------- Reminder scheduler ----------

fn windows_notification(app: &AppHandle, conn: &Connection, title: &str, body: &str) {
    let on = db::get_setting(conn, "notifications").ok().flatten();
    if on.as_deref() != Some("false") {
        let _ = app.notification().builder().title(title).body(body).show();
    }
}

/// Runs every 30 s: daily review reminder and reminders before planned studies.
pub fn spawn_scheduler(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(30));
        check_reminders(&app);
    });
}

fn check_reminders(app: &AppHandle) {
    let label = |k: &str| crate::tray::label(app, k);
    let now = Local::now().naive_local();
    let today = now.date().to_string();
    let mut pending: Vec<(String, String, &'static str)> = Vec::new();
    {
        let state = app.state::<AppState>();
        let guard = state.db.lock().unwrap();
        let Some(conn) = guard.as_ref() else { return };
        let s = db::all_settings(conn).unwrap_or_default();

        // Daily review reminder (phone only, off until configured).
        if enabled(&s, "phone_ev_daily") && setting(&s, "daily_last") != today {
            if let Ok(at) = NaiveTime::parse_from_str(&setting(&s, "daily_time"), "%H:%M") {
                if now.time() >= at {
                    let _ = db::set_setting(conn, "daily_last", &today);
                    let due = db::due_reviews(conn).unwrap_or_default();
                    if !due.is_empty() {
                        let topics: Vec<String> = due.iter().map(|r| r.topic_name.clone()).collect();
                        let body = label("daily_body")
                            .replace("{n}", &due.len().to_string())
                            .replace("{topics}", &topics.join(", "));
                        pending.push((label("daily_title"), body, "daily"));
                    }
                }
            }
        }

        // Planned studies: Windows notification + phone, `planned_lead_min` minutes before.
        let lead = setting(&s, "planned_lead_min").parse().unwrap_or(15);
        let tomorrow = (now.date() + Duration::days(1)).to_string();
        let mut sent = state.reminders_sent.lock().unwrap();
        for occ in db::planned_occurrences(conn, &today, &tomorrow).unwrap_or_default() {
            let Ok(at) = NaiveDateTime::parse_from_str(&format!("{} {}", occ.date, occ.time), "%Y-%m-%d %H:%M") else {
                continue;
            };
            if now >= at - Duration::minutes(lead) && now < at && sent.insert(format!("{}@{}", occ.plan_id, occ.date)) {
                let body = label("planned_body")
                    .replace("{topic}", &occ.topic_name)
                    .replace("{subject}", &occ.subject_name)
                    .replace("{time}", &occ.time);
                windows_notification(app, conn, &label("planned_title"), &body);
                pending.push((label("planned_title"), body, "planned"));
            }
        }
    }
    for (title, body, event) in pending {
        phone_event(app, event, title, body);
    }
}
