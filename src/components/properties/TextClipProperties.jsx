import { useProjectStore } from '../../stores/projectStore'
import {
  Section, Row, Unit, NumInput, DatalistInput, Select, ColorPicker, Toggle,
  AnimGrid, FontSelect,
  ANIM_IN_DEFS, ANIM_OUT_DEFS, POSITION_PRESETS_X, POSITION_PRESETS_Y,
} from './_widgets'

/**
 * Properties UI for a text segment. Reads everything from `clip.style.*`,
 * calls the helpers in `helpers` to update style, animation, position, etc.
 *
 * To add a new style property:
 *   1. extend TextSegment in server/core/types.ts
 *   2. add a Row + widget here
 *   3. mirror in TextOverlay (preview) and assRenderer (output)
 */
export default function TextClipProperties({ clip, helpers }) {
  const { update, updateStyle, updateAnim, updateBg, updatePos, updateShadow } = helpers

  return (
    <>
      <Section title="文字內容">
        <textarea
          value={clip.text ?? ''}
          onFocus={() => useProjectStore.getState().pushUndo()}
          onChange={e => update({ text: e.target.value })}
          className="w-full bg-[#111] border border-[#333] rounded p-2 text-sm text-gray-300 resize-none focus:outline-none focus:border-[#6d5efc]"
          rows={3}
        />
      </Section>

      <Section title="字型">
        <Row label="字體">
          <FontSelect value={clip.style?.fontFamily ?? '"Noto Sans TC", sans-serif'} onChange={v => updateStyle({ fontFamily: v })} />
        </Row>
        <Row label="大小">
          <NumInput value={clip.style?.fontSize ?? 48} step={2} onChange={v => updateStyle({ fontSize: +v })} />
          <Unit>px</Unit>
        </Row>
        <Row label="顏色">
          <ColorPicker value={clip.style?.color ?? '#ffffff'} onChange={v => updateStyle({ color: v })} />
        </Row>
        <Row label="粗細">
          <Select value={clip.style?.fontWeight ?? 'normal'} options={['normal','bold']} onChange={v => updateStyle({ fontWeight: v })} />
        </Row>
      </Section>

      <Section title="描邊">
        <Row label="寬度">
          <NumInput value={clip.style?.strokeWidth ?? 0} step={1} min={0} onChange={v => updateStyle({ strokeWidth: +v })} />
          <Unit>px</Unit>
        </Row>
        {(clip.style?.strokeWidth ?? 0) > 0 && (
          <Row label="顏色">
            <ColorPicker value={clip.style?.strokeColor ?? '#000000'} onChange={v => updateStyle({ strokeColor: v })} />
          </Row>
        )}
      </Section>

      {(() => {
        const sh = clip.style?.shadow
        const enabled = !!sh && sh.enabled !== false
        const dimmed = !enabled ? 'opacity-40 pointer-events-none' : ''
        const hexColor = (() => { const c = sh?.color ?? '#000000'; return c.startsWith('#') ? c : '#000000' })()
        return (
          <Section title="陰影">
            <Row label="啟用">
              <Toggle
                checked={enabled}
                onChange={v => {
                  if (v) updateShadow({ enabled: true, offsetX: sh?.offsetX ?? 2, offsetY: sh?.offsetY ?? 2, blur: sh?.blur ?? 6, color: hexColor, opacity: sh?.opacity ?? 0.8 })
                  else updateShadow({ enabled: false })
                }}
              />
            </Row>
            <div className={dimmed}>
              <div className="space-y-2 mt-2">
                <Row label="顏色">
                  <ColorPicker value={hexColor} onChange={v => updateShadow({ color: v })} />
                </Row>
                <Row label="透明度">
                  <NumInput value={sh?.opacity ?? 0.8} step={0.05} min={0} max={1} onChange={v => updateShadow({ opacity: +v })} />
                </Row>
                <Row label="X 位移">
                  <NumInput value={sh?.offsetX ?? 2} step={1} onChange={v => updateShadow({ offsetX: +v })} /><Unit>px</Unit>
                </Row>
                <Row label="Y 位移">
                  <NumInput value={sh?.offsetY ?? 2} step={1} onChange={v => updateShadow({ offsetY: +v })} /><Unit>px</Unit>
                </Row>
                <Row label="模糊">
                  <NumInput value={sh?.blur ?? 6} step={1} min={0} onChange={v => updateShadow({ blur: +v })} /><Unit>px</Unit>
                </Row>
              </div>
            </div>
          </Section>
        )
      })()}

      <Section title="位置">
        <Row label="X">
          <DatalistInput value={String(clip.style?.position?.x ?? 'center')} list={POSITION_PRESETS_X} onChange={v => updatePos({ x: v })} />
        </Row>
        <Row label="Y">
          <DatalistInput value={String(clip.style?.position?.y ?? '82%')} list={POSITION_PRESETS_Y} onChange={v => updatePos({ y: v })} />
        </Row>
      </Section>

      <Section title="背景條">
        <Row label="啟用">
          <Toggle checked={clip.style?.background?.enabled ?? false} onChange={v => updateBg({ enabled: v })} />
        </Row>
        {clip.style?.background?.enabled && <>
          <Row label="顏色"><ColorPicker value={clip.style?.background?.color ?? '#000000'} onChange={v => updateBg({ color: v })} /></Row>
          <Row label="透明度"><NumInput value={clip.style?.background?.opacity ?? 0.6} step={0.05} min={0} max={1} onChange={v => updateBg({ opacity: +v })} /></Row>
          <Row label="Padding"><NumInput value={clip.style?.background?.padding ?? 12} step={2} onChange={v => updateBg({ padding: +v })} /><Unit>px</Unit></Row>
        </>}
      </Section>

      <Section title="動畫">
        <div className="text-[10px] text-[#555] mb-1">進場</div>
        <AnimGrid defs={ANIM_IN_DEFS} value={clip.style?.animation?.in ?? 'none'} onChange={v => updateAnim({ in: v })} />
        {(clip.style?.animation?.in ?? 'none') !== 'none' && (
          <Row label="進場時長">
            <NumInput value={clip.style?.animation?.inDuration ?? 0.5} step={0.1} min={0} onChange={v => updateAnim({ inDuration: +v })} /><Unit>s</Unit>
          </Row>
        )}
        <div className="text-[10px] text-[#555] mb-1 mt-2">退場</div>
        <AnimGrid defs={ANIM_OUT_DEFS} value={clip.style?.animation?.out ?? 'none'} onChange={v => updateAnim({ out: v })} />
        {(clip.style?.animation?.out ?? 'none') !== 'none' && (
          <Row label="退場時長">
            <NumInput value={clip.style?.animation?.outDuration ?? 0.5} step={0.1} min={0} onChange={v => updateAnim({ outDuration: +v })} /><Unit>s</Unit>
          </Row>
        )}
      </Section>
    </>
  )
}
