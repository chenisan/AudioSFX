// @ts-check
/**
 * Video provider / mode descriptions shown in the ⓘ popover next to each
 * model selector in VideoNode. Single source so backend (errors / cost log)
 * and frontend (UI) stay aligned conceptually — keep entries short and
 * task-focused, not marketing copy.
 *
 * @typedef {{
 *   id: string,
 *   label: string,
 *   tagline: string,        // one-line "what is this for"
 *   inputs: string[],       // bullet list — what pills must be wired
 *   outputs: string,        // bullet — what comes out
 *   cost: string,           // bullet — credit/USD rough figure
 *   bestFor: string[],      // bullet list — when to pick this
 *   pitfalls: string[],     // bullet list — known landmines
 * }} VideoModeInfo
 */

/** @type {Record<string, VideoModeInfo>} */
export const VIDEO_MODE_INFO = {
  // ── Kling (image → video) ───────────────────────────────────────────────────
  kling: {
    id: 'kling',
    label: 'Kling',
    tagline: '快手 Kling：起始幀（+ 結束幀）→ 影片。亞洲臉孔最穩、運鏡聽話、有 std/pro 兩檔。',
    inputs: [
      '起始幀（必要）— 接 Generator 或上傳',
      '結束幀（選填）— image_tail，會在頭尾插值',
    ],
    outputs: '5s 或 10s mp4；解析度由 model 決定（v1-* = 720p、v2-* = 1080p）',
    cost: 'API resource-pack units：v1-6 std 5s = 2u (~$0.28)；v2-1-master 5s = 10u (~$1.40)。1 unit ≈ $0.14。',
    bestFor: [
      '亞洲角色 + 武打 / 抒情 / 唱跳場景',
      '需要起點/終點明確控制（頭尾插值）',
      '預算敏感 — v1-6 std 是現役最便宜的 1080p 之外選項',
    ],
    pitfalls: [
      'v2-0+ 不收 camera_control 欄位（舊 v1 才能用）',
      'v2-5-turbo / v2-6 是未驗證候選，第一次跑可能噴 model_name 錯',
      '餘額查詢有 12h 延遲（Kling 官方限制）',
    ],
  },

  // ── Runway image-to-video (gen4.5 / gen4_turbo) ────────────────────────────
  runway: {
    id: 'runway',
    label: 'Runway gen4.5 / turbo',
    tagline: 'Runway 主力影像生成。gen4.5 文生 + 圖生兼具（純文字也能跑），gen4_turbo 便宜但需起始幀。',
    inputs: [
      'gen4.5：起始幀「選填」（純文字也能生）+ 結束幀選填',
      'gen4_turbo：起始幀「必要」+ 結束幀選填',
    ],
    outputs: '5s 或 10s mp4；ratio 限定 1280:720 / 720:1280 / 960:960 / 1104:832 / 832:1104 / 1584:672',
    cost: 'gen4.5 = 12 credits/s ($0.12/s)；gen4_turbo = 5 credits/s ($0.05/s)。1 credit = $0.01。',
    bestFor: [
      'gen4.5：完全沒參考圖、純文字想直接出片',
      'gen4_turbo：快速驗證構圖、預算敏感的試樣',
      '西方臉孔 / 寫實風格 / 場景轉換',
    ],
    pitfalls: [
      '舊 gen3a_turbo 的 768:1280 / 1280:768 在 gen4 系列會噴 Validation 失敗 — 已被 server coerce',
      'gen4.5 純文生時要把「起始幀」pill 留空，連著但沒上傳會被誤判',
    ],
  },

  // ── Runway gen4_aleph (video → video) ──────────────────────────────────────
  'runway-aleph': {
    id: 'runway-aleph',
    label: 'Runway Aleph（video→video）',
    tagline: '把「現有影片」重新詮釋成新風格 / 新場景 / 加角色。是這個世代最強的 video editing 模型。',
    inputs: [
      '輸入影片（必要）— 接 video-in pill，通常是前一個 VideoNode 的輸出',
      '起始幀（選填）— 當「色彩 / 光線 / 風格參考」用，不是 keyframe',
      '動態 prompt — 描述想改成什麼（風格、增刪元素、場景）',
    ],
    outputs: '時長對齊輸入影片（不是 5s / 10s 由你選）；ratio 跟 gen4 系列同',
    cost: '15 credits/s ($0.15/s)。Runway 系列最貴，但比重 render 一支便宜。',
    bestFor: [
      '已生成的 Kling / Seedance 影片做 style transfer（寫實 → 動漫）',
      '影片局部修補（加雨、換光線、修元素）',
      '同一支影片多版本實驗（同動作不同畫風）',
    ],
    pitfalls: [
      '輸入影片以 base64 內嵌，10MB 以上會慢，建議先壓到 720p',
      '無法控制輸出時長 — 跟著輸入跑',
      '官方公開文件少，欄位名 (videoUri) 與行為「依第三方包驗證」，第一次跑失敗請看 Runway error 字串',
    ],
  },

  // ── Runway act_two (character performance) ────────────────────────────────
  'runway-act-two': {
    id: 'runway-act-two',
    label: 'Runway Act-Two（角色表演驅動）',
    tagline: '拿一支「驅動影片」（你自己演 / 找的範例）去驅動「角色」（圖或影片）做出同樣的表演。一致性最強。',
    inputs: [
      '角色（必要）— 接 character-in pill，圖或影片都行，後端自動辨識',
      '驅動影片（必要）— 接 driving-video-in pill，內含想要的臉部 / 身體動作',
      '動態 prompt — 補充情緒 / 場景（選填）',
    ],
    outputs: '時長對齊「驅動影片」；角色維持原本外觀，動作 / 表情換成驅動影片的',
    cost: 'Runway 還沒公開 $/s 數字，現在用 gen4_turbo 5 cr/s 當 placeholder，第一次實打後會校準。',
    bestFor: [
      'MV 主角串連 — 一張角色 sheet + 一支表演驅動 → 整支 MV 同一個人',
      'storyboard 階段：自己用手機拍動作，當驅動影片試做',
      '對嘴 / 抒情 / 戲劇表演（face capture 級的細節）',
    ],
    pitfalls: [
      '欄位 schema 是「依 Runway image_to_video 慣例推測」，第一次跑可能 422，看 error 字串調整',
      'expressionIntensity 1-5：1 = 只給方向、5 = 完全複製，預設不傳（Runway 自動）',
      '驅動影片建議 < 10s，太長 Aleph-style 慢',
    ],
  },

  // ── Seedance (BytePlus Dreamina 2.0) ──────────────────────────────────────
  seedance: {
    id: 'seedance',
    label: 'Seedance 2.0（簡易模式）',
    tagline: '⚠️ 新 workflow 建議用獨立的「Seedance 節點」(palette 上 SD)：有 @Image1-4 多圖 + @Video1/@Audio1 + prompt @-tag 快速插入、tag 映射預覽。這裡的模式為舊 workflow 相容保留。',
    inputs: [
      '起始幀（選填）— Seedance 唯一支援純文生影片',
      '結束幀（選填）— 開啟後變 first/last frame 模式',
      '運鏡參考 video-ref-in（選填）— 用另一支影片當運鏡模板',
      '音訊節奏 audio-ref-in（選填）— lip-sync 或 beat-sync',
      '角色參考圖 0–3 張（選填）— 跨片段一致性',
    ],
    outputs: '4–15 秒任意整數秒；resolution: 480p / 720p / 1080p（fast 上限 720p）',
    cost: 'tokens × $0.000004（placeholder）。720p 5s ≈ $0.44（實測 108_900 tokens / 5s）；1080p 5s ≈ $1.40（推估）。',
    bestFor: [
      '長一鏡到底（5s 不夠用）— 是唯一支援 15s 的主流選項',
      '角色一致性 — 多 reference_image 不需要 Act-Two 那麼重',
      '純文字直出（不想做起始幀）',
    ],
    pitfalls: [
      'fast 變種上限 720p，切過去時 1080p 會自動 clamp',
      'first/last frame 模式會佔掉 reference_image 配額（角色參考圖會被忽略）',
      'seed 不會 echo 回來，要重現先記下',
      '提交 base64 100-300ms 主執行緒阻塞（已知，motion-chain 6 支才修）',
    ],
  },
}

/** Convenience — list in display order for the model select. */
export const VIDEO_MODE_ORDER = ['kling', 'runway', 'runway-aleph', 'runway-act-two', 'seedance']
