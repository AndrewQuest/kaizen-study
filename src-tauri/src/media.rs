//! Attachments: images and videos copied into `<data>\adjuntos`.

use crate::state::AppState;
use crate::storage::ATTACH_DIR;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
pub const VIDEO_EXT: &[&str] = &["mp4", "webm"];

type Result<T> = std::result::Result<T, String>;

pub fn attach_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .state::<AppState>()
        .data_dir
        .lock()
        .unwrap()
        .clone()
        .ok_or("Sin carpeta de datos")?
        .join(ATTACH_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn extension(name: &str) -> Result<String> {
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();
    if IMAGE_EXT.contains(&ext.as_str()) || VIDEO_EXT.contains(&ext.as_str()) {
        Ok(ext)
    } else {
        Err(format!(
            "Formato no admitido: .{ext}. Imágenes: {}. Videos: {}.",
            IMAGE_EXT.join(", "),
            VIDEO_EXT.join(", ")
        ))
    }
}

/// Safe, unique file name inside `dir` derived from `original` ("Foto 1.PNG" → "Foto-1.png", "Foto-1-2.png"…).
pub fn unique_name(dir: &Path, original: &str) -> Result<String> {
    let ext = extension(original)?;
    let stem: String = Path::new(original)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("archivo")
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(60)
        .collect();
    let stem = if stem.is_empty() { "archivo".to_string() } else { stem };
    let mut name = format!("{stem}.{ext}");
    let mut n = 1;
    while dir.join(&name).exists() {
        n += 1;
        name = format!("{stem}-{n}.{ext}");
    }
    Ok(name)
}

pub fn save_bytes(app: &AppHandle, original: &str, bytes: &[u8]) -> Result<String> {
    let dir = attach_dir(app)?;
    let name = unique_name(&dir, original)?;
    std::fs::write(dir.join(&name), bytes).map_err(|e| e.to_string())?;
    Ok(name)
}

pub fn import_file(app: &AppHandle, path: &Path) -> Result<String> {
    let dir = attach_dir(app)?;
    let original = path.file_name().and_then(|n| n.to_str()).ok_or("Nombre de archivo no válido")?;
    let name = unique_name(&dir, original)?;
    std::fs::copy(path, dir.join(&name)).map_err(|e| e.to_string())?;
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unique_safe_names() {
        let dir = std::env::temp_dir().join(format!("kaizen-media-{}", crate::db::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(unique_name(&dir, "Mi Foto (1).PNG").unwrap(), "Mi-Foto--1.png");
        std::fs::write(dir.join("Mi-Foto--1.png"), b"x").unwrap();
        assert_eq!(unique_name(&dir, "Mi Foto (1).PNG").unwrap(), "Mi-Foto--1-2.png");
        assert!(unique_name(&dir, "virus.exe").is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
