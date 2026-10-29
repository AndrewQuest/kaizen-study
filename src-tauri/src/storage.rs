//! Data-folder configuration and backups (.kaizen = zip with kaizen.db + manifest.json).

use crate::db::{self, Result};
use chrono::{Duration, Local, NaiveDateTime};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const BACKUP_DIR: &str = "backups";
const AUTO_BACKUPS_KEPT: usize = 5;

#[derive(Serialize, Deserialize, Default)]
pub struct Config {
    pub data_dir: Option<PathBuf>,
}

/// `%APPDATA%\KaizenStudy\config.json` — the only file kept outside the data folder.
/// `KAIZEN_CONFIG_DIR` overrides the folder (used by the end-to-end tests).
pub fn config_path() -> PathBuf {
    if let Some(dir) = std::env::var_os("KAIZEN_CONFIG_DIR") {
        return PathBuf::from(dir).join("config.json");
    }
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("KaizenStudy").join("config.json")
}

pub fn load_config() -> Config {
    std::fs::read_to_string(config_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_config(cfg: &Config) -> Result<()> {
    let path = config_path();
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(path, serde_json::to_string_pretty(cfg).unwrap()).map_err(|e| e.to_string())
}

/// Consistent snapshot of the live database into `dest` (works with WAL).
fn snapshot(conn: &Connection, dest: &Path) -> Result<()> {
    let _ = std::fs::remove_file(dest);
    conn.execute("VACUUM INTO ?1", [dest.to_string_lossy()])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Copies the current database and attachments into a new folder (used by "move data").
pub fn copy_data_to(conn: &Connection, from: &Path, dir: &Path) -> Result<()> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let dest = dir.join(db::DB_FILE);
    if dest.exists() {
        return Err("La carpeta de destino ya contiene datos de Kaizen Study.".into());
    }
    snapshot(conn, &dest)?;
    let src = from.join(ATTACH_DIR);
    if src.is_dir() {
        let out = dir.join(ATTACH_DIR);
        std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
        for entry in std::fs::read_dir(&src).map_err(|e| e.to_string())?.flatten() {
            if entry.path().is_file() {
                std::fs::copy(entry.path(), out.join(entry.file_name())).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// Folder (inside the data folder) where pasted/dropped images and videos are copied.
pub const ATTACH_DIR: &str = "adjuntos";

/// Heavy optional tools (Whisper models, LaTeX compiler): `%LOCALAPPDATA%\KaizenStudy`,
/// outside the data folder so they don't fill OneDrive or the backups.
/// `KAIZEN_TOOLS_DIR` overrides it (tests).
pub fn tools_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("KAIZEN_TOOLS_DIR") {
        return PathBuf::from(dir);
    }
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("KaizenStudy")
}

/// A backup contains the database and every attachment (`adjuntos/<file>`).
pub fn export_backup(conn: &Connection, data_dir: &Path, dest: &Path) -> Result<()> {
    let tmp = std::env::temp_dir().join(format!("kaizen-{}.db", db::new_id()));
    snapshot(conn, &tmp)?;
    let result = (|| -> std::io::Result<()> {
        let mut zip = zip::ZipWriter::new(File::create(dest)?);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("manifest.json", opts)?;
        zip.write_all(
            serde_json::json!({
                "app": "Kaizen Study",
                "format": 1,
                "app_version": env!("CARGO_PKG_VERSION"),
                "created_at": db::now(),
            })
            .to_string()
            .as_bytes(),
        )?;
        zip.start_file(db::DB_FILE, opts)?;
        let mut buf = Vec::new();
        File::open(&tmp)?.read_to_end(&mut buf)?;
        zip.write_all(&buf)?;
        let attach = data_dir.join(ATTACH_DIR);
        if attach.is_dir() {
            // Media is already compressed: store it as is.
            let stored = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored)
                .large_file(true);
            for entry in std::fs::read_dir(&attach)?.flatten() {
                if entry.path().is_file() {
                    zip.start_file(format!("{ATTACH_DIR}/{}", entry.file_name().to_string_lossy()), stored)?;
                    std::io::copy(&mut File::open(entry.path())?, &mut zip)?;
                }
            }
        }
        zip.finish()?;
        Ok(())
    })();
    let _ = std::fs::remove_file(&tmp);
    result.map_err(|e| e.to_string())
}

/// Validates a backup and extracts its database into `data_dir`, replacing the current one.
/// The caller must have closed the live connection first.
pub fn import_backup(src: &Path, data_dir: &Path) -> Result<()> {
    let err = |e: &dyn std::fmt::Display| format!("Respaldo no válido: {e}");
    let mut zip = zip::ZipArchive::new(File::open(src).map_err(|e| err(&e))?).map_err(|e| err(&e))?;
    {
        let mut manifest = String::new();
        zip.by_name("manifest.json")
            .map_err(|e| err(&e))?
            .read_to_string(&mut manifest)
            .map_err(|e| err(&e))?;
        let m: serde_json::Value = serde_json::from_str(&manifest).map_err(|e| err(&e))?;
        if m["app"] != "Kaizen Study" {
            return Err("El archivo no es un respaldo de Kaizen Study.".into());
        }
    }
    let mut buf = Vec::new();
    zip.by_name(db::DB_FILE)
        .map_err(|e| err(&e))?
        .read_to_end(&mut buf)
        .map_err(|e| err(&e))?;
    let target = data_dir.join(db::DB_FILE);
    for ext in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(data_dir.join(format!("{}{ext}", db::DB_FILE)));
    }
    std::fs::write(target, buf).map_err(|e| e.to_string())?;

    // Restore attachments (existing files with the same name are replaced).
    let attach = data_dir.join(ATTACH_DIR);
    for i in 0..zip.len() {
        let mut file = zip.by_index(i).map_err(|e| err(&e))?;
        let full = file.name().map_err(|e| err(&e))?.to_string();
        let Some(name) = full.strip_prefix(&format!("{ATTACH_DIR}/")).map(str::to_string) else {
            continue;
        };
        // Only plain file names: never write outside the attachments folder.
        if name.is_empty() || name.contains(['/', '\\']) || name.contains("..") {
            continue;
        }
        std::fs::create_dir_all(&attach).map_err(|e| e.to_string())?;
        let mut out = File::create(attach.join(name)).map_err(|e| e.to_string())?;
        std::io::copy(&mut file, &mut out).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Weekly automatic backup into `<data>\backups`, keeping the newest five.
pub fn auto_backup(conn: &Connection, data_dir: &Path) -> Result<()> {
    let last = db::get_setting(conn, "last_auto_backup")?
        .and_then(|s| NaiveDateTime::parse_from_str(&s, "%Y-%m-%dT%H:%M:%S").ok());
    let now = Local::now().naive_local();
    if matches!(last, Some(l) if now - l < Duration::days(7)) {
        return Ok(());
    }
    let dir = data_dir.join(BACKUP_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    export_backup(conn, data_dir, &dir.join(format!("auto-{}.kaizen", now.format("%Y%m%d-%H%M"))))?;
    db::set_setting(conn, "last_auto_backup", &now.format("%Y-%m-%dT%H:%M:%S").to_string())?;

    let mut autos: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|d| d.ok().map(|d| d.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("auto-") && n.ends_with(".kaizen"))
        })
        .collect();
    autos.sort();
    while autos.len() > AUTO_BACKUPS_KEPT {
        let _ = std::fs::remove_file(autos.remove(0));
    }
    Ok(())
}
