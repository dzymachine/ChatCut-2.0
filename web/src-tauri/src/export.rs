use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::State;

// ─── Data Structures ────────────────────────────────────────────────────────

/// An applied effect instance (mirrors TypeScript AppliedEffect)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppliedEffect {
    pub id: String,
    #[serde(rename = "effectId")]
    pub effect_id: String,
    pub parameters: std::collections::HashMap<String, f64>,
    pub enabled: bool,
}

/// A clip in the export data (mirrors TypeScript Clip, trimmed for export)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportClip {
    /// Path to the source media file on disk
    #[serde(rename = "sourcePath")]
    pub source_path: String,
    /// Start time in the source file (seconds)
    #[serde(rename = "sourceStart")]
    pub source_start: f64,
    /// End time in the source file (seconds)
    #[serde(rename = "sourceEnd")]
    pub source_end: f64,
    /// Position on the timeline (seconds)
    #[serde(rename = "timelineStart")]
    pub timeline_start: f64,
    /// Effect stack
    pub effects: Vec<AppliedEffect>,
}

/// Export settings
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportSettings {
    /// Output file path
    #[serde(rename = "outputPath")]
    pub output_path: String,
    /// Output format: "mp4", "webm", "mov"
    pub format: String,
    /// Video codec: "h264", "h265", "vp9", "prores"
    pub codec: String,
    /// Output width in pixels
    pub width: u32,
    /// Output height in pixels
    pub height: u32,
    /// Frames per second
    pub fps: f64,
    /// Quality preset: "low", "medium", "high", "lossless"
    pub quality: String,
    /// Audio codec: "aac", "opus", "pcm"
    #[serde(rename = "audioCodec")]
    pub audio_codec: String,
    /// Audio bitrate (e.g. "192k")
    #[serde(rename = "audioBitrate")]
    pub audio_bitrate: String,
}

/// Export progress information
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportProgress {
    /// Progress percentage (0.0 to 100.0)
    pub percent: f64,
    /// Current frame being processed
    pub frame: u64,
    /// Total frames (estimated)
    #[serde(rename = "totalFrames")]
    pub total_frames: u64,
    /// Current processing speed (e.g. "2.5x")
    pub speed: String,
    /// Estimated time remaining in seconds
    pub eta: f64,
    /// Whether the export is still running
    pub running: bool,
    /// Error message if failed
    pub error: Option<String>,
}

/// Media probe result
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaProbeResult {
    pub duration: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub codec: Option<String>,
    pub fps: Option<f64>,
    #[serde(rename = "audioCodec")]
    pub audio_codec: Option<String>,
    #[serde(rename = "sampleRate")]
    pub sample_rate: Option<u32>,
    #[serde(rename = "bitRate")]
    pub bit_rate: Option<u64>,
}

// ─── Export State ────────────────────────────────────────────────────────────

/// Manages the currently running FFmpeg export process
pub struct ExportState {
    pub child: Option<Child>,
    pub progress: ExportProgress,
    pub total_duration: f64,
}

impl Default for ExportState {
    fn default() -> Self {
        Self {
            child: None,
            progress: ExportProgress {
                percent: 0.0,
                frame: 0,
                total_frames: 0,
                speed: "0x".to_string(),
                eta: 0.0,
                running: false,
                error: None,
            },
            total_duration: 0.0,
        }
    }
}

// ─── FFmpeg Filter Graph Builder ────────────────────────────────────────────

