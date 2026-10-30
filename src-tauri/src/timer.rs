//! Study timer. Runs on a background thread so it keeps exact time while the
//! window is hidden; the UI only renders the snapshots it receives.

use crate::db;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const TICK: Duration = Duration::from_millis(250);
const PERSIST_EVERY_MS: u128 = 15_000;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TimerConfig {
    /// "intervals" (fixed focus/break) or "flow" (open-ended focus, break = focus / ratio).
    pub mode: String,
    pub focus_min: u32,
    pub break_min: u32,
    pub long_break_min: u32,
    /// Long break after this many focus blocks (0 = never).
    pub long_every: u32,
    pub flow_ratio: u32,
    /// Finishing the session schedules spaced-repetition reviews.
    pub spaced: bool,
    /// Activity ids for consecutive breaks; repeats in a cycle when there are more breaks.
    #[serde(default)]
    pub break_plan: Vec<String>,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Focus,
    Break,
}

impl Kind {
    fn as_str(&self) -> &'static str {
        match self {
            Kind::Focus => "focus",
            Kind::Break => "break",
        }
    }
}

pub struct ActiveTimer {
    pub session_id: String,
    pub topic_id: String,
    pub topic_name: String,
    pub subject_name: String,
    pub subject_color: String,
    pub template_id: Option<String>,
    pub config: TimerConfig,
    kind: Kind,
    block_id: String,
    block_ms: u128,
    block_target_s: Option<u64>,
    paused: bool,
    cycle: u32,
    focus_ms: u128,
    break_ms: u128,
    unsaved_ms: u128,
    breaks: u32,
    activity: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct Snapshot {
    pub session_id: String,
    pub topic_id: String,
    pub topic_name: String,
    pub subject_name: String,
    pub subject_color: String,
    pub template_id: Option<String>,
    pub mode: String,
    pub kind: Kind,
    pub paused: bool,
    pub elapsed: u64,
    pub duration: Option<u64>,
    pub cycle: u32,
    pub focus_total: u64,
    pub break_total: u64,
    /// Planned activity for the current break, if any.
    pub activity: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct BlockEnd {
    pub finished: Kind,
    pub next: Kind,
    pub next_minutes: u64,
    pub long_break: bool,
    pub activity: Option<String>,
}

impl ActiveTimer {
    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            session_id: self.session_id.clone(),
            topic_id: self.topic_id.clone(),
            topic_name: self.topic_name.clone(),
            subject_name: self.subject_name.clone(),
            subject_color: self.subject_color.clone(),
            template_id: self.template_id.clone(),
            mode: self.config.mode.clone(),
            kind: self.kind.clone(),
            paused: self.paused,
            elapsed: (self.block_ms / 1000) as u64,
            duration: self.block_target_s,
            cycle: self.cycle,
            focus_total: (self.focus_ms / 1000) as u64,
            break_total: (self.break_ms / 1000) as u64,
            activity: self.activity.clone(),
        }
    }
}

