import ffmpeg from 'fluent-ffmpeg'
import { MediaInfo } from '../core/types'
import { probeMediaNative } from '../core/mediaEngine'

/**
 * Get media metadata. Tries the native Rust probe first (fast, no spawn)
 * and falls back to ffprobe for formats the native probe does not handle
 * (webm/mkv/avi, etc.) or if the native module fails to load.
 */
export function getMediaInfo(filePath: string): Promise<MediaInfo> {
  // Fast path: native probe
  try {
    const info = probeMediaNative(filePath)
    if (info) {
      return Promise.resolve({
        duration: info.duration,
        width: info.width,
        height: info.height,
        fps: info.fps,
        hasAudio: info.hasAudio,
        hasVideo: info.hasVideo,
      })
    }
  } catch {
    // fall through to ffprobe
  }

  // Fallback: fluent-ffmpeg (spawns ffprobe)
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err)

      const videoStream = metadata.streams.find(s => s.codec_type === 'video')
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio')

      const duration = parseFloat(String(metadata.format.duration ?? 0))

      let fps = 30
      if (videoStream?.r_frame_rate) {
        const parts = videoStream.r_frame_rate.split('/')
        if (parts.length === 2) {
          fps = parseInt(parts[0]) / parseInt(parts[1])
        }
      }

      resolve({
        duration,
        width: videoStream?.width ?? 0,
        height: videoStream?.height ?? 0,
        fps,
        hasAudio: !!audioStream,
        hasVideo: !!videoStream,
      })
    })
  })
}
