export interface TextStyle {
  fontFamily?: string
  fontSize?: number
  fontWeight?: string
  color?: string
  strokeColor?: string
  strokeWidth?: number
  shadow?: {
    color?: string
    offsetX?: number
    offsetY?: number
    blur?: number
  }
  position?: {
    x: string | number
    y: string | number
    anchor?: string
  }
  background?: {
    enabled?: boolean
    color?: string
    opacity?: number
    padding?: number
    borderRadius?: number
  }
  animation?: {
    in?: string   // none | fade-in | slide-up | slide-left | typewriter
    out?: string  // none | fade-out | slide-down
    inDuration?: number
    outDuration?: number
  }
  emoji?: {
    before?: string
    after?: string
  }
}

export interface TextSegment {
  kind?: 'text'
  text: string
  start: number
  end: number
  track?: number
  style?: TextStyle
}

export type BlendMode = 'normal' | 'add' | 'screen' | 'overlay' | 'softlight' | 'multiply'

export interface Keyframe {
  time: number   // seconds, relative to clip start
  value: number
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
}

export interface VideoOverlay {
  // x/y/width/height are CANVAS FRACTIONS (0..1), NOT pixels. Negative values
  // and values > 1 are valid — they place the clip partly or fully outside
  // the visible canvas (preview clips via overflow:hidden, ffmpeg overlay
  // accepts negative offsets natively). Default undefined = full canvas.
  x?: number             // canvas fraction from left
  y?: number             // canvas fraction from top
  width?: number         // canvas fraction (1 = full width)
  height?: number        // canvas fraction (1 = full height)
  opacity?: number       // 0–1; applied via format=rgba + colorchannelmixer
  blendMode?: BlendMode  // compositing blend mode (default 'normal' = overlay filter)
  // [RENDER] Animated position. Keyframe `value` is a canvas fraction (same
  // unit as static x/y above). When set (length > 0), overrides the static
  // x / y. Times are clip-relative (0 = clip start).
  xKF?: Keyframe[]
  yKF?: Keyframe[]
}

export interface VideoCrop {
  scale: number    // 1 = no zoom, 2 = 200%, etc.
  x: number        // horizontal offset in % (-50 to 50, 0 = center)
  y: number        // vertical offset in % (-50 to 50, 0 = center)
  top?: number     // crop inset from top in % (0-45)
  bottom?: number  // crop inset from bottom in % (0-45)
  left?: number    // crop inset from left in % (0-45)
  right?: number   // crop inset from right in % (0-45)
}

export interface FadeEffect {
  type?: string
  color?: string | null
  duration: number
}

// VideoSegment fields are tagged with their relationship to the render
// pipeline so the render contract is explicit:
//   [RENDER]    — read by ffmpegBuilder / transitionBuilder; affects output
//   [TRANSPORT] — passed through but not consumed by render (UI / linking)
// When adding a field, decide which tag applies. RENDER fields need migration
// thinking; TRANSPORT fields can change shape more freely.
export interface VideoSegment {
  kind?: 'video'
  source: string                   // [RENDER] file under project assets/, or '' for AI script clips awaiting publish
  start: number                    // [RENDER] timeline position (sec)
  end: number                      // [RENDER] timeline position (sec)
  trimStart?: number               // [RENDER] inside-source trim (sec)
  trimEnd?: number                 // [RENDER] inside-source trim (sec)
  speed?: number                   // [RENDER] playback speed multiplier (0.25–4, default 1). Applied via setpts (video) + atempo (audio, pitch-preserving). Timeline duration = (trimEnd-trimStart)/speed.
  volume?: number                  // [RENDER] audio gain 0–2
  muted?: boolean                  // [RENDER] mute embedded audio
  fadeIn?: FadeEffect | null       // [RENDER] start-of-clip audio fade duration
  fadeOut?: FadeEffect | null      // [RENDER] end-of-clip audio fade duration
  transition?: {                   // [RENDER] clip-to-clip xfade
    type: 'none' | 'crossfade' | 'fade-black' | 'wipe'
    duration: number
  }
  filter?: {                       // [RENDER] colour grade (vintage/cool/warm/bw/glow)
    type: 'none' | 'vintage' | 'cool' | 'warm' | 'bw' | 'glow'
    intensity?: number
  }
  crop?: VideoCrop                 // [RENDER] static zoom/pan; superseded by overlay-drag UX, kept for legacy projects
  scaleAnim?: {                    // [RENDER] Ken Burns animated zoom (overrides crop.scale during clip)
    fromScale: number
    toScale: number
    duration?: number
    easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
  } | null
  overlay?: VideoOverlay           // [RENDER] canvas-fraction position/size; main + overlay tracks
  opacityKF?: Keyframe[]           // [RENDER] animated opacity 0–1 (main + overlay tracks)
  colorFill?: string               // [RENDER] hex color (e.g. '#000000'); if set, clip is a solid color background (source ignored)
  objectFit?: 'contain' | 'cover' | 'fill'  // [RENDER] how the asset fills the overlay rect (default 'fill'). Premiere transform: 'fill' stretches the asset to the rect (transform box always hugs the asset, free-resize friendly); 'cover' fills the rect and crops; 'contain' letterboxes. The rect itself is whatever the user dragged.
  sourceDuration?: number          // [TRANSPORT] full duration of the source file (sec); UI uses it to clamp resize-end. Without it the drag handle has no upper bound. Set by import + AI publish paths.
  aiScriptRef?: string             // [TRANSPORT] links to AI script asset; consumed by UI publish flow, not render
}

