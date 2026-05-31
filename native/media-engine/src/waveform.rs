use std::fs::File;
use std::path::Path;

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::error::MediaError;

#[napi(object)]
pub struct WaveformData {
    pub sample_rate: u32,
    pub duration_sec: f64,
    pub channels: u32,
    pub bucket_count: u32,
    /// Interleaved i16 min/max pairs (little-endian bytes).
    /// Length = bucket_count * 2 (pairs) * 2 (bytes per i16) = bucket_count * 4 bytes.
    pub peaks: Buffer,
}

#[napi]
pub fn generate_waveform(audio_path: String, buckets: u32) -> napi::Result<WaveformData> {
    if buckets == 0 {
        return Err(MediaError::InvalidArg("buckets must be > 0".into()).into());
    }
    Ok(decode_waveform(&audio_path, buckets)?)
}

fn decode_waveform(audio_path: &str, buckets: u32) -> Result<WaveformData, MediaError> {
    let file = File::open(audio_path)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = Path::new(audio_path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe().format(
        &hint,
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    )?;

    let mut format = probed.format;

    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or(MediaError::NoAudioTrack)?;

    let track_id = track.id;
    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| MediaError::InvalidArg("no sample rate".into()))?;
    let channels = track
        .codec_params
        .channels
        .map(|c| c.count() as u32)
        .unwrap_or(1)
        .max(1);
    let total_frames = track
        .codec_params
        .n_frames
        .ok_or_else(|| MediaError::InvalidArg("unknown track duration".into()))?;

    let duration_sec = total_frames as f64 / sample_rate as f64;
    let frames_per_bucket = ((total_frames as f64 / buckets as f64).ceil() as usize).max(1);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())?;

    let mut peaks: Vec<i16> = Vec::with_capacity(buckets as usize * 2);
    let mut bucket_min: f32 = f32::INFINITY;
    let mut bucket_max: f32 = f32::NEG_INFINITY;
    let mut bucket_frame_count: usize = 0;
    let mut sample_buf: Option<SampleBuffer<f32>> = None;
    let ch = channels as usize;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(SymphoniaError::ResetRequired) => break,
            Err(e) => return Err(e.into()),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(e) => return Err(e.into()),
        };

        if sample_buf.is_none() {
            let spec = *decoded.spec();
            let duration = decoded.capacity() as u64;
            sample_buf = Some(SampleBuffer::<f32>::new(duration, spec));
        }

        let buf = sample_buf.as_mut().unwrap();
        buf.copy_interleaved_ref(decoded);

        for frame in buf.samples().chunks_exact(ch) {
            let mut sum = 0.0f32;
            for &s in frame {
                sum += s;
            }
            let mean = sum / ch as f32;

            if mean < bucket_min {
                bucket_min = mean;
            }
            if mean > bucket_max {
                bucket_max = mean;
            }
            bucket_frame_count += 1;

            if bucket_frame_count >= frames_per_bucket {
                peaks.push(to_i16(bucket_min));
                peaks.push(to_i16(bucket_max));
                bucket_min = f32::INFINITY;
                bucket_max = f32::NEG_INFINITY;
                bucket_frame_count = 0;
            }
        }
    }

    // Flush trailing partial bucket.
    if bucket_frame_count > 0 && bucket_min.is_finite() {
        peaks.push(to_i16(bucket_min));
        peaks.push(to_i16(bucket_max));
    }

    // Pad / truncate to exact bucket count for predictable buffer size.
    let target_len = buckets as usize * 2;
    peaks.resize(target_len, 0);

    let mut bytes: Vec<u8> = Vec::with_capacity(peaks.len() * 2);
    for p in &peaks {
        bytes.extend_from_slice(&p.to_le_bytes());
    }

    Ok(WaveformData {
        sample_rate,
        duration_sec,
        channels,
        bucket_count: buckets,
        peaks: Buffer::from(bytes),
    })
}

fn to_i16(f: f32) -> i16 {
    let clamped = f.clamp(-1.0, 1.0);
    (clamped * i16::MAX as f32) as i16
}
