import { useState, useEffect, useCallback } from 'react'

// Spotlight feature tour. Each step optionally targets a DOM node tagged with
// data-tour="<key>"; found → spotlight + anchored tooltip, not found / null →
// centered tooltip. Triggered from the startup About「下一步」.

const STEPS = [
  { target: 'project',   title: '專案',        body: '在這裡新建或開啟專案。' },
  { target: 'save',      title: '儲存',        body: '存檔（也可按 Ctrl+S）。編輯只在記憶體，記得存。' },
  { target: 'export',    title: '匯出',        body: '把成品匯出成影片，右下角會有浮水印。匯出前會先顯示「關於作者」。' },
  { target: 'engine',    title: 'AI 引擎',      body: '啟動 Sony Woosh / MMAudio 推論引擎 —— 生成音效前要先在這開啟。' },
  { target: 'preview',   title: '預覽',        body: '開啟右下角的浮動預覽窗，可拖曳、可調大小。' },
  { target: 'sfx',       title: '音效生成',     body: '打開「音效」浮窗，用英文描述（如 glass shatter）就能生成 SFX。' },
  { target: 'settings',  title: '設定',        body: '效能、儲存空間與「關於」都在這裡。' },
  { target: 'left-tabs', title: '左欄面板',     body: '「素材」是你的素材庫；「效果」是選中軌的 EQ / 壓縮 / 限幅與母帶 Main Out。' },
  { target: null,        title: '在音軌加入音效', body: '① 右鍵音軌空白處 →「建立音效」在該位置生成；② 或把「素材」裡的音檔直接拖到音軌上。' },
  { target: null,        title: '開始創作 🎬',  body: '就這些！隨時可從開啟頁的「下一步」重看本導引。' },
]

const TIP_W = 300

export default function GuidedTour({ onClose }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)
  const step = STEPS[i]

  const measure = useCallback(() => {
    if (!step.target) { setRect(null); return }
    const el = document.querySelector(`[data-tour="${step.target}"]`)
    setRect(el ? el.getBoundingClientRect() : null)
  }, [step.target])

  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  const last = i === STEPS.length - 1
  const next = () => (last ? onClose() : setI(i + 1))
  const prev = () => setI(n => Math.max(0, n - 1))

  // Tooltip placement: anchored under/over the target, else centered.
  let tipStyle
  if (rect) {
    const below = rect.bottom + 150 < window.innerHeight
    tipStyle = {
      top: below ? rect.bottom + 12 : undefined,
      bottom: below ? undefined : window.innerHeight - rect.top + 12,
      left: Math.min(Math.max(12, rect.left + rect.width / 2 - TIP_W / 2), window.innerWidth - TIP_W - 12),
    }
  } else {
    tipStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  }

  return (
    <div className="fixed inset-0 z-[80]">
      {/* Spotlight cutout (box-shadow dims everything but the target) */}
      {rect ? (
        <div
          className="absolute rounded-lg ring-2 ring-[#6d5efc] pointer-events-none transition-all duration-200"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.72)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/72" />
      )}

      {/* Tooltip */}
      <div
        className="absolute bg-[#1a1a1a] border border-[#6d5efc]/50 rounded-lg shadow-2xl p-4"
        style={{ width: TIP_W, ...tipStyle }}
      >
        <div className="text-sm font-medium text-white mb-1">{step.title}</div>
        <div className="text-xs text-[#bbb] leading-relaxed mb-3">{step.body}</div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[#666] font-mono tabular-nums">{i + 1} / {STEPS.length}</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-[11px] text-[#666] hover:text-[#aaa] transition-colors">跳過</button>
            {i > 0 && (
              <button onClick={prev} className="text-[11px] text-[#aaa] hover:text-white px-2 py-1 transition-colors">上一步</button>
            )}
            <button onClick={next} className="text-[11px] bg-[#6d5efc] hover:bg-[#5848e0] text-white px-3 py-1 rounded transition-colors">
              {last ? '完成' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