export interface AiScriptAsset {
  id: string
  name: string
  previewFilename: string | null   // filename in assets/ after publish
  previewKind?: 'image' | 'video' | null  // null/missing for legacy data
  createdAt: string
}

// All AudioSegment fields are [RENDER] — the segment exists only to feed the
// audio graph. If you need to attach UI-only metadata, do it elsewhere.
export interface AudioSegment {
  kind?: 'audio'
  source: string         // [RENDER]
  start: number          // [RENDER] timeline position (sec)
  end: number            // [RENDER]
  trimStart?: number     // [RENDER]
  trimEnd?: number       // [RENDER]
  speed?: number         // [RENDER] playback speed (0.25–4, default 1). atempo, pitch preserved.
  volume?: number        // [RENDER] gain 0–2
  muted?: boolean        // [RENDER]
  fadeIn?: FadeEffect | null   // [RENDER]
  fadeOut?: FadeEffect | null  // [RENDER]
  volumeKF?: Keyframe[]  // [RENDER] animated volume 0–2
  sourceDuration?: number      // [TRANSPORT] full duration of source file (sec); UI clamp only.
}

export type TrackType = 'video' | 'text' | 'audio' | 'script'

export interface SketchClip {
  kind?: 'sketch'
  assetId: string     // references SketchAsset.id
  lyric: string       // denormalized for quick display
  imagePrompt: string
  pose: PosePreset
  svgFilename: string // ai/sketch-assets/<id>.svg
  start: number
  end: number
}

export type Segment = VideoSegment | TextSegment | AudioSegment | SketchClip

// ── Type guards ─────────────────────────────────────────────────────────────
// Use these instead of casting to `any`. Guards rely on the `kind` discriminant
// — `projectManager.getProject()` runs a one-time migration that backfills it
// from track.type, so all segments returned from core code are guaranteed to
// have it set.
//
// `strict: false` in tsconfig means TS will not narrow on `.kind === 'video'`
// directly. Use these `seg is X` predicate helpers — type predicates narrow
// regardless of strict mode.

export function isVideoSegment(seg: Segment): seg is VideoSegment {
  return (seg as any).kind === 'video'
}

export function isTextSegment(seg: Segment): seg is TextSegment {
  return (seg as any).kind === 'text'
}

export function isAudioSegment(seg: Segment): seg is AudioSegment {
  return (seg as any).kind === 'audio'
}

export function isSketchClip(seg: Segment): seg is SketchClip {
  return (seg as any).kind === 'sketch'
}

/** Infer kind from a track type. SketchClip is allowed on `script` tracks. */
export function inferSegmentKind(trackType: TrackType, seg: Segment): 'video' | 'text' | 'audio' | 'sketch' {
  if (trackType === 'audio') return 'audio'
  if (trackType === 'text')  return 'text'
  if (trackType === 'script') return 'sketch'
  // video track: SketchClip can also live here (lyric+svgFilename), tell apart
  if ('assetId' in seg && 'svgFilename' in seg) return 'sketch'
  return 'video'
}

