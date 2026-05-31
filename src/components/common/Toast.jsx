import { useProjectStore } from '../../stores/projectStore'

const KIND_STYLES = {
  info:  'bg-[#252525] border-[#3a3a3a] text-[#ddd]',
  warn:  'bg-[#2d261a] border-[#7a5028] text-[#e8a838]',
  error: 'bg-[#2d1a1a] border-[#7a2828] text-[#e84858]',
}

/**
 * Single transient toast rendered at the bottom-right of the app. Driven by
 * `projectStore.toast` — actions call `showToast(message, kind)` to surface
 * quick feedback (e.g. copy-paste rejections). Auto-clears after 2.5s.
 */
export default function Toast() {
  const toast = useProjectStore(s => s.toast)
  if (!toast) return null
  const style = KIND_STYLES[toast.kind] ?? KIND_STYLES.info
  return (
    <div
      key={toast.id}
      className={`fixed bottom-5 right-5 z-[200] px-4 py-2 rounded-md border text-sm shadow-lg pointer-events-none ${style}`}
      role="status"
    >
      {toast.message}
    </div>
  )
}
