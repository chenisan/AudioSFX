use std::fs::File;
use std::path::Path;

use napi_derive::napi;

use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};

use hound::{SampleFormat, WavSpec, WavWriter};

use crate::error::MediaError;

#[napi(object)]
pub struct AudioConvertResult {
    /// Source file duration in seconds
    pub duration_sec: f64,
    /// Source sample rate (Hz)
    pub source_sample_rate: u32,
    /// Source channel count
    pub source_channels: u32,
    /// Target sample rate (Hz)
    pub target_sample_rate: u32,
    /// Target channel count
    pub target_channels: u32,
    /// Output WAV sample count (per channel)
    pub output_frames: u32,
}

/// Decode an audio/video file and write a PCM16 WAV at the requested rate/channels.
/// Currently supports `target_channels = 1` (mono) — multi-channel output not needed for whisper.
#[napi]
pub fn extract_audio_wav(
    input_path: String,
    output_path: String,
    target_sample_rate: u32,
    target_channels: u32,
) -> napi::Result<AudioConvertResult> {
    Ok(do_extract(&input_path, &output_path, target_sample_rate, target_channels)?)
}

fn do_extract(
    input_path: &str,
    output_path: &str,
    target_rate: u32,
    target_channels: u32,
) -> Result<AudioConvertResult, MediaError> {
    if target_channels != 1 {
        return Err(MediaError::InvalidArg(
            "only mono (target_channels=1) is supported".into(),
        ));
    }
    if target_rate == 0 {
        return Err(MediaError::InvalidArg("target_sample_rate must be > 0".into()));
    }

    // ── Decode via symphonia ───────────────────────────────
    let file = File::open(input_path)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = Path::new(input_path).extension().and_then(|e| e.to_str()) {
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
    let source_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| MediaError::InvalidArg("no sample rate".into()))?;
    let source_channels = track
        .codec_params
        .channels
        .map(|c| c.count() as u32)
        .unwrap_or(1)
        .max(1);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())?;

    // Downmix to mono f32 samples, accumulated in memory
    let mut mono: Vec<f32> = Vec::new();
    let mut total_frames: u64 = 0;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
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

        append_mono_f32(decoded, &mut mono, &mut total_frames);
    }

    let duration_sec = total_frames as f64 / source_rate as f64;

    // ── Resample if needed ────────────────────────────────
    let resampled: Vec<f32> = if source_rate == target_rate {
        mono
    } else {
        resample_sinc(&mono, source_rate, target_rate)?
    };

    // ── Write PCM16 WAV ───────────────────────────────────
    let spec = WavSpec {
        channels: 1,
        sample_rate: target_rate,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };
    let mut writer = WavWriter::create(output_path, spec)?;
    for s in &resampled {
        let clamped = s.clamp(-1.0, 1.0);
        let int_sample = (clamped * 32767.0).round() as i16;
        writer.write_sample(int_sample)?;
    }
    writer.finalize()?;

    Ok(AudioConvertResult {
        duration_sec,
        source_sample_rate: source_rate,
        source_channels,
        target_sample_rate: target_rate,
        target_channels: 1,
        output_frames: resampled.len() as u32,
    })
}

