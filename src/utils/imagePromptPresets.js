// @ts-check
/**
 * Image-generation prompt presets for WorkflowEditor → GeneratorNode.
 *
 * Each preset bundles a long-form template with named {{placeholders}} so
 * users can pick a curated cinematographic style and only fill in the
 * project-specific bits (brand, archetype, setting). The preset can also
 * recommend an aspect ratio that gets applied alongside the prompt.
 *
 * Adding a preset = push into IMAGE_PROMPT_PRESETS, no UI change required.
 */

/**
 * Two preset modes:
 *
 *   - 'template' (default) — pure client-side {{placeholder}} substitution.
 *     Cheap, deterministic, no API call. `template` field is required.
 *
 *   - 'ai-prompt' — placeholder values get sent to /api/ai-prompt/expand-preset
 *     along with `directive` (system prompt for Claude). The endpoint returns
 *     a long-form English image prompt. Useful when the user only wants to
 *     supply seed details (figure name, style note) and let the LLM fill in
 *     era-specific costume / events / years. Costs one Claude call per click.
 *
 * @typedef {{ key: string, label: string, default: string }} PresetPlaceholder
 * @typedef {{
 *   id: string,
 *   label: string,
 *   description: string,
 *   aspectRatioId?: '9:16' | '16:9' | '1:1' | '4:3' | '3:4',
 *   mode?: 'template' | 'ai-prompt',
 *   placeholders: PresetPlaceholder[],
 *   template?: string,
 *   directive?: string,
 * }} ImagePromptPreset
 */

