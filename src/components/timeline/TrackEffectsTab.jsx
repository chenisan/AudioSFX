import { useProjectStore } from '../../stores/projectStore'
import { getPlugins } from '../../utils/trackPlugins'
import ChannelStrip from './ChannelStrip'
import TrackFxEditor from './TrackFxEditor'
import MainOutStrip from './MainOutStrip'

// Left-column "效果" tab — a DAW-style channel inspector. Top (scrolls): the
// selected track's channel strip (name/M-S/fader/meter/dB) + insert effect
// chain. Bottom (pinned): the Main Out master channel. Track derived from the
// selected clip's trackId.
export default function TrackEffectsTab() {
  const selTrackId = useProjectStore(s => s.selectedClip?.trackId ?? null)
  const tracks = useProjectStore(s => s.project?.timeline?.tracks)
  const track = tracks?.find(t => t.id === selTrackId)
  const canFx = !!track && (track.type === 'audio' || track.type === 'video')

  return (
    <div className="h-full flex flex-col bg-[#161618]">
      <div className="flex-1 overflow-y-auto min-h-0">
        {canFx ? (
          <>
            {/* Channel strip */}
            <div className="p-3 bg-gradient-to-b from-[#1e1e22] to-[#171719] border-b border-[#000]/40 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
              <ChannelStrip track={track} />
            </div>
            {/* Inserts */}
            <div className="p-3">
              <div className="flex items-center justify-between mb-2 px-0.5">
                <span className="text-[10px] font-semibold tracking-[0.15em] text-[#6d5efc]/80">INSERTS</span>
                <span className="text-[9px] text-[#555] font-mono tabular-nums">{getPlugins(track).length}</span>
              </div>
              <TrackFxEditor track={track} />
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-center p-4">
            <div className="text-[11px] text-[#555] leading-relaxed">
              選一條<span className="text-[#888]">音軌</span>或<span className="text-[#888]">影片軌</span>
              <br />（點軌道或片段）來編輯音量與效果
            </div>
          </div>
        )}
      </div>

      {/* Main Out — always visible */}
      <MainOutStrip />
    </div>
  )
}
