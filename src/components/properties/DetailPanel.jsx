import { useProjectStore, ASPECT_RATIOS } from '../../stores/projectStore'
import { useShallow } from 'zustand/react/shallow'

const FORMAT_LABEL = { mp4: 'H.264 MP4', mov: 'ProRes MOV', webm: 'VP9 WebM' }

export default function DetailPanel() {
  // Narrowed — DetailPanel reads several scalar project fields + tracks
  // for clip-count rollup. Group them into one shallow selector so only
  // changes the panel actually displays trigger a re-render.
  const project = useProjectStore(useShallow(s => s.project ? {
    id:         s.project.id,
    name:       s.project.name,
    duration:   s.project.duration,
    aspectRatio: s.project.aspectRatio,
    createdAt:  s.project.createdAt,
    updatedAt:  s.project.updatedAt,
    tracks:     s.project.timeline?.tracks ?? [],
  } : null))
  const exportSettings = useProjectStore(s => s.exportSettings)

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[#444] text-xs text-center px-4 gap-2">
        <span className="text-2xl">📋</span>
        <span>請先選擇專案</span>
      </div>
    )
  }

  const tracks = project.tracks
  const trackCount = tracks.length
  const videoTracks = tracks.filter(t => t.type === 'video')
  const textTracks = tracks.filter(t => t.type === 'text')
  const audioTracks = tracks.filter(t => t.type === 'audio')
  const totalClips = tracks.reduce((sum, t) => sum + (t.clips?.length ?? 0), 0)

  const ratioId = project.aspectRatio ?? '9:16'
  const ratio = ASPECT_RATIOS.find(r => r.id === ratioId)
  const orient = ratio ? (ratio.w > ratio.h ? '橫式' : ratio.w === ratio.h ? '正方' : '直式') : '—'

  return (
    <div className="h-full overflow-y-auto text-[#ccc]">
      <div className="px-3 py-2 border-b border-[#2a2a2a] sticky top-0 bg-[#1a1a1a] z-10">
        <span className="text-xs text-[#6d5efc] font-medium">詳細資料</span>
      </div>

      <div className="p-3 space-y-4">
        <InfoRow label="名稱：" value={project.name} />
        <InfoRow label="專案 ID：" value={project.id} mono />
        <InfoRow label="長度：" value={`${project.duration}s`} />

        <Divider />

        <InfoRow label="比例：" value={`${ratioId} (${orient})`} />
        <InfoRow label="格式：" value={FORMAT_LABEL[exportSettings?.format ?? 'mp4'] ?? 'H.264 MP4'} />
        <InfoRow label="FPS：" value={`${exportSettings?.fps ?? 30} fps`} />
        <InfoRow label="色彩空間：" value="Rec. 709 SDR" />

        <Divider />

        <InfoRow label="軌道數：" value={`${trackCount} 軌`} />
        <InfoRow label="" value={`影片 ${videoTracks.length} · 文字 ${textTracks.length} · 音樂 ${audioTracks.length}`} sub />
        <InfoRow label="片段數：" value={`${totalClips} 個`} />

        <Divider />

        <InfoRow label="建立時間：" value={project.createdAt ? new Date(project.createdAt).toLocaleString('zh-TW') : '—'} mono />
        <InfoRow label="最後修改：" value={project.updatedAt ? new Date(project.updatedAt).toLocaleString('zh-TW') : '—'} mono />
      </div>
    </div>
  )
}

function InfoRow({ label, value, mono, sub }) {
  return (
    <div className="space-y-0.5">
      {label && <div className="text-[11px] text-[#666]">{label}</div>}
      <div className={`text-sm ${sub ? 'text-[11px] text-[#555]' : mono ? 'text-[11px] text-[#777] font-mono break-all' : 'text-[#ccc] font-medium'}`}>
        {value}
      </div>
    </div>
  )
}

function Divider() {
  return <div className="border-t border-[#2a2a2a]" />
}
