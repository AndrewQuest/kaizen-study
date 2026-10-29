//! Local dictation with whisper.cpp. Audio is captured from the default microphone with cpal,
//! converted to 16 kHz mono and transcribed on this PC: nothing is sent anywhere.
//! One model is installed at a time in `%LOCALAPPDATA%\KaizenStudy\whisper`.

use crate::storage::tools_dir;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

type Result<T> = std::result::Result<T, String>;

/// (id, approximate size in MB, relative accuracy 1–5, relative speed 1–5)
pub const MODELS: &[(&str, u32, u8, u8)] = &[
    ("tiny", 75, 1, 5),
    ("base", 142, 2, 4),
    ("small", 466, 3, 3),
    ("medium", 1530, 4, 2),
    ("large-v3-turbo", 1620, 5, 3),
    ("large-v3", 3100, 5, 1),
];

const SAMPLE_RATE: u32 = 16_000;

pub fn models_dir() -> PathBuf {
    tools_dir().join("whisper")
}

fn model_path(id: &str) -> PathBuf {
    models_dir().join(format!("ggml-{id}.bin"))
}

/// The installed model, if any.
pub fn installed() -> Option<String> {
    MODELS.iter().map(|m| m.0).find(|id| model_path(id).exists()).map(str::to_string)
}

#[derive(Serialize)]
pub struct ModelInfo {
    pub id: &'static str,
    pub size_mb: u32,
    pub accuracy: u8,
    pub speed: u8,
    pub installed: bool,
}

pub fn models() -> Vec<ModelInfo> {
    let current = installed();
    MODELS
        .iter()
        .map(|&(id, size_mb, accuracy, speed)| ModelInfo {
            id,
            size_mb,
            accuracy,
            speed,
            installed: current.as_deref() == Some(id),
        })
        .collect()
}

/// Downloads a model from the official whisper.cpp repository on Hugging Face and removes
/// the previously installed one (only one model at a time).
pub fn install(app: &AppHandle, id: &str) -> Result<()> {
    if !MODELS.iter().any(|m| m.0 == id) {
        return Err(format!("Modelo desconocido: {id}"));
    }
    let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{id}.bin");
    crate::latex::download(app, "whisper", &url, &model_path(id))?;
    for (other, ..) in MODELS {
        if *other != id {
            let _ = std::fs::remove_file(model_path(other));
        }
    }
    *LOADED.lock().unwrap() = None;
    Ok(())
}

pub fn uninstall() -> Result<()> {
    *LOADED.lock().unwrap() = None;
    for (id, ..) in MODELS {
        let _ = std::fs::remove_file(model_path(id));
    }
    Ok(())
}

// ---------- Recording ----------

struct Recording {
    stop: Sender<()>,
    samples: Arc<Mutex<Vec<f32>>>,
    rate: u32,
}

static RECORDING: Mutex<Option<Recording>> = Mutex::new(None);
static LOADED: Mutex<Option<(String, WhisperContext)>> = Mutex::new(None);

pub fn is_recording() -> bool {
    RECORDING.lock().unwrap().is_some()
}

/// Names of the connected microphones (as shown by Windows).
pub fn input_devices() -> Vec<String> {
    let mut names: Vec<String> = cpal::default_host()
        .input_devices()
        .map(|devices| devices.map(|d| d.to_string()).collect())
        .unwrap_or_default();
    names.sort();
    names.dedup();
    names
}

/// The microphone called `name`, or the Windows default when `name` is empty.
fn input_device(name: &str) -> Result<cpal::Device> {
    let host = cpal::default_host();
    if !name.is_empty() {
        if let Some(device) = host
            .input_devices()
            .map_err(|e| e.to_string())?
            .find(|d| d.to_string() == name)
        {
            return Ok(device);
        }
        return Err(format!("El micrófono «{name}» no está conectado. Elige otro en Ajustes → Dictado."));
    }
    host.default_input_device().ok_or_else(|| "No se encontró ningún micrófono.".into())
}