/// Build the FFmpeg filter string for a single clip's effect stack
fn build_effect_filters(effects: &[AppliedEffect]) -> Vec<String> {
    let mut filters = Vec::new();

    for effect in effects {
        if !effect.enabled {
            continue;
        }

        let filter = match effect.effect_id.as_str() {
            "scale" => {
                let scale = effect.parameters.get("scale").copied().unwrap_or(1.0);
                if (scale - 1.0).abs() < 0.001 {
                    continue;
                }
                format!("scale=iw*{:.6}:ih*{:.6}", scale, scale)
            }
            "position" => {
                let x = effect.parameters.get("positionX").copied().unwrap_or(0.0);
                let y = effect.parameters.get("positionY").copied().unwrap_or(0.0);
                if x.abs() < 0.001 && y.abs() < 0.001 {
                    continue;
                }
                let abs_x = x.abs() as u32;
                let abs_y = y.abs() as u32;
                let crop_x = if x > 0.0 { 0 } else { abs_x };
                let crop_y = if y > 0.0 { 0 } else { abs_y };
                let pad_x = if x > 0.0 { abs_x } else { 0 };
                let pad_y = if y > 0.0 { abs_y } else { 0 };
                format!(
                    "pad=iw+{}:ih+{}:{}:{}:black,crop=iw-{}:ih-{}:{}:{}",
                    abs_x, abs_y, pad_x, pad_y, abs_x, abs_y, crop_x, crop_y
                )
            }
            "rotation" => {
                let degrees = effect.parameters.get("degrees").copied().unwrap_or(0.0);
                if degrees.abs() < 0.001 {
                    continue;
                }
                let radians = degrees * std::f64::consts::PI / 180.0;
                format!("rotate={:.6}:fillcolor=black", radians)
            }
            "opacity" => {
                let opacity = effect.parameters.get("opacity").copied().unwrap_or(1.0);
                if (opacity - 1.0).abs() < 0.001 {
                    continue;
                }
                format!("format=rgba,colorchannelmixer=aa={:.6}", opacity)
            }
            "crop" => {
                let w = effect.parameters.get("width").copied().unwrap_or(1920.0) as u32;
                let h = effect.parameters.get("height").copied().unwrap_or(1080.0) as u32;
                let x = effect.parameters.get("x").copied().unwrap_or(0.0) as u32;
                let y = effect.parameters.get("y").copied().unwrap_or(0.0) as u32;
                format!("crop={}:{}:{}:{}", w, h, x, y)
            }
            "brightness" => {
                let brightness = effect.parameters.get("brightness").copied().unwrap_or(0.0);
                if brightness.abs() < 0.001 {
                    continue;
                }
                format!("eq=brightness={:.6}", brightness)
            }
            "contrast" => {
                let contrast = effect.parameters.get("contrast").copied().unwrap_or(1.0);
                if (contrast - 1.0).abs() < 0.001 {
                    continue;
                }
                format!("eq=contrast={:.6}", contrast)
            }
            "saturation" => {
                let saturation = effect.parameters.get("saturation").copied().unwrap_or(1.0);
                if (saturation - 1.0).abs() < 0.001 {
                    continue;
                }
                format!("eq=saturation={:.6}", saturation)
            }
            "exposure" => {
                let exposure = effect.parameters.get("exposure").copied().unwrap_or(0.0);
                if exposure.abs() < 0.001 {
                    continue;
                }
                format!("exposure=exposure={:.6}", exposure)
            }
            "color_temperature" => {
                let temp = effect.parameters.get("temperature").copied().unwrap_or(6500.0);
                if (temp - 6500.0).abs() < 1.0 {
                    continue;
                }
                format!("colortemperature=temperature={}", temp as u32)
            }
            "hue_rotate" => {
                let degrees = effect.parameters.get("degrees").copied().unwrap_or(0.0);
                if degrees.abs() < 0.001 {
                    continue;
                }
                format!("hue=h={:.6}", degrees)
            }
            "grayscale" => {
                let amount = effect.parameters.get("amount").copied().unwrap_or(1.0);
                if amount < 0.001 {
                    continue;
                }
                if amount >= 1.0 {
                    "hue=s=0".to_string()
                } else {
                    format!("hue=s={:.6}", 1.0 - amount)
                }
            }
            "gaussian_blur" => {
                let sigma = effect.parameters.get("sigma").copied().unwrap_or(0.0);
                if sigma < 0.001 {
                    continue;
                }
                format!("gblur=sigma={:.6}", sigma)
            }
            "sharpen" => {
                let amount = effect.parameters.get("amount").copied().unwrap_or(0.0);
                if amount < 0.001 {
                    continue;
                }
                format!("unsharp=5:5:{:.6}:5:5:{:.6}", amount, amount / 2.0)
            }
            "sepia" => {
                let amount = effect.parameters.get("amount").copied().unwrap_or(1.0);
                if amount < 0.001 {
                    continue;
                }
                let lerp = |identity: f64, sepia: f64| -> f64 {
                    identity + (sepia - identity) * amount
                };
                format!(
                    "colorchannelmixer={:.6}:{:.6}:{:.6}:0:{:.6}:{:.6}:{:.6}:0:{:.6}:{:.6}:{:.6}",
                    lerp(1.0, 0.393),
                    lerp(0.0, 0.769),
                    lerp(0.0, 0.189),
                    lerp(0.0, 0.349),
                    lerp(1.0, 0.686),
                    lerp(0.0, 0.168),
                    lerp(0.0, 0.272),
                    lerp(0.0, 0.534),
                    lerp(1.0, 0.131)
                )
            }
            "vignette" => {
                let angle = effect.parameters.get("angle").copied().unwrap_or(0.0);
                if angle < 0.001 {
                    continue;
                }
                format!("vignette=angle={:.6}", angle)
            }
            "fade_in" => {
                let duration = effect.parameters.get("duration").copied().unwrap_or(1.0);
                format!("fade=t=in:d={:.6}", duration)
            }
            "fade_out" => {
                let start = effect.parameters.get("start").copied().unwrap_or(0.0);
                let duration = effect.parameters.get("duration").copied().unwrap_or(1.0);
                format!("fade=t=out:st={:.6}:d={:.6}", start, duration)
            }
            "playback_speed" => {
                let rate = effect.parameters.get("rate").copied().unwrap_or(1.0);
                if (rate - 1.0).abs() < 0.001 {
                    continue;
                }
                format!("setpts={:.6}*PTS", 1.0 / rate)
            }
            _ => continue,
        };

        filters.push(filter);
    }

    filters
}

