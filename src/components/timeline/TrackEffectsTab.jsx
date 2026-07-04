import { useState, useEffect } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { getPlugins } from '../../utils/trackPlugins'
import {
  listPresets, getPresetChain, instantiate, isBuiltin, chainMatches,
  saveUserPreset, deleteUserPreset,
} from '../../utils/fxPresets'
import ChannelStrip from './ChannelStrip'
import TrackFxEditor from './TrackFxEditor'
import MainOutStrip from './MainOutStrip'
import PresetBar from '../skeuo/PresetBar'
import ampTex from '../../assets/textures/amp-panel-dark.png'

// Four chrome corner screws for a raised bezel plate (parent must be relative;
// .amp-bezel already is). Sells the "physical plate bolted onto the amp" look.
function Screws() {
  return (
    <>
      <span className="amp-screw absolute top-1.5 left-1.5" />
      <span className="amp-screw absolute top-1.5 right-1.5" />
      <span className="amp-screw absolute bottom-1.5 left-1.5" />
      <span className="amp-screw absolute bottom-1.5 right-1.5" />
    </>
  )
}

// Left-column "效果" tab — a skeuomorphic amp-head channel inspector. A brushed
// metal preset rail on top, then the selected track's channel strip + insert
// chain on a dark faceplate, with the Main Out master channel pinned at the
// bottom. Track derived from the selected clip's trackId.
export default function TrackEffectsTab() {
  const selTrackId = useProjectStore(s => s.selectedClip?.trackId ?? null)
  const tracks = useProjectStore(s => s.project?.timeline?.tracks)
  const setTrackPlugins = useProjectStore(s => s.setTrackPlugins)
  const setTrackPluginsLive = useProjectStore(s => s.setTrackPluginsLive)
  const track = tracks?.find(t => t.id === selTrackId)
  const canFx = !!track && (track.type === 'audio' || track.type === 'video')

  // Preset rail state. `rev` forces a re-read of the localStorage preset list.
  const [selName, setSelName] = useState(null)
  const [rev, setRev] = useState(0)
  useEffect(() => { setSelName(null) }, [selTrackId])

  const plugins = canFx ? getPlugins(track) : []
  const names = (() => { void rev; return listPresets().map(p => p.name) })()
  const dirty = !!selName && !chainMatches(plugins, selName)

  const applyPlugins = (next) => {
    setTrackPluginsLive(track.id, next)
    setTrackPlugins(track.id, next)
  }
  const apply = (name) => {
    if (!name) { setSelName(null); return }
    const chain = getPresetChain(name)
    if (!chain) return
    applyPlugins(instantiate(chain))
    setSelName(name)
  }
  const step = (dir) => {
    if (!names.length) return
    const i = selName ? names.indexOf(selName) : -1
    const next = ((i < 0 ? (dir < 0 ? 0 : -1) : i) + dir + names.length) % names.length
    apply(names[next])
  }
  const onSaveAs = () => {
    const name = window.prompt('預設名稱', selName && isBuiltin(selName) ? `${selName} 副本` : (selName ?? ''))
    if (!name) return
    saveUserPreset(name.trim(), plugins)
    setSelName(name.trim())
    setRev(r => r + 1)
  }
  const onSave = () => {
    if (!selName || isBuiltin(selName)) return
    saveUserPreset(selName, plugins)
    setRev(r => r + 1)
  }
  const onDelete = () => {
    if (!selName || isBuiltin(selName)) return
    deleteUserPreset(selName)
    setSelName(null)
    setRev(r => r + 1)
  }

  return (
    <div className="h-full flex flex-col amp-faceplate" style={{ '--amp-tex': `url(${ampTex})` }}>
      {/* Preset rail */}
      {canFx && (
        <div className="amp-rail px-2.5 py-2 flex items-center gap-2">
          <span className="text-[9px] font-semibold tracking-[0.16em] text-[#8a8378] shrink-0">PRESET</span>
          <div className="flex-1 min-w-0">
            <PresetBar
              names={names}
              current={selName}
              dirty={dirty}
              editable={!!selName && !isBuiltin(selName)}
              onPrev={() => step(-1)}
              onNext={() => step(+1)}
              onSelect={apply}
              onSave={onSave}
              onSaveAs={onSaveAs}
              onDelete={onDelete}
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0 p-2.5 space-y-2.5">
        {canFx ? (
          <>
            {/* Channel strip */}
            <div className="amp-bezel p-3">
              <Screws />
              <ChannelStrip track={track} />
            </div>
            {/* Inserts */}
            <div className="amp-bezel p-3">
              <Screws />
              <div className="flex items-center justify-between mb-2 px-0.5">
                <span className="text-[10px] font-semibold tracking-[0.16em] text-[#b8b0a6]">INSERTS</span>
                <span className="text-[9px] text-[#6a655d] font-mono tabular-nums">{getPlugins(track).length}</span>
              </div>
              <TrackFxEditor track={track} />
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-center p-4">
            <div className="text-[11px] text-[#6a655d] leading-relaxed">
              選一條<span className="text-[#9a948b]">音軌</span>或<span className="text-[#9a948b]">影片軌</span>
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