/// Starts capturing a microphone (`device` = name, empty = Windows default), mono at its own rate.
pub fn start(device: String) -> Result<()> {
    if installed().is_none() {
        return Err("Primero descarga un modelo de dictado en Ajustes.".into());
    }
    let mut rec = RECORDING.lock().unwrap();
    if rec.is_some() {
        return Ok(());
    }
    let samples = Arc::new(Mutex::new(Vec::<f32>::new()));
    let (stop_tx, stop_rx) = channel::<()>();
    let (ready_tx, ready_rx) = channel::<Result<u32>>();
    let buf = samples.clone();
    // The stream lives on its own thread until `stop` is signalled.
    std::thread::spawn(move || {
        let setup = || -> Result<(cpal::Stream, u32)> {
            let device = input_device(&device)?;
            let config = device.default_input_config().map_err(|e| e.to_string())?;
            let channels = config.channels() as usize;
            let rate = config.sample_rate();
            let err = |e| eprintln!("Error del micrófono: {e}");
            macro_rules! stream {
                ($t:ty, $conv:expr) => {{
                    let buf = buf.clone();
                    device.build_input_stream(
                        config.clone().into(),
                        move |data: &[$t], _: &_| {
                            let mut out = buf.lock().unwrap();
                            for frame in data.chunks(channels) {
                                let sum: f32 = frame.iter().map(|s| $conv(*s)).sum();
                                out.push(sum / channels as f32);
                            }
                        },
                        err,
                        None,
                    )
                }};
            }
            let stream = match config.sample_format() {
                cpal::SampleFormat::F32 => stream!(f32, |s: f32| s),
                cpal::SampleFormat::I16 => stream!(i16, |s: i16| s as f32 / i16::MAX as f32),
                cpal::SampleFormat::U16 => stream!(u16, |s: u16| (s as f32 - 32768.0) / 32768.0),
                other => return Err(format!("Formato de micrófono no compatible: {other:?}")),
            }
            .map_err(|e| e.to_string())?;
            stream.play().map_err(|e| e.to_string())?;
            Ok((stream, rate))
        };
        match setup() {
            Ok((stream, rate)) => {
                let _ = ready_tx.send(Ok(rate));
                let _ = stop_rx.recv();
                drop(stream);
            }
            Err(e) => {
                let _ = ready_tx.send(Err(e));
            }
        }
    });
    let rate = ready_rx.recv().map_err(|e| e.to_string())??;
    *rec = Some(Recording { stop: stop_tx, samples, rate });
    Ok(())
}

/// Linear resampling to 16 kHz (good enough for speech).
fn resample(input: &[f32], from: u32) -> Vec<f32> {
    if from == SAMPLE_RATE || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from as f64 / SAMPLE_RATE as f64;
    let len = (input.len() as f64 / ratio) as usize;
    (0..len)
        .map(|i| {
            let pos = i as f64 * ratio;
            let idx = pos as usize;
            let frac = (pos - idx as f64) as f32;
            let a = input[idx];
            let b = *input.get(idx + 1).unwrap_or(&a);
            a + (b - a) * frac
        })
        .collect()
}

/// Stops recording and returns the 16 kHz audio.
pub fn stop() -> Result<Vec<f32>> {
    let rec = RECORDING.lock().unwrap().take().ok_or("No se está grabando.")?;
    let _ = rec.stop.send(());
    let samples = std::mem::take(&mut *rec.samples.lock().unwrap());
    Ok(resample(&samples, rec.rate))
}

pub fn cancel() {
    if let Some(rec) = RECORDING.lock().unwrap().take() {
        let _ = rec.stop.send(());
    }
}