// ── Sketch Asset ─────────────────────────────────────────────────────────────
// Created by the SketchPanel: lyric → AI → pose + imagePrompt → SVG
export interface SketchAsset {
  id: string
  lyric: string
  imagePrompt: string
  mood: string
  pose: PosePreset          // preset name (display / fallback)
  poseData?: StickFigurePose // full joint positions; optional for backward compat
  svgFilename: string       // ai/sketch-assets/<id>.svg
  createdAt: string
}

// Track-level parametric EQ. Applied to every audio source on the track
// (audio clips AND video clips' embedded audio). Preview uses Web Audio
// BiquadFilterNode (audioEngine.js); render uses ffmpeg bass/equalizer/treble
// (ffmpegBuilder.ts). Both follow the Audio EQ Cookbook so freq/gain/Q match.
export type TrackEqBandType = 'lowshelf' | 'peaking' | 'highshelf'
export interface TrackEqBand {
  type: TrackEqBandType
  freq: number   // Hz
  gain: number   // dB (±18)
  q: number      // 0.3–10 (ignored by shelf filters)
}
export interface TrackEq {
  enabled: boolean
  bands: TrackEqBand[]   // fixed 5-band parametric (low-shelf / 3× peaking / high-shelf)
}

// ── Track effect plugins (insert chain) ──────────────────────────────────────
// Each track carrying audio can host an ordered chain of effect plugins, applied
// in array order. EQ is the first member; compressor / limiter follow (Step 2).
// Preview = Web Audio nodes (audioEngine.js); render = ffmpeg filters
// (ffmpegBuilder.ts). Per plugin: `enabled` is the single on/off source of truth
// (the params object holds no enabled flag).
export type TrackPluginType =
  | 'eq' | 'compressor' | 'limiter' | 'reverb'
  | 'delay' | 'distortion' | 'filter' | 'tremolo'
  | 'chorus' | 'flanger' | 'gate' | 'pitch'

export interface EqPluginParams {
  bands: TrackEqBand[]   // fixed 5-band parametric
}
export interface CompressorPluginParams {
  threshold: number   // dB
  ratio: number       // n:1
  attack: number      // ms
  release: number     // ms
  knee: number        // dB
  makeup: number      // dB
}
export interface LimiterPluginParams {
  threshold: number   // dB (ceiling)
  release: number     // ms
}
// FabFilter Pro-R-inspired layout (approximate DSP). predelay ms; space seconds;
// the rest 0–100 %.
export interface ReverbPluginParams {
  predelay: number    // 0–200 ms   (pre-delay before the tail)
  space: number       // 0.2–8 s    (decay time / room size — the big knob)
  character: number   // 0–100 %    (tail density / diffusion)
  brightness: number  // 0–100 %    (high-freq content of the tail)
  thickness: number   // 0–100 %    (low-freq body)
  width: number       // 0–100 %    (stereo spread)
  mix: number         // 0–100 %    (wet / dry)
}
// ── SFX-oriented effects (2026-07). All mirrored preview↔export like the rest. ──
export interface DelayPluginParams {
  time: number       // 1–2000 ms   (echo spacing)
  feedback: number   // 0–95 %      (repeat decay)
  mix: number        // 0–100 %     (wet level)
}
export interface DistortionPluginParams {
  drive: number      // 0–100 %     (pre-gain into the clipper)
  tone: number       // 0–100 %     (post lowpass: dark → bright)
  output: number     // -24–+6 dB   (post gain)
}
export interface FilterPluginParams {
  mode: 'lowpass' | 'highpass' | 'bandpass'
  freq: number       // 20–20000 Hz
  q: number          // 0.1–20
}
export interface TremoloPluginParams {
  rate: number       // 0.1–20 Hz
  depth: number      // 0–100 %
}
export interface ChorusPluginParams {
  rate: number       // 0.1–5 Hz
  depth: number      // 0.5–10 ms   (delay modulation swing)
  mix: number        // 0–100 %
}
export interface FlangerPluginParams {
  rate: number       // 0.1–10 Hz
  depth: number      // 0.1–10 ms
  feedback: number   // 0–90 %      (regen)
  mix: number        // 0–100 %
}
export interface GatePluginParams {
  threshold: number  // -80–0 dB
  ratio: number      // 1–9 (expander slope)
  attack: number     // 0.1–100 ms
  release: number    // 10–1000 ms
}
export interface PitchPluginParams {
  semitones: number  // -12–+12 (tape-style: formants shift with pitch)
}

