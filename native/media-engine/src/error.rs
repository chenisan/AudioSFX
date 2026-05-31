use thiserror::Error;

#[derive(Debug, Error)]
pub enum MediaError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("symphonia error: {0}")]
    Symphonia(#[from] symphonia::core::errors::Error),

    #[error("no audio track found")]
    NoAudioTrack,

    #[error("ffprobe failed: {0}")]
    Ffprobe(String),

    #[error("ffmpeg failed: {0}")]
    Ffmpeg(String),

    #[error("invalid argument: {0}")]
    InvalidArg(String),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("unsupported format: {0}")]
    UnsupportedFormat(String),

    #[error("resampler error: {0}")]
    Resampler(String),

    #[error("wav writer error: {0}")]
    Wav(String),
}

impl From<rubato::ResamplerConstructionError> for MediaError {
    fn from(err: rubato::ResamplerConstructionError) -> Self {
        MediaError::Resampler(err.to_string())
    }
}

impl From<rubato::ResampleError> for MediaError {
    fn from(err: rubato::ResampleError) -> Self {
        MediaError::Resampler(err.to_string())
    }
}

impl From<hound::Error> for MediaError {
    fn from(err: hound::Error) -> Self {
        MediaError::Wav(err.to_string())
    }
}

impl From<MediaError> for napi::Error {
    fn from(err: MediaError) -> Self {
        napi::Error::from_reason(err.to_string())
    }
}
