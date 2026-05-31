use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use napi_derive::napi;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::error::MediaError;

#[napi(object)]
pub struct MediaInfo {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub has_audio: bool,
    pub has_video: bool,
}

#[napi]
pub fn probe_media(path: String) -> napi::Result<Option<MediaInfo>> {
    Ok(do_probe(&path)?)
}

fn do_probe(path: &str) -> Result<Option<MediaInfo>, MediaError> {
    let ext = Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "mp4" | "mov" | "m4v" | "m4a" => Ok(Some(probe_mp4_fast(path)?)),
        "mp3" | "wav" | "aac" | "flac" | "ogg" | "oga" | "opus" => {
            Ok(Some(probe_audio(path, &ext)?))
        }
        _ => Ok(None),
    }
}

// ───── Minimal MP4 atom parser ─────
// Walks only moov -> mvhd + trak(tkhd, mdia/hdlr). Skips stbl entirely
// (which is what makes the `mp4` crate slow on long videos).

struct Mp4Probe {
    file: File,
}

/// Read the next box header at the current file position.
/// Returns (box_type, payload_start, payload_end).
fn read_box_header(file: &mut File, end_limit: u64) -> Result<Option<([u8; 4], u64, u64)>, MediaError> {
    let pos = file.stream_position()?;
    if pos + 8 > end_limit {
        return Ok(None);
    }
    let mut header = [0u8; 8];
    if file.read(&mut header)? < 8 {
        return Ok(None);
    }
    let mut size = u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as u64;
    let box_type = [header[4], header[5], header[6], header[7]];
    let mut header_len = 8u64;

    if size == 1 {
        let mut ext = [0u8; 8];
        file.read_exact(&mut ext)?;
        size = u64::from_be_bytes(ext);
        header_len = 16;
    } else if size == 0 {
        size = end_limit - pos;
    }

    if size < header_len || pos + size > end_limit {
        return Ok(None);
    }

    Ok(Some((box_type, pos + header_len, pos + size)))
}

impl Mp4Probe {
    fn new(path: &str) -> Result<Self, MediaError> {
        Ok(Self { file: File::open(path)? })
    }

    fn parse(&mut self) -> Result<MediaInfo, MediaError> {
        let file_len = self.file.metadata()?.len();
        let mut info = MediaInfo {
            duration: 0.0,
            width: 0,
            height: 0,
            fps: 0.0,
            has_audio: false,
            has_video: false,
        };

        self.file.seek(SeekFrom::Start(0))?;
        // Walk root level, find moov
        loop {
            let pos = self.file.stream_position()?;
            let next = read_box_header(&mut self.file, file_len)?;
            match next {
                Some((box_type, payload_start, payload_end)) => {
                    if &box_type == b"moov" {
                        self.parse_moov(payload_start, payload_end, &mut info)?;
                        break;
                    }
                    self.file.seek(SeekFrom::Start(payload_end))?;
                    if payload_end <= pos {
                        break;
                    }
                }
                None => break,
            }
        }

        Ok(info)
    }

    fn parse_moov(&mut self, start: u64, end: u64, info: &mut MediaInfo) -> Result<(), MediaError> {
        self.file.seek(SeekFrom::Start(start))?;
        loop {
            let pos = self.file.stream_position()?;
            if pos >= end {
                break;
            }
            let next = read_box_header(&mut self.file, end)?;
            match next {
                Some((box_type, payload_start, payload_end)) => {
                    match &box_type {
                        b"mvhd" => self.parse_mvhd(payload_start, info)?,
                        b"trak" => self.parse_trak(payload_start, payload_end, info)?,
                        _ => {}
                    }
                    self.file.seek(SeekFrom::Start(payload_end))?;
                    if payload_end <= pos {
                        break;
                    }
                }
                None => break,
            }
        }
        Ok(())
    }

    fn parse_trak(&mut self, start: u64, end: u64, info: &mut MediaInfo) -> Result<(), MediaError> {
        let mut width = 0u32;
        let mut height = 0u32;
        let mut track_type: Option<[u8; 4]> = None;

        self.file.seek(SeekFrom::Start(start))?;
        loop {
            let pos = self.file.stream_position()?;
            if pos >= end {
                break;
            }
            let next = read_box_header(&mut self.file, end)?;
            match next {
                Some((box_type, payload_start, payload_end)) => {
                    match &box_type {
                        b"tkhd" => {
                            let (w, h) = self.parse_tkhd(payload_start)?;
                            width = w;
                            height = h;
                        }
                        b"mdia" => {
                            track_type = self.find_hdlr_in_mdia(payload_start, payload_end)?;
                        }
                        _ => {}
                    }
                    self.file.seek(SeekFrom::Start(payload_end))?;
                    if payload_end <= pos {
                        break;
                    }
                }
                None => break,
            }
        }

        match track_type.as_ref() {
            Some(t) if t == b"vide" => {
                info.has_video = true;
                if width * height > info.width * info.height {
                    info.width = width;
                    info.height = height;
                }
            }
            Some(t) if t == b"soun" => {
                info.has_audio = true;
            }
            _ => {}
        }
        Ok(())
    }