export type TrackPluginParams =
  | EqPluginParams | CompressorPluginParams | LimiterPluginParams | ReverbPluginParams
  | DelayPluginParams | DistortionPluginParams | FilterPluginParams | TremoloPluginParams
  | ChorusPluginParams | FlangerPluginParams | GatePluginParams | PitchPluginParams

export interface TrackPlugin {
  id: string                   // stable id (used for reorder / remove)
  type: TrackPluginType
  enabled: boolean
  params: TrackPluginParams
}

// Track fields are tagged the same way as VideoSegment:
//   [RENDER]    — affects ffmpeg output
//   [TRANSPORT] — survives to project.yaml but UI-only
export interface Track {
  id: string                                // [TRANSPORT] (referenced from clips)
  type: TrackType                           // [RENDER] (decides which graph branch)
  name: string                              // [TRANSPORT] (only "AI MV 腳本" is special-cased by AI MV pipeline)
  order: number                             // [RENDER] (controls z-order in overlay stack)
  clips: Segment[]                          // [RENDER]
  locked?: boolean                          // [TRANSPORT]
  hidden?: boolean                          // [RENDER] (hidden tracks dropped from graph entirely)
  muted?: boolean                           // [RENDER] (audio dropped, video kept)
  volume?: number                           // [RENDER] track-level audio gain (0–4); multiplies each clip's volume
  eq?: TrackEq                              // [RENDER] DEPRECATED — migrated into `plugins` on load; kept only as migration source
  plugins?: TrackPlugin[]                   // [RENDER] ordered effect insert chain (eq/compressor/limiter); any track carrying audio
  gapMode?: 'black' | 'freeze'              // [RENDER] video tracks only — main-chain gap-fill behaviour
  // ── UI-only persisted preferences — do not grow without explicit reason ──
  heightSize?: 'small' | 'default' | 'large' // [TRANSPORT] timeline row height
}

export interface Timeline {
  tracks: Track[]
}

export interface LegacyTimeline {
  audio?: AudioSegment[]
  video?: VideoSegment[]
  video_2?: VideoSegment[]
  video_3?: VideoSegment[]
  text_1?: TextSegment[]
  text_2?: TextSegment[]
  text_3?: TextSegment[]
  texts?: TextSegment[]
}

export interface Project {
  id: string
  name: string
  duration: number
  resolution?: [number, number]
  aspectRatio?: string   // '9:16' | '16:9' | '1:1' | '4:5' | '4:3'

  // Master-bus brickwall limiter applied to the FINAL mix on export (and mirrored
  // in the Web Audio preview: src/audio/audioEngine.js setMasterLimiter).
  // Missing = { enabled: true, ceilingDb: -1 } (legacy default 防爆 behaviour).
  // ceilingDb → ffmpeg alimiter limit = 10^(ceilingDb/20).
  masterLimiter?: { enabled: boolean; ceilingDb: number }

  timeline: Timeline
  createdAt: string
  updatedAt: string

  // ── Membership / access control ──────────────────────────────────────────
  // Owner's user id (from G1 users table). Set by /api/projects POST from
  // req.user.id. Legacy projects without ownerId get auto-claimed to the
  // bootstrap admin on boot (server/auth/bootstrap.ts).
  // Access rules in requireProjectAccess middleware: admin sees all; everyone
  // else sees only projects where ownerId matches their user id.
  ownerId?: string

  // ── AI MV pipeline ───────────────────────────────────────────────────────
  // Storyboard 不再持久化在 project.yaml；每個 scene 改存為獨立的 AI 腳本素材
  // （data/projects/<id>/ai/scripts/<scriptId>/）。
  characterBible?: CharacterBible[]
  storyboardConfig?: StoryboardConfig

  // ── Export range ─────────────────────────────────────────────────────────
  // null/undefined → render from 0 to contentEnd (latest clip end across tracks).
  // Set value → render only the [in, out] window.
  exportRange?: { in: number; out: number } | null

