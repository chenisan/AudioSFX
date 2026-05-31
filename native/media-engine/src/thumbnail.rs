use std::path::Path;
use std::process::{Command, Stdio};

use napi_derive::napi;
use rayon::prelude::*;
use serde::Deserialize;
use serde_json::json;

use crate::error::MediaError;

#[napi(object)]
pub struct ThumbnailManifest {
    pub duration_sec: f64,
    pub count: u32,
    pub width: u32,
    pub height: u32,
    pub files: Vec<String>,
    pub output_dir: String,
}

#[napi]
pub fn generate_thumbnails(
    video_path: String,
    output_dir: String,
    ffmpeg_path: String,
    ffprobe_path: String,
    height: u32,
) -> napi::Result<ThumbnailManifest> {
    Ok(do_generate(
        &video_path,
        &output_dir,
        &ffmpeg_path,
        &ffprobe_path,
        height,
    )?)
}

fn do_generate(
    video_path: &str,
    output_dir: &str,
    ffmpeg_path: &str,
    ffprobe_path: &str,
    thumb_height: u32,
) -> Result<ThumbnailManifest, MediaError> {
    if thumb_height == 0 {
        return Err(MediaError::InvalidArg("height must be > 0".into()));
    }

    let probe = probe_source(ffprobe_path, video_path)?;
    let duration_sec = probe.duration;
    let source_w = probe.width;
    let source_h = probe.height;

    // Dynamic count: 1 thumbnail per 2s, clamped to [10, 200].
    let count = ((duration_sec / 2.0).round() as i64).clamp(10, 200) as u32;

    // Preserve aspect ratio, round width to even number (JPEG friendly).
    let thumb_width = if source_h > 0 {
        let w = (source_w as f64 * thumb_height as f64 / source_h as f64).round() as u32;
        (w / 2) * 2
    } else {
        thumb_height * 16 / 9
    }
    .max(2);

    std::fs::create_dir_all(output_dir)?;

    // rayon parallel ffmpeg extraction
    let results: Vec<Result<String, MediaError>> = (0..count)
        .into_par_iter()
        .map(|i| {
            let t = duration_sec * (i as f64 + 0.5) / count as f64;
            let filename = format!("thumb_{:04}.jpg", i);
            let out_path = Path::new(output_dir).join(&filename);

            let status = Command::new(ffmpeg_path)
                .args([
                    "-y",
                    "-ss",
                    &format!("{:.3}", t),
                    "-i",
                    video_path,
                    "-frames:v",
                    "1",
                    "-vf",
                    &format!("scale={}:{}", thumb_width, thumb_height),
                    "-q:v",
                    "4",
                ])
                .arg(&out_path)
                .stderr(Stdio::null())
                .stdout(Stdio::null())
                .status()
                .map_err(|e| MediaError::Ffmpeg(format!("spawn ffmpeg: {e}")))?;

            if !status.success() {
                return Err(MediaError::Ffmpeg(format!(
                    "ffmpeg failed at t={t:.3} (idx={i})"
                )));
            }

            Ok(filename)
        })
        .collect();

    let mut files: Vec<String> = Vec::with_capacity(count as usize);
    for r in results {
        files.push(r?);
    }

    // Write manifest.json next to the thumbnails for direct HTTP consumers.
    let manifest_json = json!({
        "durationSec": duration_sec,
        "count": count,
        "width": thumb_width,
        "height": thumb_height,
        "files": files,
    });
    std::fs::write(
        Path::new(output_dir).join("manifest.json"),
        serde_json::to_string(&manifest_json)?,
    )?;

    Ok(ThumbnailManifest {
        duration_sec,
        count,
        width: thumb_width,
        height: thumb_height,
        files,
        output_dir: output_dir.to_string(),
    })
}

struct ProbeInfo {
    duration: f64,
    width: u32,
    height: u32,
}

#[derive(Deserialize)]
struct FfprobeOutput {
    streams: Vec<FfprobeStream>,
    format: FfprobeFormat,
}

#[derive(Deserialize)]
struct FfprobeStream {
    #[serde(default)]
    width: u32,
    #[serde(default)]
    height: u32,
}

#[derive(Deserialize)]
struct FfprobeFormat {
    duration: String,
}

fn probe_source(ffprobe_path: &str, video_path: &str) -> Result<ProbeInfo, MediaError> {
    let output = Command::new(ffprobe_path)
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            "-select_streams",
            "v:0",
            video_path,
        ])
        .output()
        .map_err(|e| MediaError::Ffprobe(format!("spawn ffprobe: {e}")))?;

    if !output.status.success() {
        return Err(MediaError::Ffprobe(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    let parsed: FfprobeOutput = serde_json::from_slice(&output.stdout)?;
    let stream = parsed
        .streams
        .into_iter()
        .next()
        .ok_or_else(|| MediaError::Ffprobe("no video stream".into()))?;
    let duration: f64 = parsed
        .format
        .duration
        .parse()
        .map_err(|e| MediaError::Ffprobe(format!("parse duration: {e}")))?;

    Ok(ProbeInfo {
        duration,
        width: stream.width,
        height: stream.height,
    })
}
