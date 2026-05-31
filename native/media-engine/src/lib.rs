#![deny(clippy::all)]

mod error;
mod waveform;
mod thumbnail;
mod probe;
mod audio_convert;

use napi_derive::napi;

pub use waveform::{WaveformData, generate_waveform};
pub use thumbnail::{ThumbnailManifest, generate_thumbnails};
pub use probe::{MediaInfo, probe_media};
pub use audio_convert::{AudioConvertResult, extract_audio_wav};

#[napi]
pub fn hello(name: String) -> String {
    format!("Hello from media-engine, {}!", name)
}