  // ── UI folder grouping (orthogonal to render) ────────────────────────────
  // Pure organisational metadata so heavy projects don't drown in flat lists.
  // Items can live in 0 or 1 folder; uncategorised items are bucketed
  // automatically by the panel. Renaming/deleting on disk doesn't dereference
  // anything because itemIds are the same stable ids the rest of the project
  // already uses (filename / scriptId / sketchId / trackId). Optional: missing
  // → flat list, no folders.
  folderGroups?: FolderGroups
}

export interface Folder {
  id: string
  name: string
  itemIds: string[]
  collapsed?: boolean   // [TRANSPORT] UI-persisted collapse state
}

export interface FolderGroups {
  asset?:  Folder[]   // itemIds = clip.source filename
  script?: Folder[]   // itemIds = scriptId
  sketch?: Folder[]   // itemIds = sketch asset id
  track?:  Folder[]   // itemIds = track id
}

export type FolderNamespace = keyof FolderGroups

// ── AI MV pipeline types ───────────────────────────────────────────────────
//
// SRT → Scene[] → SVG sketch → AI first frame → Kling video → timeline.
// All scene editing and sketch rendering is local/free; only Claude / OpenAI
// / Kling calls cost money and each is gated by an explicit user button.

export interface CharacterBible {
  id: string
  name: string                 // 主唱、女主角...
  appearance: string           // 全中文外貌描述，直接餵 imagePrompt
  referenceImage?: string      // 路徑 (相對 ai/characters/) ，img-gen 多 ref 用
  promptToken?: string         // 短描述，每次 imagePrompt 自動注入；scenes 中有引用該角色時 sceneToWorkflow 會把它 prepend 進 text-1 的 prompt
  styleHints?: string
  // Locked seed — fixes the random component of image generation so this
  // character's face/body proportions stay closer across scenes. Only used
  // when a scene references exactly ONE character (multi-character scenes
  // pick the first character's seed; user can still override per-script).
  lockedSeed?: number
}

export interface StoryboardConfig {
  lyricsTrackId: string        // 指向某個 type='text' 的 track id
  musicStyle?: string          // "中文抒情" / "K-pop dance" / etc.
  bpm?: number
  imageProvider?: string       // plugin id
  videoProvider?: string       // plugin id
  // When true, after a script's video finishes generating, the executor
  // extracts the last frame and stamps it as the next AI MV script's
  // uploadedStartFrameUrl — gives visual continuity from clip N → N+1
  // without manual frame copying. Off by default.
  chainScripts?: boolean
}

export interface Storyboard {
  scenes: Scene[]
  generatedAt: string          // ISO
  model: string                // claude-opus-4-7 / etc.
  summary: string
  totalDuration: number
}

// 18 個內建 pose preset，加上 'custom_*' 形式的使用者自訂
export type PosePreset =
  | 'standing' | 'walking' | 'running' | 'sitting' | 'lying'
  | 'kneeling' | 'leaning' | 'jumping' | 'falling'
  | 'waving' | 'pointing' | 'hands-up' | 'arms-crossed'
  | 'holding-mic' | 'hugging' | 'dancing' | 'fighting-stance'
  | string  // allow 'custom_*'

export type Joint =
  | 'head' | 'neck'
  | 'leftShoulder' | 'rightShoulder'
  | 'leftElbow' | 'rightElbow'
  | 'leftHand' | 'rightHand'
  | 'pelvis'
  | 'leftKnee' | 'rightKnee'
  | 'leftFoot' | 'rightFoot'

export interface StickFigurePose {
  preset: PosePreset
  position: [number, number]   // 0-1 normalized canvas coords
  scale: number                // 0.5-2
  rotation: number             // -180~180 degrees
  facing: 'front' | 'side-l' | 'side-r' | 'back'
  mirrored: boolean
  joints: Record<Joint, [number, number]>  // 0-1 normalized inside figure box
  actionArrow?: { from: [number, number]; to: [number, number]; curved?: boolean }
  gaze?: 'left' | 'right' | 'up' | 'down' | 'forward'
}

export type SceneStatus =
  | 'pending' | 'storyboarded' | 'sketched'
  | 'framed' | 'rendered' | 'failed'