/// Build audio filters from the effect stack
fn build_audio_filters(effects: &[AppliedEffect]) -> Vec<String> {
    let mut filters = Vec::new();

    for effect in effects {
        if !effect.enabled {
            continue;
        }

        if effect.effect_id == "playback_speed" {
            let rate = effect.parameters.get("rate").copied().unwrap_or(1.0);
            if (rate - 1.0).abs() < 0.001 {
                continue;
            }
            // atempo supports 0.5 to 100.0; chain for extremes
            if rate >= 0.5 && rate <= 100.0 {
                filters.push(format!("atempo={:.6}", rate));
            } else if rate < 0.5 {
                let mut remaining = rate;
                while remaining < 0.5 {
                    filters.push("atempo=0.5".to_string());
                    remaining /= 0.5;
                }
                filters.push(format!("atempo={:.6}", remaining));
            }
        }
    }

    filters
}

/// Build the complete filter_complex string for multi-clip export
fn build_filter_complex(clips: &[ExportClip], output_width: u32, output_height: u32) -> String {
    let mut filter_parts = Vec::new();
    let mut video_streams = Vec::new();
    let mut audio_streams = Vec::new();

    for (i, clip) in clips.iter().enumerate() {
        let input_v = format!("[{}:v]", i);
        let input_a = format!("[{}:a]", i);
        let output_v = format!("[v{}]", i);
        let output_a = format!("[a{}]", i);

        // 1. Trim
        let mut video_chain = format!(
            "{}trim=start={:.6}:end={:.6},setpts=PTS-STARTPTS",
            input_v, clip.source_start, clip.source_end
        );
        let mut audio_chain = format!(
            "{}atrim=start={:.6}:end={:.6},asetpts=PTS-STARTPTS",
            input_a, clip.source_start, clip.source_end
        );

        // 2. Video effects
        let video_effects = build_effect_filters(&clip.effects);
        for f in &video_effects {
            video_chain.push(',');
            video_chain.push_str(f);
        }

        // 3. Scale to output resolution
        video_chain.push_str(&format!(
            ",scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2:black",
            output_width, output_height, output_width, output_height
        ));

        // 4. Audio effects
        let audio_effects = build_audio_filters(&clip.effects);
        for f in &audio_effects {
            audio_chain.push(',');
            audio_chain.push_str(f);
        }

        filter_parts.push(format!("{}{}", video_chain, output_v));
        filter_parts.push(format!("{}{}", audio_chain, output_a));
        video_streams.push(format!("[v{}]", i));
        audio_streams.push(format!("[a{}]", i));
    }

    // 5. Concatenate if multiple clips
    if clips.len() == 1 {
        return filter_parts.join(";");
    }

    let concat_input: String = video_streams
        .iter()
        .zip(audio_streams.iter())
        .map(|(v, a)| format!("{}{}", v, a))
        .collect();
    filter_parts.push(format!(
        "{}concat=n={}:v=1:a=1[vout][aout]",
        concat_input,
        clips.len()
    ));

    filter_parts.join(";")
}

