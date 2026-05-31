/**
 * Render a single asset (video / audio / image) as a standalone preview.
 * Used when the user clicks an asset in the asset panel without dropping it
 * to the timeline. Audio assets show waveform + audio element controls.
 */
export default function AssetPreview({ asset, projectId }) {
  const src = `/assets/${projectId}/${encodeURIComponent(asset.filename)}`

  if (asset.type === 'video') {
    return <video key={asset.filename} src={src} className="w-full h-full object-contain" controls playsInline preload="metadata" />
  }
  if (asset.type === 'audio') {
    const waveformSrc = `/api/projects/${projectId}/assets/waveform/${encodeURIComponent(asset.filename)}`
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-3 px-4">
        <img src={waveformSrc} alt="" className="w-full max-h-[40%] object-contain rounded opacity-70" />
        <audio key={asset.filename} src={src} controls className="w-full max-w-[200px]" preload="metadata" />
        <div className="text-xs text-[#666] truncate max-w-full">{asset.filename}</div>
      </div>
    )
  }
  if (asset.type === 'image') {
    return <img src={src} alt={asset.filename} className="w-full h-full object-contain" />
  }
  return <div className="flex items-center justify-center w-full h-full text-[#555] text-sm">{asset.filename}</div>
}
