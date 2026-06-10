use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use tauri::State;
use tempfile::NamedTempFile;

/// Cached probe for VideoToolbox hardware encoder availability.
fn has_videotoolbox() -> bool {
    static CACHE: OnceLock<bool> = OnceLock::new();
    *CACHE.get_or_init(|| {
        match Command::new("ffmpeg")
            .args(["-hide_banner", "-encoders"])
            .output()
        {
            Ok(out) => {
                let s = String::from_utf8_lossy(&out.stdout);
                s.contains("h264_videotoolbox")
            }
            Err(_) => false,
        }
    })
}

/// VideoToolbox is bitrate-driven (no CRF), so quality maps to bits-per-pixel.
fn target_bitrate_kbps(quality: &str, width: u32, height: u32, fps: f64) -> u32 {
    let bpp = match quality {
        "low" => 0.04,
        "medium" => 0.08,
        "high" => 0.12,
        "veryhigh" | "vhigh" | "lossless" => 0.20,
        _ => 0.08,
    };
    let pixels = (width as f64) * (height as f64) * fps.max(1.0);
    ((bpp * pixels) / 1000.0).round().max(500.0) as u32
}

/// True if `path` has an audio stream (false for GoPro timelapses with only tmcd).
fn has_audio_stream(path: &str) -> bool {
    match Command::new("ffprobe")
        .args([
            "-v", "error",
            "-select_streams", "a",
            "-show_entries", "stream=codec_type",
            "-of", "csv=p=0",
            path,
        ])
        .output()
    {
        Ok(out) => out.stdout.iter().any(|b| !b.is_ascii_whitespace()),
        Err(_) => false,
    }
}

