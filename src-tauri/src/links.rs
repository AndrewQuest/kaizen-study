//! External links always open in the user's default browser — never inside the app window.
//!
//! * `open`: the single way the UI opens a link (only http, https, mailto and tel).
//! * `navigation_guard`: if anything tries to navigate the app's webviews to an external page
//!   (e.g. a link inside a rendered table), the navigation is cancelled and the address is
//!   opened in the browser instead.

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Runtime, Url};
use tauri_plugin_opener::OpenerExt;

const EXTERNAL_SCHEMES: &[&str] = &["http", "https", "mailto", "tel"];

/// Opens `url` in the default browser/app. With `KAIZEN_OPEN_LOG` set (end-to-end tests) the
/// address is appended to that file instead, so tests never open a real browser.
pub fn open<R: Runtime>(app: &AppHandle<R>, url: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|_| format!("Dirección no válida: {url}"))?;
    if !EXTERNAL_SCHEMES.contains(&parsed.scheme()) {
        return Err(format!("Tipo de enlace no permitido: {}", parsed.scheme()));
    }
    if let Some(log) = std::env::var_os("KAIZEN_OPEN_LOG") {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(log).map_err(|e| e.to_string())?;
        return writeln!(f, "{url}").map_err(|e| e.to_string());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// True for the app's own pages (and the dev server in debug builds).
fn is_internal(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "asset" | "ipc" | "about" | "data" | "blob" => true,
        "http" | "https" => match url.host_str() {
            Some("tauri.localhost" | "asset.localhost" | "ipc.localhost") => true,
            Some("localhost" | "127.0.0.1") => cfg!(debug_assertions),
            _ => false,
        },
        _ => false,
    }
}

pub fn navigation_guard<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|webview, url| {
            if is_internal(url) {
                return true;
            }
            if EXTERNAL_SCHEMES.contains(&url.scheme()) {
                let _ = open(webview.app_handle(), url.as_str());
            }
            false
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn internal_and_external_urls() {
        let u = |s: &str| Url::parse(s).unwrap();
        assert!(is_internal(&u("http://tauri.localhost/")));
        assert!(is_internal(&u("http://asset.localhost/C%3A/x.pdf")));
        assert!(!is_internal(&u("https://example.com/tabla")));
        assert!(!is_internal(&u("https://tauri.localhost.evil.com/")));
        assert!(!is_internal(&u("file:///C:/Windows/")));
    }
}
