import { useProjectStore } from '../../stores/projectStore'
import TrackFxEditor from './TrackFxEditor'

// Left-column "效果" tab: shows the effect chain for the currently selected
// track (derived from the selected clip's trackId). Empty state prompts the
// user to select an audio/video track. Only tracks that carry audio can host
// effects.
export default function TrackEffectsTab() {
  const selTrackId = useProjectStore(s => s.selectedClip?.trackId ?? null)
  const tracks = useProjectStore(s => s.project?.timeline?.tracks)
  const track = tracks?.find(t => t.id === selTrackId)
  const canFx = !!track && (track.type === 'audio' || track.type === 'video')

  if (!canFx) {
    return (
      <div className="h-full flex items-center justify-center text-center p-4">
        <div className="text-[11px] text-[#555] leading-relaxed">
          選一條<span className="text-[#888]">音軌</span>或<span className="text-[#888]">影片軌</span>
          <br />（點軌道或片段）來編輯效果鏈
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-2">
      <div className="flex items-center gap-1.5 px-1 pb-2 mb-1 border-b border-[#2a2a2a]">
        <span className="text-[10px]">{track.type === 'audio' ? '🎵' : '🎬'}</span>
        <span className="text-xs text-[#ccc] truncate">{track.name}</span>
        <span className="text-[10px] text-[#555] shrink-0">的效果鏈</span>
      </div>
      <TrackFxEditor track={track} />
    </div>
  )
}