    fn find_hdlr_in_mdia(&mut self, start: u64, end: u64) -> Result<Option<[u8; 4]>, MediaError> {
        self.file.seek(SeekFrom::Start(start))?;
        loop {
            let pos = self.file.stream_position()?;
            if pos >= end {
                break;
            }
            let next = read_box_header(&mut self.file, end)?;
            match next {
                Some((box_type, payload_start, payload_end)) => {
                    if &box_type == b"hdlr" {
                        return Ok(Some(self.parse_hdlr(payload_start)?));
                    }
                    self.file.seek(SeekFrom::Start(payload_end))?;
                    if payload_end <= pos {
                        break;
                    }
                }
                None => break,
            }
        }
        Ok(None)
    }

    fn parse_mvhd(&mut self, start: u64, info: &mut MediaInfo) -> Result<(), MediaError> {
        self.file.seek(SeekFrom::Start(start))?;
        let mut ver_flags = [0u8; 4];
        self.file.read_exact(&mut ver_flags)?;
        let version = ver_flags[0];

        let (timescale, duration) = if version == 1 {
            self.file.seek(SeekFrom::Current(16))?; // creation(8) + modification(8)
            let mut ts = [0u8; 4];
            self.file.read_exact(&mut ts)?;
            let mut dur = [0u8; 8];
            self.file.read_exact(&mut dur)?;
            (u32::from_be_bytes(ts), u64::from_be_bytes(dur))
        } else {
            self.file.seek(SeekFrom::Current(8))?; // creation(4) + modification(4)
            let mut ts = [0u8; 4];
            self.file.read_exact(&mut ts)?;
            let mut dur = [0u8; 4];
            self.file.read_exact(&mut dur)?;
            (u32::from_be_bytes(ts), u32::from_be_bytes(dur) as u64)
        };

        if timescale > 0 {
            info.duration = duration as f64 / timescale as f64;
        }
        Ok(())
    }

    fn parse_tkhd(&mut self, start: u64) -> Result<(u32, u32), MediaError> {
        self.file.seek(SeekFrom::Start(start))?;
        let mut ver_flags = [0u8; 4];
        self.file.read_exact(&mut ver_flags)?;
        let version = ver_flags[0];

        // After version+flags(4 already read):
        // v0: creation(4)+modification(4)+track_id(4)+reserved(4)+duration(4)+reserved(8)
        //     +layer(2)+alt_group(2)+volume(2)+reserved(2)+matrix(36) = 72 bytes before width/height
        // v1: creation(8)+modification(8)+track_id(4)+reserved(4)+duration(8)+reserved(8)
        //     +layer(2)+alt_group(2)+volume(2)+reserved(2)+matrix(36) = 84 bytes before width/height
        let skip = if version == 1 { 84 } else { 72 };
        self.file.seek(SeekFrom::Current(skip))?;

        let mut w_buf = [0u8; 4];
        self.file.read_exact(&mut w_buf)?;
        let mut h_buf = [0u8; 4];
        self.file.read_exact(&mut h_buf)?;

        // 32-bit fixed point 16.16 — upper 16 bits are integer part
        let width = u32::from_be_bytes(w_buf) >> 16;
        let height = u32::from_be_bytes(h_buf) >> 16;
        Ok((width, height))
    }

    fn parse_hdlr(&mut self, start: u64) -> Result<[u8; 4], MediaError> {
        self.file.seek(SeekFrom::Start(start))?;
        // version(1) + flags(3) + pre_defined(4) + handler_type(4)
        let mut buf = [0u8; 12];
        self.file.read_exact(&mut buf)?;
        Ok([buf[8], buf[9], buf[10], buf[11]])
    }
}

fn probe_mp4_fast(path: &str) -> Result<MediaInfo, MediaError> {
    let mut probe = Mp4Probe::new(path)?;
    probe.parse()
}

// ───── Audio probing via symphonia ─────

fn probe_audio(path: &str, ext: &str) -> Result<MediaInfo, MediaError> {
    let file = File::open(path)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    hint.with_extension(ext);

    let probed = symphonia::default::get_probe().format(
        &hint,
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    )?;

    let format = probed.format;
    let track = format
        .default_track()
        .or_else(|| format.tracks().first())
        .ok_or(MediaError::NoAudioTrack)?;

    let params = &track.codec_params;
    let sample_rate = params.sample_rate.unwrap_or(0) as f64;
    let n_frames = params.n_frames.unwrap_or(0) as f64;
    let duration = if sample_rate > 0.0 {
        n_frames / sample_rate
    } else {
        0.0
    };

    Ok(MediaInfo {
        duration,
        width: 0,
        height: 0,
        fps: 0.0,
        has_audio: true,
        has_video: false,
    })
}
