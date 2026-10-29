//! Full LaTeX documents compiled to PDF with Tectonic (optional download, ~30 MB).
//! Tectonic fetches the LaTeX packages it needs from the internet the first time.

use crate::storage::tools_dir;
use serde::Serialize;
use std::io::Read;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

type Result<T> = std::result::Result<T, String>;

static COMPILING: Mutex<()> = Mutex::new(());

pub fn exe() -> PathBuf {
    tools_dir().join("tectonic").join("tectonic.exe")
}

pub fn output_root() -> PathBuf {
    tools_dir().join("latex")
}

#[derive(Serialize, Clone)]
pub struct Progress {
    pub tool: &'static str,
    pub done: u64,
    pub total: u64,
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(std::time::Duration::from_secs(20)))
        .build()
        .into()
}

/// Streams `url` into `dest`, emitting `tools://progress` events.
pub fn download(app: &AppHandle, tool: &'static str, url: &str, dest: &PathBuf) -> Result<()> {
    let mut res = agent()
        .get(url)
        .header("User-Agent", "KaizenStudy")
        .call()
        .map_err(|e| format!("Descarga fallida: {e}"))?;
    let total: u64 = res
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let part = dest.with_extension("part");
    std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
    let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut reader = res.body_mut().with_config().limit(u64::MAX).reader();
    let mut buf = vec![0u8; 256 * 1024];
    let (mut done, mut last) = (0u64, 0u64);
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("Descarga interrumpida: {e}"))?;
        if n == 0 {
            break;
        }
        std::io::Write::write_all(&mut file, &buf[..n]).map_err(|e| e.to_string())?;
        done += n as u64;
        if done - last > 1024 * 1024 || done == total {
            last = done;
            let _ = app.emit("tools://progress", Progress { tool, done, total });
        }
    }
    drop(file);
    if total > 0 && done != total {
        let _ = std::fs::remove_file(&part);
        return Err("Descarga incompleta, inténtalo de nuevo.".into());
    }
    std::fs::rename(&part, dest).map_err(|e| e.to_string())
}

/// Downloads the latest Windows build of Tectonic from its official GitHub releases.
pub fn install(app: &AppHandle) -> Result<()> {
    let release: serde_json::Value = agent()
        .get("https://api.github.com/repos/tectonic-typesetting/tectonic/releases/latest")
        .header("User-Agent", "KaizenStudy")
        .call()
        .map_err(|e| format!("No se pudo consultar GitHub: {e}"))?
        .body_mut()
        .read_json()
        .map_err(|e| e.to_string())?;
    let url = release["assets"]
        .as_array()
        .and_then(|assets| {
            assets.iter().find_map(|a| {
                let name = a["name"].as_str()?;
                (name.contains("x86_64-pc-windows-msvc") && name.ends_with(".zip"))
                    .then(|| a["browser_download_url"].as_str().map(str::to_string))?
            })
        })
        .ok_or("No se encontró Tectonic para Windows en la última versión.")?;
    let zip_path = tools_dir().join("tectonic").join("tectonic.zip");
    download(app, "tectonic", &url, &zip_path)?;
    let result = (|| -> Result<()> {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(&zip_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        let mut entry = zip.by_name("tectonic.exe").map_err(|e| e.to_string())?;
        let mut out = std::fs::File::create(exe()).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        Ok(())
    })();
    let _ = std::fs::remove_file(&zip_path);
    result
}

pub fn uninstall() -> Result<()> {
    let dir = tools_dir().join("tectonic");
    if dir.exists() {
        std::fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Serialize)]
pub struct CompileResult {
    /// Absolute path of the PDF when compilation succeeded.
    pub pdf: Option<String>,
    pub log: String,
}

/// Compiles `source` for note `note_id` into `<tools>\latex\<note_id>\main.pdf`.
pub fn compile(note_id: &str, source: &str) -> Result<CompileResult> {
    if !exe().exists() {
        return Err("El compilador LaTeX no está instalado.".into());
    }
    if note_id.is_empty() || !note_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Nota no válida".into());
    }
    let _guard = COMPILING.lock().unwrap();
    let dir = output_root().join(note_id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("main.tex"), source).map_err(|e| e.to_string())?;
    let pdf = dir.join("main.pdf");
    let _ = std::fs::remove_file(&pdf);

    let mut cmd = std::process::Command::new(exe());
    cmd.arg("-X").arg("compile").arg("--keep-logs").arg("main.tex").current_dir(&dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().map_err(|e| format!("No se pudo ejecutar Tectonic: {e}"))?;
    let log = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    Ok(CompileResult {
        pdf: (out.status.success() && pdf.exists()).then(|| pdf.to_string_lossy().into_owned()),
        log,
    })
}