/// Get codec settings for FFmpeg
fn get_codec_args(codec: &str, quality: &str) -> Vec<String> {
    match codec {
        "h264" => {
            let crf = match quality {
                "low" => "28",
                "medium" => "23",
                "high" => "18",
                "lossless" => "0",
                _ => "23",
            };
            vec![
                "-c:v".to_string(),
                "libx264".to_string(),
                "-crf".to_string(),
                crf.to_string(),
                "-preset".to_string(),
                "medium".to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
            ]
        }
        "h265" | "hevc" => {
            let crf = match quality {
                "low" => "32",
                "medium" => "28",
                "high" => "22",
                "lossless" => "0",
                _ => "28",
            };
            vec![
                "-c:v".to_string(),
                "libx265".to_string(),
                "-crf".to_string(),
                crf.to_string(),
                "-preset".to_string(),
                "medium".to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
            ]
        }
        "vp9" => {
            let crf = match quality {
                "low" => "40",
                "medium" => "33",
                "high" => "25",
                "lossless" => "0",
                _ => "33",
            };
            vec![
                "-c:v".to_string(),
                "libvpx-vp9".to_string(),
                "-crf".to_string(),
                crf.to_string(),
                "-b:v".to_string(),
                "0".to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
            ]
        }
        "prores" => {
            let profile = match quality {
                "low" => "0",    // ProRes Proxy
                "medium" => "2", // ProRes LT
                "high" => "3",   // ProRes HQ
                "lossless" => "4", // ProRes 4444
                _ => "3",
            };
            vec![
                "-c:v".to_string(),
                "prores_ks".to_string(),
                "-profile:v".to_string(),
                profile.to_string(),
                "-pix_fmt".to_string(),
                "yuva444p10le".to_string(),
            ]
        }
        _ => vec![
            "-c:v".to_string(),
            "libx264".to_string(),
            "-crf".to_string(),
            "23".to_string(),
            "-preset".to_string(),
            "medium".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
        ],
    }
}

/// Get audio codec arguments
fn get_audio_codec_args(audio_codec: &str, bitrate: &str) -> Vec<String> {
    match audio_codec {
        "aac" => vec![
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            bitrate.to_string(),
        ],
        "opus" => vec![
            "-c:a".to_string(),
            "libopus".to_string(),
            "-b:a".to_string(),
            bitrate.to_string(),
        ],
        "pcm" => vec![
            "-c:a".to_string(),
            "pcm_s16le".to_string(),
        ],
        _ => vec![
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            bitrate.to_string(),
        ],
    }
}

// ─── Tauri Commands ─────────────────────────────────────────────────────────