/// Transcribes 16 kHz mono audio. `lang`: "es", "en" or "auto".
pub fn transcribe(audio: &[f32], lang: &str) -> Result<String> {
    if audio.len() < (SAMPLE_RATE / 4) as usize {
        return Ok(String::new());
    }
    if audio.iter().all(|s| s.abs() < 1e-4) {
        return Err("No se captó sonido. Revisa el micrófono y el permiso de Windows (Configuración → Privacidad → Micrófono).".into());
    }
    let id = installed().ok_or("No hay ningún modelo de dictado instalado.")?;
    let mut loaded = LOADED.lock().unwrap();
    if loaded.as_ref().map(|(m, _)| m != &id).unwrap_or(true) {
        let ctx = WhisperContext::new_with_params(model_path(&id), WhisperContextParameters::default())
            .map_err(|e| format!("No se pudo cargar el modelo: {e}"))?;
        *loaded = Some((id, ctx));
    }
    let ctx = &loaded.as_ref().unwrap().1;
    let mut state = ctx.create_state().map_err(|e| e.to_string())?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some(if lang == "es" || lang == "en" { lang } else { "auto" }));
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    params.set_n_threads(threads as i32);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_special(false);
    params.set_print_timestamps(false);
    params.set_suppress_blank(true);
    state.full(params, audio).map_err(|e| format!("Error al transcribir: {e}"))?;
    let mut text = String::new();
    for i in 0..state.full_n_segments() {
        if let Some(seg) = state.get_segment(i) {
            text.push_str(&seg.to_str_lossy().map_err(|e| e.to_string())?);
        }
    }
    Ok(text.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reads 16-bit PCM mono WAV samples (finds the "data" chunk).
    fn read_wav(path: &str) -> (Vec<f32>, u32) {
        let bytes = std::fs::read(path).unwrap();
        let rate = u32::from_le_bytes(bytes[24..28].try_into().unwrap());
        let mut i = 12;
        while &bytes[i..i + 4] != b"data" {
            i += 8 + u32::from_le_bytes(bytes[i + 4..i + 8].try_into().unwrap()) as usize;
        }
        let pcm = &bytes[i + 8..];
        let samples = pcm.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect();
        (samples, rate)
    }

    /// End-to-end check of the Whisper pipeline with a real model and a recorded phrase:
    ///   KAIZEN_TOOLS_DIR=<dir with whisper/ggml-*.bin> KAIZEN_TEST_WAV=<file.wav> cargo test -- --ignored
    #[test]
    #[ignore]
    fn transcribes_a_recording() {
        let wav = std::env::var("KAIZEN_TEST_WAV").expect("KAIZEN_TEST_WAV");
        let (samples, rate) = read_wav(&wav);
        let text = transcribe(&resample(&samples, rate), "es").unwrap().to_lowercase();
        println!("transcripción: {text}");
        assert!(text.contains("regla de la cadena"), "{text}");
        assert!(text.contains("matemáticas") || text.contains("matematicas"), "{text}");
    }

    /// Captures 1.5 s from every connected microphone (audio is only measured, never stored):
    ///   KAIZEN_TOOLS_DIR=<dir with a model> cargo test -- --ignored captures
    #[test]
    #[ignore]
    fn captures_from_each_microphone() {
        let devices = input_devices();
        assert!(!devices.is_empty(), "no hay micrófonos");
        for name in std::iter::once(String::new()).chain(devices) {
            start(name.clone()).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let audio = stop().unwrap();
            let peak = audio.iter().fold(0f32, |m, s| m.max(s.abs()));
            println!("«{}»: {} muestras a 16 kHz, pico {peak:.4}", if name.is_empty() { "predeterminado" } else { &name }, audio.len());
            assert!(audio.len() > 16_000, "{name}: muy pocas muestras");
        }
    }

    #[test]
    fn resamples_to_16k() {
        let input: Vec<f32> = (0..48_000).map(|i| i as f32 / 48_000.0).collect();
        let out = resample(&input, 48_000);
        assert_eq!(out.len(), 16_000);
        assert!((out[8_000] - 0.5).abs() < 0.001);
    }
}