/** @type {ImagePromptPreset[]} */
export const IMAGE_PROMPT_PRESETS = [
  {
    id: 'hollywood-commercial-board',
    label: '好萊塢工業化 商業廣告 視覺開發板',
    description: '15 秒商業廣告 6 大模塊發板（人設＋場景＋分鏡＋技術參數），16:9',
    aspectRatioId: '16:9',
    placeholders: [
      { key: 'duration',  label: '片長',     default: '15 秒' },
      { key: 'brand',     label: '品牌名',   default: '馬力個B' },
      { key: 'category',  label: '產品類型', default: '運動飲料' },
      { key: 'character', label: '人物特徵', default: '年輕亞洲運動系形象，外型陽光健康、充滿速度感與爆發力' },
      { key: 'setting',   label: '場景設定', default: '跑道、球場或訓練空間' },
    ],
    template:
      '好萊塢工業化標準 {{duration}} 《{{brand}}》{{category}}廣告影視視覺開發板，' +
      '專業電影前期製作全案模板，16:9 橫向構圖，4K 超清，高級商業廣告與影視工業級排版風格，' +
      '完整畫面分為 6 大模塊：' +
      '頂部項目信息欄包含片名、時長、類型、調性；' +
      '左上為雙男女主角人設設計欄，含角色詳細設定、正面 / 側面 / 背面三視圖與面部特寫，' +
      '人物造型 100% 一致無崩壞，男女主角皆為{{character}}；' +
      '右上為核心場景概念圖，場景設定在{{setting}}，' +
      '呈現高強度運動後補充{{brand}}{{category}}的瞬間，瓶身帶冰珠、水氣與清爽反光；' +
      '中部為 3 組鏡頭故事板序列，包含鏡頭參數、運鏡軌跡示意圖、分鏡畫面序列，' +
      '內容依序呈現高強度運動爆發、運動後拿起冰鎮飲料補給、恢復能量後再次投入挑戰與品牌英雄式收尾；' +
      '底部為專業技術參數欄，包含相機運動流程圖、燈光氛圍設定、色卡、專業攝影鏡頭參數，' +
      '整體採冷調寫實電影質感，強調汗水、速度、冰爽、能量補充、青春張力與潮流運動感，' +
      '畫面高細節、無文字錯亂、無畫面崩壞，適配 SEEDANCE 2.0，' +
      'ULTRA-DETAILED, PROFESSIONAL FILM PRODUCTION LAYOUT, ' +
      'SPORTS DRINK COMMERCIAL DEVELOPMENT BOARD, CINEMATIC STORYBOARD SHEET, ' +
      'REALISTIC COOL-TONE FILM LOOK.',
  },
  {
    id: 'historical-figure-infographic',
    label: '人物資訊圖海報（歷史 / 虛擬皆可）',
    description: '只填人物名字 + 整體風格，AI 自動補完背景、服飾、代表事件、關鍵年份。歷史人物、動漫主角、遊戲角色、IP 吉祥物皆適用（呼叫 Claude，需 Anthropic key）',
    aspectRatioId: '9:16',
    mode: 'ai-prompt',
    placeholders: [
      { key: 'figureName', label: '人物名稱', default: '唐太宗李世民' },
      { key: 'styleNote',  label: '整體風格', default: '黑金色調、深色羊皮紙背景、博物館展覽海報感、電影級寫實人物、精緻排版、細線框 UI、金色 serif 字體風格、4K' },
    ],
    directive:
      '你是專業人物資訊圖海報 prompt 工程師。' +
      '\n\n輸入：人物名字 + 整體風格描述。' +
      '\n人物可以是：歷史人物（拿破崙、達文西）、虛擬角色（蒙其·D·魯夫、初音未來）、動漫主角、遊戲角色、電影 / 小說 / 漫畫角色、IP 吉祥物。' +
      '請先判斷人物屬於哪一類，再依下方規則組裝。' +
      '\n\n輸出規格（英文 image generation prompt，150-300 字）：' +
      '\n- 必須完整保留並翻譯 user 的「整體風格」描述為英文，放在 prompt 開頭作為主視覺基調，不可省略或替換色系' +
      '\n- 9:16 直式博物館級資訊圖海報構圖' +
      '\n- 中央全身寫實人物（即使是動漫 / 遊戲角色也用半寫實 / 電影感呈現，不要 flat anime style，除非 styleNote 明確要求），根據人物背景自動決定服飾 / 裝備 / 武器 / 配件 / 姿態' +
      '\n- 左欄：人物簡介、服飾或裝備拆解（含 callout lines）、人生 / 故事時間軸' +
      '\n- 右欄：優點與能力、弱點與爭議、代表事件 / 戰役 / 名場面。歷史人物填真實史實；虛擬角色填作品中的劇情關鍵點（例如「東海冒險」、「頂上戰爭」、「初登場 2007」）' +
      '\n- 底部：地理範圍或勢力地圖（歷史人物用真實地圖；虛擬角色用作品世界觀地圖，例如新世界海域、霍格華茲、提瓦特大陸）、關鍵年份時間軸（歷史人物用真實年份；虛擬角色用作品連載 / 上映 / 設定年份）、歷史 / 文化影響' +
      '\n- 結尾固定加：museum exhibition poster, premium editorial infographic design, ultra detailed, cinematic realism, 4K' +
      '\n- 不要 cartoon / flat vector，除非 styleNote 明確指定' +
      '\n- 文字保留為裝飾性 pseudo-readable' +
      '\n- 純文字段落輸出，不要 markdown 標題或項目符號',
  },
  {
    id: 'anime-character-sheet',
    label: '日漫水墨 角色設定表',
    description: '角色設定參考表（三視圖＋細節特寫＋色卡＋材質＋動作示意），日漫＋水墨風，純模板無需 Claude，3:4 直式',
    aspectRatioId: '3:4',
    placeholders: [
      { key: 'characterName', label: '角色名',   default: '無痕拳者 Wuhen Fist Wanderer' },
      { key: 'characterDesc', label: '角色特徵', default: 'stylized East Asian male martial artist with a 5.5-head anime proportion, compact low center of gravity, agile body, messy tied black hair, sharp eyes, dark indigo short robe over a white inner shirt, loose martial pants, cloth waist tie, cloth shoes, bare hands, no gloves' },
      { key: 'style',         label: '畫風',     default: 'Japanese anime action fused with expressive Chinese ink-wash painting, dry-brush textures, heavy ink splashes, calligraphic speed lines' },
      { key: 'palette',       label: '色彩',     default: 'ink black, deep indigo, slate blue-grey, off-white, warm paper beige' },
    ],
    template:
      'Character design reference sheet (character model sheet / 角色設定表) of {{characterName}}, ' +
      'a {{characterDesc}}. ' +
      'Art style: {{style}}. ' +
      'Layout: one large portrait sheet on an aged warm rice-paper background, professional anime production model-sheet composition, ' +
      'with bilingual Chinese + English section labels, a vertical brush-calligraphy title and a small red seal stamp in the top-left corner. ' +
      'Include all of these modules arranged cleanly: ' +
      '(1) a large dynamic hero martial-arts action pose on the left wrapped in sweeping circular ink-brush motion arcs; ' +
      '(2) a full-body turnaround — front / side / back / three-quarter views, identical costume, proportion and identity across every view; ' +
      '(3) detail close-up studies — hairstyle, collar, waist tie, sleeve cuff and footwear; ' +
      '(4) a horizontal color palette row of paint swatches ({{palette}}); ' +
      '(5) a texture & material study row — cotton/linen weave, wrapped cloth, ink splash, rice-paper grain; ' +
      '(6) a bottom row of gesture / action pose studies. ' +
      'Character identity stays 100% consistent across every panel, no model collapse, no extra characters. ' +
      'Bold brushstroke textures, heavy ink splashes, dry-brush edges, calligraphic speed trails, muted indigo-and-ink palette on warm paper. ' +
      'ULTRA-DETAILED, PROFESSIONAL ANIME CHARACTER MODEL SHEET, CHINESE INK-WASH FUSED WITH JAPANESE ANIME, RICE PAPER TEXTURE, ' +
      'clean editorial layout, decorative pseudo-readable labels, no garbled text, no random gibberish.',
  },
]

/**
 * Substitute {{key}} occurrences in the template with values. Missing keys
 * fall back to the placeholder's default. Unknown {{key}} markers (not in
 * the preset's placeholders array) are left as-is so authoring mistakes
 * are visible in the output rather than silently dropped.
 *
 * @param {ImagePromptPreset} preset
 * @param {Record<string, string>} [values]
 * @returns {string}
 */
export function applyPreset(preset, values) {
  if (!preset?.template) return ''
  let out = preset.template
  for (const ph of preset.placeholders ?? []) {
    const v = values?.[ph.key] ?? ph.default ?? ''
    out = out.split(`{{${ph.key}}}`).join(v)
  }
  return out
}