/// Start exporting a video
#[tauri::command]
pub fn export_video(
    clips: Vec<ExportClip>,
    settings: ExportSettings,
    export_state: State<'_, Mutex<ExportState>>,
) -> Result<String, String> {
    let mut state = export_state.lock().map_err(|e| e.to_string())?;

    // If there's an existing process, kill it first
    if let Some(ref mut child) = state.child {
        let _ = child.kill();
    }

    if clips.is_empty() {
        return Err("No clips to export".to_string());
    }

    // Calculate total duration for progress tracking
    let total_duration: f64 = clips.iter().map(|c| c.source_end - c.source_start).sum();
    let total_frames = (total_duration * settings.fps).ceil() as u64;

    // Build FFmpeg command
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-y"); // Overwrite output

    // Add input files
    for clip in &clips {
        cmd.arg("-i").arg(&clip.source_path);
    }

    // Build and add filter_complex
    let filter_complex = build_filter_complex(&clips, settings.width, settings.height);
    if !filter_complex.is_empty() {
        cmd.arg("-filter_complex").arg(&filter_complex);

        // Map the output streams
        if clips.len() == 1 {
            cmd.arg("-map").arg("[v0]");
            cmd.arg("-map").arg("[a0]");
        } else {
            cmd.arg("-map").arg("[vout]");
            cmd.arg("-map").arg("[aout]");
        }
    }

    // Add codec settings
    let codec_args = get_codec_args(&settings.codec, &settings.quality);
    for arg in &codec_args {
        cmd.arg(arg);
    }

    // Add audio codec settings
    let audio_args = get_audio_codec_args(&settings.audio_codec, &settings.audio_bitrate);
    for arg in &audio_args {
        cmd.arg(arg);
    }

    // Set FPS
    cmd.arg("-r").arg(format!("{}", settings.fps));

    // Progress reporting
    cmd.arg("-progress").arg("pipe:1");
    cmd.arg("-stats_period").arg("0.5");

    // Output file
    cmd.arg(&settings.output_path);

    // Configure process
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // Start the process
    let child = cmd.spawn().map_err(|e| {
        format!(
            "Failed to start FFmpeg: {}. Make sure FFmpeg is installed.",
            e
        )
    })?;

    state.child = Some(child);
    state.total_duration = total_duration;
    state.progress = ExportProgress {
        percent: 0.0,
        frame: 0,
        total_frames,
        speed: "0x".to_string(),
        eta: 0.0,
        running: true,
        error: None,
    };

    Ok("Export started".to_string())
}

