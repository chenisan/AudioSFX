import { useState } from 'react'
import aboutPoster from '../../assets/about-poster.png'

// Shared "關於" content — brand poster + bilingual (繁中 / EN) intro + author
// links. Used by the Settings 關於 tab, the export About gate, and the startup
// About window. Links open in the system browser (Electron's
// setWindowOpenHandler denies in-app nav → shell.openExternal).

export const ABOUT_LINKS = [
  { label: '官方網站',     handle: 'poofone.com.tw', url: 'https://www.poofone.com.tw/' },
  { label: 'Threads',      handle: '@isan1314558',   url: 'https://www.threads.com/@isan1314558' },
  { label: 'YouTube',      handle: '@13Neosoul',     url: 'https://www.youtube.com/@13Neosoul' },
  { label: 'Instagram',    handle: '@isan1314558',   url: 'https://www.instagram.com/isan1314558/' },
  { label: 'Facebook 社團', handle: 'AI 工具討論',     url: 'https://www.facebook.com/groups/26340062805675868' },
]

const COPY = {
  zh: {
    toggle: '繁中',
    intro: '獨立、本地、非商業的「影片 → 音效」創作工具。在時間軸上對齊 AI 生成的音效，用本地 GPU 跑 MMAudio（影片→同步底聲）與 Sony Woosh（文字／影片→SFX），最後以 ffmpeg 合成回影片。',
    credit: '設計製作 · Isan（13soul）',
    role: '全端設計工程師 · 影像及音樂創作人',
    note: 'MMAudio／Woosh 權重為 CC BY-NC，本工具維持非商業定位。歡迎追蹤以下連結。',
    legal: '內含 FFmpeg（GPLv3，以獨立執行檔呼叫）· 第三方授權見 GitHub NOTICE.md',
    links: '連結',
  },
  en: {
    toggle: 'EN',
    intro: 'A standalone, local, non-commercial “video → sound-effects” tool. Align AI-generated SFX on a timeline, powered by local GPU models — MMAudio (video → synced ambience) and Sony Woosh (text / video → SFX) — then mux back into the video with ffmpeg.',
    credit: 'Designed & built by Isan (13soul)',
    role: 'Full-stack design engineer · video & music creator',
    note: 'MMAudio / Woosh weights are CC BY-NC; this tool stays non-commercial. Follow the links below.',
    legal: 'Includes FFmpeg (GPLv3, invoked as a separate executable) · third-party licenses in NOTICE.md on GitHub',
    links: 'Links',
  },
}

export default function AboutPanel() {
  const [lang, setLang] = useState('zh')
  const t = COPY[lang]

  return (
    <div className="space-y-5">
      {/* Brand poster */}
      <div className="rounded-lg overflow-hidden border border-[#2a2a2a] bg-black">
        <img src={aboutPoster} alt="AudioSFX" className="w-full block" />
      </div>

      {/* Version + language toggle */}
      <div className="flex items-center justify-between -mt-1">
        <span className="text-[10px] text-[#666] font-mono">v0.1.0</span>
        <div className="inline-flex rounded border border-[#333] overflow-hidden text-[10px]">
          {['zh', 'en'].map(k => (
            <button
              key={k}
              onClick={() => setLang(k)}
              className={`px-2.5 py-1 transition-colors ${
                lang === k ? 'bg-[#6d5efc] text-white' : 'bg-[#1a1a1a] text-[#888] hover:text-white'
              }`}
            >
              {COPY[k].toggle}
            </button>
          ))}
        </div>
      </div>

      {/* Intro */}
      <div>
        <p className="text-xs text-[#aaa] leading-relaxed">{t.intro}</p>
        <p className="text-xs leading-relaxed mt-2">
          <span className="text-[#6d5efc] font-medium">{t.credit}</span>
        </p>
        <p className="text-[11px] text-[#999] leading-relaxed mt-1">{t.role}</p>
        <p className="text-[10px] text-[#666] leading-relaxed mt-1">{t.note}</p>
        <p className="text-[9px] text-[#555] leading-relaxed mt-2">{t.legal}</p>
      </div>

      {/* Links */}
      <div>
        <div className="text-xs text-[#999] mb-3">{t.links}</div>
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