/// An applied effect instance (mirrors TypeScript AppliedEffect)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppliedEffect {
    pub id: String,
    #[serde(rename = "effectId")]
    pub effect_id: String,
    pub parameters: std::collections::HashMap<String, f64>,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportClip {
    #[serde(rename = "sourcePath")]
    pub source_path: String,
    #[serde(rename = "sourceStart")]
    pub source_start: f64,
    #[serde(rename = "sourceEnd")]
    pub source_end: f64,
    #[serde(rename = "timelineStart")]
    pub timeline_start: f64,
    pub effects: Vec<AppliedEffect>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recipe: Option<crate::recipe::Recipe>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportSettings {
    #[serde(rename = "outputPath")]
    pub output_path: String,
    pub format: String,
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub quality: String,
    #[serde(rename = "audioCodec")]
    pub audio_codec: String,
    #[serde(rename = "audioBitrate")]
    pub audio_bitrate: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportProgress {
    pub percent: f64,
    pub frame: u64,
    #[serde(rename = "totalFrames")]
    pub total_frames: u64,
    pub speed: String,
    pub eta: f64,
    pub running: bool,
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

/// Manages the currently running FFmpeg export process
pub struct ExportState {
    pub child: Option<Child>,
    pub progress: ExportProgress,
    pub total_duration: f64,
    filter_script: Option<NamedTempFile>,
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
            filter_script: None,
        }
    }
}

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
    if clips.is_empty() {
        return String::new();
    }

    let mut sorted_clips: Vec<&ExportClip> = clips.iter().collect();
    sorted_clips.sort_by(|a, b| a.timeline_start.partial_cmp(&b.timeline_start).unwrap());

    // Probe unique sources for audio presence in parallel — each spawns an
    // ffprobe subprocess, so parallelism avoids serial latency for N sources.
    let unique_sources: Vec<String> = {
        let mut seen = std::collections::HashSet::new();
        sorted_clips
            .iter()
            .filter(|c| seen.insert(c.source_path.clone()))
            .map(|c| c.source_path.clone())
            .collect()
    };
    let audio_by_source: HashMap<String, bool> = std::thread::scope(|s| {
        let handles: Vec<_> = unique_sources
            .iter()
            .map(|path| {
                let path = path.clone();
                s.spawn(move || {
                    let has = has_audio_stream(&path);
                    if !has {
                        eprintln!("[export] source has no audio, will use anullsrc: {}", path);
                    }
                    (path, has)
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });

    let scale_pad = format!(
        ",scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2:black",
        output_width, output_height, output_width, output_height
    );

    let mut filter_parts = Vec::new();
    let mut video_streams = Vec::new();
    let mut audio_streams = Vec::new();
    let mut stream_index = 0;

    // Handle initial gap if first clip doesn't start at 0
    if sorted_clips[0].timeline_start > 0.0 {
        let gap_duration = sorted_clips[0].timeline_start;
        let gap_video = format!(
            "color=black:size={}x{}:duration={:.6}[vgap{}]",
            output_width, output_height, gap_duration, stream_index
        );
        let gap_audio = format!(
            "anullsrc=duration={:.6}[agap{}]",
            gap_duration, stream_index
        );
        filter_parts.push(gap_video);
        filter_parts.push(gap_audio);
        video_streams.push(format!("[vgap{}]", stream_index));
        audio_streams.push(format!("[agap{}]", stream_index));
        stream_index += 1;
    }

    // Process each clip and gaps between them
    for (i, clip) in sorted_clips.iter().enumerate() {
        let input_v = format!("[{}:v]", i);
        let input_a = format!("[{}:a]", i);
        let output_v = format!("[v{}]", stream_index);
        let output_a = format!("[a{}]", stream_index);
        let source_has_audio = *audio_by_source.get(&clip.source_path).unwrap_or(&false);
        let clip_duration = (clip.source_end - clip.source_start).max(0.0);

        // 1. Trim
        let mut video_chain = format!(
            "{}trim=start={:.6}:end={:.6},setpts=PTS-STARTPTS",
            input_v, clip.source_start, clip.source_end
        );
        // Audio chain: if the source actually has audio, trim it like the
        // video. Otherwise synthesize silence so the downstream graph still
        // has a valid [a*] label to map to [aout].
        let mut audio_chain = if source_has_audio {
            format!(
                "{}atrim=start={:.6}:end={:.6},asetpts=PTS-STARTPTS",
                input_a, clip.source_start, clip.source_end
            )
        } else {
            format!(
                "anullsrc=channel_layout=stereo:sample_rate=44100:duration={:.6}",
                clip_duration
            )
        };

        // 2. Video effects (legacy effect stack)
        let video_effects = build_effect_filters(&clip.effects);
        for f in &video_effects {
            video_chain.push(',');
            video_chain.push_str(f);
        }

        // 2b. Recipe filters (appended after legacy effects)
        if let Some(ref recipe) = clip.recipe {
            if let Ok(recipe_filters) = crate::recipe::compile_recipe(recipe) {
                if !recipe_filters.is_empty() {
                    video_chain.push(',');
                    video_chain.push_str(&recipe_filters);
                }
            }
        }

        // 3. Scale to output resolution
        video_chain.push_str(&scale_pad);

        // 4. Audio effects
        let audio_effects = build_audio_filters(&clip.effects);
        for f in &audio_effects {
            audio_chain.push(',');
            audio_chain.push_str(f);
        }

        filter_parts.push(format!("{}{}", video_chain, output_v));
        filter_parts.push(format!("{}{}", audio_chain, output_a));
        video_streams.push(format!("[v{}]", stream_index));
        audio_streams.push(format!("[a{}]", stream_index));
        stream_index += 1;

        // Check for gap to next clip
        if i < sorted_clips.len() - 1 {
            let current_end = clip.timeline_start + (clip.source_end - clip.source_start);
            let next_start = sorted_clips[i + 1].timeline_start;
            if next_start > current_end {
                let gap_duration = next_start - current_end;
                let gap_video = format!(
                    "color=black:size={}x{}:duration={:.6}[vgap{}]",
                    output_width, output_height, gap_duration, stream_index
                );
                let gap_audio = format!(
                    "anullsrc=duration={:.6}[agap{}]",
                    gap_duration, stream_index
                );
                filter_parts.push(gap_video);
                filter_parts.push(gap_audio);
                video_streams.push(format!("[vgap{}]", stream_index));
                audio_streams.push(format!("[agap{}]", stream_index));
                stream_index += 1;
            }
        }
    }

    // 5. Concatenate all streams
    if video_streams.len() == 1 {
        // Single stream: alias the chain output to [vout] / [aout] via
        // passthrough filters. Naked `[v0][vout]` is invalid syntax —
        // FFmpeg parses `[vout]` as a filter name and errors "Filter not
        // found". `null` / `anull` are stock no-op filters.
        filter_parts.push(format!("{}null[vout]", video_streams[0]));
        filter_parts.push(format!("{}anull[aout]", audio_streams[0]));
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
        video_streams.len()
    ));

    filter_parts.join(";")
}

/// Build a standalone single-input filtergraph for ONE clip's preview proxy:
/// legacy effects → recipe → downscale. Mirrors the per-clip video chain in
/// `build_filter_complex` minus trim/pad/concat — input `-ss`/`-t` handle the
/// segment, and a preview proxy needs no composition canvas (no pad). Kept
/// separate so the verified export path is untouched.
fn build_single_clip_filter(clip: &ExportClip, out_w: u32, out_h: u32) -> Result<String, String> {
    let mut parts: Vec<String> = build_effect_filters(&clip.effects);
    if let Some(ref recipe) = clip.recipe {
        let rf = crate::recipe::compile_recipe(recipe)?;
        if !rf.is_empty() {
            parts.push(rf);
        }
    }
    parts.push(format!("scale={}:{}", out_w, out_h));
    Ok(format!("[0:v]{}[vout]", parts.join(",")))
}

/// Stable short hex hash for preview-proxy cache filenames.
fn short_hash(s: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// Render a fast, low-res, video-only preview proxy (mp4) — or a single still
/// frame (png) — of ONE clip with its recipe baked in, so the canvas can show
/// the grade without a full export. Returns the output file path (the frontend
/// wraps it with convertFileSrc). Cached by content hash; a hit skips encoding.
/// Runs off the UI thread via spawn_blocking.
#[tauri::command]
pub async fn render_recipe_preview(
    app: tauri::AppHandle,
    clip: ExportClip,
    clip_id: String,
    out_width: u32,
    out_height: u32,
    fps: f64,
    single_frame: Option<f64>,
) -> Result<String, String> {
    use tauri::Manager;

    let out_w = (out_width.max(16) / 2) * 2;
    let out_h = (out_height.max(16) / 2) * 2;

    // Build the graph up front so a recipe compile error surfaces synchronously.
    let filter = build_single_clip_filter(&clip, out_w, out_h)?;

    // Cache key over everything that affects pixels/timing — NOT recipe alone,
    // or a trim/dims change would return a stale proxy.
    let cache_input = format!(
        "{}|{:?}|{:?}|{:.6}|{:.6}|{}|{}|{:.3}|{:?}",
        clip.source_path, clip.recipe, clip.effects,
        clip.source_start, clip.source_end, out_w, out_h, fps, single_frame
    );
    let hash = short_hash(&cache_input);
    let ext = if single_frame.is_some() { "png" } else { "mp4" };

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("preview-proxies");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let out_path = dir.join(format!("{}-{}.{}", clip_id, hash, ext));
    let out_path_str = out_path.to_string_lossy().to_string();

    // Cache hit — return immediately, no encode.
    if out_path.exists() {
        return Ok(out_path_str);
    }

    let source_path = clip.source_path.clone();
    let source_start = clip.source_start;
    let duration = (clip.source_end - clip.source_start).max(0.0);
    let task_out = out_path_str.clone();

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let mut cmd = Command::new("ffmpeg");
        cmd.arg("-y");
        match single_frame {
            Some(t) => {
                // Still: input-seek to the (proxy-local) playhead within the clip.
                cmd.arg("-ss").arg(format!("{:.6}", source_start + t.max(0.0)));
                cmd.arg("-i").arg(&source_path);
                cmd.arg("-filter_complex").arg(&filter);
                cmd.arg("-map").arg("[vout]");
                cmd.arg("-frames:v").arg("1");
            }
            None => {
                // Proxy: input-seek to clip start, encode the trimmed segment.
                cmd.arg("-ss").arg(format!("{:.6}", source_start));
                cmd.arg("-i").arg(&source_path);
                cmd.arg("-t").arg(format!("{:.6}", duration));
                cmd.arg("-filter_complex").arg(&filter);
                cmd.arg("-map").arg("[vout]");
                cmd.arg("-an"); // video-only (pool <video>s are muted)
                for a in get_codec_args("h264", "low", out_w, out_h, fps) {
                    cmd.arg(a);
                }
                cmd.arg("-r").arg(format!("{}", fps));
            }
        }
        cmd.arg(&task_out);
        cmd.stdout(Stdio::null());
        cmd.stderr(Stdio::piped());

        let output = cmd
            .output()
            .map_err(|e| format!("Failed to start FFmpeg: {}. Is it installed?", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let msg = stderr
                .lines()
                .rev()
                .find(|l| {
                    let x = l.to_lowercase();
                    x.contains("error") || x.contains("invalid") || x.contains("not found")
                })
                .unwrap_or("preview encode failed")
                .to_string();
            eprintln!("[preview] ffmpeg failed:\n{}", stderr);
            return Err(msg);
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("preview task join error: {}", e))??;

    eprintln!("[preview] rendered {}", out_path_str);
    Ok(out_path_str)
}

/// Prefers VideoToolbox hardware encoders when available; falls back to software CRF.
fn get_codec_args(codec: &str, quality: &str, width: u32, height: u32, fps: f64) -> Vec<String> {
    let hw = has_videotoolbox();
    match codec {
        "h264" => {
            if hw {
                let kbps = target_bitrate_kbps(quality, width, height, fps);
                eprintln!("[export] using h264_videotoolbox @ {}k", kbps);
                vec![
                    "-c:v".to_string(),
                    "h264_videotoolbox".to_string(),
                    "-b:v".to_string(),
                    format!("{}k", kbps),
                    "-pix_fmt".to_string(),
                    "yuv420p".to_string(),
                ]
            } else {
                let crf = match quality {
                    "low" => "28",
                    "medium" => "23",
                    "high" => "18",
                    "veryhigh" | "vhigh" => "16",
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
        }
        "h265" | "hevc" => {
            if hw {
                let kbps = target_bitrate_kbps(quality, width, height, fps);
                eprintln!("[export] using hevc_videotoolbox @ {}k", kbps);
                vec![
                    "-c:v".to_string(),
                    "hevc_videotoolbox".to_string(),
                    "-b:v".to_string(),
                    format!("{}k", kbps),
                    // hvc1 tag so QuickTime/Apple players accept the stream
                    "-tag:v".to_string(),
                    "hvc1".to_string(),
                    "-pix_fmt".to_string(),
                    "yuv420p".to_string(),
                ]
            } else {
                let crf = match quality {
                    "low" => "32",
                    "medium" => "28",
                    "high" => "22",
                    "veryhigh" | "vhigh" => "20",
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
        "aac" | _ => vec![
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            bitrate.to_string(),
        ],
    }
}

/// Start exporting a video
#[tauri::command]
pub fn export_video(
    clips: Vec<ExportClip>,
    settings: ExportSettings,
    export_state: State<'_, Mutex<ExportState>>,
) -> Result<String, String> {
    eprintln!(
        "[export] export_video ENTERED — {} clip(s), output={}, codec={}, quality={}",
        clips.len(),
        settings.output_path,
        settings.codec,
        settings.quality
    );

    let mut state = export_state.lock().map_err(|e| e.to_string())?;

    // If there's an existing process, kill it first
    if let Some(ref mut child) = state.child {
        let _ = child.kill();
    }

    if clips.is_empty() {
        eprintln!("[export] FAIL: no clips passed in");
        return Err("No clips to export".to_string());
    }

    // Sort clips by timeline_start to calculate total duration correctly
    let mut sorted_clips: Vec<&ExportClip> = clips.iter().collect();
    sorted_clips.sort_by(|a, b| a.timeline_start.partial_cmp(&b.timeline_start).unwrap());

    // Calculate total duration for progress tracking (full timeline span including gaps)
    let min_start = sorted_clips.first().map(|c| c.timeline_start).unwrap_or(0.0);
    let max_end = sorted_clips.last().map(|c| c.timeline_start + (c.source_end - c.source_start)).unwrap_or(0.0);
    let total_duration = (max_end - min_start).max(0.0);
    let total_frames = (total_duration * settings.fps).ceil() as u64;

    // Build FFmpeg command
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-y"); // Overwrite output

    // Add input files
    for clip in &clips {
        cmd.arg("-i").arg(&clip.source_path);
    }

    // Build filter graph and write to a temp file — avoids argv length limits
    // (as low as ~32KB on Windows) for timelines with many clips/effects.
    let filter_complex = build_filter_complex(&clips, settings.width, settings.height);
    let mut filter_script: Option<NamedTempFile> = None;
    if !filter_complex.is_empty() {
        eprintln!("[export] filter_complex = {}", filter_complex);
        for (i, clip) in clips.iter().enumerate() {
            if let Some(ref r) = clip.recipe {
                eprintln!(
                    "[export] clip[{}] has recipe: {} nodes, {} connections",
                    i,
                    r.nodes.len(),
                    r.connections.len()
                );
            }
        }

        let mut tmp = NamedTempFile::new()
            .map_err(|e| format!("Failed to create filter script: {}", e))?;
        tmp.write_all(filter_complex.as_bytes())
            .map_err(|e| format!("Failed to write filter script: {}", e))?;
        tmp.flush()
            .map_err(|e| format!("Failed to flush filter script: {}", e))?;
        cmd.arg("-filter_complex_script").arg(tmp.path());
        filter_script = Some(tmp);

        cmd.arg("-map").arg("[vout]");
        cmd.arg("-map").arg("[aout]");
    }

    // Add codec settings
    let codec_args = get_codec_args(
        &settings.codec,
        &settings.quality,
        settings.width,
        settings.height,
        settings.fps,
    );
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
    state.filter_script = filter_script;
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
                        // Dump full FFmpeg stderr to the dev terminal so we
                        // can diagnose. Without this, only the last line is
                        // surfaced to the UI which loses the actual cause.
                        eprintln!(
                            "[export] FFmpeg FAILED (exit {}) — full stderr ({} lines):",
                            status,
                            error_lines.len()
                        );
                        for line in &error_lines {
                            eprintln!("[export]   | {}", line);
                        }
                        // Find the most-informative error line: prefer the
                        // first one containing "Error" / "Invalid" / "not
                        // found" rather than the last (often a generic
                        // "Conversion failed").
                        let informative = error_lines.iter().find(|l| {
                            let lower = l.to_lowercase();
                            lower.contains("error") || lower.contains("invalid")
                                || lower.contains("not found") || lower.contains("no such")
                        });
                        error_msg = Some(
                            informative
                                .or_else(|| error_lines.last())
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
        state.filter_script = None;
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
        state.filter_script = None;
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