/// Get the current export progress
#[tauri::command]
pub fn get_export_progress(
    export_state: State<'_, Mutex<ExportState>>,
) -> Result<ExportProgress, String> {
    let mut state = export_state.lock().map_err(|e| e.to_string())?;

    // If no export in progress, return idle progress
    if state.child.is_none() {
        return Ok(ExportProgress {
            percent: 0.0,
            frame: 0,
            total_frames: 0,
            speed: "0x".to_string(),
            eta: 0.0,
            running: false,
            error: None,
        });
    }

    // Collect progress data from the child process into local variables
    // to avoid multiple mutable borrows
    let mut new_percent: Option<f64> = None;
    let mut new_speed: Option<String> = None;
    let mut new_frame: Option<u64> = None;
    let mut is_finished = false;
    let mut error_msg: Option<String> = None;
    let total_duration = state.total_duration;

    // Phase 1: Read from child process stdout
    if let Some(ref mut child) = state.child {
        // Read progress from stdout (FFmpeg -progress pipe:1)
        if let Some(ref mut stdout) = child.stdout {
            let reader = BufReader::new(stdout);
            let mut current_time: Option<f64> = None;
            let mut current_speed: Option<String> = None;
            let mut current_frame: Option<u64> = None;

            for line in reader.lines() {
                match line {
                    Ok(line) => {
                        if let Some(time_str) = line.strip_prefix("out_time_us=") {
                            if let Ok(time_us) = time_str.trim().parse::<f64>() {
                                current_time = Some(time_us / 1_000_000.0);
                            }
                        } else if let Some(speed_str) = line.strip_prefix("speed=") {
                            current_speed = Some(speed_str.trim().to_string());
                        } else if let Some(frame_str) = line.strip_prefix("frame=") {
                            if let Ok(frame) = frame_str.trim().parse::<u64>() {
                                current_frame = Some(frame);
                            }
                        } else if line.starts_with("progress=end") {
                            is_finished = true;
                            new_percent = Some(100.0);
                            break;
                        } else if line.starts_with("progress=continue") {
                            if let Some(time) = current_time {
                                if total_duration > 0.0 {
                                    new_percent = Some((time / total_duration * 100.0).min(99.9));
                                }
                            }
                            new_speed = current_speed.clone();
                            new_frame = current_frame;
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        }

        // Check if process has exited
        match child.try_wait() {
            Ok(Some(status)) => {
                is_finished = true;
                if !status.success() {
                    if let Some(ref mut stderr) = child.stderr {
                        let reader = BufReader::new(stderr);
                        let error_lines: Vec<String> = reader
                            .lines()
                            .filter_map(|l| l.ok())
                            .collect();
                        error_msg = Some(
                            error_lines
                                .last()
                                .cloned()
                                .unwrap_or_else(|| format!("FFmpeg exited with code {}", status)),
                        );
                    }
                } else {
                    new_percent = Some(100.0);
                }
            }
            Ok(None) => {} // Still running
            Err(e) => {
                is_finished = true;
                error_msg = Some(format!("Error checking process: {}", e));
            }
        }
    }

    // Phase 2: Apply collected data to state (no borrow conflicts)
    if let Some(percent) = new_percent {
        state.progress.percent = percent;
    }
    if let Some(speed) = new_speed {
        state.progress.speed = speed;
    }
    if let Some(frame) = new_frame {
        state.progress.frame = frame;
    }
    if is_finished {
        state.progress.running = false;
    }
    if let Some(err) = error_msg {
        state.progress.error = Some(err);
    }

    Ok(state.progress.clone())
}

/// Cancel the current export
#[tauri::command]
pub fn cancel_export(
    export_state: State<'_, Mutex<ExportState>>,
) -> Result<String, String> {
    let mut state = export_state.lock().map_err(|e| e.to_string())?;

    if let Some(ref mut child) = state.child {
        child.kill().map_err(|e| format!("Failed to cancel export: {}", e))?;
        state.progress.running = false;
        state.progress.error = Some("Export cancelled by user".to_string());
        state.child = None;
        Ok("Export cancelled".to_string())
    } else {
        Ok("No export in progress".to_string())
    }
}

/// Probe a media file for metadata using ffprobe
#[tauri::command]
pub fn probe_media(path: String) -> Result<MediaProbeResult, String> {
    let file_path = PathBuf::from(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    let output = Command::new("ffprobe")
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            &path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffprobe: {}. Make sure FFmpeg is installed.", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed: {}", stderr));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

    let mut result = MediaProbeResult {
        duration: 0.0,
        width: None,
        height: None,
        codec: None,
        fps: None,
        audio_codec: None,
        sample_rate: None,
        bit_rate: None,
    };

    // Parse duration from format
    if let Some(format) = json.get("format") {
        if let Some(duration_str) = format.get("duration").and_then(|d| d.as_str()) {
            result.duration = duration_str.parse().unwrap_or(0.0);
        }
        if let Some(bit_rate_str) = format.get("bit_rate").and_then(|b| b.as_str()) {
            result.bit_rate = bit_rate_str.parse().ok();
        }
    }

    // Parse streams
    if let Some(streams) = json.get("streams").and_then(|s| s.as_array()) {
        for stream in streams {
            let codec_type = stream.get("codec_type").and_then(|c| c.as_str()).unwrap_or("");

            match codec_type {
                "video" => {
                    result.width = stream.get("width").and_then(|w| w.as_u64()).map(|w| w as u32);
                    result.height = stream.get("height").and_then(|h| h.as_u64()).map(|h| h as u32);
                    result.codec = stream.get("codec_name").and_then(|c| c.as_str()).map(String::from);

                    // Parse FPS from r_frame_rate (e.g. "30/1" or "24000/1001")
                    if let Some(fps_str) = stream.get("r_frame_rate").and_then(|f| f.as_str()) {
                        let parts: Vec<&str> = fps_str.split('/').collect();
                        if parts.len() == 2 {
                            if let (Ok(num), Ok(den)) = (
                                parts[0].parse::<f64>(),
                                parts[1].parse::<f64>(),
                            ) {
                                if den > 0.0 {
                                    result.fps = Some(num / den);
                                }
                            }
                        }
                    }
                }
                "audio" => {
                    result.audio_codec = stream.get("codec_name").and_then(|c| c.as_str()).map(String::from);
                    if let Some(sr_str) = stream.get("sample_rate").and_then(|s| s.as_str()) {
                        result.sample_rate = sr_str.parse().ok();
                    }
                }
                _ => {}
            }
        }
    }

    Ok(result)
}
