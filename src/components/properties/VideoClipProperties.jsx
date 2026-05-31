import {
  Section, Row, Unit, Mono, NumInput, ColorPicker,
  FilterGrid, KeyframeEditor, TimelineKeyframeTrack,
} from './_widgets'
import { hasUserOverlay } from '../preview/OverlayClip'

const BLEND_MODES = [
  { id: 'normal',   label: '正常' },
  { id: 'screen',   label: '濾色' },
  { id: 'add',      label: '相加' },
  { id: 'overlay',  label: '疊加' },
  { id: 'softlight',label: '柔光' },
  { id: 'multiply', label: '色彩增值' },
]

/**
 * Properties UI for a video segment. Branches between two modes:
 *   - colorFill (clip.colorFill set, no source): just color + timing
 *   - regular video (has source): source name, volume, filter, opacityKF
 *   - overlay (regular video on a non-primary track): adds blend mode
 *
 * Trim start/end and clip-to-clip transitions are mutated via timeline drag /
 * Q-W cut keys; the numeric editors were intentionally removed from this
 * panel because the on-timeline gestures cover the same intent.
 *
 * Opacity keyframes apply to both main and overlay tracks. On main track,
 * since there is no underlying layer, opacity < 1 reads as fade-toward-black
 * (matched in ffmpeg via RGB attenuation in transitionBuilder).
 *
 * To add a new keyframe-able property (e.g. position, scale, rotation):
 *   1. extend VideoSegment in server/core/types.ts
 *   2. add a Section + KeyframeEditor here gated by the appropriate condition
 *   3. wire the playhead-time interpolation in OverlayClip.jsx (preview)
 *      and ffmpegBuilder.ts (render).
 */
export default function VideoClipProperties({
  clip, playheadTime, helpers, isOverlay,
}) {
  const { update, updateFilter, updateOverlay } = helpers
  const isColorFill = !!clip.colorFill
  // On the primary track, an explicit overlay position bypasses the standard
  // filter chain (Ken Burns, glow). Surface this so the user understands why
  // those settings appear inert when overlay is set.
  const overlayConflict = !isOverlay && hasUserOverlay(clip)

  if (isColorFill) {
    return (
      <>
        <Section title="底色">
          <Row label="顏色">
            <ColorPicker value={clip.colorFill} onChange={v => update({ colorFill: v })} />
          </Row>
        </Section>
        <Section title="時長">
          <Row label="開始"><NumInput value={clip.start} step={0.1} min={0} onChange={v => update({ start: +v })} /><Unit>s</Unit></Row>
          <Row label="結束"><NumInput value={clip.end}   step={0.1} min={0} onChange={v => update({ end: +v })} /><Unit>s</Unit></Row>
          <Row label="時長"><Mono>{(clip.end - clip.start).toFixed(2)}s</Mono></Row>
        </Section>
      </>
    )
  }

  return (
    <>
      <Section title="來源">
        <Row label="檔案"><Mono>{clip.source}</Mono></Row>
      </Section>

      <Section title="音量">
        <Row label="音量">
          <NumInput value={clip.volume ?? 1} step={0.05} min={0} max={2} onChange={v => update({ volume: +v })} />
          <Unit>×</Unit>
        </Row>
      </Section>

      <Section title="濾鏡">
        <FilterGrid value={clip.filter?.type ?? 'none'} onChange={v => updateFilter({ type: v })} />
        {clip.filter?.type && clip.filter.type !== 'none' && (
          <Row label="強度">
            <NumInput value={clip.filter?.intensity ?? 0.5} step={0.05} min={0} max={1} onChange={v => updateFilter({ intensity: +v })} />
            <input
              type="range" value={clip.filter?.intensity ?? 0.5} step={0.05} min={0} max={1}
              onChange={e => updateFilter({ intensity: +e.target.value })}
              className="flex-1 h-1 accent-[#6d5efc] cursor-pointer"
            />
          </Row>
        )}
        {overlayConflict && clip.filter?.type === 'glow' && (
          <div className="mt-2 px-2 py-1.5 rounded border border-[#7a5028] bg-[#2d261a] text-[10px] text-[#e8a838] leading-snug">
            此片段已用 overlay 自訂位置，render 時 glow 會被略過。在預覽按 Reset 還原 overlay 即可恢復。
          </div>
        )}
      </Section>

      <Section title="透明度關鍵幀">
        <KeyframeEditor
          keyframes={clip.opacityKF ?? []}
          clipStart={clip.start}
          clipEnd={clip.end}
          playheadTime={playheadTime}
          valueMin={0} valueMax={1} valueStep={0.05} valueLabel="透明度"
          defaultValue={clip.overlay?.opacity ?? 1}
          onChange={kfs => update({ opacityKF: kfs })}
        />
        {!isOverlay && (
          <div className="text-[9px] text-[#555] mt-1 text-center">
            主軌無下層，低透明度視覺等同淡入黑底
          </div>
        )}
      </Section>

      {isOverlay && (
        <Section title="位置關鍵幀">
          <TimelineKeyframeTrack
            keyframes={clip.overlay?.xKF ?? []}
            clipStart={clip.start}
            clipEnd={clip.end}
            playheadTime={playheadTime}
            label="X 位置"
            valueAsPercent
            valueMin={-0.5} valueMax={1.5} valueStep={0.01}
            defaultValue={clip.overlay?.x ?? 0}
            onChange={kfs => updateOverlay({ xKF: kfs })}
          />
          <TimelineKeyframeTrack
            keyframes={clip.overlay?.yKF ?? []}
            clipStart={clip.start}
            clipEnd={clip.end}
            playheadTime={playheadTime}
            label="Y 位置"
            valueAsPercent
            valueMin={-0.5} valueMax={1.5} valueStep={0.01}
            defaultValue={clip.overlay?.y ?? 0}
            onChange={kfs => updateOverlay({ yKF: kfs })}
          />
          <div className="text-[9px] text-[#555] text-center">
            數值是 canvas 比例（50% = 畫面中心）。點軌道空白處新增，拖動 ◆ 改時間，點選後底下調整。
          </div>
        </Section>
      )}

      {isOverlay && (
        <Section title="混合模式">
          <div className="grid grid-cols-3 gap-1">
            {BLEND_MODES.map(m => (
              <button
                key={m.id}
                onClick={() => updateOverlay({ blendMode: m.id })}
                className={`text-[10px] py-1 rounded border transition-colors ${
                  (clip.overlay?.blendMode ?? 'normal') === m.id
                    ? 'border-[#6d5efc] bg-[#6d5efc]/10 text-[#6d5efc]'
                    : 'border-[#2a2a2a] text-[#666] hover:border-[#555] hover:text-[#888]'
                }`}
              >{m.label}</button>
            ))}
          </div>
          {(clip.overlay?.blendMode && clip.overlay.blendMode !== 'normal') && (
            <div className="text-[9px] text-[#555] mt-1 text-center">
              僅對全畫面疊加有效
            </div>
          )}
        </Section>
      )}
    </>
  )
}
