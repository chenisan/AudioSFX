// Shared "關於" content — software intro + author links. Used by the Settings
// 關於 tab and the export About gate. Links open in the system browser
// (Electron's setWindowOpenHandler denies in-app nav → shell.openExternal).

export const ABOUT_LINKS = [
  { label: '官方網站',     handle: 'poofone.com.tw', url: 'https://www.poofone.com.tw/' },
  { label: 'Threads',      handle: '@isan1314558',   url: 'https://www.threads.com/@isan1314558' },
  { label: 'YouTube',      handle: '@13Neosoul',     url: 'https://www.youtube.com/@13Neosoul' },
  { label: 'Instagram',    handle: '@isan1314558',   url: 'https://www.instagram.com/isan1314558/' },
  { label: 'Facebook 社團', handle: 'AI 工具討論',     url: 'https://www.facebook.com/groups/26340062805675868' },
]

export default function AboutPanel() {
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-[#6d5efc] font-bold text-lg">AudioSFX</span>
          <span className="text-[10px] text-[#666] font-mono">v0.1.0</span>
        </div>
        <p className="text-xs text-[#aaa] leading-relaxed">
          獨立、本地、非商業的「影片 → 音效」創作工具。在時間軸上對齊 AI 生成的音效，用本地 GPU 跑
          <span className="text-[#ccc]"> MMAudio</span>（影片→同步底聲）與
          <span className="text-[#ccc]"> Sony Woosh</span>（文字／影片→SFX），最後以 ffmpeg 合成回影片。
        </p>
        <p className="text-xs text-[#bbb] leading-relaxed mt-2">
          <span className="text-[#6d5efc] font-medium">設計製作 · Isan（13soul）</span>
        </p>
        <p className="text-[11px] text-[#999] leading-relaxed mt-1">
          全端設計工程師 · 影像及音樂創作人
        </p>
        <p className="text-[10px] text-[#666] leading-relaxed mt-1">
          MMAudio／Woosh 權重為 CC BY-NC，本工具維持非商業定位。歡迎追蹤以下連結。
        </p>
      </div>

      <div>
        <div className="text-xs text-[#999] mb-3">連結</div>
        <div className="bg-[#252525] rounded-lg border border-[#333] px-4 divide-y divide-[#333]">
          {ABOUT_LINKS.map(l => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between py-2 group"
            >
              <span className="text-xs text-[#bbb] group-hover:text-white transition-colors">{l.label}</span>
              <span className="text-[10px] text-[#555] group-hover:text-[#6d5efc] font-mono ml-3 truncate max-w-[240px] transition-colors">
                {l.handle}
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
