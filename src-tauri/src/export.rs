//! Export and printing. The UI builds the document as HTML (same renderer as the app);
//! a hidden window at `/export` shows it and WebView2 saves it as PDF with the chosen page
//! size, orientation and margins. Word/TXT/Markdown files are produced in the UI and written here.

use serde::Deserialize;
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

type Result<T> = std::result::Result<T, String>;

/// HTML of the document being exported/printed (read by the `/export` page).
static DOC: Mutex<Option<String>> = Mutex::new(None);
/// Signalled by the `/export` page once fonts and images are ready.
static READY: Mutex<Option<Sender<()>>> = Mutex::new(None);

#[derive(Deserialize, Clone, Copy)]
pub struct PageSetup {
    /// Inches.
    pub width: f64,
    pub height: f64,
    pub landscape: bool,
    /// Inches, all four sides.
    pub margin: f64,
}

pub fn set_doc(html: String) {
    *DOC.lock().unwrap() = Some(html);
}

pub fn doc() -> String {
    DOC.lock().unwrap().clone().unwrap_or_default()
}

pub fn ready() {
    if let Some(tx) = READY.lock().unwrap().take() {
        let _ = tx.send(());
    }
}

fn close(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.close();
    }
}

/// Opens a print-preview window: the page calls `window.print()` itself (Windows print dialog).
pub fn print(app: &AppHandle, html: String) -> Result<()> {
    set_doc(html);
    close(app, "export-print");
    WebviewWindowBuilder::new(app, "export-print", WebviewUrl::App("export?mode=print".into()))
        .title("Kaizen Study — Imprimir")
        .inner_size(900.0, 760.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Renders `html` in a hidden window and saves it as a PDF at `path`.
pub fn pdf(app: &AppHandle, html: String, path: String, page: PageSetup) -> Result<()> {
    set_doc(html);
    let (tx, rx) = channel();
    *READY.lock().unwrap() = Some(tx);
    close(app, "export");
    let window = WebviewWindowBuilder::new(app, "export", WebviewUrl::App("export?mode=pdf".into()))
        // Off-screen rather than hidden: a hidden WebView2 may not lay out or paint the page.
        .position(-20000.0, -20000.0)
        .skip_taskbar(true)
        .focused(false)
        .decorations(false)
        .inner_size(900.0, 1200.0)
        .build()
        .map_err(|e| e.to_string())?;
    let result = (|| {
        rx.recv_timeout(Duration::from_secs(60))
            .map_err(|_| "La exportación tardó demasiado (¿imágenes muy pesadas?).".to_string())?;
        print_to_pdf(&window, &path, page)
    })();
    let _ = window.close();
    result
}

#[cfg(windows)]
fn print_to_pdf(window: &tauri::WebviewWindow, path: &str, page: PageSetup) -> Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_7, COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE,
        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows_core::{Interface, HSTRING};

    let (tx, rx) = channel::<Result<()>>();
    let path = path.to_string();
    window
        .with_webview(move |wv| {
            let run = || -> windows_core::Result<()> {
                unsafe {
                    let core = wv.controller().CoreWebView2()?.cast::<ICoreWebView2_7>()?;
                    let env = wv.environment().cast::<ICoreWebView2Environment6>()?;
                    let settings = env.CreatePrintSettings()?;
                    settings.SetOrientation(if page.landscape {
                        COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
                    } else {
                        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
                    })?;
                    settings.SetPageWidth(page.width)?;
                    settings.SetPageHeight(page.height)?;
                    settings.SetMarginTop(page.margin)?;
                    settings.SetMarginBottom(page.margin)?;
                    settings.SetMarginLeft(page.margin)?;
                    settings.SetMarginRight(page.margin)?;
                    settings.SetShouldPrintBackgrounds(true.into())?;
                    settings.SetShouldPrintHeaderAndFooter(false.into())?;
                    let done = tx.clone();
                    let handler = PrintToPdfCompletedHandler::create(Box::new(move |hr, ok| {
                        let _ = done.send(match (hr, ok) {
                            (Ok(()), true) => Ok(()),
                            (Err(e), _) => Err(e.to_string()),
                            _ => Err("WebView2 no pudo crear el PDF.".into()),
                        });
                        Ok(())
                    }));
                    core.PrintToPdf(&HSTRING::from(path.as_str()), &settings, &handler)
                }
            };
            if let Err(e) = run() {
                let _ = tx.send(Err(e.to_string()));
            }
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(120))
        .map_err(|_| "La creación del PDF no respondió.".to_string())?
}

#[cfg(not(windows))]
fn print_to_pdf(_: &tauri::WebviewWindow, _: &str, _: PageSetup) -> Result<()> {
    Err("Exportar a PDF solo está disponible en Windows por ahora.".into())
}
