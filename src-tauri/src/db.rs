//! SQLite storage: connection, migrations and domain queries.

use chrono::{Datelike, Duration, Local, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const DB_FILE: &str = "kaizen.db";

/// Days between reviews for the Leitner / spaced-repetition ladder.
pub const LEITNER_DAYS: [i64; 5] = [1, 3, 7, 14, 30];

const MIGRATIONS: &[&str] = &[r#"
CREATE TABLE subjects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '📘',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE topics (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    template_id TEXT,
    status TEXT NOT NULL DEFAULT 'nuevo',
    stage TEXT,
    exam_date TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    template_id TEXT,
    config_json TEXT NOT NULL DEFAULT '{}',
    started_at TEXT NOT NULL,
    ended_at TEXT,
    planned_minutes INTEGER NOT NULL DEFAULT 0,
    focus_seconds INTEGER NOT NULL DEFAULT 0,
    break_seconds INTEGER NOT NULL DEFAULT 0,
    rating INTEGER,
    notes_md TEXT NOT NULL DEFAULT ''
);
CREATE TABLE blocks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    completed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body_md TEXT NOT NULL DEFAULT '',
    layout TEXT NOT NULL DEFAULT 'libre',
    updated_at TEXT NOT NULL
);
CREATE TABLE reviews (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    due_date TEXT NOT NULL,
    step INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'leitner',
    done_at TEXT,
    result TEXT
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX idx_topics_subject ON topics(subject_id);
CREATE INDEX idx_sessions_topic ON sessions(topic_id);
CREATE INDEX idx_sessions_started ON sessions(started_at);
CREATE INDEX idx_notes_topic ON notes(topic_id);
CREATE INDEX idx_reviews_due ON reviews(due_date);
"#, r#"
CREATE TABLE break_activities (
    id TEXT PRIMARY KEY,
    emoji TEXT NOT NULL,
    name TEXT NOT NULL,
    instructions TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0
);
INSERT INTO break_activities (id, emoji, name, instructions, sort) VALUES
 ('cafe', '☕', 'Café o té', 'Prepáralo con calma, lejos del escritorio. Evita el móvil mientras tanto.', 1),
 ('caminar', '🚶', 'Caminar', 'Da una vuelta o sube y baja escaleras. Moverte activa la circulación y despeja la mente.', 2),
 ('estirar', '🧘', 'Estirarse', 'Estira cuello, hombros, espalda y muñecas. Respira lento en cada estiramiento.', 3),
 ('agua', '💧', 'Hidratarse', 'Bebe un vaso de agua. La deshidratación leve reduce la concentración.', 4),
 ('respirar', '🌬️', 'Respirar', 'Respiración 4-7-8: inhala 4 s, retén 7 s, exhala 8 s. Repite 4 veces.', 5),
 ('mirar_lejos', '👀', 'Mirar lejos (20-20-20)', 'Mira algo a más de 6 metros durante al menos 20 segundos para descansar la vista.', 6);
CREATE TABLE planned_studies (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    template_id TEXT,
    start_date TEXT NOT NULL,
    time TEXT NOT NULL,
    duration_min INTEGER NOT NULL DEFAULT 60,
    repeat_days TEXT NOT NULL DEFAULT '',
    repeat_until TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE user_dictionary (word TEXT PRIMARY KEY);
ALTER TABLE sessions ADD COLUMN notes_moved INTEGER NOT NULL DEFAULT 0;
"#, r#"
CREATE TABLE planned_exceptions (
    plan_id TEXT NOT NULL REFERENCES planned_studies(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    kind TEXT NOT NULL,
    new_date TEXT,
    new_time TEXT,
    PRIMARY KEY (plan_id, date)
);
"#];

pub type Result<T> = std::result::Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

pub fn now() -> String {
    Local::now().to_rfc3339()
}

pub fn today() -> NaiveDate {
    Local::now().date_naive()
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn open(dir: &Path) -> Result<Connection> {
    std::fs::create_dir_all(dir).map_err(e)?;
    let conn = Connection::open(dir.join(DB_FILE)).map_err(e)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(e)?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<()> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(e)?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
        conn.execute_batch(&format!(
            "BEGIN; {sql} PRAGMA user_version = {}; COMMIT;",
            i + 1
        ))
        .map_err(e)?;
    }
    Ok(())
}

// ---------- Types ----------

#[derive(Serialize, Deserialize, Clone)]
pub struct Subject {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    pub archived: bool,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Topic {
    pub id: String,
    pub subject_id: String,
    pub name: String,
    pub template_id: Option<String>,
    pub status: String,
    pub stage: Option<String>,
    pub exam_date: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub session_count: i64,
    #[serde(default)]
    pub focus_seconds: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Session {
    pub id: String,
    pub topic_id: String,
    pub template_id: Option<String>,
    pub config_json: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub planned_minutes: i64,
    pub focus_seconds: i64,
    pub break_seconds: i64,
    pub rating: Option<i64>,
    pub notes_md: String,
    #[serde(default)]
    pub notes_moved: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub topic_id: String,
    pub title: String,
    pub body_md: String,
    pub layout: String,
    pub updated_at: String,
}

#[derive(Serialize, Clone)]
pub struct NoteHit {
    #[serde(flatten)]
    pub note: Note,
    pub topic_name: String,
    pub subject_name: String,
    pub subject_color: String,
}

#[derive(Serialize, Clone)]
pub struct Review {
    pub id: String,
    pub topic_id: String,
    pub topic_name: String,
    pub subject_name: String,
    pub subject_color: String,
    pub due_date: String,
    pub step: i64,
    pub kind: String,
    pub done_at: Option<String>,
    pub result: Option<String>,
}

#[derive(Serialize)]
pub struct DayTotal {
    pub date: String,
    pub seconds: i64,
}

#[derive(Serialize)]
pub struct SubjectTotal {
    pub name: String,
    pub color: String,
    pub seconds: i64,
}

#[derive(Serialize)]
pub struct Stats {
    pub daily: Vec<DayTotal>,
    pub by_subject: Vec<SubjectTotal>,
    pub today_seconds: i64,
    pub total_seconds: i64,
    pub session_count: i64,
    pub streak: i64,
    pub best_streak: i64,
}

// ---------- Subjects ----------

pub fn list_subjects(c: &Connection, include_archived: bool) -> Result<Vec<Subject>> {
    let mut st = c
        .prepare(
            "SELECT id,name,color,icon,archived,created_at FROM subjects
             WHERE archived = 0 OR ?1 ORDER BY archived, name COLLATE NOCASE",
        )
        .map_err(e)?;
    let rows = st
        .query_map([include_archived], |r| {
            Ok(Subject {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                icon: r.get(3)?,
                archived: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(e)?;
    rows.collect::<std::result::Result<_, _>>().map_err(e)
}

pub fn save_subject(c: &Connection, s: &Subject) -> Result<Subject> {
    let mut s = s.clone();
    if s.id.is_empty() {
        s.id = new_id();
        s.created_at = now();
    }
    c.execute(
        "INSERT INTO subjects (id,name,color,icon,archived,created_at) VALUES (?1,?2,?3,?4,?5,?6)
         ON CONFLICT(id) DO UPDATE SET name=?2,color=?3,icon=?4,archived=?5",
        params![s.id, s.name, s.color, s.icon, s.archived, s.created_at],
    )
    .map_err(e)?;
    Ok(s)
}

pub fn delete_subject(c: &Connection, id: &str) -> Result<()> {
    c.execute("DELETE FROM subjects WHERE id=?1", [id]).map_err(e)?;
    Ok(())
}

// ---------- Topics ----------

const TOPIC_SELECT: &str = "SELECT t.id,t.subject_id,t.name,t.template_id,t.status,t.stage,t.exam_date,t.created_at,
    (SELECT COUNT(*) FROM sessions s WHERE s.topic_id=t.id AND s.ended_at IS NOT NULL),
    (SELECT COALESCE(SUM(focus_seconds),0) FROM sessions s WHERE s.topic_id=t.id)
    FROM topics t";

fn row_topic(r: &rusqlite::Row) -> rusqlite::Result<Topic> {
    Ok(Topic {
        id: r.get(0)?,
        subject_id: r.get(1)?,
        name: r.get(2)?,
        template_id: r.get(3)?,
        status: r.get(4)?,
        stage: r.get(5)?,
        exam_date: r.get(6)?,
        created_at: r.get(7)?,
        session_count: r.get(8)?,
        focus_seconds: r.get(9)?,
    })
}

pub fn list_topics(c: &Connection, subject_id: &str) -> Result<Vec<Topic>> {
    let mut st = c
        .prepare(&format!(
            "{TOPIC_SELECT} WHERE t.subject_id=?1 ORDER BY t.created_at"
        ))
        .map_err(e)?;
    let rows = st.query_map([subject_id], row_topic).map_err(e)?;
    rows.collect::<std::result::Result<_, _>>().map_err(e)
}

pub fn get_topic(c: &Connection, id: &str) -> Result<Topic> {
    c.query_row(&format!("{TOPIC_SELECT} WHERE t.id=?1"), [id], row_topic)
        .map_err(e)
}

pub fn save_topic(c: &Connection, t: &Topic) -> Result<Topic> {
    let mut t = t.clone();
    if t.id.is_empty() {
        t.id = new_id();
        t.created_at = now();
    }
    let prev_exam: Option<String> = c
        .query_row("SELECT exam_date FROM topics WHERE id=?1", [&t.id], |r| r.get(0))
        .optional()
        .map_err(e)?
        .flatten();
    c.execute(
        "INSERT INTO topics (id,subject_id,name,template_id,status,stage,exam_date,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
         ON CONFLICT(id) DO UPDATE SET name=?3,template_id=?4,status=?5,stage=?6,exam_date=?7",
        params![
            t.id, t.subject_id, t.name, t.template_id, t.status, t.stage, t.exam_date, t.created_at
        ],
    )
    .map_err(e)?;
    if t.exam_date != prev_exam {
        schedule_exam_reviews(c, &t.id, t.exam_date.as_deref())?;
    }
    get_topic(c, &t.id)
}

pub fn delete_topic(c: &Connection, id: &str) -> Result<()> {
    c.execute("DELETE FROM topics WHERE id=?1", [id]).map_err(e)?;
    Ok(())
}

// ---------- Sessions ----------

fn row_session(r: &rusqlite::Row) -> rusqlite::Result<Session> {
    Ok(Session {
        id: r.get(0)?,
        topic_id: r.get(1)?,
        template_id: r.get(2)?,
        config_json: r.get(3)?,
        started_at: r.get(4)?,
        ended_at: r.get(5)?,
        planned_minutes: r.get(6)?,
        focus_seconds: r.get(7)?,
        break_seconds: r.get(8)?,
        rating: r.get(9)?,
        notes_md: r.get(10)?,
        notes_moved: r.get(11)?,
    })
}

const SESSION_COLS: &str = "id,topic_id,template_id,config_json,started_at,ended_at,planned_minutes,focus_seconds,break_seconds,rating,notes_md,notes_moved";

pub fn list_sessions(c: &Connection, topic_id: &str) -> Result<Vec<Session>> {
    let mut st = c
        .prepare(&format!(
            "SELECT {SESSION_COLS} FROM sessions WHERE topic_id=?1 ORDER BY started_at DESC"
        ))
        .map_err(e)?;
    let rows = st.query_map([topic_id], row_session).map_err(e)?;
    rows.collect::<std::result::Result<_, _>>().map_err(e)
}

pub fn unfinished_session(c: &Connection) -> Result<Option<Session>> {
    c.query_row(
        &format!("SELECT {SESSION_COLS} FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1"),
        [],
        row_session,
    )
    .optional()
    .map_err(e)
}

/// Closes interrupted sessions except the newest one (which the UI offers to resume).
pub fn close_stale_sessions(c: &Connection) -> Result<()> {
    c.execute(
        "UPDATE sessions SET ended_at = started_at WHERE ended_at IS NULL AND id NOT IN
         (SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1)",
        [],
    )
    .map_err(e)?;
    Ok(())
}

pub fn create_session(
    c: &Connection,
    topic_id: &str,
    template_id: Option<&str>,
    config_json: &str,
    planned_minutes: i64,
) -> Result<String> {
    let id = new_id();
    c.execute(
        "INSERT INTO sessions (id,topic_id,template_id,config_json,started_at,planned_minutes)
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![id, topic_id, template_id, config_json, now(), planned_minutes],
    )
    .map_err(e)?;
    c.execute(
        "UPDATE topics SET status='aprendiendo' WHERE id=?1 AND status='nuevo'",
        [topic_id],
    )
    .map_err(e)?;
    Ok(id)
}

pub fn update_session_totals(c: &Connection, id: &str, focus: i64, brk: i64) -> Result<()> {
    c.execute(
        "UPDATE sessions SET focus_seconds=?2, break_seconds=?3 WHERE id=?1",
        params![id, focus, brk],
    )
    .map_err(e)?;
    Ok(())
}

pub fn update_session_notes(c: &Connection, id: &str, notes: &str) -> Result<()> {
    c.execute("UPDATE sessions SET notes_md=?2 WHERE id=?1", params![id, notes])
        .map_err(e)?;
    Ok(())
}

pub fn finish_session(
    c: &Connection,
    id: &str,
    rating: Option<i64>,
    spaced: bool,
) -> Result<()> {
    c.execute(
        "UPDATE sessions SET ended_at=?2, rating=COALESCE(?3, rating) WHERE id=?1",
        params![id, now(), rating],
    )
    .map_err(e)?;
    if spaced {
        let topic_id: String = c
            .query_row("SELECT topic_id FROM sessions WHERE id=?1", [id], |r| r.get(0))
            .map_err(e)?;
        let pending: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM reviews WHERE topic_id=?1 AND kind='leitner' AND done_at IS NULL",
                [&topic_id],
                |r| r.get(0),
            )
            .map_err(e)?;
        if pending == 0 {
            insert_review(c, &topic_id, today() + Duration::days(LEITNER_DAYS[0]), 0, "leitner")?;
        }
    }
    Ok(())
}

pub fn insert_block(c: &Connection, session_id: &str, kind: &str) -> Result<String> {
    let id = new_id();
    c.execute(
        "INSERT INTO blocks (id,session_id,kind,started_at) VALUES (?1,?2,?3,?4)",
        params![id, session_id, kind, now()],
    )
    .map_err(e)?;
    Ok(id)
}

pub fn close_block(c: &Connection, id: &str, completed: bool) -> Result<()> {
    c.execute(
        "UPDATE blocks SET ended_at=?2, completed=?3 WHERE id=?1 AND ended_at IS NULL",
        params![id, now(), completed],
    )
    .map_err(e)?;
    Ok(())
}

// ---------- Notes ----------

fn row_note(r: &rusqlite::Row) -> rusqlite::Result<Note> {
    Ok(Note {
        id: r.get(0)?,
        topic_id: r.get(1)?,
        title: r.get(2)?,
        body_md: r.get(3)?,
        layout: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

pub fn list_notes(c: &Connection, topic_id: &str) -> Result<Vec<Note>> {
    let mut st = c
        .prepare("SELECT id,topic_id,title,body_md,layout,updated_at FROM notes WHERE topic_id=?1 ORDER BY updated_at DESC")
        .map_err(e)?;
    let rows = st.query_map([topic_id], row_note).map_err(e)?;
    rows.collect::<std::result::Result<_, _>>().map_err(e)
}

pub fn search_notes(c: &Connection, q: &str) -> Result<Vec<NoteHit>> {
    let like = format!("%{}%", q.replace('%', "\\%").replace('_', "\\_"));
    let mut st = c
        .prepare(
            "SELECT n.id,n.topic_id,n.title,n.body_md,n.layout,n.updated_at,t.name,s.name,s.color
             FROM notes n JOIN topics t ON t.id=n.topic_id JOIN subjects s ON s.id=t.subject_id
             WHERE n.title LIKE ?1 ESCAPE '\\' OR n.body_md LIKE ?1 ESCAPE '\\'
             ORDER BY n.updated_at DESC LIMIT 100",
        )
        .map_err(e)?;
    let rows = st
        .query_map([like], |r| {
            Ok(NoteHit {
                note: row_note(r)?,
                topic_name: r.get(6)?,
                subject_name: r.get(7)?,
                subject_color: r.get(8)?,
            })
        })
        .map_err(e)?;
    rows.collect::<std::result::Result<_, _>>().map_err(e)
}

pub fn save_note(c: &Connection, n: &Note) -> Result<Note> {
    let mut n = n.clone();
    if n.id.is_empty() {
        n.id = new_id();
    }
    n.updated_at = now();
    c.execute(
        "INSERT INTO notes (id,topic_id,title,body_md,layout,updated_at) VALUES (?1,?2,?3,?4,?5,?6)
         ON CONFLICT(id) DO UPDATE SET title=?3,body_md=?4,layout=?5,updated_at=?6",
        params![n.id, n.topic_id, n.title, n.body_md, n.layout, n.updated_at],
    )
    .map_err(e)?;
    Ok(n)
}

pub fn delete_note(c: &Connection, id: &str) -> Result<()> {
    c.execute("DELETE FROM notes WHERE id=?1", [id]).map_err(e)?;
    Ok(())
}

// ---------- Reviews ----------

fn insert_review(c: &Connection, topic_id: &str, due: NaiveDate, step: i64, kind: &str) -> Result<()> {
    c.execute(
        "INSERT INTO reviews (id,topic_id,due_date,step,kind) VALUES (?1,?2,?3,?4,?5)",
        params![new_id(), topic_id, due.to_string(), step, kind],
    )
    .map_err(e)?;
    Ok(())
}

/// 7-3-2-1 method: reviews 7, 3, 2 and 1 days before the exam (only future dates).
fn schedule_exam_reviews(c: &Connection, topic_id: &str, exam: Option<&str>) -> Result<()> {
    c.execute(
        "DELETE FROM reviews WHERE topic_id=?1 AND kind='examen' AND done_at IS NULL",
        [topic_id],
    )
    .map_err(e)?;
    let Some(exam) = exam.and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()) else {
        return Ok(());
    };
    for (step, days) in [7, 3, 2, 1].iter().enumerate() {
        let due = exam - Duration::days(*days);
        if due >= today() {
            insert_review(c, topic_id, due, step as i64, "examen")?;
        }
    }
    Ok(())
}

pub fn list_reviews(c: &Connection, from: &str, to: &str) -> Result<Vec<Review>> {
    let mut st = c
        .prepare(
            "SELECT r.id,r.topic_id,t.name,s.name,s.color,r.due_date,r.step,r.kind,r.done_at,r.result
             FROM reviews r JOIN topics t ON t.id=r.topic_id JOIN subjects s ON s.id=t.subject_id
             WHERE (r.due_date BETWEEN ?1 AND ?2) OR (r.done_at IS NULL AND r.due_date < ?1 AND ?1 <= date('now','localtime'))
             ORDER BY r.due_date, s.name",
        )
        .map_err(e)?;
    let rows = st
        .query_map([from, to], |r| {
            Ok(Review {
                id: r.get(0)?,
                topic_id: r.get(1)?,
                topic_name: r.get(2)?,
                subject_name: r.get(3)?,
                subject_color: r.get(4)?,
                due_date: r.get(5)?,
                step: r.get(6)?,
                kind: r.get(7)?,
                done_at: r.get(8)?,
                result: r.get(9)?,
            })
        })
        .map_err(e)?;
    rows.collect::<std::result::Result<_, _>>().map_err(e)
}

/// Pending reviews due today or overdue.
pub fn due_reviews(c: &Connection) -> Result<Vec<Review>> {
    let t = today().to_string();
    Ok(list_reviews(c, "0000-01-01", &t)?
        .into_iter()
        .filter(|r| r.done_at.is_none())
        .collect())
}

/// Difícil resets the ladder, bien advances one step, fácil advances two.
pub fn complete_review(c: &Connection, id: &str, result: &str) -> Result<()> {
    let (topic_id, step, kind): (String, i64, String) = c
        .query_row(
            "SELECT topic_id,step,kind FROM reviews WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(e)?;
    c.execute(
        "UPDATE reviews SET done_at=?2, result=?3 WHERE id=?1",
        params![id, now(), result],
    )
    .map_err(e)?;
    if kind != "leitner" {
        return Ok(());
    }
    let next = match result {
        "dificil" => 0,
        "facil" => step + 2,
        _ => step + 1,
    };
    let last = LEITNER_DAYS.len() as i64 - 1;
    if next > last {
        c.execute("UPDATE topics SET status='dominado' WHERE id=?1", [&topic_id])
            .map_err(e)?;
    } else {
        c.execute(
            "UPDATE topics SET status='repasando' WHERE id=?1 AND status!='dominado'",
            [&topic_id],
        )
        .map_err(e)?;
    }
    let days = LEITNER_DAYS[next.min(last) as usize];
    insert_review(c, &topic_id, today() + Duration::days(days), next.min(last), "leitner")
}

// ---------- Stats ----------

pub fn stats(c: &Connection, days: i64) -> Result<Stats> {
    let mut by_day = std::collections::HashMap::<String, i64>::new();
    {
        let mut st = c
            .prepare("SELECT substr(started_at,1,10), SUM(focus_seconds) FROM sessions GROUP BY 1")
            .map_err(e)?;
        let rows = st
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(e)?;
        for row in rows {
            let (d, s) = row.map_err(e)?;
            by_day.insert(d, s);
        }
    }
    let t = today();
    let daily = (0..days)
        .rev()
        .map(|i| {
            let d = (t - Duration::days(i)).to_string();
            DayTotal { seconds: *by_day.get(&d).unwrap_or(&0), date: d }
        })
        .collect();

    // Streaks: consecutive days with at least one minute of focus.
    let mut studied: Vec<NaiveDate> = by_day
        .iter()
        .filter(|(_, s)| **s >= 60)
        .filter_map(|(d, _)| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
        .collect();
    studied.sort();
    let (mut best, mut run) = (0i64, 0i64);
    let mut prev: Option<NaiveDate> = None;
    for d in &studied {
        run = match prev {
            Some(p) if *d - p == Duration::days(1) => run + 1,
            _ => 1,
        };
        best = best.max(run);
        prev = Some(*d);
    }
    let streak = match studied.last() {
        Some(last) if *last == t || *last == t - Duration::days(1) => run,
        _ => 0,
    };

    let since = (t - Duration::days(days - 1)).to_string();
    let mut st = c
        .prepare(
            "SELECT s.name, s.color, SUM(x.focus_seconds) FROM sessions x
             JOIN topics t ON t.id=x.topic_id JOIN subjects s ON s.id=t.subject_id
             WHERE substr(x.started_at,1,10) >= ?1 GROUP BY s.id HAVING SUM(x.focus_seconds) > 0
             ORDER BY 3 DESC",
        )
        .map_err(e)?;
    let by_subject = st
        .query_map([since], |r| {
            Ok(SubjectTotal { name: r.get(0)?, color: r.get(1)?, seconds: r.get(2)? })
        })
        .map_err(e)?
        .collect::<std::result::Result<_, _>>()
        .map_err(e)?;
    let session_count = c
        .query_row("SELECT COUNT(*) FROM sessions WHERE ended_at IS NOT NULL", [], |r| r.get(0))
        .map_err(e)?;

    Ok(Stats {
        daily,
        by_subject,
        today_seconds: *by_day.get(&t.to_string()).unwrap_or(&0),
        total_seconds: by_day.values().sum(),
        session_count,
        streak,
        best_streak: best,
    })
}

// ---------- Settings ----------

pub fn get_setting(c: &Connection, key: &str) -> Result<Option<String>> {
    c.query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get(0))
        .optional()
        .map_err(e)
}

pub fn set_setting(c: &Connection, key: &str, value: &str) -> Result<()> {
    c.execute(
        "INSERT INTO settings (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=?2",
        params![key, value],
    )
    .map_err(e)?;
    Ok(())
}

pub fn all_settings(c: &Connection) -> Result<std::collections::HashMap<String, String>> {
    let mut st = c.prepare("SELECT key,value FROM settings").map_err(e)?;
    let rows = st
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(e)?;
    rows.collect::<std::result::Result<_, _>>().map_err(e)
}

// ---------- Break activities ----------

#[derive(Serialize, Deserialize, Clone)]
pub struct BreakActivity {
    pub id: String,
    pub emoji: String,
    pub name: String,
    pub instructions: String,
    pub sort: i64,
}

pub fn list_activities(c: &Connection) -> Result<Vec<BreakActivity>> {
    let mut st = c
        .prepare("SELECT id,emoji,name,instructions,sort FROM break_activities ORDER BY sort, name")
        .map_err(e)?;
    let rows = st
        .query_map([], |r| {
            Ok(BreakActivity { id: r.get(0)?, emoji: r.get(1)?, name: r.get(2)?, instructions: r.get(3)?, sort: r.get(4)? })
        })
        .map_err(e)?;
    rows.collect::<std::result::Result<_, _>>().map_err(e)
}

pub fn save_activity(c: &Connection, a: &BreakActivity) -> Result<BreakActivity> {
    let mut a = a.clone();
    if a.name.trim().is_empty() {
        return Err("La actividad necesita un nombre.".into());
    }
    if a.id.is_empty() {
        a.id = new_id();
        a.sort = c
            .query_row("SELECT COALESCE(MAX(sort),0)+1 FROM break_activities", [], |r| r.get(0))
            .map_err(e)?;
    }
    c.execute(
        "INSERT INTO break_activities (id,emoji,name,instructions,sort) VALUES (?1,?2,?3,?4,?5)
         ON CONFLICT(id) DO UPDATE SET emoji=?2,name=?3,instructions=?4,sort=?5",
        params![a.id, a.emoji, a.name, a.instructions, a.sort],
    )
    .map_err(e)?;
    Ok(a)
}

pub fn delete_activity(c: &Connection, id: &str) -> Result<()> {
    c.execute("DELETE FROM break_activities WHERE id=?1", [id]).map_err(e)?;
    Ok(())
}

// ---------- Planned studies ----------

#[derive(Serialize, Deserialize, Clone)]
pub struct PlannedStudy {
    pub id: String,
    pub topic_id: String,
    pub template_id: Option<String>,
    pub start_date: String,
    /// "HH:MM" local time.
    pub time: String,
    pub duration_min: i64,
    /// ISO weekdays ("1".."7", Monday = 1) separated by commas; empty = one-off.
    pub repeat_days: String,
    pub repeat_until: Option<String>,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Serialize, Clone)]
pub struct PlannedOccurrence {
    pub plan_id: String,
    pub topic_id: String,
    pub topic_name: String,
    pub subject_name: String,
    pub subject_color: String,
    pub template_id: Option<String>,
    pub date: String,
    pub time: String,
    pub duration_min: i64,
    pub repeats: bool,
    /// Date of this occurrence in the series (differs from `date` when it was moved).
    pub original_date: String,
    /// "pending" | "done" | "skipped"
    pub status: String,
}

pub fn save_planned(c: &Connection, p: &PlannedStudy) -> Result<PlannedStudy> {
    let mut p = p.clone();
    NaiveDate::parse_from_str(&p.start_date, "%Y-%m-%d").map_err(|_| "Fecha no válida".to_string())?;
    if chrono::NaiveTime::parse_from_str(&p.time, "%H:%M").is_err() {
        return Err("Hora no válida".into());
    }
    p.duration_min = p.duration_min.clamp(5, 720);
    let mut days: Vec<u32> = p
        .repeat_days
        .split(',')
        .filter_map(|d| d.trim().parse().ok())
        .filter(|d| (1..=7).contains(d))
        .collect();
    days.sort();
    days.dedup();
    p.repeat_days = days.iter().map(|d| d.to_string()).collect::<Vec<_>>().join(",");
    if p.repeat_days.is_empty() {
        p.repeat_until = None;
    }
    if p.id.is_empty() {
        p.id = new_id();
        p.created_at = now();
    }
    let prev_start: Option<String> = c
        .query_row("SELECT start_date FROM planned_studies WHERE id=?1", [&p.id], |r| r.get(0))
        .optional()
        .map_err(e)?;
    c.execute(
        "INSERT INTO planned_studies (id,topic_id,template_id,start_date,time,duration_min,repeat_days,repeat_until,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(id) DO UPDATE SET topic_id=?2,template_id=?3,start_date=?4,time=?5,duration_min=?6,repeat_days=?7,repeat_until=?8",
        params![p.id, p.topic_id, p.template_id, p.start_date, p.time, p.duration_min, p.repeat_days, p.repeat_until, p.created_at],
    )
    .map_err(e)?;
    // A one-off study keeps its done/skipped mark when its date changes.
    if let (true, Some(prev)) = (p.repeat_days.is_empty(), prev_start) {
        c.execute(
            "DELETE FROM planned_exceptions WHERE plan_id=?1 AND (date<>?2 OR kind IN ('moved','deleted'))",
            params![p.id, prev],
        )
        .map_err(e)?;
        c.execute(
            "UPDATE planned_exceptions SET date=?2, new_date=NULL, new_time=NULL WHERE plan_id=?1",
            params![p.id, p.start_date],
        )
        .map_err(e)?;
    }
    Ok(p)
}

pub fn get_planned(c: &Connection, id: &str) -> Result<PlannedStudy> {
    c.query_row(
        "SELECT id,topic_id,template_id,start_date,time,duration_min,repeat_days,repeat_until,created_at
         FROM planned_studies WHERE id=?1",
        [id],
        |r| {
            Ok(PlannedStudy {
                id: r.get(0)?,
                topic_id: r.get(1)?,
                template_id: r.get(2)?,
                start_date: r.get(3)?,
                time: r.get(4)?,
                duration_min: r.get(5)?,
                repeat_days: r.get(6)?,
                repeat_until: r.get(7)?,
                created_at: r.get(8)?,
            })
        },
    )
    .map_err(e)
}

pub fn delete_planned(c: &Connection, id: &str) -> Result<()> {
    c.execute("DELETE FROM planned_studies WHERE id=?1", [id]).map_err(e)?;
    Ok(())
}

/// Expands one-off and weekly plans into dated occurrences within [from, to].
pub fn planned_occurrences(c: &Connection, from: &str, to: &str) -> Result<Vec<PlannedOccurrence>> {
    let parse = |d: &str| NaiveDate::parse_from_str(d, "%Y-%m-%d").map_err(|_| format!("Fecha no válida: {d}"));
    let (from_d, to_d) = (parse(from)?, parse(to)?);
    let mut st = c
        .prepare(
            "SELECT p.id,p.topic_id,t.name,s.name,s.color,p.template_id,p.start_date,p.time,p.duration_min,p.repeat_days,p.repeat_until
             FROM planned_studies p JOIN topics t ON t.id=p.topic_id JOIN subjects s ON s.id=t.subject_id",
        )
        .map_err(e)?;
    let rows = st
        .query_map([], |r| {
            Ok((
                PlannedOccurrence {
                    plan_id: r.get(0)?,
                    topic_id: r.get(1)?,
                    topic_name: r.get(2)?,
                    subject_name: r.get(3)?,
                    subject_color: r.get(4)?,
                    template_id: r.get(5)?,
                    date: r.get(6)?,
                    time: r.get(7)?,
                    duration_min: r.get(8)?,
                    repeats: false,
                    original_date: String::new(),
                    status: "pending".into(),
                },
                r.get::<_, String>(9)?,
                r.get::<_, Option<String>>(10)?,
            ))
        })
        .map_err(e)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(e)?;
    // Exceptions of single days: deleted, skipped, done, or moved to another date/time.
    let mut exc: std::collections::HashMap<(String, String), (String, Option<String>, Option<String>)> =
        std::collections::HashMap::new();
    {
        let mut st = c
            .prepare("SELECT plan_id,date,kind,new_date,new_time FROM planned_exceptions")
            .map_err(e)?;
        let rows = st
            .query_map([], |r| Ok(((r.get(0)?, r.get(1)?), (r.get(2)?, r.get(3)?, r.get(4)?))))
            .map_err(e)?;
        for row in rows {
            let (k, v) = row.map_err(e)?;
            exc.insert(k, v);
        }
    }
    // A moved occurrence may come from outside [from, to]: expand a wider window, filter at the end.
    let (wide_from, wide_to) = (from_d - Duration::days(366), to_d + Duration::days(366));
    let mut out = Vec::new();
    let mut push = |mut occ: PlannedOccurrence| {
        occ.original_date = occ.date.clone();
        match exc.get(&(occ.plan_id.clone(), occ.date.clone())) {
            Some((kind, _, _)) if kind == "deleted" => return,
            // done/skipped may keep the new date/time of a day that had been moved first.
            Some((kind, new_date, new_time)) => {
                if kind != "moved" {
                    occ.status = kind.clone();
                }
                if let Some(d) = new_date {
                    occ.date = d.clone();
                }
                if let Some(t) = new_time {
                    occ.time = t.clone();
                }
            }
            _ => {}
        }
        if occ.date.as_str() >= from && occ.date.as_str() <= to {
            out.push(occ);
        }
    };
    for (base, days, until) in rows {
        let Ok(start) = NaiveDate::parse_from_str(&base.date, "%Y-%m-%d") else { continue };
        let weekdays: Vec<u32> = days.split(',').filter_map(|d| d.parse().ok()).collect();
        if weekdays.is_empty() {
            push(base);
            continue;
        }
        let end = until
            .as_deref()
            .and_then(|u| NaiveDate::parse_from_str(u, "%Y-%m-%d").ok())
            .map_or(wide_to, |u| u.min(wide_to));
        let mut d = start.max(wide_from);
        while d <= end {
            if weekdays.contains(&d.weekday().number_from_monday()) {
                push(PlannedOccurrence { date: d.to_string(), repeats: true, ..base.clone() });
            }
            d += Duration::days(1);
        }
    }
    out.sort_by(|a, b| (&a.date, &a.time).cmp(&(&b.date, &b.time)));
    Ok(out)
}

/// Marks one occurrence (by its series date): "deleted", "skipped", "done" or "moved"
/// (with `new_date`/`new_time`). `kind` = "" removes the exception.
pub fn set_plan_exception(
    c: &Connection,
    plan_id: &str,
    date: &str,
    kind: &str,
    new_date: Option<&str>,
    new_time: Option<&str>,
) -> Result<()> {
    if kind.is_empty() {
        c.execute("DELETE FROM planned_exceptions WHERE plan_id=?1 AND date=?2", params![plan_id, date])
            .map_err(e)?;
        return Ok(());
    }
    if !["deleted", "skipped", "done", "moved"].contains(&kind) {
        return Err(format!("Tipo no válido: {kind}"));
    }
    c.execute(
        "INSERT INTO planned_exceptions (plan_id,date,kind,new_date,new_time) VALUES (?1,?2,?3,?4,?5)
         ON CONFLICT(plan_id,date) DO UPDATE SET kind=?3,new_date=?4,new_time=?5",
        params![plan_id, date, kind, new_date, new_time],
    )
    .map_err(e)?;
    Ok(())
}

/// Moves a whole plan (one-off or weekly series) by `days`, keeping its weekdays pattern.
pub fn shift_planned(c: &Connection, id: &str, days: i64) -> Result<PlannedStudy> {
    let mut p = get_planned(c, id)?;
    let shift = |d: &str| -> Result<String> {
        let date = NaiveDate::parse_from_str(d, "%Y-%m-%d").map_err(|_| "Fecha no válida".to_string())?;
        Ok((date + Duration::days(days)).to_string())
    };
    p.start_date = shift(&p.start_date)?;
    p.repeat_until = p.repeat_until.as_deref().map(shift).transpose()?;
    p.repeat_days = p
        .repeat_days
        .split(',')
        .filter_map(|d| d.parse::<i64>().ok())
        .map(|d| ((d - 1 + days).rem_euclid(7) + 1).to_string())
        .collect::<Vec<_>>()
        .join(",");
    let p = save_planned(c, &p)?;
    if p.repeat_days.is_empty() {
        return Ok(p); // save_planned already moved the one-off's mark
    }
    c.execute(
        "UPDATE planned_exceptions SET date=date(date, ?2 || ' days'),
           new_date=CASE WHEN new_date IS NULL THEN NULL ELSE date(new_date, ?2 || ' days') END
         WHERE plan_id=?1",
        params![id, format!("{days:+}")],
    )
    .map_err(e)?;
    Ok(p)
}

// ---------- Exams ----------

#[derive(Serialize)]
pub struct Exam {
    pub topic_id: String,
    pub topic_name: String,
    pub subject_name: String,
    pub subject_color: String,
    pub exam_date: String,
}

pub fn upcoming_exams(c: &Connection) -> Result<Vec<Exam>> {
    let mut st = c
        .prepare(
            "SELECT t.id,t.name,s.name,s.color,t.exam_date FROM topics t JOIN subjects s ON s.id=t.subject_id
             WHERE t.exam_date >= ?1 ORDER BY t.exam_date",
        )
        .map_err(e)?;
    let rows = st
        .query_map([today().to_string()], |r| {
            Ok(Exam {
                topic_id: r.get(0)?,
                topic_name: r.get(1)?,
                subject_name: r.get(2)?,
                subject_color: r.get(3)?,
                exam_date: r.get(4)?,
            })
        })
        .map_err(e)?;
    rows.collect::<std::result::Result<_, _>>().map_err(e)
}

// ---------- Quick notes (notes taken during a session) ----------

#[derive(Serialize)]
pub struct QuickNoteHit {
    #[serde(flatten)]
    pub session: Session,
    pub topic_name: String,
    pub subject_name: String,
    pub subject_color: String,
}

pub fn list_quick_notes(c: &Connection, topic_id: &str) -> Result<Vec<Session>> {
    Ok(list_sessions(c, topic_id)?
        .into_iter()
        .filter(|s| !s.notes_md.trim().is_empty())
        .collect())
}

pub fn search_quick_notes(c: &Connection, q: &str) -> Result<Vec<QuickNoteHit>> {
    let like = format!("%{}%", q.replace('%', "\\%").replace('_', "\\_"));
    let cols = SESSION_COLS
        .split(',')
        .map(|col| format!("x.{col}"))
        .collect::<Vec<_>>()
        .join(",");
    let mut st = c
        .prepare(&format!(
            "SELECT {cols},t.name,s.name,s.color FROM sessions x
             JOIN topics t ON t.id=x.topic_id JOIN subjects s ON s.id=t.subject_id
             WHERE x.notes_md LIKE ?1 ESCAPE '\\' ORDER BY x.started_at DESC LIMIT 50"
        ))
        .map_err(e)?;
    let rows = st
        .query_map([like], |r| {
            Ok(QuickNoteHit {
                session: row_session(r)?,
                topic_name: r.get(12)?,
                subject_name: r.get(13)?,
                subject_color: r.get(14)?,
            })
        })
        .map_err(e)?;
    rows.collect::<std::result::Result<_, _>>().map_err(e)
}

/// Copies a session's quick notes into a new note (`target` = None) or appends them, under
/// `heading`, to an existing note. The quick note is kept and marked as moved.
pub fn move_quick_note(c: &Connection, session_id: &str, target: Option<&str>, title: &str, heading: &str) -> Result<Note> {
    let (topic_id, body): (String, String) = c
        .query_row("SELECT topic_id, notes_md FROM sessions WHERE id=?1", [session_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(e)?;
    let note = match target {
        Some(id) => {
            let mut n = c
                .query_row(
                    "SELECT id,topic_id,title,body_md,layout,updated_at FROM notes WHERE id=?1",
                    [id],
                    row_note,
                )
                .map_err(e)?;
            let sep = if n.body_md.trim().is_empty() { "" } else { "\n\n" };
            n.body_md = format!("{}{sep}## {heading}\n\n{}\n", n.body_md.trim_end(), body.trim());
            save_note(c, &n)?
        }
        None => save_note(
            c,
            &Note {
                id: String::new(),
                topic_id,
                title: title.to_string(),
                body_md: format!("{}\n", body.trim()),
                layout: "libre".into(),
                updated_at: String::new(),
            },
        )?,
    };
    c.execute("UPDATE sessions SET notes_moved=1 WHERE id=?1", [session_id])
        .map_err(e)?;
    Ok(note)
}

// ---------- Personal dictionary ----------

pub fn dictionary_words(c: &Connection) -> Result<Vec<String>> {
    let mut st = c.prepare("SELECT word FROM user_dictionary ORDER BY word").map_err(e)?;
    let rows = st.query_map([], |r| r.get(0)).map_err(e)?;
    rows.collect::<std::result::Result<_, _>>().map_err(e)
}

pub fn add_dictionary_word(c: &Connection, word: &str) -> Result<()> {
    c.execute("INSERT OR IGNORE INTO user_dictionary (word) VALUES (?1)", [word])
        .map_err(e)?;
    Ok(())
}

pub fn remove_dictionary_word(c: &Connection, word: &str) -> Result<()> {
    c.execute("DELETE FROM user_dictionary WHERE word=?1", [word]).map_err(e)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempdir::Dir, Connection, Topic) {
        let dir = tempdir::Dir::new();
        let c = open(&dir.0).unwrap();
        let s = save_subject(
            &c,
            &Subject {
                id: String::new(),
                name: "Matemáticas".into(),
                color: "#000".into(),
                icon: "🧮".into(),
                archived: false,
                created_at: String::new(),
            },
        )
        .unwrap();
        let t = save_topic(
            &c,
            &Topic {
                id: String::new(),
                subject_id: s.id,
                name: "Derivadas".into(),
                template_id: Some("leitner".into()),
                status: "nuevo".into(),
                stage: None,
                exam_date: None,
                created_at: String::new(),
                session_count: 0,
                focus_seconds: 0,
            },
        )
        .unwrap();
        (dir, c, t)
    }

    mod tempdir {
        pub struct Dir(pub std::path::PathBuf);
        impl Dir {
            pub fn new() -> Self {
                let p = std::env::temp_dir().join(format!("kaizen-test-{}", super::new_id()));
                std::fs::create_dir_all(&p).unwrap();
                Dir(p)
            }
        }
        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    fn pending(c: &Connection, topic: &str) -> Vec<(String, i64, String)> {
        let mut st = c
            .prepare("SELECT due_date, step, id FROM reviews WHERE topic_id=?1 AND done_at IS NULL ORDER BY due_date")
            .unwrap();
        st.query_map([topic], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    }

    #[test]
    fn spaced_session_schedules_first_review_tomorrow_once() {
        let (_d, c, t) = setup();
        for _ in 0..2 {
            let id = create_session(&c, &t.id, Some("leitner"), "{}", 25).unwrap();
            update_session_totals(&c, &id, 1500, 300).unwrap();
            finish_session(&c, &id, Some(4), true).unwrap();
        }
        let p = pending(&c, &t.id);
        assert_eq!(p.len(), 1, "a second session must not duplicate reviews");
        assert_eq!(p[0].0, (today() + Duration::days(1)).to_string());
        assert_eq!(get_topic(&c, &t.id).unwrap().status, "aprendiendo");
    }

    #[test]
    fn leitner_ladder() {
        let (_d, c, t) = setup();
        let id = create_session(&c, &t.id, None, "{}", 25).unwrap();
        finish_session(&c, &id, None, true).unwrap();

        let r = pending(&c, &t.id)[0].2.clone();
        complete_review(&c, &r, "bien").unwrap(); // step 0 -> 1 (3 days)
        let p = pending(&c, &t.id);
        assert_eq!((p[0].1, p[0].0.clone()), (1, (today() + Duration::days(3)).to_string()));

        complete_review(&c, &p[0].2, "facil").unwrap(); // 1 -> 3 (14 days)
        let p = pending(&c, &t.id);
        assert_eq!(p[0].1, 3);
        assert_eq!(get_topic(&c, &t.id).unwrap().status, "repasando");

        complete_review(&c, &p[0].2, "dificil").unwrap(); // reset
        assert_eq!(pending(&c, &t.id)[0].1, 0);

        let p = pending(&c, &t.id);
        complete_review(&c, &p[0].2, "facil").unwrap(); // 0 -> 2
        let p = pending(&c, &t.id);
        complete_review(&c, &p[0].2, "facil").unwrap(); // 2 -> 4 (last)
        let p = pending(&c, &t.id);
        complete_review(&c, &p[0].2, "facil").unwrap(); // beyond last => mastered
        assert_eq!(get_topic(&c, &t.id).unwrap().status, "dominado");
    }

    #[test]
    fn exam_date_schedules_7321_and_reschedules() {
        let (_d, c, mut t) = setup();
        t.exam_date = Some((today() + Duration::days(10)).to_string());
        t = save_topic(&c, &t).unwrap();
        let days: Vec<String> = pending(&c, &t.id).into_iter().map(|p| p.0).collect();
        let expect: Vec<String> = [3, 7, 8, 9]
            .iter()
            .map(|d| (today() + Duration::days(*d)).to_string())
            .collect();
        assert_eq!(days, expect);

        // Exam in 2 days: only the -1 day review is still in the future (and -2 is today).
        t.exam_date = Some((today() + Duration::days(2)).to_string());
        save_topic(&c, &t).unwrap();
        assert_eq!(pending(&c, &t.id).len(), 2);

        t.exam_date = None;
        save_topic(&c, &t).unwrap();
        assert!(pending(&c, &t.id).is_empty());
    }

    #[test]
    fn stats_totals_and_streak() {
        let (_d, c, t) = setup();
        for days_ago in [0, 1, 2, 5] {
            let id = create_session(&c, &t.id, None, "{}", 25).unwrap();
            let started = (Local::now() - Duration::days(days_ago)).to_rfc3339();
            c.execute(
                "UPDATE sessions SET started_at=?2, focus_seconds=600, ended_at=?2 WHERE id=?1",
                params![id, started],
            )
            .unwrap();
        }
        let s = stats(&c, 7).unwrap();
        assert_eq!(s.today_seconds, 600);
        assert_eq!(s.total_seconds, 2400);
        assert_eq!(s.streak, 3);
        assert_eq!(s.best_streak, 3);
        assert_eq!(s.daily.len(), 7);
        assert_eq!(s.by_subject[0].seconds, 2400);
    }

    #[test]
    fn search_escapes_wildcards() {
        let (_d, c, t) = setup();
        save_note(&c, &Note { id: String::new(), topic_id: t.id.clone(), title: "100% seguro".into(), body_md: "regla de la cadena".into(), layout: "libre".into(), updated_at: String::new() }).unwrap();
        save_note(&c, &Note { id: String::new(), topic_id: t.id.clone(), title: "otra".into(), body_md: "nada".into(), layout: "libre".into(), updated_at: String::new() }).unwrap();
        assert_eq!(search_notes(&c, "%").unwrap().len(), 1);
        assert_eq!(search_notes(&c, "cadena").unwrap()[0].topic_name, "Derivadas");
    }


    #[test]
    fn planned_studies_expand_weekly_and_one_off() {
        let (_d, c, t) = setup();
        // A Monday, repeating Monday and Wednesday for two weeks.
        let monday = NaiveDate::from_ymd_opt(2030, 1, 7).unwrap();
        let weekly = save_planned(&c, &PlannedStudy {
            id: String::new(), topic_id: t.id.clone(), template_id: Some("pomodoro".into()),
            start_date: monday.to_string(), time: "18:00".into(), duration_min: 60,
            repeat_days: "3,1,9".into(), repeat_until: Some((monday + Duration::days(13)).to_string()),
            created_at: String::new(),
        }).unwrap();
        assert_eq!(weekly.repeat_days, "1,3", "invalid days dropped and sorted");
        save_planned(&c, &PlannedStudy {
            id: String::new(), topic_id: t.id.clone(), template_id: None,
            start_date: (monday + Duration::days(4)).to_string(), time: "09:30".into(), duration_min: 2,
            repeat_days: String::new(), repeat_until: None, created_at: String::new(),
        }).unwrap();
        let occ = planned_occurrences(&c, &monday.to_string(), &(monday + Duration::days(30)).to_string()).unwrap();
        let dates: Vec<String> = occ.iter().map(|o| format!("{} {}", o.date, o.time)).collect();
        assert_eq!(dates, [
            "2030-01-07 18:00", "2030-01-09 18:00", "2030-01-11 09:30", "2030-01-14 18:00", "2030-01-16 18:00",
        ]);
        assert_eq!(occ[2].duration_min, 5, "duration clamped to the minimum");
        assert!(save_planned(&c, &PlannedStudy { time: "25:00".into(), ..weekly.clone() }).is_err());
    }

    #[test]
    fn planned_exceptions_and_series_shift() {
        let (_d, c, t) = setup();
        let monday = NaiveDate::from_ymd_opt(2030, 1, 7).unwrap();
        let p = save_planned(&c, &PlannedStudy {
            id: String::new(), topic_id: t.id.clone(), template_id: None, start_date: monday.to_string(),
            time: "18:00".into(), duration_min: 60, repeat_days: "1,3".into(), repeat_until: None, created_at: String::new(),
        }).unwrap();
        let range = |c: &Connection| planned_occurrences(c, "2030-01-07", "2030-01-20").unwrap();
        assert_eq!(range(&c).len(), 4);
        set_plan_exception(&c, &p.id, "2030-01-07", "done", None, None).unwrap();
        set_plan_exception(&c, &p.id, "2030-01-09", "deleted", None, None).unwrap();
        set_plan_exception(&c, &p.id, "2030-01-14", "moved", Some("2030-01-15"), Some("09:00")).unwrap();
        set_plan_exception(&c, &p.id, "2030-01-16", "skipped", None, None).unwrap();
        let occ = range(&c);
        let view: Vec<_> = occ.iter().map(|o| format!("{} {} {} {}", o.date, o.time, o.status, o.original_date)).collect();
        assert_eq!(view, [
            "2030-01-07 18:00 done 2030-01-07",
            "2030-01-15 09:00 pending 2030-01-14",
            "2030-01-16 18:00 skipped 2030-01-16",
        ]);
        // Moved out of the range into it: appears in the range where it landed.
        set_plan_exception(&c, &p.id, "2030-01-23", "moved", Some("2030-01-20"), None).unwrap();
        assert_eq!(range(&c).len(), 4);
        set_plan_exception(&c, &p.id, "2030-01-07", "", None, None).unwrap();
        assert_eq!(range(&c)[0].status, "pending");
        // Whole series one day later: Tuesdays and Thursdays.
        let shifted = shift_planned(&c, &p.id, 1).unwrap();
        assert_eq!((shifted.start_date.as_str(), shifted.repeat_days.as_str()), ("2030-01-08", "2,4"));
        let after = range(&c);
        assert!(after.iter().any(|o| o.date == "2030-01-16" && o.status == "pending" && o.original_date == "2030-01-15"));
        // Sunday + 1 = Monday (wraps around).
        let p2 = save_planned(&c, &PlannedStudy { id: String::new(), repeat_days: "7".into(), ..p.clone() }).unwrap();
        assert_eq!(shift_planned(&c, &p2.id, 1).unwrap().repeat_days, "1");
        // One-off: the done mark follows the date (edited or dragged).
        let once = save_planned(&c, &PlannedStudy { id: String::new(), repeat_days: String::new(), ..p.clone() }).unwrap();
        set_plan_exception(&c, &once.id, &once.start_date, "done", None, None).unwrap();
        let once = save_planned(&c, &PlannedStudy { start_date: "2030-01-10".into(), ..once }).unwrap();
        shift_planned(&c, &once.id, 2).unwrap();
        let o = planned_occurrences(&c, "2030-01-12", "2030-01-12").unwrap();
        assert!(o.iter().any(|x| x.plan_id == once.id && x.status == "done"), "one-off lost its mark");
    }

    #[test]
    fn quick_notes_move_to_new_or_existing_note() {
        let (_d, c, t) = setup();
        let s1 = create_session(&c, &t.id, None, "{}", 25).unwrap();
        update_session_notes(&c, &s1, "idea **uno**").unwrap();
        let s2 = create_session(&c, &t.id, None, "{}", 25).unwrap();
        update_session_notes(&c, &s2, "idea dos").unwrap();
        create_session(&c, &t.id, None, "{}", 25).unwrap(); // no notes: not listed
        assert_eq!(list_quick_notes(&c, &t.id).unwrap().len(), 2);

        let note = move_quick_note(&c, &s1, None, "Sesión 1", "").unwrap();
        assert_eq!(note.body_md, "idea **uno**\n");
        let merged = move_quick_note(&c, &s2, Some(&note.id), "", "Sesión 2").unwrap();
        assert_eq!(merged.body_md, "idea **uno**\n\n## Sesión 2\n\nidea dos\n");
        assert!(list_quick_notes(&c, &t.id).unwrap().iter().all(|s| s.notes_moved), "kept and marked");
        assert_eq!(search_quick_notes(&c, "dos").unwrap()[0].topic_name, "Derivadas");
    }

    #[test]
    fn break_activities_seeded_and_editable() {
        let (_d, c, _t) = setup();
        let list = list_activities(&c).unwrap();
        assert_eq!(list.len(), 6);
        assert_eq!(list[0].id, "cafe");
        let mine = save_activity(&c, &BreakActivity { id: String::new(), emoji: "🎸".into(), name: "Guitarra".into(), instructions: String::new(), sort: 0 }).unwrap();
        assert_eq!(mine.sort, 7);
        delete_activity(&c, "cafe").unwrap();
        assert_eq!(list_activities(&c).unwrap().len(), 6);
        assert!(save_activity(&c, &BreakActivity { name: " ".into(), ..mine }).is_err());
    }

    #[test]
    fn backup_round_trip() {
        let (d, c, t) = setup();
        let file = d.0.join("x.kaizen");
        std::fs::create_dir_all(d.0.join("adjuntos")).unwrap();
        std::fs::write(d.0.join("adjuntos").join("foto.png"), b"PNG").unwrap();
        crate::storage::export_backup(&c, &d.0, &file).unwrap();
        delete_topic(&c, &t.id).unwrap();
        drop(c);
        let target = tempdir::Dir::new();
        crate::storage::import_backup(&file, &target.0).unwrap();
        let c2 = open(&target.0).unwrap();
        assert_eq!(get_topic(&c2, &t.id).unwrap().name, "Derivadas");
        assert_eq!(std::fs::read(target.0.join("adjuntos").join("foto.png")).unwrap(), b"PNG");
    }
}