fn topic_info(conn: &rusqlite::Connection, topic_id: &str) -> db::Result<(String, String, String)> {
    conn.query_row(
        "SELECT t.name, s.name, s.color FROM topics t JOIN subjects s ON s.id=t.subject_id WHERE t.id=?1",
        [topic_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .map_err(|e| e.to_string())
}

/// Starts a new session, or resumes an unfinished one when `resume` holds its id.
pub fn start(
    app: &AppHandle,
    topic_id: &str,
    template_id: Option<String>,
    mut config: TimerConfig,
    resume: Option<(String, u64, u64)>,
) -> db::Result<Snapshot> {
    if config.mode != "flow" && config.mode != "intervals" {
        return Err(format!("Modo de temporizador desconocido: {}", config.mode));
    }
    config.focus_min = config.focus_min.clamp(1, 600);
    config.break_min = config.break_min.min(600);
    config.long_break_min = config.long_break_min.min(600);
    config.flow_ratio = config.flow_ratio.max(1);
    let state = app.state::<AppState>();
    let mut timer = state.timer.lock().unwrap();
    if timer.is_some() {
        return Err("Ya hay una sesión en curso.".into());
    }
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or("Base de datos no abierta")?;
    let (topic_name, subject_name, subject_color) = topic_info(conn, topic_id)?;
    let (session_id, focus_s, break_s) = match resume {
        Some(r) => r,
        None => {
            let cfg_json = serde_json::to_string(&config).unwrap();
            let id = db::create_session(
                conn,
                topic_id,
                template_id.as_deref(),
                &cfg_json,
                config.focus_min as i64,
            )?;
            (id, 0, 0)
        }
    };
    // A resumed session continues counting its completed focus blocks.
    let done_blocks: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM blocks WHERE session_id=?1 AND kind='focus' AND completed=1",
            [&session_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let block_id = db::insert_block(conn, &session_id, "focus")?;
    let t = ActiveTimer {
        session_id,
        topic_id: topic_id.to_string(),
        topic_name,
        subject_name,
        subject_color,
        template_id,
        block_target_s: focus_target(&config),
        config,
        kind: Kind::Focus,
        block_id,
        block_ms: 0,
        paused: false,
        cycle: done_blocks,
        focus_ms: focus_s as u128 * 1000,
        break_ms: break_s as u128 * 1000,
        unsaved_ms: 0,
        breaks: 0,
        activity: None,
    };
    let snap = t.snapshot();
    *timer = Some(t);
    drop(db_guard);
    drop(timer);
    emit(app, &snap);
    Ok(snap)
}

fn focus_target(c: &TimerConfig) -> Option<u64> {
    (c.mode != "flow").then_some(c.focus_min as u64 * 60)
}

pub fn spawn_ticker(app: AppHandle) {
    // `KAIZEN_TIME_SCALE` speeds the clock up for end-to-end tests (e.g. 60 = 1 min per second).
    let scale: u128 = std::env::var("KAIZEN_TIME_SCALE")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|v| *v >= 1)
        .unwrap_or(1);
    std::thread::spawn(move || {
        let mut last = Instant::now();
        loop {
            std::thread::sleep(TICK);
            let now = Instant::now();
            let dt = now.duration_since(last).as_millis() * scale;
            last = now;
            tick(&app, dt);
        }
    });
}

fn tick(app: &AppHandle, dt: u128) {
    let state = app.state::<AppState>();
    let mut guard = state.timer.lock().unwrap();
    let Some(t) = guard.as_mut() else { return };
    if t.paused {
        return;
    }
    let before = t.block_ms / 1000;
    t.block_ms += dt;
    t.unsaved_ms += dt;
    match t.kind {
        Kind::Focus => t.focus_ms += dt,
        Kind::Break => t.break_ms += dt,
    }
    let ended = t.block_target_s.is_some_and(|s| t.block_ms >= s as u128 * 1000);
    let persist = t.unsaved_ms >= PERSIST_EVERY_MS;
    let changed = t.block_ms / 1000 != before;
    drop(guard);

    if ended {
        advance(app, true);
    } else {
        if persist {
            persist_totals(app);
        }
        if changed {
            emit_current(app);
        }
    }
}

fn persist_totals(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut guard = state.timer.lock().unwrap();
    let Some(t) = guard.as_mut() else { return };
    t.unsaved_ms = 0;
    if let Some(conn) = state.db.lock().unwrap().as_ref() {
        let _ = db::update_session_totals(
            conn,
            &t.session_id,
            (t.focus_ms / 1000) as i64,
            (t.break_ms / 1000) as i64,
        );
    }
}

/// Closes the current block and opens the next one (focus ⇄ break).
pub fn advance(app: &AppHandle, completed: bool) {
    let state = app.state::<AppState>();
    let mut guard = state.timer.lock().unwrap();
    let Some(t) = guard.as_mut() else { return };
    let db_guard = state.db.lock().unwrap();
    let Some(conn) = db_guard.as_ref() else { return };

    let _ = db::close_block(conn, &t.block_id, completed);
    let finished = t.kind.clone();
    let mut long_break = false;
    let (next, target) = match t.kind {
        Kind::Focus => {
            t.cycle += 1;
            let c = &t.config;
            let secs = if c.mode == "flow" {
                (t.block_ms / 1000) as u64 / c.flow_ratio.max(1) as u64
            } else if c.long_every > 0 && t.cycle % c.long_every == 0 {
                long_break = true;
                c.long_break_min as u64 * 60
            } else {
                c.break_min as u64 * 60
            };
            (Kind::Break, Some(secs.max(60)))
        }
        Kind::Break => (Kind::Focus, focus_target(&t.config)),
    };
    t.activity = None;
    if next == Kind::Break {
        let plan = &t.config.break_plan;
        if !plan.is_empty() {
            t.activity = Some(plan[t.breaks as usize % plan.len()].clone());
        }
        t.breaks += 1;
    }
    t.block_id = db::insert_block(conn, &t.session_id, next.as_str()).unwrap_or_default();
    t.kind = next.clone();
    t.block_ms = 0;
    t.block_target_s = target;
    t.unsaved_ms = 0;
    let _ = db::update_session_totals(
        conn,
        &t.session_id,
        (t.focus_ms / 1000) as i64,
        (t.break_ms / 1000) as i64,
    );
    let snap = t.snapshot();
    drop(db_guard);
    drop(guard);

    let _ = app.emit(
        "timer://block-end",
        BlockEnd {
            finished,
            next,
            next_minutes: target.map(|s| s / 60).unwrap_or(0),
            long_break,
            activity: snap.activity.clone(),
        },
    );
    emit(app, &snap);
}

pub fn toggle_pause(app: &AppHandle) {
    {
        let state = app.state::<AppState>();
        let mut guard = state.timer.lock().unwrap();
        let Some(t) = guard.as_mut() else { return };
        t.paused = !t.paused;
    }
    persist_totals(app);
    emit_current(app);
}

/// Ends the running session. Returns its id so the UI can ask for a rating.
pub fn finish(app: &AppHandle, rating: Option<i64>) -> db::Result<Option<String>> {
    let state = app.state::<AppState>();
    let Some(t) = state.timer.lock().unwrap().take() else {
        return Ok(None);
    };
    let saved = (|| -> db::Result<()> {
        let db_guard = state.db.lock().unwrap();
        let conn = db_guard.as_ref().ok_or("Base de datos no abierta")?;
        db::close_block(conn, &t.block_id, false)?;
        db::update_session_totals(
            conn,
            &t.session_id,
            (t.focus_ms / 1000) as i64,
            (t.break_ms / 1000) as i64,
        )?;
        db::finish_session(conn, &t.session_id, rating, t.config.spaced)
    })();
    // The timer is stopped either way: always tell the UI, even if saving failed.
    let _ = app.emit("timer://finished", &t.session_id);
    crate::tray::update(app, None);
    if let Some(w) = app.get_webview_window("mini") {
        let _ = w.close();
    }
    saved.map(|_| Some(t.session_id))
}

pub fn current(app: &AppHandle) -> Option<Snapshot> {
    app.state::<AppState>()
        .timer
        .lock()
        .unwrap()
        .as_ref()
        .map(|t| t.snapshot())
}

fn emit_current(app: &AppHandle) {
    if let Some(s) = current(app) {
        emit(app, &s);
    }
}

fn emit(app: &AppHandle, snap: &Snapshot) {
    let _ = app.emit("timer://tick", snap);
    crate::tray::update(app, Some(snap));
}