export type Shot =
  | 'extreme-close-up' | 'close-up' | 'medium' | 'wide' | 'extreme-wide'

export type CameraMovement =
  | 'static' | 'push-in' | 'pull-out'
  | 'pan-left' | 'pan-right' | 'tilt-up' | 'tilt-down'

export interface Scene {
  id: string                   // scene_001
  startSec: number
  endSec: number
  lyrics: string               // 原 SRT cue 文字；間奏為 '(前奏)'/'(間奏)'/'(尾奏)'
  cueIds: number[]             // 對應 SRT cue 編號（1-based），間奏為 []
  isInstrumental: boolean

  // LLM-decided cinematography
  shot: Shot
  subjectPosition: 'left' | 'center' | 'right'
  cameraMovement: CameraMovement
  action: string               // 全中文，物理動作
  background: string           // 全中文
  mood: string                 // 全中文
  emotionShift?: string        // 全中文

  characters: string[]         // CharacterBible.id[]
  poses: Record<string, StickFigurePose>  // characterId → pose

  // Prompts (全中文，使用者可編輯)
  imagePrompt: string
  motionPrompt: string
  negativePrompt: string
  // Rollback originals (Claude 初版)
  _originalImagePrompt?: string
  _originalMotionPrompt?: string
  _originalNegativePrompt?: string
  imagePromptEdited?: boolean
  motionPromptEdited?: boolean

  // 產物路徑（相對 data/projects/<id>/）
  sketchPath?: string          // ai/sketches/scene_xxx.png
  framePath?: string           // ai/frames/scene_xxx.png
  videoPath?: string           // ai/videos/scene_xxx.mp4

  status: SceneStatus
  errorMessage?: string
  jobId?: string               // provider job 識別碼
  cost?: { sketch: number; frame: number; video: number }
}

export type RenderQuality = 'preview' | '720p' | 'high' | '2k' | '4k'

// Portrait short-side base: preview=540, 720p=720, high=1080, 2k=1440, 4k=2160
export const RESOLUTION_MAP: Record<RenderQuality, [number, number]> = {
  preview: [540,  960],
  '720p':  [720,  1280],
  high:    [1080, 1920],
  '2k':    [1440, 2560],
  '4k':    [2160, 3840],
}

/** 根據 aspectRatio + quality 決定輸出解析度（寬 x 高） */
export function resolveResolution(aspectRatio: string | undefined, quality: RenderQuality): [number, number] {
  const [pw, ph] = RESOLUTION_MAP[quality] ?? RESOLUTION_MAP.high  // portrait base
  const ratio: Record<string, [number, number]> = {
    '9:16': [pw, ph],
    '16:9': [ph, pw],   // 交換寬高
    '1:1':  [pw, pw],
    '4:5':  [pw, Math.round(pw * 5 / 4)],
    '4:3':  [Math.round(ph * 4 / 3), ph],
    '3:4':  [pw, Math.round(pw * 4 / 3)],
  }
  return ratio[aspectRatio ?? '9:16'] ?? [pw, ph]
}

export interface RenderOptions {
  quality: RenderQuality
  fps?: number          // default: 30
  videoBitrate?: string // e.g. '8M', '15M' — overrides CRF/CQ
  audioBitrate?: string // e.g. '128k', '256k', '320k'
  format?: 'mp4' | 'mov' | 'webm' | 'wav'  // default: mp4. 'wav' = audio-only export
  outputDir?: string    // custom output directory (absolute path)
  startSec?: number     // export window start (default 0)
  endSec?: number       // export window end (default = contentEnd)
  /**
   * Composite the 13soul corner watermark into the output. Determined
   * by the tier gate (free tier only), not the user. Routes call
   * enforceExportGate() and forward the boolean it returns.
   */
  applyWatermark?: boolean
}

export interface RenderResult {
  outputPath: string
  relativePath: string
  duration: number
  resolution: string
}

export interface RenderProgress {
  status: 'rendering' | 'done' | 'error'
  progress: number
  message: string
  output?: string | null
  outputPath?: string
  error?: string
}

export interface Template {
  id: string
  name: string
  description: string
  duration: number
  resolution?: [number, number]
  tracks: Timeline
  placeholders?: string[]
}

export interface MediaInfo {
  duration: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
  hasVideo?: boolean
}
