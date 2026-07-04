// Flat amp-panel text button (DELETE / SAVE / SAVE AS in the reference): caps,
// letter-spaced, subtle hover lift. `accent` tints it warm; `disabled` greys out.
export default function PanelButton({ children, onClick, disabled, accent = false, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-2 py-1 rounded text-[10px] font-semibold tracking-[0.12em] uppercase transition-colors ${
        disabled
          ? 'text-[#4a4a4d] cursor-not-allowed'
          : accent
            ? 'text-[#e0a04a] hover:text-[#f2b766] hover:bg-[#e0a04a]/10'
            : 'text-[#9a948b] hover:text-[#d8d2c6] hover:bg-white/[0.04]'
      }`}
    >
      {children}
    </button>
  )
}
