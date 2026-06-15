//! Runway ML video_to_video REST client (gen4_aleph).

use serde::Deserialize;

const BASE: &str = "https://api.dev.runwayml.com/v1";
const VERSION: &str = "2024-11-06";

#[derive(Debug, Deserialize)]
pub struct TaskStatus {
    pub status: String,
    #[serde(default)]
    pub progress: Option<f64>,
    #[serde(default)]
    pub output: Vec<String>,
    #[serde(default)]
    pub failure: Option<String>,
}

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

/// Pick the Runway-accepted ratio closest to the segment's aspect.
pub fn closest_ratio(w: u32, h: u32) -> &'static str {
    let aspect = w as f64 / h as f64;
    if aspect > 1.3 {
        "1280:720"
    } else if aspect < 0.77 {
        "720:1280"
    } else {
        "960:960"
    }
}

/// Submit a video_to_video task. Returns the Runway task id.
pub async fn submit(
    api_key: &str,
    video_data_uri: &str,
    prompt_text: &str,
    ratio: &str,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": "gen4_aleph",
        "videoUri": video_data_uri,
        "promptText": prompt_text,
        "ratio": ratio,
    });

    let resp = client()
        .post(format!("{}/video_to_video", BASE))
        .bearer_auth(api_key)
        .header("X-Runway-Version", VERSION)
        .json(&body)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| format!("Runway request failed: {}", e))?;

    let status = resp.status();
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Runway response parse failed: {}", e))?;

    if !status.is_success() {
        let detail = json["error"]
            .as_str()
            .or_else(|| json["message"].as_str())
            .unwrap_or("no detail");
        return Err(match status.as_u16() {
            401 | 403 => format!("Runway rejected the API key ({}): {}", status, detail),
            429 => format!("Runway rate limit hit: {}", detail),
            _ => format!("Runway error {}: {}", status, detail),
        });
    }

    json["id"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "Runway response missing task id".to_string())
}

pub async fn poll(api_key: &str, task_id: &str) -> Result<TaskStatus, String> {
    let resp = client()
        .get(format!("{}/tasks/{}", BASE, task_id))
        .bearer_auth(api_key)
        .header("X-Runway-Version", VERSION)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Runway poll failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Runway poll error: {}", resp.status()));
    }
    resp.json::<TaskStatus>()
        .await
        .map_err(|e| format!("Runway poll parse failed: {}", e))
}

/// Best-effort remote cancel (the local poll loop exits via the cancel flag
/// regardless of whether this succeeds).
pub async fn cancel(api_key: &str, task_id: &str) -> Result<(), String> {
    let _ = client()
        .delete(format!("{}/tasks/{}", BASE, task_id))
        .bearer_auth(api_key)
        .header("X-Runway-Version", VERSION)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
