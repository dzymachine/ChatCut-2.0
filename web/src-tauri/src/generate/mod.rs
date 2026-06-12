//! Generative clips — Runway video-to-video, fully in-process.
//!
//! Replaces the prototype's Python sidecar (`:3001/api/process-media`) with a
//! native pipeline mirroring the export module's idioms: a managed state
//! registry the frontend polls (`get_generation_progress`) plus cooperative
//! cancellation (`cancel_generation`). No broadened fs capabilities: all file
//! work happens here in Rust; the output lands under `$APPDATA/generations/`
//! which the webview is already scoped to read.
//!
//! Pipeline per task:
//!   1. extract  — FFmpeg cuts the clip segment, ≤720p, bitrate budgeted so
//!                 the file fits Runway's 16 MB data-URI cap, video-only.
//!   2. enrich   — ffprobe metadata + (optional) a single-frame caption from
//!                 Claude Haiku vision, folded into the Runway prompt.
//!   3. generate — POST video_to_video, poll the task with backoff.
//!   4. download — fetch the output into app-data and report the path.

pub mod runway;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

const RUNWAY_DATA_URI_BUDGET_BYTES: f64 = 15.5 * 1024.0 * 1024.0; // headroom under the 16 MB cap
const MAX_SEGMENT_SECONDS: f64 = 10.0;
const POLL_INTERVAL_SECS: u64 = 3;
const POLL_TIMEOUT_SECS: u64 = 600;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationProgress {
    pub id: String,
    /// extracting | enriching | uploading | generating | downloading | done | failed | cancelled
    pub stage: String,
    pub percent: f64,
    pub message: String,
    pub output_path: Option<String>,
    pub error: Option<String>,
    pub running: bool,
}

#[derive(Default)]
pub struct GenerationState {
    tasks: Mutex<HashMap<String, GenerationProgress>>,
    cancelled: Mutex<HashSet<String>>,
    runway_tasks: Mutex<HashMap<String, String>>,
}

impl GenerationState {
    fn update(&self, id: &str, stage: &str, percent: f64, message: &str) {
        if let Ok(mut tasks) = self.tasks.lock() {
            if let Some(p) = tasks.get_mut(id) {
                p.stage = stage.to_string();
                p.percent = percent;
                p.message = message.to_string();
            }
        }
    }

    fn finish(&self, id: &str, result: Result<String, String>, cancelled: bool) {
        if let Ok(mut tasks) = self.tasks.lock() {
            if let Some(p) = tasks.get_mut(id) {
                p.running = false;
                match result {
                    Ok(path) => {
                        p.stage = "done".into();
                        p.percent = 100.0;
                        p.message = "Generation complete".into();
                        p.output_path = Some(path);
                    }
                    Err(e) => {
                        p.stage = if cancelled { "cancelled".into() } else { "failed".into() };
                        p.message = e.clone();
                        p.error = Some(e);
                    }
                }
            }
        }
    }

    fn is_cancelled(&self, id: &str) -> bool {
        self.cancelled.lock().map(|c| c.contains(id)).unwrap_or(false)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationRequest {
    pub source_path: String,
    pub source_start: f64,
    pub source_end: f64,
    pub prompt: String,
    pub runway_api_key: String,
    /// Optional: enables the single-frame vision caption for prompt context.
    pub anthropic_api_key: Option<String>,
}

/// Kick off a generation. Returns the generation id immediately; progress is
/// polled via `get_generation_progress` (same pattern as export).
#[tauri::command]
pub fn start_generation(
    app: tauri::AppHandle,
    state: tauri::State<'_, GenerationState>,
    request: GenerationRequest,
) -> Result<String, String> {
    if request.runway_api_key.trim().is_empty() {
        return Err("Runway API key is not configured. Add it in Settings.".into());
    }
    if !PathBuf::from(&request.source_path).exists() {
        return Err(format!("Source file not found: {}", request.source_path));
    }

    let id = format!("gen-{}", uuid::Uuid::new_v4());
    {
        let mut tasks = state.tasks.lock().map_err(|e| e.to_string())?;
        tasks.insert(id.clone(), GenerationProgress {
            id: id.clone(),
            stage: "extracting".into(),
            percent: 0.0,
            message: "Extracting segment".into(),
            output_path: None,
            error: None,
            running: true,
        });
    }

    let task_id = id.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<GenerationState>();
        let result = run_pipeline(&app, &state, &task_id, &request).await;
        let was_cancelled = state.is_cancelled(&task_id);
        state.finish(&task_id, result, was_cancelled);
    });

