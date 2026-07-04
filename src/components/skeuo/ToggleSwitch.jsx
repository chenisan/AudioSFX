// Physical slide toggle styled after an amp-head rocker (GATE / DOUBLER in the
// reference). Off = dark recessed; on = warm-lit. Controlled via checked/onChange.
export default function ToggleSwitch({ checked, onChange, label, color = '#e0a04a', title }) {
  return (
    <button
      type="button"
      onClick={() => onChange?.(!checked)}
      title={title}
      className="flex items-center gap-2 select-none group"
    >
      {label && (
        <span className="text-[9px] font-semibold tracking-[0.14em] uppercase text-[#b8b0a6]">{label}</span>
      )}
      <span
        className="relative inline-flex w-9 h-[18px] rounded-full transition-colors duration-150"
        style={{
          background: checked
            ? `linear-gradient(180deg, ${color}, ${color}cc)`
            : 'linear-gradient(180deg, #0c0c0e, #18181b)',
          boxShadow: checked
            ? `inset 0 1px 2px rgba(0,0,0,0.4), 0 0 8px ${color}66`
            : 'inset 0 2px 4px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.03)',
        }}
      >
        <span
          className="absolute top-1/2 -translate-y-1/2 w-[14px] h-[14px] rounded-full transition-all duration-150"
          style={{
            left: checked ? '20px' : '2px',
            background: 'radial-gradient(circle at 38% 32%, #f0f0f2, #b8b8bc 70%)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,0,0,0.2)',
          }}
        />
      </span>
    </button>
  )
}