/// Append decoded audio frames as mono f32 samples (averaging channels).
fn append_mono_f32(decoded: AudioBufferRef<'_>, out: &mut Vec<f32>, total_frames: &mut u64) {
    match decoded {
        AudioBufferRef::F32(buf) => {
            let frames = buf.frames();
            let spec = buf.spec();
            let ch_count = spec.channels.count();
            out.reserve(frames);
            if ch_count == 1 {
                for &s in buf.chan(0).iter().take(frames) {
                    out.push(s);
                }
            } else {
                for f in 0..frames {
                    let mut sum = 0.0f32;
                    for c in 0..ch_count {
                        sum += buf.chan(c)[f];
                    }
                    out.push(sum / ch_count as f32);
                }
            }
            *total_frames += frames as u64;
        }
        AudioBufferRef::S16(buf) => {
            let frames = buf.frames();
            let spec = buf.spec();
            let ch_count = spec.channels.count();
            out.reserve(frames);
            const INV: f32 = 1.0 / 32768.0;
            if ch_count == 1 {
                for &s in buf.chan(0).iter().take(frames) {
                    out.push(s as f32 * INV);
                }
            } else {
                for f in 0..frames {
                    let mut sum = 0.0f32;
                    for c in 0..ch_count {
                        sum += buf.chan(c)[f] as f32 * INV;
                    }
                    out.push(sum / ch_count as f32);
                }
            }
            *total_frames += frames as u64;
        }
        AudioBufferRef::S32(buf) => {
            let frames = buf.frames();
            let spec = buf.spec();
            let ch_count = spec.channels.count();
            out.reserve(frames);
            const INV: f32 = 1.0 / 2147483648.0;
            if ch_count == 1 {
                for &s in buf.chan(0).iter().take(frames) {
                    out.push(s as f32 * INV);
                }
            } else {
                for f in 0..frames {
                    let mut sum = 0.0f32;
                    for c in 0..ch_count {
                        sum += buf.chan(c)[f] as f32 * INV;
                    }
                    out.push(sum / ch_count as f32);
                }
            }
            *total_frames += frames as u64;
        }
        AudioBufferRef::U8(buf) => {
            let frames = buf.frames();
            let spec = buf.spec();
            let ch_count = spec.channels.count();
            out.reserve(frames);
            const INV: f32 = 1.0 / 128.0;
            if ch_count == 1 {
                for &s in buf.chan(0).iter().take(frames) {
                    out.push((s as f32 - 128.0) * INV);
                }
            } else {
                for f in 0..frames {
                    let mut sum = 0.0f32;
                    for c in 0..ch_count {
                        sum += (buf.chan(c)[f] as f32 - 128.0) * INV;
                    }
                    out.push(sum / ch_count as f32);
                }
            }
            *total_frames += frames as u64;
        }
        AudioBufferRef::U16(buf) => {
            let frames = buf.frames();
            let spec = buf.spec();
            let ch_count = spec.channels.count();
            out.reserve(frames);
            const INV: f32 = 1.0 / 32768.0;
            if ch_count == 1 {
                for &s in buf.chan(0).iter().take(frames) {
                    out.push((s as f32 - 32768.0) * INV);
                }
            } else {
                for f in 0..frames {
                    let mut sum = 0.0f32;
                    for c in 0..ch_count {
                        sum += (buf.chan(c)[f] as f32 - 32768.0) * INV;
                    }
                    out.push(sum / ch_count as f32);
                }
            }
            *total_frames += frames as u64;
        }
        AudioBufferRef::U32(buf) => {
            let frames = buf.frames();
            let spec = buf.spec();
            let ch_count = spec.channels.count();
            out.reserve(frames);
            const INV: f32 = 1.0 / 2147483648.0;
            if ch_count == 1 {
                for &s in buf.chan(0).iter().take(frames) {
                    out.push((s as f32 - 2147483648.0) * INV);
                }
            } else {
                for f in 0..frames {
                    let mut sum = 0.0f32;
                    for c in 0..ch_count {
                        sum += (buf.chan(c)[f] as f32 - 2147483648.0) * INV;
                    }
                    out.push(sum / ch_count as f32);
                }
            }
            *total_frames += frames as u64;
        }
        _ => {
            // Other formats (F64, S8, S24, U24) — unsupported for now
        }
    }
}

/// Sinc resampler (Kaiser window) — high quality, fixed chunk size
fn resample_sinc(input: &[f32], source_rate: u32, target_rate: u32) -> Result<Vec<f32>, MediaError> {
    let ratio = target_rate as f64 / source_rate as f64;
    let chunk_size = 1024usize;

    let params = SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 160,
        window: WindowFunction::BlackmanHarris2,
    };

    let mut resampler = SincFixedIn::<f32>::new(ratio, 2.0, params, chunk_size, 1)?;

    let mut out: Vec<f32> = Vec::with_capacity(((input.len() as f64) * ratio) as usize + chunk_size);
    let mut pos = 0usize;

    // Process full chunks
    while pos + chunk_size <= input.len() {
        let frame_in = vec![input[pos..pos + chunk_size].to_vec()];
        let frame_out = resampler.process(&frame_in, None)?;
        out.extend_from_slice(&frame_out[0]);
        pos += chunk_size;
    }

    // Final partial chunk — pad with zeros to keep fixed-size input
    if pos < input.len() {
        let mut tail = vec![0.0f32; chunk_size];
        let remaining = input.len() - pos;
        tail[..remaining].copy_from_slice(&input[pos..]);
        let frame_in = vec![tail];
        let frame_out = resampler.process(&frame_in, None)?;
        let expected = ((remaining as f64) * ratio).round() as usize;
        let take = expected.min(frame_out[0].len());
        out.extend_from_slice(&frame_out[0][..take]);
    }

    Ok(out)
}