    Ok(id)
}

#[tauri::command]
pub fn get_generation_progress(
    state: tauri::State<'_, GenerationState>,
    id: String,
) -> Result<GenerationProgress, String> {
    state
        .tasks
        .lock()
        .map_err(|e| e.to_string())?
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("Unknown generation: {}", id))
}

/// Cooperative cancel: flips the flag. The pipeline checks it between stages
/// and on every poll tick — and performs the authed remote Runway cancel
/// itself (it holds the API key; this command does not).
#[tauri::command]
pub fn cancel_generation(
    state: tauri::State<'_, GenerationState>,
    id: String,
) -> Result<(), String> {
    state.cancelled.lock().map_err(|e| e.to_string())?.insert(id);
    Ok(())
}

async fn run_pipeline(
    app: &tauri::AppHandle,
    state: &GenerationState,
    id: &str,
    req: &GenerationRequest,
) -> Result<String, String> {
    // ── 1. Extract the segment ──
    let duration = (req.source_end - req.source_start).clamp(0.5, MAX_SEGMENT_SECONDS);
    let probe = crate::export::probe_media(req.source_path.clone())?;
    let (src_w, src_h) = (probe.width.unwrap_or(1920), probe.height.unwrap_or(1080));
    let fps = probe.fps.unwrap_or(30.0).clamp(1.0, 60.0);

    // Even output dims, ≤720p on the short side, preserving aspect.
    let scale = (720.0 / src_h.min(src_w) as f64).min(1.0);
    let out_w = (((src_w as f64 * scale) / 2.0).round() as u32 * 2).max(256);
    let out_h = (((src_h as f64 * scale) / 2.0).round() as u32 * 2).max(256);

    // Bitrate budget: fit the data URI (base64 ≈ 4/3 of raw bytes).
    let raw_budget = RUNWAY_DATA_URI_BUDGET_BYTES * 3.0 / 4.0;
    let budget_kbps = ((raw_budget * 8.0) / duration / 1000.0).floor() as u32;
    let kbps = budget_kbps.clamp(500, 8000);

    let tmp_dir = std::env::temp_dir();
    let segment_path = tmp_dir.join(format!("{}-segment.mp4", id));
    let frame_path = tmp_dir.join(format!("{}-frame.jpg", id));

    let extract = tokio::process::Command::new("ffmpeg")
        .args([
            "-y", "-v", "error",
            "-ss", &format!("{:.3}", req.source_start),
            "-i", &req.source_path,
            "-t", &format!("{:.3}", duration),
            "-an",
            "-vf", &format!("scale={}:{}", out_w, out_h),
            "-c:v", "libx264", "-preset", "fast",
            "-b:v", &format!("{}k", kbps),
            "-pix_fmt", "yuv420p",
            "-r", &format!("{:.3}", fps),
        ])
        .arg(&segment_path)
        .output()
        .await
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;
    if !extract.status.success() {
        return Err(format!(
            "Segment extraction failed: {}",
            String::from_utf8_lossy(&extract.stderr).lines().last().unwrap_or("unknown")
        ));
    }
    if state.is_cancelled(id) {
        return Err("Cancelled".into());
    }

    // ── 2. Enrich the prompt with footage context ──
    state.update(id, "enriching", 12.0, "Reading footage context");
    let mut context_parts = vec![format!(
        "Source: {}x{} at {:.0}fps, {:.1}s segment.",
        out_w, out_h, fps, duration
    )];

    if let Some(anthropic_key) = req.anthropic_api_key.as_deref().filter(|k| !k.trim().is_empty()) {
        let mid = req.source_start + duration / 2.0;
        let grab = tokio::process::Command::new("ffmpeg")
            .args([
                "-y", "-v", "error",
                "-ss", &format!("{:.3}", mid),
                "-i", &req.source_path,
                "-frames:v", "1",
                "-vf", "scale=768:-2",
            ])
            .arg(&frame_path)
            .output()
            .await;
        if matches!(grab, Ok(ref o) if o.status.success()) {
            if let Ok(bytes) = std::fs::read(&frame_path) {
                match caption_frame(anthropic_key, &bytes).await {
                    Ok(caption) if !caption.is_empty() => {
                        eprintln!("[generate] frame caption: {}", caption);
                        context_parts.push(format!("Scene: {}", caption));
                    }
                    Ok(_) => {}
                    Err(e) => eprintln!("[generate] caption skipped: {}", e),
                }
            }
        }
        let _ = std::fs::remove_file(&frame_path);
    }
    if state.is_cancelled(id) {
        let _ = std::fs::remove_file(&segment_path);
        return Err("Cancelled".into());
    }

    let prompt_text = format!(
        "{}. Context — {} Maintain the original framing and motion.",
        req.prompt.trim_end_matches('.'),
        context_parts.join(" ")
    );

    // ── 3. Submit to Runway + poll ──
    state.update(id, "uploading", 20.0, "Uploading segment to Runway");
    let bytes = std::fs::read(&segment_path).map_err(|e| format!("read segment: {}", e))?;
    let _ = std::fs::remove_file(&segment_path);
    if bytes.len() as f64 > RUNWAY_DATA_URI_BUDGET_BYTES {
        return Err(format!(
            "Extracted segment is {:.1} MB — exceeds Runway's 16 MB upload cap. Trim the clip shorter.",
            bytes.len() as f64 / 1024.0 / 1024.0
        ));
    }
    let data_uri = format!(
        "data:video/mp4;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    );
    drop(bytes);

    let ratio = runway::closest_ratio(out_w, out_h);
    let runway_task = runway::submit(&req.runway_api_key, &data_uri, &prompt_text, ratio).await?;
    eprintln!("[generate] runway task {} started ({} ratio {})", runway_task, id, ratio);
    if let Ok(mut m) = state.runway_tasks.lock() {
        m.insert(id.to_string(), runway_task.clone());
    }

    state.update(id, "generating", 30.0, "Runway is generating");
    let started = std::time::Instant::now();
    let output_url = loop {
        if state.is_cancelled(id) {
            let _ = runway::cancel(&req.runway_api_key, &runway_task).await;
            return Err("Cancelled".into());
        }
        if started.elapsed().as_secs() > POLL_TIMEOUT_SECS {
            let _ = runway::cancel(&req.runway_api_key, &runway_task).await;
            return Err("Runway generation timed out after 10 minutes.".into());
        }

        let status = runway::poll(&req.runway_api_key, &runway_task).await?;
        match status.status.as_str() {
            "SUCCEEDED" => {
                let url = status
                    .output
                    .first()
                    .cloned()
                    .ok_or_else(|| "Runway succeeded but returned no output".to_string())?;
                break url;
            }
            "FAILED" | "CANCELLED" => {
                return Err(format!(
                    "Runway generation {}: {}",
                    status.status.to_lowercase(),
                    status.failure.unwrap_or_else(|| "no reason given".into())
                ));
            }
            _ => {
                // PENDING / RUNNING / THROTTLED → map progress into 30..90.
                let pct = 30.0 + status.progress.unwrap_or(0.0).clamp(0.0, 1.0) * 60.0;
                state.update(id, "generating", pct, "Runway is generating");
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(POLL_INTERVAL_SECS)).await;
    };

    // ── 4. Download the result ──
    state.update(id, "downloading", 92.0, "Downloading generated clip");
    let out_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("generations");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let out_path = out_dir.join(format!("{}.mp4", id));

    let video = reqwest::get(&output_url)
        .await
        .map_err(|e| format!("download failed: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("download read failed: {}", e))?;
    std::fs::write(&out_path, &video).map_err(|e| format!("write failed: {}", e))?;

    eprintln!("[generate] {} complete → {}", id, out_path.display());
    Ok(out_path.to_string_lossy().to_string())
}

/// One-frame vision caption via Claude Haiku — best-effort prompt context.
async fn caption_frame(api_key: &str, jpeg: &[u8]) -> Result<String, String> {
    let body = serde_json::json!({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 150,
        "messages": [{
            "role": "user",
            "content": [
                { "type": "image", "source": {
                    "type": "base64", "media_type": "image/jpeg",
                    "data": base64::engine::general_purpose::STANDARD.encode(jpeg),
                }},
                { "type": "text", "text": "Describe this video frame for a video-generation prompt: subject, setting, lighting, camera angle, and any motion cues. Two dense sentences, no preamble." }
            ]
        }]
    });

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("anthropic {}", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(json["content"][0]["text"].as_str().unwrap_or("").trim().to_string())
}
