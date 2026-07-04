import PanelButton from './PanelButton'

// Amp-head preset rail: ← → step through presets, a recessed name well (native
// select), and DELETE / SAVE / SAVE AS actions. Fully controlled — the parent
// owns the preset list + persistence.
//
//   names    : string[]            available preset names
//   current  : string | null       selected name (null = none/unsaved)
//   dirty    : bool                 current chain differs from the saved preset
//   onPrev/onNext/onSelect(name)/onSave/onSaveAs/onDelete
export default function PresetBar({
  names = [], current, dirty = false, editable = true,
  onPrev, onNext, onSelect, onSave, onSaveAs, onDelete,
}) {
  const idx = current ? names.indexOf(current) : -1
  const canStep = names.length > 0
  const canEdit = idx >= 0 && editable

  const Step = ({ dir, fn }) => (
    <button
      type="button"
      onClick={fn}
      disabled={!canStep}
      title={dir === 'prev' ? '上一個預設' : '下一個預設'}
      className={`w-5 h-6 grid place-items-center rounded text-[12px] leading-none transition-colors ${
        canStep ? 'text-[#9a948b] hover:text-[#d8d2c6] hover:bg-white/[0.04]' : 'text-[#3a3a3d] cursor-not-allowed'
      }`}
    >
      {dir === 'prev' ? '‹' : '›'}
    </button>
  )

  return (
    <div className="flex items-center gap-1">
      <Step dir="prev" fn={onPrev} />
      <Step dir="next" fn={onNext} />

      {/* recessed name well */}
      <div className="amp-inset relative flex-1 min-w-0 rounded h-7 flex items-center px-2">
        <select
          value={current ?? ''}
          onChange={(e) => onSelect?.(e.target.value || null)}
          className="appearance-none bg-transparent w-full pr-4 text-[11px] text-[#d8d2c6] font-medium truncate outline-none cursor-pointer"
        >
          {!current && <option value="">— 無預設 —</option>}
          {names.map((n) => (
            <option key={n} value={n} className="bg-[#1a1a1c] text-[#d8d2c6]">{n}</option>
          ))}
        </select>
        {dirty && <span className="absolute left-1 top-1 text-[#e0a04a] text-[13px] leading-none" title="未存變更">*</span>}
        <span className="pointer-events-none absolute right-2 text-[#777] text-[9px]">▾</span>
      </div>

      <PanelButton onClick={onDelete} disabled={!canEdit} title="刪除此預設">Delete</PanelButton>
      <PanelButton onClick={onSave} accent disabled={!canEdit} title="覆寫此預設">Save</PanelButton>
      <PanelButton onClick={onSaveAs} title="另存新預設">Save As…</PanelButton>
    </div>
  )
}
