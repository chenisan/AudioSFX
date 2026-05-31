// Detect GPU badge from first message containing known tag
function gpuBadge(messages) {
  const first = messages.find(m => m.includes('NVENC') || m.includes('libx264'))
  if (!first) return null
  if (first.includes('NVENC')) return <span className="text-xs px-2 py-0.5 rounded bg-green-900/50 text-green-400 font-mono">⚡ GPU</span>
  return <span className="text-xs px-2 py-0.5 rounded bg-[#252525] text-[#666] font-mono">🖥 CPU</span>
}

export default function RenderProgress({ rendering, progress, messages, outputUrl, error, onClose }) {
  if (!rendering && !outputUrl && !error) return null

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-[#1a1a1a] border border-[#333] rounded-lg w-[480px] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-white">
              {rendering ? '渲染中...' : outputUrl ? '✅ 渲染完成' : '❌ 渲染失敗'}
            </h3>
            {gpuBadge(messages)}
          </div>
          {!rendering && (
            <button onClick={onClose} className="text-[#666] hover:text-white text-xl leading-none">×</button>
          )}
        </div>

        {/* Progress bar */}
        <div className="bg-[#111] rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-[#6d5efc] transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="text-xs text-[#666] font-mono">{progress}%</div>

        {/* Log */}
        <div className="bg-[#111] rounded p-3 h-36 overflow-y-auto space-y-0.5">
          {messages.map((msg, i) => (
            <div key={i} className="text-xs text-[#888] font-mono">{msg}</div>
          ))}
        </div>

        {/* Download / Local path */}
        {outputUrl && (
          <div className="flex flex-col gap-2">
            {outputUrl.startsWith('local:') ? (
              <div className="bg-green-900/30 border border-green-800/50 rounded p-3">
                <div className="text-xs text-green-400 mb-1">已儲存至：</div>
                <div className="text-sm text-green-300 font-mono break-all select-all">{outputUrl.slice(6)}</div>
              </div>
            ) : (
              <a
                href={outputUrl}
                download
                className="flex-1 text-center bg-green-700 hover:bg-green-600 text-white text-sm py-2 rounded transition-colors"
              >
                {outputUrl.toLowerCase().endsWith('.wav') ? '⬇ 下載音訊' : '⬇ 下載影片'}
              </a>
            )}
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-[#2a2a2a] hover:bg-[#333] text-[#aaa] text-sm rounded"
            >
              關閉
            </button>
          </div>
        )}

        {error && (
          <div className="text-xs text-red-400 bg-red-900/20 rounded p-2">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
